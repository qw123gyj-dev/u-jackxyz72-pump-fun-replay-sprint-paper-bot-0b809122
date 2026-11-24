// Position valuation and the exit rules.
//
// A position is priced by what selling all of it would actually pay: the
// constant-product payout against the reserves the harness last marked for
// the mint, capped at the curve's real quote reserve, with the curve fees
// taken off the top. Every exit compares that liquidation value with what
// the position cost us — never with a spot price that ignores slippage.

import type { Mark } from './vendor/makefun-bot.ts';
import type { SniperParams } from './params.ts';

/** What we remember about a position we opened. */
export interface OpenBook {
  /** Slot at which the position first appeared in our account. */
  entrySlot: number;
  /** A full-exit sell is in flight; do not send another. */
  exiting: boolean;
  /** Best liquidation gain (fraction over cost) seen for this position. */
  peakGain: number;
}

export function newOpenBook(entrySlot: number): OpenBook {
  return { entrySlot, exiting: false, peakGain: 0 };
}

const CURVE_FEE_BPS = 125n; // protocol + creator fallback, rounded up
const BPS_WHOLE = 10_000n;

/**
 * What selling `tokens` would pay right now, per the mark. Returns -1 when
 * there is no mark to price against.
 */
export function sellAllValue(mark: Mark | undefined, tokens: bigint): bigint {
  if (mark === undefined || tokens <= 0n) return -1n;
  const vQuote = BigInt(mark.virtual_quote_reserves);
  const vTokens = BigInt(mark.virtual_token_reserves);
  const rQuote = BigInt(mark.real_quote_reserves);
  if (vTokens + tokens === 0n) return -1n;
  let gross = (tokens * vQuote) / (vTokens + tokens);
  if (gross > rQuote) gross = rQuote;
  const fee = (gross * CURVE_FEE_BPS + BPS_WHOLE - 1n) / BPS_WHOLE;
  return gross - fee;
}

/**
 * Decide whether a held position exits on this batch. Side effect: the
 * position's peak gain is updated from the current value first, so the
 * trailing rule always compares against the best mark seen so far.
 *
 * Exits, in the order they are checked:
 *  - take profit at the set gain,
 *  - stop loss at the set loss,
 *  - trailing exit: armed at the set gain, fired when the gain gives back
 *    the set number of points from its peak (a stalled winner is sold while
 *    it is still ahead instead of being ridden down to the time-stop),
 *  - momentum fade: a position that never armed the trailing exit and is
 *    already under water after the fade window is cut early — the early
 *    demand we bought on has demonstrably not carried through,
 *  - time stop at the set holding length, which fires even when there is
 *    no mark to price against — stale capital is recycled regardless.
 */
export function shouldExit(
  p: SniperParams,
  ob: OpenBook,
  value: bigint,
  costLamports: bigint,
  heldForSlots: number,
): boolean {
  if (value >= 0n && costLamports > 0n) {
    const gain = Number(value - costLamports) / Number(costLamports);
    if (gain > ob.peakGain) ob.peakGain = gain;
    if (gain >= p.takeProfit) return true;
    if (gain <= -p.stopLoss) return true;
    if (ob.peakGain >= p.trailingArmGain && gain <= ob.peakGain - p.trailingGiveback) return true;
    if (heldForSlots >= p.fadeStopSlots && ob.peakGain < p.trailingArmGain && gain <= -p.fadeStopLoss) return true;
  }
  return heldForSlots >= p.maxHoldSlots;
}
