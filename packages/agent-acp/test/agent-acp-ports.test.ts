import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { uriOf } from '@ahpd/sdk';
import { createHost } from '../../sdk/src/host.js';
import { fileResources } from '../../sdk/src/resources.js';
import { shellTerminals } from '../../sdk/src/terminals.js';
import { acpAgent } from '../src/index.js';
import { anyone, signIn } from './people.js';
import type { ChangesetSource } from '../../sdk/src/types/changes.js';
import type { Peer } from '../../sdk/src/types/rpc.js';
import { checker } from '../../../tools/wire.mjs';

/*
 * The ports an ACP server reaches for.
 *
 * A server asks its client for a file, a shell and a permission; this is the
 * client half of each, driven through a real `createHost` and the scripted
 * subprocess in `test/fixtures/acp-server.mjs`. The fixture makes each of those
 * a genuine request and reports what came back, so what is checked is that the
 * bridge answered - and answered with the host's own store, the host's own
 * terminal, and the person's own choice.
 */

const FIXTURE = fileURLToPath(new URL('./fixtures/acp-server.mjs', import.meta.url));

function peer(): Peer & { notes: { method: string; params: unknown }[] } {
  const notes: { method: string; params: unknown }[] = [];
  return {
    notes,
    send: () => {},
    notify: (method, params) => notes.push({ method, params }),
    request: async () => ({}),
    answered: () => {},
    close: async () => {},
  };
}

/** Let the subprocess's work finish, up to a point; the fixture never sleeps. */
const until = async (check: () => boolean, times = 3000): Promise<void> => {
  for (let i = 0; i < times; i++) {
    if (check()) return;
    await new Promise((r) => { setTimeout(r, 1); });
  }
};

type Note = { channel: string; action: Record<string, unknown> };

const actions = (p: ReturnType<typeof peer>, channel: string): Note[] => p.notes
  .filter((n) => n.method === 'action')
  .map((n) => n.params as Note)
  .filter((e) => e.channel === channel);

const types = (p: ReturnType<typeof peer>, channel: string): string[] =>
  actions(p, channel).map((e) => String(e.action.type));

/** Everything the server said, as prose. */
const prose = (p: ReturnType<typeof peer>, chatUri: string): string => actions(p, chatUri)
  .filter((e) => e.action.type === 'chat/delta')
  .map((e) => String(e.action.content))
  .join('');

const made: string[] = [];
const running: { client: ReturnType<ReturnType<typeof createHost>['accept']>; uri: string }[] = [];

/**
 * Wait until the host's own catalogue read has written its last line into a
 * folder's log, failing on its own message after a wall-clock limit inside the
 * hook's.
 *
 * `createHost` reads the catalogue once by itself, unawaited, and that read
 * spawns a server of its own that appends each request it is sent to the same
 * log. Its last request is `session/list`, which a session's server is never
 * sent.
 */
const listed = async (log: string, ms = 4000): Promise<void> => {
  const limit = Date.now() + ms;
  for (;;) {
    if (existsSync(log) && readFileSync(log, 'utf8').includes('"method":"session/list"')) return;
    if (Date.now() > limit) throw new Error(`timed out waiting for the host's catalogue read to finish writing ${log}`);
    await new Promise((r) => { setTimeout(r, 1); });
  }
};

afterEach(async () => {
  for (const one of running.splice(0)) {
    await one.client.handle({ method: 'disposeSession', params: { channel: one.uri } });
  }
  for (const path of made.splice(0)) {
    await listed(join(path, 'requests.jsonl'));
    rmSync(path, { recursive: true, force: true });
  }
});

/**
 * The `clientCapabilities` the bridge advertised to the session's server, out
 * of the fixture's log.
 *
 * The host also reads the catalogue, which spawns a server of its own that
 * handshakes with no ports and logs to the same file, in whichever order the
 * two processes get there. The session's server is the one that was sent
 * `session/new`, so its handshake is picked by pid.
 */
const capabilitiesOf = (log: string): unknown => {
  const held = readFileSync(log, 'utf8').trim().split('\n').filter((one) => one !== '')
    .map((line) => JSON.parse(line) as { pid?: number; method?: string; params?: { clientCapabilities?: unknown } });
  const session = held.find((one) => one.method === 'session/new')?.pid;
  if (session === undefined) return undefined;
  return held.find((one) => one.pid === session && one.method === 'initialize')?.params?.clientCapabilities;
};

/** A changeset source that only remembers what it was asked to observe. */
function recorder(): { source: ChangesetSource; seen: { turnId: string; path: string; phase: string }[] } {
  const seen: { turnId: string; path: string; phase: string }[] = [];
  return {
    seen,
    source: {
      scopes: () => [],
      state: async () => undefined,
      summary: () => undefined,
      observe: (_dir, _session, turnId, path, phase) => { seen.push({ turnId, path, phase }); },
    },
  };
}

/** A connected client with one ACP session, watching both its channels. */
async function talking(options: { files?: boolean; shells?: boolean; changes?: ChangesetSource } = {}) {
  const path = mkdtempSync(join(tmpdir(), 'ahpd-acp-ports-'));
  made.push(path);
  writeFileSync(join(path, 'note.txt'), 'the note body');
  const log = join(path, 'requests.jsonl');
  const host = createHost({
    path,
    agents: [acpAgent({ command: process.execPath, args: [FIXTURE], env: { ACP_LOG: log }, provider: 'acp' })],
    // Somebody for this window to be, without whom its session has no owner and
    // so no folder it can be told is trusted.
    users: anyone(),
    ...(options.files === false ? {} : { resources: fileResources() }),
    ...(options.shells === false ? {} : { terminals: shellTerminals() }),
    ...(options.changes === undefined ? {} : { changes: options.changes }),
  });
  const p = peer();
  const client = host.accept(p);
  await client.handle({
    method: 'initialize',
    params: { clientId: 'probe', protocolVersions: ['0.9.0'], initialSubscriptions: ['ahp-root://'] },
  });
  await signIn(client);
  const uri = 'ahp-session:/ports';
  const chatUri = 'ahp-chat:/ports';
  // The window says which folders it trusts, and a session of a folder nobody
  // vouched for is refused rather than started - decision
  // `a-folder-is-untrusted-until-a-client-says-otherwise`.
  await client.handle({
    method: 'dispatchAction',
    params: {
      channel: 'ahp-root://',
      action: { type: 'root/configChanged', config: { workspaceTrust: { enabled: true, trustedUris: [uriOf(path)] } } },
    },
  });
  await client.handle({
    method: 'createSession',
    params: { channel: uri, provider: 'acp', workingDirectories: [`file://${path}`] },
  });
  await client.handle({ method: 'subscribe', params: { channel: uri } });
  await client.handle({ method: 'subscribe', params: { channel: chatUri } });
  running.push({ client, uri });
  return { host, client, peer: p, uri, chatUri, path, log };
}

const begin = (
  client: Awaited<ReturnType<typeof talking>>['client'],
  chatUri: string,
  turnId: string,
  text: string,
): void => {
  client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId, message: { text } } },
  });
};

/** Wait for the nth turn to finish, not merely for one to have finished. */
const endedTurn = async (p: ReturnType<typeof peer>, chatUri: string, count: number): Promise<void> => {
  const done = (): number => types(p, chatUri).filter((type) => type === 'chat/turnComplete').length;
  await until(() => done() >= count);
  expect(done()).toBeGreaterThanOrEqual(count);
};

it('advertises exactly the ports it was given, and nothing more', async () => {
  // A turn, because the handshake happens when the server is first needed
  // rather than when the session is created.
  const both = await talking();
  begin(both.client, both.chatUri, 't1', 'hello');
  await endedTurn(both.peer, both.chatUri, 1);
  // The boolean option is not a port but a thing the bridge draws and sets, so
  // it is in the handshake whatever ports the host gave.
  expect(capabilitiesOf(both.log)).toEqual({
    fs: { readTextFile: true, writeTextFile: true },
    terminal: true,
    session: { configOptions: { boolean: {} } },
  });

  // A capability advertised without an implementation is a request nobody
  // answers, so a host with neither port asks a server for neither.
  const neither = await talking({ files: false, shells: false });
  begin(neither.client, neither.chatUri, 't1', 'hello');
  await endedTurn(neither.peer, neither.chatUri, 1);
  expect(capabilitiesOf(neither.log)).toEqual({ session: { configOptions: { boolean: {} } } });
});

it('reads and writes a file through the host\'s own store', async () => {
  const { client, peer: p, chatUri, path } = await talking();

  begin(client, chatUri, 't1', 'read it please');
  await endedTurn(p, chatUri, 1);
  expect(prose(p, chatUri)).toContain('read=the note body');

  begin(client, chatUri, 't2', 'write it please');
  await endedTurn(p, chatUri, 2);
  expect(prose(p, chatUri)).toContain('wrote it');
  // The bytes are on disk, written by the store the resource commands serve.
  expect(readFileSync(join(path, 'written.txt'), 'utf8')).toBe('written by the server');
});

it('hands both sides of an agent\'s write to the host\'s changeset', async () => {
  const changes = recorder();
  const { client, peer: p, chatUri, path } = await talking({ changes: changes.source });
  begin(client, chatUri, 't1', 'write it please');
  await endedTurn(p, chatUri, 1);
  // Before and after, in that order: a changeset holding only the file as it is
  // now cannot say what this turn did to it.
  expect(changes.seen).toEqual([
    { turnId: 't1', path: join(path, 'written.txt'), phase: 'before' },
    { turnId: 't1', path: join(path, 'written.txt'), phase: 'after' },
  ]);
});

it('opens a shell the host owns, waits for it, and reads what it printed', async () => {
  const { client, peer: p, chatUri } = await talking();
  begin(client, chatUri, 't1', 'term now');
  await endedTurn(p, chatUri, 1);
  // The argv arrived whole, the exit wait resolved with the real code, and the
  // output is what a shell on this machine printed.
  expect(prose(p, chatUri)).toContain('term=hello from the shell|exit=0');
});

it('asks the person, and answers with the once option they chose', async () => {
  const { client, peer: p, uri, chatUri } = await talking();
  begin(client, chatUri, 't1', 'ask me first');
  await until(() => types(p, uri).includes('session/inputNeededSet'));

  const entry = actions(p, uri).find((e) => e.action.type === 'session/inputNeededSet')?.action.request as {
    kind?: string; toolCall?: { toolCallId?: string };
  };
  expect(entry?.kind).toBe('toolConfirmation');
  expect(entry?.toolCall?.toolCallId).toBe('call-perm');

  client.handle({
    method: 'dispatchAction',
    params: {
      channel: chatUri,
      action: { type: 'chat/toolCallConfirmed', turnId: 't1', toolCallId: 'call-perm', approved: true },
    },
  });
  await endedTurn(p, chatUri, 1);
  // `allow_once`, never `allow_always`: the server offered both, and approving
  // one call is not agreeing to every call.
  expect(prose(p, chatUri)).toContain('perm=yes-once');
});

/** The fixture's three options, as the protocol offers them: approve before deny, in the server's order. */
const OFFERED = [
  { id: 'yes-once', label: 'Allow once', kind: 'approve', group: 1 },
  { id: 'yes-always', label: 'Always allow', kind: 'approve', group: 1 },
  { id: 'no-once', label: 'Reject once', kind: 'deny', group: 2 },
];

it('offers every option the server listed, on the call and on the ask', async () => {
  const { client, peer: p, uri, chatUri } = await talking();
  begin(client, chatUri, 't1', 'ask me first');
  await until(() => types(p, uri).includes('session/inputNeededSet'));

  const ready = actions(p, chatUri)
    .filter((e) => e.action.type === 'chat/toolCallReady' && e.action.toolCallId === 'call-perm')
    .at(-1)?.action;
  // A ready with no `confirmed`, so a call the server announced as running
  // goes back to `pending-confirmation` with the choices on it.
  expect(ready?.confirmed).toBeUndefined();
  expect(ready?.options).toEqual(OFFERED);
  expect(ready?.confirmationTitle).toBe('Remove a file');
  const entry = actions(p, uri).find((e) => e.action.type === 'session/inputNeededSet')?.action.request as {
    toolCall?: { options?: unknown };
  };
  expect(entry?.toolCall?.options).toEqual(OFFERED);

  const snapshot = await client.handle({ method: 'subscribe', params: { channel: chatUri } }) as {
    snapshot: { state: { activeTurn?: { responseParts: { toolCall?: { toolCallId: string; status: string; options?: unknown } }[] } } };
  };
  const call = snapshot.snapshot.state.activeTurn?.responseParts.find((one) => one.toolCall?.toolCallId === 'call-perm')?.toolCall;
  expect(call?.status).toBe('pending-confirmation');
  expect(call?.options).toEqual(OFFERED);

  // The two frames that carry the options, as the protocol declares them.
  const check = checker();
  const carrying = p.notes.filter((n) => n.method === 'action' && (
    ((n.params as Note).action.type === 'chat/toolCallReady' && (n.params as Note).action.options !== undefined)
    || (n.params as Note).action.type === 'session/inputNeededSet'));
  expect(carrying).toHaveLength(2);
  const defects = carrying.flatMap((frame) => check.frame(frame)).map((one) => `${one.def} ${one.at} ${one.what}`);
  expect(defects).toEqual([]);

  client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'chat/toolCallConfirmed', turnId: 't1', toolCallId: 'call-perm', approved: true, confirmed: 'user-action' } },
  });
  await endedTurn(p, chatUri, 1);
});

it('answers with the option the person picked, and says which', async () => {
  const { client, peer: p, uri, chatUri } = await talking();
  begin(client, chatUri, 't1', 'ask me first');
  await until(() => types(p, uri).includes('session/inputNeededSet'));

  client.handle({
    method: 'dispatchAction',
    params: {
      channel: chatUri,
      action: {
        type: 'chat/toolCallConfirmed', turnId: 't1', toolCallId: 'call-perm',
        approved: true, confirmed: 'user-action', selectedOptionId: 'yes-always',
      },
    },
  });
  await endedTurn(p, chatUri, 1);
  expect(prose(p, chatUri)).toContain('perm=yes-always');
  const echoed = p.notes.find((n) => n.method === 'action' && (n.params as Note).channel === chatUri
    && (n.params as Note).action.type === 'chat/toolCallConfirmed');
  expect((echoed?.params as Note | undefined)?.action.selectedOptionId).toBe('yes-always');
  expect(checker().frame(echoed)).toEqual([]);
});

it('answers once when the option picked is not one the server offered', async () => {
  const { client, peer: p, uri, chatUri } = await talking();
  begin(client, chatUri, 't1', 'ask me first');
  await until(() => types(p, uri).includes('session/inputNeededSet'));

  client.handle({
    method: 'dispatchAction',
    params: {
      channel: chatUri,
      action: {
        type: 'chat/toolCallConfirmed', turnId: 't1', toolCallId: 'call-perm',
        approved: true, confirmed: 'user-action', selectedOptionId: 'forever',
      },
    },
  });
  await endedTurn(p, chatUri, 1);
  expect(prose(p, chatUri)).toContain('perm=yes-once');
});

it('answers a refusal with the reject option, not with an approval', async () => {
  const { client, peer: p, uri, chatUri } = await talking();
  begin(client, chatUri, 't1', 'ask me first');
  await until(() => types(p, uri).includes('session/inputNeededSet'));

  client.handle({
    method: 'dispatchAction',
    params: {
      channel: chatUri,
      action: { type: 'chat/toolCallConfirmed', turnId: 't1', toolCallId: 'call-perm', approved: false },
    },
  });
  await endedTurn(p, chatUri, 1);
  expect(prose(p, chatUri)).toContain('perm=no-once');
});

it('answers the permission a cancel withdrew with `cancelled`, and takes the entry away', async () => {
  const { client, peer: p, uri, chatUri, log } = await talking();
  begin(client, chatUri, 't1', 'ask me first');
  await until(() => types(p, uri).includes('session/inputNeededSet'));

  const entry = actions(p, uri).find((e) => e.action.type === 'session/inputNeededSet')?.action.request as {
    id?: string;
  };
  client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'chat/turnCancelled', turnId: 't1', duration: 0 } },
  });
  await until(() => prose(p, chatUri).includes('perm='));

  /*
   * `cancelled` and not one of the options the server offered, because the
   * person was never asked: the cancel is the answer, and a server told to stop
   * while it waits on a question is a server that never stops.
   */
  expect(prose(p, chatUri)).toContain('perm=cancelled');
  // The row the entry was drawn from is withdrawn, so a client is not left
  // offering a decision nobody can make.
  const withdrawn = actions(p, uri).find((e) => e.action.type === 'session/inputNeededRemoved')?.action as
    { id?: string } | undefined;
  expect(withdrawn?.id).toBe(entry?.id);
  expect(types(p, uri).at(-1)).not.toBe('session/inputNeededSet');
  // And the cancel itself reached the server, after the permission was settled.
  expect(readFileSync(log, 'utf8')).toContain('"method":"session/cancel"');
});
