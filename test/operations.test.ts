import { expect, it } from 'vitest';
import { changesetReducer } from '@microsoft/agent-host-protocol';
import { createHost } from '../packages/server/src/host.js';
import { echo } from '../examples/echo/agent.js';
import type { ChangesetOperation, ChangesetOperationRequest, ChangesetSource } from '../packages/server/src/types/changes.js';
import type { Peer } from '../packages/server/src/types/rpc.js';

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
    request: async () => ({}),
    answered: () => {},
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
    state: async () => ({ status: 'ready', files: [{ id: `file://${DIR}/a.txt`, edit: {} }] }),
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

/*
 * A changeset URI is built from the session's, so a template is the session's
 * name in disguise - and a client resolves a changeset channel back to the
 * session that owns it. A template naming the held spelling teaches a client
 * that asked about another one a *second* name for the same session; it then
 * addresses the session, its chat and its annotations under that one, and
 * which name the conversation ends up keyed by is whichever subscription
 * happened to land first.
 */
it('spells a changeset template with the name the client asked under', async () => {
  const { source } = scripted();
  const host = createHost({ path: DIR, agents: [echo({ path: DIR })], changes: source });
  const client = host.accept(peer());
  await client.handle({ method: 'initialize', params: { clientId: 'probe', protocolVersions: ['0.9.0'] } });
  await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/one', provider: 'echo' } });

  // The same session, asked about under the name a client computes from the
  // provider rather than the one this host holds it by.
  const opened = await client.handle({ method: 'subscribe', params: { channel: 'claude:/one' } }) as {
    snapshot: { state: { changesets: { uriTemplate: string }[] } };
  };
  const templates = opened.snapshot.state.changesets.map((one) => one.uriTemplate);
  expect(templates).toEqual(['claude:/one/changeset/uncommitted']);

  // And under its own name it is still its own name.
  const own = await client.handle({ method: 'subscribe', params: { channel: 'ahp-session:/one' } }) as {
    snapshot: { state: { changesets: { uriTemplate: string }[] } };
  };
  expect(own.snapshot.state.changesets.map((one) => one.uriTemplate))
    .toEqual(['ahp-session:/one/changeset/uncommitted']);
});

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
  // And nothing about the files, because this source answers the same list
  // either side of the operation. A host that re-sent it regardless was
  // sending a client the set it already held to tell it nothing.
  expect(said.some((one) => one.type === 'changeset/contentChanged')).toBe(false);
  expect(said.some((one) => one.type === 'changeset/fileSet')).toBe(false);
});

/**
 * A source whose file list can be moved between reads.
 *
 * Everything else here answers the same changeset twice, which is exactly the
 * case the incremental actions do not apply to.
 */
function shifting(files: { id: string; edit: Record<string, unknown> }[]) {
  const held = { files, status: 'ready' as 'ready' | 'computing' | 'error' };
  const source: ChangesetSource = {
    scopes: () => [{ id: 'uncommitted', label: 'Uncommitted Changes', changeKind: 'uncommitted' }],
    state: async () => ({ status: held.status, files: held.files }),
    summary: () => ({ files: held.files.length }),
    operations: () => [LOOK],
    invoke: async () => ({}),
  };
  return { source, held };
}

const one = (id: string, edit: Record<string, unknown> = {}) => ({ id: `file://${DIR}/${id}`, edit });

it('says the files that moved, not the whole set, when few of them did', async () => {
  const { source, held } = shifting([one('a.txt'), one('b.txt'), one('c.txt'), one('d.txt')]);
  const { client, peer: p, changeset } = await watching(source);
  held.files = [one('a.txt'), one('b.txt', { added: 1 }), one('e.txt')];
  await client.handle({ method: 'invokeChangesetOperation', params: { channel: changeset, operationId: 'look' } });

  const said = actions(p, changeset);
  // Two gone, one changed, one added: four actions against a set of three, so
  // the whole set would have been the smaller thing to send. One fewer file
  // and it goes the other way - which is the point of choosing per change.
  expect(said.some((a) => a.type === 'changeset/contentChanged')).toBe(true);

  // Now a single file moving inside a set of three.
  const before = said.length;
  held.files = [one('a.txt'), one('b.txt', { added: 1 }), one('e.txt', { added: 2 })];
  await client.handle({ method: 'invokeChangesetOperation', params: { channel: changeset, operationId: 'look' } });
  const after = actions(p, changeset).slice(before);
  expect(after.filter((a) => a.type === 'changeset/fileSet')).toHaveLength(1);
  expect(after.some((a) => a.type === 'changeset/contentChanged')).toBe(false);
});

it('reduces to the same state either way, which is what makes the choice safe', async () => {
  const { source, held } = shifting([one('a.txt'), one('b.txt'), one('c.txt')]);
  const { client, peer: p, changeset } = await watching(source);
  const start = actions(p, changeset).length;
  held.files = [one('a.txt'), one('b.txt', { added: 3 }), one('c.txt')];
  await client.handle({ method: 'invokeChangesetOperation', params: { channel: changeset, operationId: 'look' } });

  // Replayed through the package's own reducer, from the state a subscriber
  // held before the change, to the state it holds after.
  let state = { status: 'ready', files: [one('a.txt'), one('b.txt'), one('c.txt')] } as Parameters<typeof changesetReducer>[0];
  for (const action of actions(p, changeset).slice(start)) {
    state = changesetReducer(state, action as unknown as Parameters<typeof changesetReducer>[1]);
  }
  expect(state.files).toEqual(held.files);
});

it('says a changeset emptied with one action rather than one per file', async () => {
  const { source, held } = shifting([one('a.txt'), one('b.txt'), one('c.txt')]);
  const { client, peer: p, changeset } = await watching(source);
  const start = actions(p, changeset).length;
  held.files = [];
  await client.handle({ method: 'invokeChangesetOperation', params: { channel: changeset, operationId: 'look' } });
  const said = actions(p, changeset).slice(start);
  expect(said.some((a) => a.type === 'changeset/cleared')).toBe(true);
  expect(said.some((a) => a.type === 'changeset/fileRemoved')).toBe(false);
});

it('says the status moved without re-sending a list that did not', async () => {
  const { source, held } = shifting([one('a.txt'), one('b.txt')]);
  const { client, peer: p, changeset } = await watching(source);
  const start = actions(p, changeset).length;
  held.status = 'computing';
  await client.handle({ method: 'invokeChangesetOperation', params: { channel: changeset, operationId: 'look' } });
  const said = actions(p, changeset).slice(start);
  expect(said.filter((a) => a.type === 'changeset/statusChanged').map((a) => a.status)).toEqual(['computing']);
  expect(said.some((a) => a.type === 'changeset/contentChanged')).toBe(false);
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
