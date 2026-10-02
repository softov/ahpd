import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import type { Bag, Session, Start } from '@ahpd/sdk';
import { acpAgent } from '../src/index.js';

/*
 * What an ACP turn costs.
 *
 * ACP has no per-call counts: the `usage_update` it sends is a cost for the
 * whole session, and the only tokens a turn has are the ones its prompt
 * response carries at the end. Both arrive on the same `chat/usage` as the
 * other backends send, so a client reads one number that grows and ends as the
 * turn's whole cost.
 *
 * The server is the real subprocess (`test/fixtures/acp-server.mjs`), whose
 * books start above zero: a client that had nothing to count from can only tell
 * what a turn spent by subtracting what the session had spent before it began,
 * and a fixture starting at nought would not prove it does.
 */

const FIXTURE = fileURLToPath(new URL('./fixtures/acp-server.mjs', import.meta.url));

/** The subprocess's work finishing, up to a point. */
const until = async (check: () => boolean, times = 3000): Promise<void> => {
  for (let i = 0; i < times; i++) {
    if (check()) return;
    await new Promise((resolve) => { setTimeout(resolve, 1); });
  }
};

const started: Session[] = [];

afterEach(async () => {
  for (const session of started.splice(0)) await session.close();
});

/** A session over the fixture server, with every action it emits kept. */
function talking(...flags: string[]): { session: Session; actions: Bag[] } {
  const actions: Bag[] = [];
  const agent = acpAgent({ command: process.execPath, args: [FIXTURE, ...flags], provider: 'acp-usage' });
  const opening: Start = {
    uri: 'ahp-session:/usage',
    chatUri: 'ahp-chat:/usage',
    settings: {},
    schema: () => ({ type: 'object', properties: {} }),
    emit: (_channel, action) => { actions.push(action); },
  };
  const session = agent.create(opening);
  started.push(session);
  return { session, actions };
}

const bag = (value: unknown): Bag => (typeof value === 'object' && value !== null ? value as Bag : {});

/** The usage reports the chat was sent, in order. */
const reports = (actions: Bag[]): Bag[] =>
  actions.filter((action) => action.type === 'chat/usage').map((action) => bag(action.usage));

/** What each report says the turn had cost, in the order they went out. */
const amounts = (actions: Bag[]): unknown[] =>
  reports(actions).map((usage) => bag(bag(usage._meta).cost).amount);

/** The usage the finished turn holds, as a client reading the snapshot sees it. */
const held = (session: Session): Bag => {
  const state = bag(session.chatState());
  const turns = state.turns as unknown[] | undefined;
  return bag(bag(turns?.at(-1)).usage);
};

/** One turn, run to its end. */
async function turn(session: Session, actions: Bag[], turnId: string, text: string): Promise<void> {
  const before = actions.length;
  session.begin(turnId, text);
  await until(() => actions.slice(before).some((action) => action.type === 'chat/turnComplete'
    || action.type === 'chat/turnCancelled'
    || action.type === 'chat/error'));
}

it('sends the change in the session cost as each update lands', async () => {
  const { session, actions } = talking();
  await turn(session, actions, 't1', 'spend some of it');

  // A dollar charged before this bridge saw the session, then a quarter and
  // half a dollar more. Nothing said what the session had spent before this
  // turn, so the first count is the whole of what the bridge can see.
  expect(amounts(actions)).toEqual([1.25, 1.75, 1.75]);
  for (const usage of reports(actions)) {
    // The context window is not what the turn spent, so it is reported beside
    // the cost in `_meta` and as nothing a token count could be read out of.
    expect(usage).toEqual({
      _meta: { context: { used: 4200, size: 200000 }, cost: { amount: expect.any(Number), currency: 'USD' } },
    });
  }
  // Before the turn ends, as every other backend's running total goes out.
  const said = actions.map((action) => action.type);
  expect(said.indexOf('chat/usage')).toBeLessThan(said.indexOf('chat/turnComplete'));

  // And the turn holds what it last said, for a client that reads the snapshot.
  expect(held(session)).toEqual(reports(actions).at(-1));
});

it('sends the context on its own when the server reported no cost', async () => {
  const { session, actions } = talking();
  await turn(session, actions, 't1', 'fill the window');

  // The update, then the prompt's response carrying nothing but the context the
// update already reported: the protocol replaces the turn's usage rather than
// adding to it, so the last word has to carry what the turn knows.
expect(reports(actions)).toEqual([
  { _meta: { context: { used: 4200, size: 200000 } } },
  { _meta: { context: { used: 4200, size: 200000 } } },
]);
});

it('counts a second turn from where the first left the books', async () => {
  const { session, actions } = talking();
  await turn(session, actions, 't1', 'spend some of it');
  await turn(session, actions, 't2', 'spend some more');

  // Nothing of the first turn's cost is charged to the second: what this turn
  // spent is counted from the 1.75 the first one left, so it is the quarter and
  // the half it was charged and not the session's whole again.
  expect(amounts(actions)).toEqual([1.25, 1.75, 1.75, 0.25, 0.75, 0.75]);
});

it('counts the first turn from a cost the server reported before it', async () => {
  const { session, actions } = talking('--books');
  await turn(session, actions, 't1', 'spend some of it');

  // The dollar spent before this bridge attached was reported outside any
  // turn, so this turn is charged only the quarter and the half it spent.
  expect(amounts(actions)).toEqual([0.25, 0.75, 0.75]);
});

it('sends the tokens the prompt response counted, with the cost it did not', async () => {
  const { session, actions } = talking();
  await turn(session, actions, 't1', 'spend and count the tokens');

  const said = reports(actions);
  expect(said).toHaveLength(3);
  // The last report is the turn's own: the counts the response carried, and
  // the price the updates carried, which the response says nothing about.
  expect(said.at(-1)).toEqual({
    inputTokens: 1000,
    outputTokens: 400,
    cacheReadTokens: 40,
    _meta: {
      cacheWriteTokens: 10,
      reasoningTokens: 80,
      cost: { amount: 1.75, currency: 'USD' },
      context: { used: 4200, size: 200000 },
    },
  });
  // And it lands before the ending action, which is what moves the turn into
  // the history a client reads it back from.
  const order = actions.map((action) => action.type);
  expect(order.lastIndexOf('chat/usage')).toBeLessThan(order.indexOf('chat/turnComplete'));
  expect(held(session)).toEqual(said.at(-1));

});

it('sends the cost alone when the response counted nothing', async () => {
  const { session, actions } = talking();
  await turn(session, actions, 't1', 'spend without a count');

  // A response that says nothing about tokens is ordinary: the field is
  // unstable and optional, and what the updates already reported is the whole
  // of what this turn knows.
  expect(reports(actions).at(-1)).toEqual({
    _meta: { cost: { amount: 1.75, currency: 'USD' }, context: { used: 4200, size: 200000 } },
  });
});

it('sends no usage for a turn whose server reported none', async () => {
  const { session, actions } = talking();
  await turn(session, actions, 't1', 'say nothing about it');

  expect(reports(actions)).toEqual([]);
});
