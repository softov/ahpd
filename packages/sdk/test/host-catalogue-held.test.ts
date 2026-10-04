import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHost, hello, machine, peer, resetSdk, settle } from './support/host.js';
import { echo } from '../../../examples/echo/agent.js';
import type { Agent, Listed } from '@ahpd/sdk';

/*
 * The catalogue is held, and a refresh says what it found.
 *
 * A listing is the most expensive thing this host does: it is a pass over every
 * transcript every backend knows about, and `listSessions` was one of those, as
 * was every subscribe to a session this host is not running. So the rows are
 * held, a client is answered from them, and a refresh started behind an answer
 * brings them up to date - which is why a client that asks twice pays for one
 * pass and still hears about the session that appeared in between.
 *
 * What a refresh found goes out as the three notifications the protocol already
 * has rather than as a way for clients to find out. A client that has to ask
 * again to learn what moved is a client paying for a pass per change, and the
 * change is the cheap part.
 */

vi.mock('@anthropic-ai/claude-agent-sdk', async () => (await import('./support/claude-sdk.js')).fake);

beforeEach(resetSdk);

const PATH = '/home/softov';

/** How long one pass over the backend's store takes. */
const WAIT = 100;

/** One row, as a backend answers it. */
const row = (id: string, title: string): Listed => ({
  id,
  title,
  createdAt: '2026-09-27T00:00:00.000Z',
  modifiedAt: '2026-09-27T09:00:00.000Z',
  workingDirectories: [`file://${PATH}`],
});

interface Store {
  rows: Listed[];
  /** How many times `list` was asked, which is one pass each. */
  calls: number;
  /** How many of those answers have come back. */
  done: number;
  /** Whether the next answers throw, as a store that cannot be read would. */
  refuse: boolean;
}

const store = (rows: Listed[]): Store => ({ rows, calls: 0, done: 0, refuse: false });

/** A backend whose `list` takes `WAIT` and answers from a store a test edits. */
const backend = (here: Store, provider = 'slow'): Agent => ({
  ...echo({ path: PATH }),
  provider,
  displayName: provider,
  directories: () => [PATH],
  list: async () => {
    here.calls += 1;
    await new Promise((done) => { setTimeout(done, WAIT); });
    here.done += 1;
    if (here.refuse) throw new Error('the store could not be read');
    return [...here.rows];
  },
});

/** Ticks until this is true, or long enough that it plainly is not. */
const until = async (wanted: () => boolean): Promise<void> => {
  for (let i = 0; i < 500 && !wanted(); i++) await settle(2);
};

const listed = async (client: { handle(request: unknown): Promise<unknown> }) =>
  await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } }) as {
    items: { resource: string; title: string }[];
  };

/**
 * A host over one slow backend, with the first listing still running.
 *
 * `createHost` starts a listing of its own the moment it is built, so the first
 * `listSessions` below is answered out of that one - which is the case the
 * whole of this is about, since it is the only answer that waits.
 *
 * The client watches the root, because a catalogue notification goes to the
 * connections watching the root channel and to no others.
 */
const started = async () => {
  const here = store([row('one', 'One')]);
  const host = createHost({ path: PATH, agents: [backend(here)], ...machine() });
  const p = peer();
  const client = host.accept(p);
  await client.handle(hello(['0.9.0'], { initialSubscriptions: ['ahp-root://'] }));
  return { here, client, notes: p.notes };
};

/** Wait for the first listing to have landed, and for the rows it left. */
const filled = async (here: Store): Promise<void> => {
  await until(() => here.done >= 1);
  await settle(4);
};

const said = (notes: { method: string; params: unknown }[], method: string) =>
  notes.filter((one) => one.method === method).map((one) => one.params as {
    session?: string;
    summary?: { resource: string; title: string };
    changes?: { title?: string; resource?: string };
  });

describe('the catalogue is held', () => {
  it('waits for the first listing and answers the next without another pass', async () => {
    const { here, client } = await started();

    const at = Date.now();
    await listed(client);
    const first = Date.now() - at;
    const passed = here.calls;

    const again = Date.now();
    const answer = await listed(client);
    const second = Date.now() - again;

    // There is one answer that waits: the first, on a host that has nothing
    // held. Every one after it is answered out of what that pass left behind,
    // so a client paging a catalogue is not a client reading the machine.
    expect(first).toBeGreaterThanOrEqual(WAIT - 20);
    expect(second).toBeLessThan(10);
    expect(answer.items.map((one) => one.resource)).toEqual(['slow:/one']);
    // And answering from the held rows started no pass of its own: the one the
    // first answer started behind it is still running, and this joined it.
    expect(here.calls).toBe(passed);
  });

  it('starts no second refresh while one is running', async () => {
    const { here, client } = await started();
    await filled(here);
    const passed = here.calls;

    // Both answered out of the rows already held, while the refresh each of
    // them starts behind that answer is still out.
    const [one, two] = await Promise.all([listed(client), listed(client)]);
    await until(() => here.calls > passed);

    expect(one.items.map((row_) => row_.resource)).toEqual(['slow:/one']);
    expect(two.items.map((row_) => row_.resource)).toEqual(['slow:/one']);
    // One pass between them, not one each. Asked this way the host used to run
    // two, and a run of subscribes to sessions nobody has ran one per subscribe.
    expect(here.calls).toBe(passed + 1);
  });

  it('keeps the rows it holds when a refresh fails', async () => {
    const { here, client } = await started();
    await filled(here);
    here.refuse = true;

    await listed(client);
    await until(() => here.calls > 1);
    const answer = await listed(client);

    // A backend that is not answering is a backend with nothing to say, not one
    // whose sessions have been deleted: the rows that were there are still true,
    // so a failed refresh costs a client what it had rather than an empty list.
    expect(answer.items.map((one) => one.resource)).toEqual(['slow:/one']);
  });
});

describe('a refresh says what it found', () => {
  it('sends a row that appeared, and one that is gone', async () => {
    const { here, client, notes } = await started();
    await filled(here);

    // Nothing was said to fill it. This client connected before that listing
    // finished and is handed the catalogue by its own `listSessions` below, so
    // the first rows are that answer rather than one addition each - which is
    // what a client with a hundred stored sessions would be sent.
    expect(notes).toEqual([]);

    here.rows.push(row('two', 'Two'));
    await listed(client);
    await until(() => said(notes, 'root/sessionAdded').length > 0);

    expect(said(notes, 'root/sessionAdded').map((one) => one.summary?.resource)).toEqual(['slow:/two']);
    expect(said(notes, 'root/sessionAdded')[0]?.summary?.title).toBe('Two');

    // And the other way round, which is how a client hears that a transcript was
    // deleted outside this host without its having to ask for the catalogue.
    notes.length = 0;
    here.rows = [row('one', 'One')];
    await listed(client);
    await until(() => said(notes, 'root/sessionRemoved').length > 0);

    expect(said(notes, 'root/sessionRemoved').map((one) => one.session)).toEqual(['slow:/two']);
  });

  it('sends one change for a row that moved, and nothing for the ones that did not', async () => {
    const { here, client, notes } = await started();
    await filled(here);

    here.rows = [row('one', 'One'), row('two', 'Two'), row('three', 'Three')];
    await listed(client);
    await until(() => said(notes, 'root/sessionAdded').length >= 2);

    // A pass over rows that did not move says nothing at all. Every client is
    // already holding them, and a notification per row per refresh is how a
    // background pass turns into a flood.
    notes.length = 0;
    await listed(client);
    await until(() => said(notes, 'root/sessionAdded').length > 0 || here.calls > 2);
    expect(here.calls).toBe(3);
    expect(notes).toEqual([]);

    notes.length = 0;
    here.rows[1] = row('two', 'Two, retitled');
    await listed(client);
    await until(() => said(notes, 'root/sessionSummaryChanged').length > 0);

    const moved = said(notes, 'root/sessionSummaryChanged');
    expect(moved.map((one) => one.session)).toEqual(['slow:/two']);
    // A partial, not a whole row: `resource` is who it is and every client has
    // it, and a client applies what it is sent over what it already holds.
    expect(moved[0]?.changes?.title).toBe('Two, retitled');
    expect(moved[0]?.changes?.resource).toBeUndefined();
  });
});

describe('a backend that refuses keeps what it had', () => {
  /*
   * Two backends, and only the second one refuses.
   *
   * A listing that fails outright is the case the host already had: nothing is
   * held, so nothing is said. This is the one a held catalogue makes new - the
   * pass finishes, because the other backend answered, and a finished pass that
   * says nothing about a store is a pass that says every session in it is gone.
   */
  /** What the catalogue holds, in a settled order, which is not what is tested. */
  const resources = async (client: { handle(request: unknown): Promise<unknown> }): Promise<string[]> =>
    (await listed(client)).items.map((one) => one.resource).sort();

  const two = async () => {
    const first = store([row('a', 'A'), row('gone', 'Gone')]);
    const second = store([row('b', 'B')]);
    const host = createHost({
      path: PATH,
      agents: [backend(first, 'first'), backend(second, 'second')],
      ...machine(),
    });
    const p = peer();
    const client = host.accept(p);
    await client.handle(hello(['0.9.0'], { initialSubscriptions: ['ahp-root://'] }));
    return { first, second, client, notes: p.notes };
  };

  it('keeps its rows and says nothing was removed, and prunes the ones that answered', async () => {
    const { first, second, client, notes } = await two();
    await until(() => first.done >= 1 && second.done >= 1);
    await settle(4);
    expect(await resources(client)).toEqual(['first:/a', 'first:/gone', 'second:/b']);

    // The second backend goes dark and the first stops listing one row. Both are
    // ordinary things to happen, and only one of them is a session deleted.
    notes.length = 0;
    second.refuse = true;
    first.rows = [row('a', 'A')];
    await listed(client);
    await until(() => said(notes, 'root/sessionRemoved').length > 0);

    expect(said(notes, 'root/sessionRemoved').map((one) => one.session)).toEqual(['first:/gone']);
    // A client that closes a session it has open when it is told the session is
    // gone is the cost of getting this wrong, so nothing is said for a store that
    // did not answer, however many rows it would have listed.
    expect(notes.filter((one) => one.method === 'root/sessionRemoved')).toHaveLength(1);
    // And the rows it did list last are still there to answer with.
    expect(await resources(client)).toEqual(['first:/a', 'second:/b']);

    // Once it answers again and no longer lists it, that is what a gone session
    // looks like: the removal is about the answer, not about the earlier silence.
    notes.length = 0;
    second.refuse = false;
    second.rows = [];
    await listed(client);
    await until(() => said(notes, 'root/sessionRemoved').length > 0);

    expect(said(notes, 'root/sessionRemoved').map((one) => one.session)).toEqual(['second:/b']);
    expect(await resources(client)).toEqual(['first:/a']);
  });
});
