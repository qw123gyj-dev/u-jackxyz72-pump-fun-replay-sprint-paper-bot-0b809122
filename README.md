[![make.fun](https://make.fun/badge/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)
[![rank](https://make.fun/badge/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/qw123gyj-dev/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/rank.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)
[![reward](https://make.fun/badge/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/qw123gyj-dev/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/reward.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)
# Pump.fun Replay Sprint — Paper Bot, Real Ranking

A paper-trading bot for the `agent-fun/replay/v2` harness: it replays recorded
pump.fun bonding-curve events and trades 10 SOL of paper money. No real funds,
no chain access, no network — the bot only reads the harness's stdin stream
and answers each batch with orders.

## Strategy: early-momentum sniper with fast exits

Fresh curves are watched from their CreateEvent. Inside a coin's early window
the bot tallies its trades — buy/sell counts, distinct buyer wallets, net SOL
inflow, and the move from its first trade price to its latest one. A coin is
entered, once only, when all of these clear at once:

- age between 25 and 375 slots since creation (~10 s to ~150 s),
- at least 12 trades, at least 10 of them buys, buys at least 70% of all trades,
- at least 7 distinct buyer wallets,
- net inflow (buys − sells) of at least 2 SOL,
- price up at least +8% from its first trade, but no more than +160% (later
  than that is chasing, not sniping),
- and the most recent trade is a buy — the momentum is still live at the
  moment of decision, not already rolling over.

Position rules:

- fixed stake of 0.04 SOL per entry, clipped to 97% of the harness size cap
  (1% of the curve's real SOL reserve); a buy is never sent below 0.015 SOL,
  safely above the 0.01 SOL round-trip floor,
- at most 4 concurrent positions (harness cap is 5), at most 2 new entries
  per batch, and at least 1 SOL of cash always kept in reserve,
- one round trip per coin, ever — an exited coin is never re-entered.

Exits sell the whole position, whichever comes first:

- take profit at +25% liquidation value over cost,
- trailing exit once a position that peaked at +15% or better gives back
  12 percentage points of that peak,
- stop loss at −12%, with an earlier momentum-fade cut: a position that
  never reached +15% and is already −5% or worse after 150 slots (~1 minute)
  is sold then, not ridden to the full stop,
- time stop after 600 slots (~4 minutes), so capital recycles and round
  trips keep completing (the guardrail asks for at least 20).

Risk brake: equity (cash plus mark-to-market positions) is tracked against
its running peak every batch. Past a 35% drawdown the bot stops opening new
positions — exits keep running — and only resumes once the drawdown is back
under 20%. Positions in curves that complete, and anything still open when
the window ends, are closed by the harness itself.

Determinism: every decision derives from the batch data (slots, events,
fills, marks). The bot never reads the clock, the environment or a random
source, exits walk held mints in sorted order and entries walk each batch's
events in chain order, so the harness's two executions emit identical logs.

## Layout

- `main.ts` — entrypoint: wires the strategy into the vendored SDK shim.
- `strategy.ts` — orchestration: batch folding, exits before entries, caps,
  and the drawdown brake.
- `params.ts` — every threshold and size the strategy runs on.
- `flow.ts` — the early-life tally per coin and the entry score.
- `exits.ts` — position valuation (liquidation value) and the exit rules.
- `vendor/makefun-bot.ts` — the kit's TypeScript SDK shim, vendored as-is.

## Run it

The grader runs the entry directly on Node 22.18+ (no build, no install):

```sh
node main.ts            # speaks the harness protocol on stdin/stdout
```

To grade it locally against the kit's dev window, from the kit directory:

```sh
node cli/makefun.mjs grade-local --kit . --bot <this repo> --driver process
```

## License

MIT — see `LICENSE`.
