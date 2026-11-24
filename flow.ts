// Early-life bookkeeping and the entry score.
//
// For every coin we see created we keep a small running tally of its first
// trades: how many there were, which side they were on, who bought, how much
// SOL flowed in net, and where the price went between the first and the most
// recent trade. The tally is all the entry decision ever looks at, and it is
// a pure fold over the event stream — same events in, same tally out.

import type { Pubkey, TradeEventRecord } from './vendor/makefun-bot.ts';
import type { SniperParams } from './params.ts';

/** Running tally of one coin's early life, built event by event. */
export interface EarlyBook {
  createdSlot: number;
  trades: number;
  buyTrades: number;
  sellTrades: number;
  buySol: bigint;
  sellSol: bigint;
  buyers: Set<Pubkey>;
  firstPrice: number;
  lastPrice: number;
  lastWasBuy: boolean;
  /** We already sent our one entry (filled or not): never again. */
  entered: boolean;
  /** The coin's curve completed while we only watched it. */
  dead: boolean;
}

export function newEarlyBook(createdSlot: number): EarlyBook {
  return {
    createdSlot,
    trades: 0,
    buyTrades: 0,
    sellTrades: 0,
    buySol: 0n,
    sellSol: 0n,
    buyers: new Set<Pubkey>(),
    firstPrice: 0,
    lastPrice: 0,
    lastWasBuy: false,
    entered: false,
    dead: false,
  };
}

/** Marginal price (quote per token) implied by a pair of virtual reserves. */
export function priceOf(virtualQuote: bigint, virtualTokens: bigint): number {
  if (virtualTokens === 0n) return 0;
  return Number(virtualQuote) / Number(virtualTokens);
}

/** Fold one trade into the coin's tally. */
export function applyTrade(b: EarlyBook, e: TradeEventRecord): void {
  const price = priceOf(BigInt(e.virtual_quote_reserves), BigInt(e.virtual_token_reserves));
  if (b.trades === 0) b.firstPrice = price;
  b.lastPrice = price;
  b.trades += 1;
  b.lastWasBuy = e.is_buy;
  if (e.is_buy) {
    b.buyTrades += 1;
    b.buySol += BigInt(e.sol_amount);
    b.buyers.add(e.user);
  } else {
    b.sellTrades += 1;
    b.sellSol += BigInt(e.sol_amount);
  }
}

/**
 * The demand score: does this coin, at this slot, show the early momentum we
 * snipe? All thresholds come from the params; the checks are ordered so the
 * cheapest rejections (age, counts) run before the arithmetic ones.
 */
export function passesEntryScore(p: SniperParams, b: EarlyBook, slot: number): boolean {
  const age = slot - b.createdSlot;
  if (age < p.minAgeSlots || age > p.entryWindowSlots) return false;
  if (b.trades < p.minTrades || b.buyTrades < p.minBuyTrades) return false;
  if (b.buyTrades / b.trades < p.minBuyShare) return false;
  if (b.buyers.size < p.minDistinctBuyers) return false;
  if (b.buySol - b.sellSol < p.minNetInflowLamports) return false;
  if (p.lastTradeMustBeBuy && !b.lastWasBuy) return false;
  if (b.firstPrice <= 0 || b.lastPrice <= 0) return false;
  const gain = b.lastPrice / b.firstPrice - 1;
  if (gain < p.minEarlyGain || gain > p.maxEarlyGain) return false;
  return true;
}
