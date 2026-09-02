import { expect, it } from 'vitest';
import { createHost } from '../src/host.js';
import { echo } from '../examples/echo/agent.js';
import type { ChangesetOperation, ChangesetOperationRequest, ChangesetSource } from '../src/types/changes.js';
import type { Peer } from '../src/types/rpc.js';

/*
 * Operations on a changeset, driven the way a client drives them.
 *
 * The source is scripted rather than `gitChanges`, for the same reason `echo`
 * stands in for Claude: what is under test is the *gate* - which invocations
 * this host lets through and what it says to the ones it does not - and a real
 * `git` would make every case depend on a repository somebody had to build
 * first.
 */

const DIR = '/tmp/ops';

function peer(): Peer & { notes: { method: string; params: unknown }[] } {
  const notes: { method: string; params: unknown }[] = [];
  return {
    notes,
    send: () => {},
    notify: (method, params) => notes.push({ method, params }),
    close: () => {},
  };
}

const settle = async (times = 6): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((r) => { setTimeout(r, 0); });
};

const COMMIT: ChangesetOperation = {
  id: 'commit', label: 'Commit', scopes: ['changeset'], icon: 'git-commit', writes: true,
};
const DISCARD: ChangesetOperation = {
  id: 'discard', label: 'Discard Changes', scopes: ['resource'], confirmation: 'Sure?', writes: true,
};
/** One that changes nothing on disk, so the write gate can be shown to be about writing. */
const LOOK: ChangesetOperation = { id: 'look', label: 'Look', scopes: ['changeset'] };

/** A source that offers three verbs and records what was asked of it. */
function scripted(fail?: string) {
  const invoked: ChangesetOperationRequest[] = [];
  const source: ChangesetSource = {
    scopes: () => [{ id: 'uncommitted', label: 'Uncommitted Changes', changeKind: 'uncommitted' }],
    state: async () => ({ status: 'complete', files: [{ id: `file://${DIR}/a.txt`, edit: {} }] }),
    summary: () => ({ files: 1 }),
    operations: () => [COMMIT, DISCARD, LOOK],
    invoke: async (request) => {
      invoked.push(request);
      if (fail !== undefined) throw new Error(fail);
      return { message: `did ${request.operationId}` };
    },
  };
  return { source, invoked };
}

/** A connected client with one session, watching the session and its changeset. */
async function watching(source: ChangesetSource, pace = 0) {
  const host = createHost({ path: DIR, agents: [echo({ path: DIR, pace })], changes: source });
  const p = peer();
  const client = host.accept(p);
  await client.handle({
    method: 'initialize',
    params: { clientId: 'probe', protocolVersions: ['0.8.0'], initialSubscriptions: ['ahp-root://'] },
  });
  const uri = 'ahp-session:/one';
  await client.handle({ method: 'createSession', params: { channel: uri, provider: 'echo' } });
  await client.handle({ method: 'subscribe', params: { channel: uri } });
  const changeset = `${uri}/changeset/uncommitted`;
  const opened = await client.handle({ method: 'subscribe', params: { channel: changeset } });
  const snapshot = (opened as { snapshot: { state: Record<string, unknown> } }).snapshot;
  return { host, client, peer: p, uri, chatUri: 'ahp-chat:/one', changeset, snapshot };
}

const actions = (p: ReturnType<typeof peer>, channel: string) => p.notes
  .filter((n) => n.method === 'action')
  .map((n) => (n.params as { channel: string; action: Record<string, unknown> }))
  .filter((n) => n.channel === channel)
  .map((n) => n.action);

const refused = async (run: Promise<unknown>): Promise<{ code: number; message: string; data?: unknown }> => {
  try {
    await run;
    throw new Error('That was supposed to be refused.');
  }
  catch (error) {
    const held = error as { code?: number; message: string; data?: unknown };
    expect(typeof held.code).toBe('number');
    return { code: held.code as number, message: held.message, data: held.data };
  }
};

it('puts the verbs on the changeset, idle, alongside the files', async () => {
  const { snapshot } = await watching(scripted().source);
  const state = snapshot.state as { operations?: Record<string, unknown>[] };
  expect(state.operations?.map((one) => one.id)).toEqual(['commit', 'discard', 'look']);
  expect(state.operations?.map((one) => one.status)).toEqual(['idle', 'idle', 'idle']);
  // The confirmation is what tells a client the verb is destructive, so it has
  // to survive the trip. One without it must not grow one.
  expect(state.operations?.[1]?.confirmation).toBe('Sure?');
  expect(state.operations?.[0]?.confirmation).toBeUndefined();
});

it('refuses an operation it never offered, and one aimed at the wrong kind of thing', async () => {
  const { client, changeset } = await watching(scripted().source);
  const missing = await refused(client.handle({
    method: 'invokeChangesetOperation', params: { channel: changeset, operationId: 'rebase' },
  }));
  expect(missing.code).toBe(-32602);
  expect(missing.message).toContain('rebase');

  // `commit` is changeset-scoped. A client that points it at a file is asking
  // for something the advertised operation does not accept.
  const misaimed = await refused(client.handle({
    method: 'invokeChangesetOperation',
    params: {
      channel: changeset,
      operationId: 'commit',
      target: { kind: 'resource', resource: `file://${DIR}/a.txt` },
    },
  }));
  expect(misaimed.code).toBe(-32602);
});

it('refuses a write with no grant, and names the request that would unlock it', async () => {
  const { client, changeset } = await watching(scripted().source);
  const denied = await refused(client.handle({
    method: 'invokeChangesetOperation', params: { channel: changeset, operationId: 'commit' },
  }));
  expect(denied.code).toBe(-32009);
  // The protocol's own affordance: the refusal carries the `resourceRequest`
  // that, granted, would make the same call work.
  expect(denied.data).toEqual({ request: { channel: 'ahp-root://', uri: `file://${DIR}`, write: true } });
});

it('lets an operation that writes nothing through without one', async () => {
  const { client, changeset, source } = { ...await watching(scripted().source), source: undefined };
  const done = await client.handle({
    method: 'invokeChangesetOperation', params: { channel: changeset, operationId: 'look' },
  });
  expect(done).toEqual({ message: 'did look' });
  expect(source).toBeUndefined();
});

it('grants inside the directories it serves and refuses everywhere else', async () => {
  const { client } = await watching(scripted().source);
  expect(await client.handle({
    method: 'resourceRequest', params: { channel: 'ahp-root://', uri: `file://${DIR}/a.txt`, write: true },
  })).toEqual({});
  const denied = await refused(client.handle({
    method: 'resourceRequest', params: { channel: 'ahp-root://', uri: 'file:///etc/shadow', write: true },
  }));
  expect(denied.code).toBe(-32009);
});

it('runs it once granted, and says running then idle on the changeset', async () => {
  const { source, invoked } = scripted();
  const { client, peer: p, changeset } = await watching(source);
  await client.handle({
    method: 'resourceRequest', params: { channel: 'ahp-root://', uri: `file://${DIR}`, write: true },
  });
  const done = await client.handle({
    method: 'invokeChangesetOperation', params: { channel: changeset, operationId: 'commit' },
  });
  expect(done).toEqual({ message: 'did commit' });
  // The session's title rides along, because a commit needs a sentence and the
  // conversation is where one already exists.
  expect(invoked[0]?.subject).toBeDefined();
  expect(invoked[0]?.scope).toBe('uncommitted');

  const said = actions(p, changeset);
  const statuses = said.filter((one) => one.type === 'changeset/operationStatusChanged');
  expect(statuses.map((one) => one.status)).toEqual(['running', 'idle']);
  // And the files, because something wrote to the tree and a client watching
  // this changeset is holding a list that has moved.
  expect(said.some((one) => one.type === 'changeset/contentChanged')).toBe(true);
});

it('keeps the failure on the operation, and hands it to the next reader', async () => {
  const { source } = scripted('git said no');
  const { client, peer: p, changeset } = await watching(source);
  await client.handle({
    method: 'resourceRequest', params: { channel: 'ahp-root://', uri: `file://${DIR}`, write: true },
  });
  const broke = await refused(client.handle({
    method: 'invokeChangesetOperation', params: { channel: changeset, operationId: 'commit' },
  }));
  expect(broke.message).toContain('git said no');

  const last = actions(p, changeset).filter((one) => one.type === 'changeset/operationStatusChanged').pop();
  expect(last).toMatchObject({ status: 'error', operationId: 'commit', error: { message: 'git said no' } });

  // And the next client to look sees it, because the status is the
  // changeset's rather than the reply's.
  const again = await client.handle({ method: 'subscribe', params: { channel: changeset } }) as {
    snapshot: { state: { operations: Record<string, unknown>[] } };
  };
  const operations = again.snapshot.state.operations;
  expect(operations[0]).toMatchObject({ id: 'commit', status: 'error' });
});

it('disables the verbs while a turn is running, and refuses one sent anyway', async () => {
  const { source } = scripted();
  const { client, peer: p, uri, chatUri, changeset } = await watching(source, 40);
  await client.handle({
    method: 'resourceRequest', params: { channel: 'ahp-root://', uri: `file://${DIR}`, write: true },
  });
  client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'go' } } },
  });
  await settle(4);

  // Said without being asked: nothing inside the changeset moved, so a turn
  // starting is only visible to a client if the host says it.
  const announced = actions(p, changeset).filter((one) => one.type === 'changeset/operationsChanged').pop();
  const offered = announced?.operations as Record<string, unknown>[] | undefined;
  expect(offered?.every((one) => one.status === 'disabled')).toBe(true);

  const busy = await refused(client.handle({
    method: 'invokeChangesetOperation', params: { channel: changeset, operationId: 'commit' },
  }));
  // `-32004 TurnInProgress`, not `-32002 ProviderNotFound`: what the client
  // should do is wait, and the code is the only part of a refusal it branches
  // on.
  expect(busy.code).toBe(-32004);
  expect(busy.message).toContain(uri);
});

it('lists the changesets on the session channel, and not on a catalogue row', async () => {
  const { client, peer: p, uri } = await watching(scripted().source);

  // `SessionState.changesets` is declared, and is where a client reads the
  // scopes it may subscribe to. Both of ahpc's readers take it from here.
  const session = (await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
    snapshot: { state: { changesets?: unknown[] } };
  }).snapshot.state;
  expect(session.changesets)
    .toEqual([expect.objectContaining({ uriTemplate: `${uri}/changeset/uncommitted` })]);

  /*
   * And nowhere else.
   *
   * `SessionSummary` does not declare `changesets`, and a row carrying one was
   * the same answer from a second place: every catalogue row repeated the
   * scopes, and so did every `root/sessionSummaryChanged` - which fires on
   * every turn start, every turn end, every git refresh and every flag toggle.
   * A receiver ignores a key it does not understand, so nothing broke; what it
   * cost was weight on the busiest notification this host sends.
   */
  const listed = await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } }) as {
    items: Record<string, unknown>[];
  };
  const row = listed.items.find((one) => one.resource === uri);
  expect(row).toBeDefined();
  expect(row).not.toHaveProperty('changesets');
  // The diff stat is a different field, is declared on a summary, and stays.
  expect(row).toHaveProperty('changes');

  client.handle({
    method: 'dispatchAction',
    params: { channel: uri, action: { type: 'session/isReadChanged', isRead: true } },
  });
  await settle();
  const moved = p.notes
    .filter((n) => n.method === 'root/sessionSummaryChanged')
    .map((n) => n.params as { changes: Record<string, unknown> })
    .at(-1);
  expect(moved?.changes).toBeDefined();
  expect(moved?.changes).not.toHaveProperty('changesets');
});
