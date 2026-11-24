// Early-momentum sniper for the pump.fun replay harness (agent-fun/replay/v2).
//
// Thesis: on a fresh bonding curve, the first minute or so tells you whether
// anyone actually wants the coin. A coin that, inside its early window, pulls
// in several distinct buyers, a clear majority of buy trades and a meaningful
// amount of net SOL — while its price is already moving up, not down — has
// real early demand. We take one small, fixed-size bite of those coins, and
// we leave quickly: a modest take-profit, a tighter stop-loss, a trailing
// exit for stalled winners, and a short time-stop so the same SOL keeps
// recycling into the next candidate. Fast recycling is also what gets us
// past the guardrail of twenty completed round trips of at least 0.01 SOL
// without ever concentrating the book.
//
// The pieces live in sibling modules: params.ts holds every threshold,
// flow.ts the early-life tally and entry score, exits.ts the valuation and
// exit rules. This file is the wiring: fold the batch in, run exits before
// entries, respect the caps, and track the drawdown brake.
//
// Determinism: every number comes out of the batch stream itself — slots,
// event fields, fills and marks. No clock, no randomness, no environment,
// no iteration over unordered state: exits walk the held mints in sorted
// order and entries walk the batch's events in chain order, so two runs
// over the same window emit byte-identical orders.

import type { Batch, BotState, Mark, OrderInput, Pubkey } from './vendor/makefun-bot.ts';
import { PARAMS, type SniperParams } from './params.ts';
import { applyTrade, newEarlyBook, passesEntryScore, type EarlyBook } from './flow.ts';
import { newOpenBook, sellAllValue, shouldExit, type OpenBook } from './exits.ts';

/** The harness size cap for a mint, shaved a little so our own flow cannot push a buy past it. */
function clippedCap(state: BotState, mint: Pubkey): bigint {
  return (state.maxBuyLamports(mint) * 97n) / 100n;
}

function hasPendingOn(state: BotState, mint: Pubkey): boolean {
  for (const pend of state.pending.values()) if (pend.order.mint === mint) return true;
  return false;
}

export function createSniper(p: SniperParams = PARAMS) {
  const early = new Map<Pubkey, EarlyBook>();
  const open = new Map<Pubkey, OpenBook>();
  /** Every mint we have ever entered: one round trip per coin, ever. */
  const spentCoins = new Set<Pubkey>();
  let peakEquity = -1n;
  let brakeOn = false;

  function watchBook(mint: Pubkey, createdSlot: number): EarlyBook {
    let b = early.get(mint);
    if (b === undefined) {
      b = newEarlyBook(createdSlot);
      early.set(mint, b);
    }
    return b;
  }

  return function onBatch(state: BotState, batch: Batch): OrderInput[] {
    const slot = batch.slot;
    const orders: OrderInput[] = [];
    const orderCap = state.hello.caps.max_orders_per_batch;
    const txFee = state.txFeeLamports();

    const marks = new Map<Pubkey, Mark>();
    for (const m of batch.marks) marks.set(m.mint, m);

    // ---- learn from this batch's events, in chain order -------------------
    // Coins touched by a trade this batch, in first-touch order: the only
    // coins whose entry score can have changed, and a deterministic order.
    const touched: Pubkey[] = [];
    for (const e of batch.events) {
      if (e.event === 'CreateEvent') {
        watchBook(e.mint, e.slot);
        continue;
      }
      if (e.event === 'CompleteEvent') {
        const b = early.get(e.mint);
        if (b !== undefined) b.dead = true;
        continue;
      }
      // TradeEvent. A mint first seen through a trade is watched from this
      // slot; it simply gets a shorter runway.
      applyTrade(watchBook(e.mint, e.slot), e);
      if (!touched.includes(e.mint)) touched.push(e.mint);
    }

    // ---- fills: notice exits that landed ----------------------------------
    for (const f of batch.fills) {
      if (f.side !== 'sell') continue;
      const ob = open.get(f.mint);
      if (ob === undefined) continue;
      ob.exiting = false; // resolved either way; if tokens remain we may retry
      if (!state.positions.has(f.mint)) open.delete(f.mint);
    }

    // ---- register freshly filled positions --------------------------------
    for (const mint of state.positions.keys()) {
      if (spentCoins.has(mint) && !open.has(mint)) {
        open.set(mint, newOpenBook(slot));
      }
    }

    // ---- drawdown brake ----------------------------------------------------
    // Equity is cash plus what every position would sell for right now
    // (cost stands in for a position the batch gave us no mark for).
    let equity = state.cash;
    for (const [mint, h] of state.positions) {
      const v = sellAllValue(marks.get(mint), h.token_amount);
      equity += v >= 0n ? v : h.cost_lamports;
    }
    if (peakEquity < 0n || equity > peakEquity) peakEquity = equity;
    if (peakEquity > 0n) {
      const dd = Number(peakEquity - equity) / Number(peakEquity);
      if (!brakeOn && dd > p.drawdownBrake) brakeOn = true;
      if (brakeOn && dd < p.drawdownRelease) brakeOn = false;
    }

    // ---- exits first: they free the slots and the cash entries need -------
    const heldSorted = [...state.positions.keys()].sort();
    for (const mint of heldSorted) {
      if (orders.length >= orderCap) break;
      const h = state.positions.get(mint)!;
      const ob = open.get(mint);
      if (ob === undefined || ob.exiting) continue;
      if (hasPendingOn(state, mint)) continue;
      const curve = state.curves.get(mint);
      if (curve === undefined || curve.complete) continue; // the harness closes those itself
      const value = sellAllValue(marks.get(mint), h.token_amount);
      if (!shouldExit(p, ob, value, h.cost_lamports, slot - ob.entrySlot)) continue;
      orders.push({
        side: 'sell',
        mint,
        token_amount: h.token_amount,
        max_slippage_bps: p.sellSlippageBps,
      });
      ob.exiting = true;
    }

    // ---- entries: score the coins that traded this batch -------------------
    if (!brakeOn) {
      let entries = 0;
      let committed = state.committedPositionCount();
      const room = Math.min(p.maxConcurrent, state.hello.caps.max_open_positions);
      for (const mint of touched) {
        if (orders.length >= orderCap || entries >= p.maxEntriesPerBatch) break;
        if (committed >= room) break;
        const b = early.get(mint);
        if (b === undefined || b.dead || b.entered) continue;
        if (spentCoins.has(mint) || state.positions.has(mint)) continue;
        if (hasPendingOn(state, mint)) continue;
        const curve = state.curves.get(mint);
        if (curve === undefined || curve.complete) continue;
        if (!passesEntryScore(p, b, slot)) continue;

        // Size: the fixed stake, clipped by the harness's per-coin cap
        // (1% of the curve's real SOL reserve). Below our floor the coin is
        // not skipped for good — a later batch inside the window may find
        // the cap grown — but nothing is sent now.
        let amount = p.stakeLamports;
        const cap = clippedCap(state, mint);
        if (amount > cap) amount = cap;
        if (amount < p.minBuyLamports) continue;
        if (state.freeCashLamports() - amount - txFee < p.cashReserveLamports) continue;

        orders.push({
          side: 'buy',
          mint,
          quote_lamports: amount,
          max_slippage_bps: p.buySlippageBps,
        });
        b.entered = true;
        spentCoins.add(mint);
        entries += 1;
        committed += 1;
      }
    }

    // ---- forget coins whose early window has closed and that we never held -
    for (const [mint, b] of early) {
      if (slot - b.createdSlot > p.entryWindowSlots && !state.positions.has(mint)) {
        early.delete(mint);
      }
    }

    return orders;
  };
}
