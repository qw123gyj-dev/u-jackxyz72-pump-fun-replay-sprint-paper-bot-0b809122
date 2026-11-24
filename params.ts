// Tunable parameters for the early-momentum sniper.
//
// Every value here was chosen against the harness's own economics: 10 SOL of
// paper capital, at most 5 open positions, a per-coin buy cap of 1% of the
// curve's real SOL reserve, roughly 1.25% of curve fees on a round trip and
// 105,000 lamports of transaction fees on every order, filled or not. Small
// stakes and fast exits keep the fixed fees from dominating; the demand
// thresholds keep the bot out of coins nobody is actually buying.

export interface SniperParams {
  /** Slots after a coin's CreateEvent during which it may still be entered. */
  entryWindowSlots: number;
  /** Earliest slot offset at which the demand score is even looked at. */
  minAgeSlots: number;
  /** TradeEvents (buys + sells) the coin must show inside the window. */
  minTrades: number;
  /** Of those, at least this many must be buys. */
  minBuyTrades: number;
  /** Buy trades must be at least this share of all trades (0..1). */
  minBuyShare: number;
  /** Distinct buyer wallets required inside the window. */
  minDistinctBuyers: number;
  /** Net SOL inflow (buys minus sells, lamports) required inside the window. */
  minNetInflowLamports: bigint;
  /** Last early price must be at least first early price * (1 + this). */
  minEarlyGain: number;
  /** ...and at most first early price * (1 + this): later is chasing. */
  maxEarlyGain: number;
  /** The most recent early trade must be a buy: momentum still live. */
  lastTradeMustBeBuy: boolean;
  /** Fixed stake per entry, before the harness size cap clips it. */
  stakeLamports: bigint;
  /** Never send a buy smaller than this (also the round-trip floor). */
  minBuyLamports: bigint;
  /** Our own cap on simultaneous positions, on top of the harness cap. */
  maxConcurrent: number;
  /** Most new entries sent in a single batch reply. */
  maxEntriesPerBatch: number;
  /** Cash (lamports) that must stay uncommitted after a new entry. */
  cashReserveLamports: bigint;
  /** Sell everything once liquidation value reaches cost * (1 + this). */
  takeProfit: number;
  /** Sell everything once liquidation value falls to cost * (1 - this). */
  stopLoss: number;
  /** A position that never took off is cut early: after this many slots... */
  fadeStopSlots: number;
  /** ...if it is already this far under water and never armed the trail. */
  fadeStopLoss: number;
  /** Trailing exit arms once the gain reaches this... */
  trailingArmGain: number;
  /** ...and fires when the gain gives back this many points from its peak. */
  trailingGiveback: number;
  /** Sell everything after holding this many slots, win or lose. */
  maxHoldSlots: number;
  /** Brake: stop opening while equity is more than this below its peak. */
  drawdownBrake: number;
  /** ...and only resume opening once it is back within this of the peak. */
  drawdownRelease: number;
  /** Slippage tolerance (bps) for buys and for sells. */
  buySlippageBps: number;
  sellSlippageBps: number;
}

export const PARAMS: SniperParams = {
  entryWindowSlots: 375, // ~150 seconds of slots: the coin's early life only
  minAgeSlots: 25, // let the first burst of trades actually happen first
  minTrades: 12,
  minBuyTrades: 10,
  minBuyShare: 0.7,
  minDistinctBuyers: 7,
  minNetInflowLamports: 2_000_000_000n, // 2 SOL of net demand
  minEarlyGain: 0.08,
  maxEarlyGain: 1.6,
  lastTradeMustBeBuy: true,
  stakeLamports: 40_000_000n, // 0.04 SOL
  minBuyLamports: 15_000_000n, // 0.015 SOL, safely above the 0.01 SOL floor
  maxConcurrent: 4,
  maxEntriesPerBatch: 2,
  cashReserveLamports: 1_000_000_000n, // always keep 1 SOL in hand
  takeProfit: 0.25,
  stopLoss: 0.12,
  fadeStopSlots: 150, // ~1 minute: long enough for the fill burst to settle
  fadeStopLoss: 0.05,
  trailingArmGain: 0.15,
  trailingGiveback: 0.12,
  maxHoldSlots: 600, // ~4 minutes of slots, then the capital moves on
  drawdownBrake: 0.35,
  drawdownRelease: 0.2,
  buySlippageBps: 800,
  sellSlippageBps: 3000,
};
