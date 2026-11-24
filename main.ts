// Pump.fun Replay Sprint — paper bot entrypoint.
//
// Run by the grader as `node /bot/main.ts` (Node 22, types stripped, no
// build step). The wire protocol — hello, batch, orders, slot bookkeeping —
// is owned by the vendored SDK shim in vendor/makefun-bot.ts; everything
// that decides what to buy or sell lives in strategy.ts, hand-written for
// this entry: an early-momentum sniper with fast exits (see README.md).
//
// The strategy is a pure function of the batch stream: no clock reads, no
// randomness, no network, so the harness's two executions of this file over
// the same window produce byte-identical action logs.

import { runBot } from './vendor/makefun-bot.ts';
import { createSniper } from './strategy.ts';
import { PARAMS } from './params.ts';

const onBatch = createSniper(PARAMS);

await runBot({
  onHello(state) {
    console.error(
      `hello: capital=${state.hello.capital.lamports} lamports, ` +
        `max_open=${state.hello.caps.max_open_positions}, ` +
        `max_orders_per_batch=${state.hello.caps.max_orders_per_batch}`,
    );
  },
  onBatch,
  onDone(state, done) {
    console.error(`done: reason=${done.reason}, cash=${state.cash.toString()} lamports`);
  },
});
