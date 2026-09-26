/*
 * Lifecycles, with more than one client watching.
 *
 * A session is created, spoken to and read back; a second client joins while
 * a turn is running and has to be told the same story; a client hangs up in
 * the middle and its replacement has to be given what it missed exactly once.
 * Each ends by replaying what a client was sent onto the snapshot it opened
 * with and comparing that against the host - which is the property all three
 * are about, and the one a single-client test cannot check.
 */

import { expect, it, describe } from 'vitest';
import { conversation, scenario } from './scenario.js';

const SESSION = 'ahp-session:/one';
const CHAT = 'ahp-chat:/one';

/** Say something, as a client dispatching a turn does. */
const say = (id: string, text: string): { method: string; params: Record<string, unknown> } => ({
  method: 'dispatchAction',
  params: { channel: CHAT, action: { type: 'chat/turnStarted', turnId: id, message: { text } } },
});

/** A host with one echo session, and one client watching both its channels. */
async function started() {
  const run = scenario();
  const first = await run.join('first');
  await first.handle({ method: 'createSession', params: { channel: SESSION, provider: 'echo' } });
  await first.subscribe(SESSION);
  await first.subscribe(CHAT);
  return { run, first };
}

describe('a session is created, spoken to, and read back', () => {
  it('leaves the client agreeing with the host about what was said', async () => {
    const { run, first } = await started();

    await first.handle(say('t1', 'hello there'));
    await run.settle();

    // The turn is in the host's own state, not only in what it announced.
    expect(conversation(await run.truth(CHAT))).toBe(1);
    expect(await run.agrees(first, CHAT)).toBe(true);

    // And the actions carry a sequence that only goes up, which is what a
    // resuming client measures its gap against.
    const seqs = first.delivered(CHAT).map((one) => one.serverSeq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
  });
});

describe('a second client on a session that is already going', () => {
  it('is given a snapshot that already contains what it did not watch happen', async () => {
    const { run, first } = await started();
    await first.handle(say('t1', 'before the second client'));
    await run.settle();

    const second = await run.join('second');
    const seen = await second.subscribe(CHAT);
    // Not an empty conversation with a promise to catch up: the snapshot is
    // the whole of what the host holds, which is what makes a late join
    // indistinguishable from an early one.
    expect(conversation(seen)).toBe(conversation(await run.truth(CHAT)));

    await second.handle(say('t2', 'and now this one'));
    await run.settle();

    // Both agree, from different starting points - the first from an empty
    // chat plus two turns of actions, the second from one turn plus one.
    expect(await run.agrees(first, CHAT)).toBe(true);
    expect(await run.agrees(second, CHAT)).toBe(true);
  });

  it('sees the turn its neighbour started, attributed to the client that sent it', async () => {
    const { run, first } = await started();
    const second = await run.join('second');
    await second.subscribe(CHAT);

    await first.handle(say('t1', 'said by the first'));
    await run.settle();

    const heard = second.delivered(CHAT).find((one) => one.action.type === 'chat/turnStarted');
    expect(heard).toBeDefined();
    // Which client dispatched it, so a client can tell its own echo from
    // somebody else typing in the same session on another machine.
    expect(heard?.origin?.clientId).toBe('first');
  });
});

describe('a client that hangs up in the middle', () => {
  it('is not still being written to, and its replacement is given the whole story', async () => {
    const { run, first } = await started();
    await first.handle(say('t1', 'the first thing'));
    await run.settle();
    const before = first.delivered(CHAT).length;

    first.close();

    // The conversation carries on without it.
    const second = await run.join('second');
    await second.subscribe(CHAT);
    await second.handle(say('t2', 'the second thing'));
    await run.settle();

    // Nothing more was delivered to the connection that went. A host still
    // notifying a closed peer is a leak that only shows up as memory, and
    // only on a host somebody has been reconnecting to for a week.
    expect(first.delivered(CHAT)).toHaveLength(before);

    // And the one that arrived after the fact holds what the host holds.
    expect(await run.agrees(second, CHAT)).toBe(true);
    expect(conversation(await run.truth(CHAT))).toBe(2);
  });

  it('leaves the session running for everybody else', async () => {
    const { run, first } = await started();
    const second = await run.join('second');
    await second.subscribe(CHAT);

    first.close();

    await second.handle(say('t1', 'still here'));
    await run.settle();

    expect(await run.agrees(second, CHAT)).toBe(true);
    expect(conversation(await run.truth(CHAT))).toBe(1);
  });
});
