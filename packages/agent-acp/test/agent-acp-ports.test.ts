import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { uriOf } from '@ahpd/sdk';
import { createHost } from '../../sdk/src/host.js';
import { fileResources } from '../../sdk/src/resources/resources.js';
import { shellTerminals } from '../../sdk/src/machines/terminals.js';
import { acpAgent } from '../src/index.js';
import { anyone, signIn } from './people.js';
import type { ChangesetSource } from '../../sdk/src/types/changes.js';
import type { Peer } from '../../sdk/src/types/rpc.js';
import { checker } from '../../../tools/wire.mjs';
import { undeclaredIn } from '../../sdk/test/support/wire.js';
import { callsIn, openedFrom, replayed } from '../../sdk/test/support/replay.js';
import type { Bag } from '@ahpd/sdk';

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
    // Awaited rather than sync: on Windows the folder is held until the host
    // has let go of what it opened there, which happens on the event loop a
    // sync retry blocks.
    await rm(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
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
async function talking(options: {
  files?: boolean;
  shells?: boolean;
  changes?: ChangesetSource;
  rules?: Record<string, boolean>;
} = {}) {
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
  // vouched for is refused rather than started.
  await client.handle({
    method: 'dispatchAction',
    params: {
      channel: 'ahp-root://',
      action: {
        type: 'root/configChanged',
        config: {
          workspaceTrust: { enabled: true, trustedUris: [uriOf(path)] },
          // The window's own command rules, read when the server asks.
          ...(options.rules === undefined ? {} : { terminalAutoApproveRules: options.rules }),
        },
      },
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
    elicitation: { form: {}, url: {} },
    session: { configOptions: { boolean: {} } },
  });

  // A capability advertised without an implementation is a request nobody
  // answers, so a host with neither port asks a server for neither. The
  // question is not a port: it needs a chat and nothing else to be put on, so
  // it is offered whatever the host gave.
  const neither = await talking({ files: false, shells: false });
  begin(neither.client, neither.chatUri, 't1', 'hello');
  await endedTurn(neither.peer, neither.chatUri, 1);
  expect(capabilitiesOf(neither.log)).toEqual({
    elicitation: { form: {}, url: {} },
    session: { configOptions: { boolean: {} } },
  });
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

it('sends calls as the protocol declares them, and a late client reads them the same way', async () => {
  const { client, peer: p, uri, chatUri } = await talking();
  const opened = openedFrom(await client.handle({ method: 'subscribe', params: { channel: chatUri } }));
  // A client's message as the protocol declares one, with its origin.
  const begin = (turnId: string, text: string): void => {
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId, message: { text, origin: { kind: 'user' } } } },
    });
  };
  // A call the server reports, a call the server asks about first, and a
  // person's own shell command, each of which holds a tool call part.
  begin('t1', 'tool now');
  await endedTurn(p, chatUri, 1);
  begin('t2', 'ask me first');
  await until(() => types(p, uri).includes('session/inputNeededSet'));
  client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'chat/toolCallConfirmed', turnId: 't2', toolCallId: 'call-perm', approved: true } },
  });
  await endedTurn(p, chatUri, 2);
  begin('t3', '!echo declared');
  await endedTurn(p, chatUri, 3);

  const late = await client.handle({ method: 'subscribe', params: { channel: chatUri } });
  const calls = ((((late as Bag).snapshot as Bag).state as Bag).turns as Bag[])
    .flatMap((turn) => turn.responseParts as Bag[])
    .filter((part) => part.kind === 'toolCall')
    .map((part) => String((part.toolCall as Bag).toolCallId));
  expect(calls).toEqual(expect.arrayContaining(['call-1', 'call-perm']));
  expect(calls.length).toBe(3);
  expect(undeclaredIn([...p.notes, { asked: 'subscribe', params: { channel: chatUri }, result: late }])).toEqual([]);
  expect(callsIn(openedFrom(late).state)).toEqual(callsIn(replayed(opened, p.notes, chatUri)));
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

/*
 * A shell command the server asks about, in the shape codex-acp 1.13.1 sends:
 * an `execute` call whose raw input carries the command beside its folder.
 * An allowed line is answered with the server's `allow_once` before anybody is
 * asked; an unmatched one, one with no command line and one whose choices have
 * no `allow_once` all put the question as they always did.
 */

it('answers an allowed shell command without asking the person', async () => {
  const { client, peer: p, uri, chatUri } = await talking({ rules: { 'make test': true } });
  begin(client, chatUri, 't1', 'execrun');
  await endedTurn(p, chatUri, 1);

  expect(prose(p, chatUri)).toContain('exec=yes-once');
  expect(types(p, uri)).not.toContain('session/inputNeededSet');
  // Nor was the call answered from a rule by selecting an "always": the
  // check picks the once option, and the policy is unchanged.
  expect(prose(p, chatUri)).not.toContain('exec=yes-always');
});

it('asks for a shell command no rule matches', async () => {
  const { client, peer: p, uri, chatUri } = await talking({ rules: { 'make build': true } });
  begin(client, chatUri, 't1', 'execrun');
  await until(() => types(p, uri).includes('session/inputNeededSet'));

  client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'chat/toolCallConfirmed', turnId: 't1', toolCallId: 'call-run', approved: true } },
  });
  await endedTurn(p, chatUri, 1);
  expect(prose(p, chatUri)).toContain('exec=yes-once');
});

it('asks for a call of kind execute with no command line', async () => {
  const { client, peer: p, uri, chatUri } = await talking({ rules: { 'make test': true } });
  begin(client, chatUri, 't1', 'execrun nocmd');
  await until(() => types(p, uri).includes('session/inputNeededSet'));

  client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'chat/toolCallConfirmed', turnId: 't1', toolCallId: 'call-run', approved: true } },
  });
  await endedTurn(p, chatUri, 1);
  expect(prose(p, chatUri)).toContain('exec=yes-once');
});

it('asks when the agent offers no allow_once option', async () => {
  const { client, peer: p, uri, chatUri } = await talking({ rules: { 'make test': true } });
  begin(client, chatUri, 't1', 'execrun alwaysonly');
  await until(() => types(p, uri).includes('session/inputNeededSet'));

  // The "always" is only selected because the person selected it: a check
  // that approved the command still had no once option to answer with.
  client.handle({
    method: 'dispatchAction',
    params: {
      channel: chatUri,
      action: {
        type: 'chat/toolCallConfirmed', turnId: 't1', toolCallId: 'call-run',
        approved: true, confirmed: 'user-action', selectedOptionId: 'yes-always',
      },
    },
  });
  await endedTurn(p, chatUri, 1);
  expect(prose(p, chatUri)).toContain('exec=yes-always');
});

/** One question the server asked, out of the chat's own actions. */
const asked = (p: ReturnType<typeof peer>, chatUri: string): Record<string, unknown> | undefined =>
  actions(p, chatUri).find((e) => e.action.type === 'chat/inputRequested')?.action.request as
    Record<string, unknown> | undefined;

/** The entry a session raises for that question. */
const needing = (p: ReturnType<typeof peer>, uri: string): Record<string, unknown> | undefined =>
  actions(p, uri).find((e) => e.action.type === 'session/inputNeededSet')?.action.request as
    Record<string, unknown> | undefined;

it('asks a form the server is blocked on, and answers it with what was filled in', async () => {
  const { client, peer: p, uri, chatUri } = await talking();
  begin(client, chatUri, 't1', 'elicitform please');
  await until(() => types(p, chatUri).includes('chat/inputRequested'));

  const request = asked(p, chatUri);
  // Named for the call the question is about, because a form carries no id of
  // its own: the call's id is the only name there is to hold it under.
  expect(request?.id).toBe('call-elicit:elicitation');
  expect(request?.message).toBe('Where should the branch go?');
  // One question per field, in the order the server wrote them, and named by
  // the field itself - that name is what the answer comes back under.
  expect((request?.questions as { id?: string }[] | undefined)?.map((one) => one.id))
    .toEqual(['branch', 'force', 'retries', 'mode', 'tags']);
  expect((request?.questions as { kind?: string }[] | undefined)?.map((one) => one.kind))
    .toEqual(['text', 'boolean', 'integer', 'single-select', 'multi-select']);
  // The one field the schema requires, with its title and its sentence: a
  // client draws a question from what is on it and nothing else.
  expect((request?.questions as unknown[])?.[0]).toEqual({
    id: 'branch', kind: 'text', title: 'Branch name', message: 'What to call it', required: true,
  });
  expect((request?.questions as unknown[])?.[1]).toMatchObject({ kind: 'boolean', defaultValue: false });
  expect((request?.questions as unknown[])?.[2]).toMatchObject({ kind: 'integer', min: 1, max: 5 });
  // An untitled enum is its own options, and an array of one is a selection of
  // many, with the bounds the array set.
  expect((request?.questions as unknown[])?.[3]).toMatchObject({
    kind: 'single-select', options: [{ id: 'fast', label: 'fast' }, { id: 'careful', label: 'careful' }],
  });
  expect((request?.questions as unknown[])?.[4]).toMatchObject({
    kind: 'multi-select', options: [{ id: 'a', label: 'a' }, { id: 'b', label: 'b' }],
  });

  // The session says somebody is needed, as a permission does, and the entry is
  // the chat input kind: it names the chat rather than a turn.
  const entry = needing(p, uri);
  expect(entry).toMatchObject({ id: 'call-elicit:elicitation', kind: 'chatInput' });
  // The chat it names is this conversation's, under the host's own name for it
  // rather than the alias this window subscribed with: the entry is what a
  // client that never subscribed to the chat answers on.
  expect(String(entry?.chat)).toContain('ahp-chat:');
  expect((entry?.request as { id?: string } | undefined)?.id).toBe('call-elicit:elicitation');

  // The two frames, as the protocol declares them.
  const check = checker();
  const carrying = p.notes.filter((n) => n.method === 'action' && (
    (n.params as Note).action.type === 'chat/inputRequested'
    || (n.params as Note).action.type === 'session/inputNeededSet'));
  expect(carrying).toHaveLength(2);
  expect(carrying.flatMap((frame) => check.frame(frame)).map((one) => `${one.def} ${one.at} ${one.what}`))
    .toEqual([]);

  client.handle({
    method: 'dispatchAction',
    params: {
      channel: chatUri,
      action: {
        type: 'chat/inputCompleted',
        requestId: 'call-elicit:elicitation',
        response: 'accept',
        answers: {
          branch: { state: 'submitted', value: { kind: 'text', value: 'feature/one' } },
          force: { state: 'submitted', value: { kind: 'boolean', value: true } },
          retries: { state: 'submitted', value: { kind: 'number', value: 3 } },
          mode: { state: 'submitted', value: { kind: 'selected', value: 'careful' } },
          tags: { state: 'submitted', value: { kind: 'selected-many', value: ['a', 'b'] } },
        },
      },
    },
  });
  await endedTurn(p, chatUri, 1);
  // Every field arrived as the value a person typed or picked, under the name
  // the form asked it by, and a selection of many as an array of its options.
  expect(prose(p, chatUri))
    .toContain('elicit=accept|branch=feature/one|force=true|retries=3|mode=careful|tags=a+b');
  // And the entry is withdrawn, so nothing is left asking a question the server
  // has already been answered.
  expect(actions(p, uri).some((e) => e.action.type === 'session/inputNeededRemoved'
    && e.action.id === 'call-elicit:elicitation')).toBe(true);
});

it('answers a declined form with a decline, and carries no content', async () => {
  const { client, peer: p, chatUri } = await talking();
  begin(client, chatUri, 't1', 'elicitform please');
  await until(() => types(p, chatUri).includes('chat/inputRequested'));

  // Answers are sent with the decline, which is what a client that filled the
  // form in and then changed its mind would have. None of them is content: a
  // declined form is one the server is told nothing by.
  client.handle({
    method: 'dispatchAction',
    params: {
      channel: chatUri,
      action: {
        type: 'chat/inputCompleted',
        requestId: 'call-elicit:elicitation',
        response: 'decline',
        answers: { branch: { state: 'submitted', value: { kind: 'text', value: 'never mind' } } },
      },
    },
  });
  await endedTurn(p, chatUri, 1);
  expect(prose(p, chatUri))
    .toContain('elicit=decline|branch=-|force=-|retries=-|mode=-|tags=-');
});

it('answers a cancelled form with a cancel, which a decline is not', async () => {
  const { client, peer: p, chatUri } = await talking();
  begin(client, chatUri, 't1', 'elicitform please');
  await until(() => types(p, chatUri).includes('chat/inputRequested'));

  /*
   * A client that stopped the question rather than refusing it.
   *
   * The two arrive at the host as the same `accepted: false` and are two
   * different things to tell the server: a decline is somebody saying no, and
   * a cancel is nobody having been asked. So the kind is what decides what the
   * server is handed, and the answers left in the form go nowhere.
   */
  client.handle({
    method: 'dispatchAction',
    params: {
      channel: chatUri,
      action: {
        type: 'chat/inputCompleted',
        requestId: 'call-elicit:elicitation',
        response: 'cancel',
        answers: { branch: { state: 'submitted', value: { kind: 'text', value: 'never mind' } } },
      },
    },
  });
  await endedTurn(p, chatUri, 1);
  expect(prose(p, chatUri))
    .toContain('elicit=cancel|branch=-|force=-|retries=-|mode=-|tags=-');
});

it('asks a question the server marked for an answer of one\'s own as one that takes a typed answer', async () => {
  const { client, peer: p, chatUri } = await talking();
  begin(client, chatUri, 't1', 'elicitother please');
  await until(() => types(p, chatUri).includes('chat/inputRequested'));

  const request = asked(p, chatUri);
  expect(request?.id).toBe('call-other:elicitation');
  /*
   * The note field is not drawn as a question of its own. It is where the
   * question it belongs to takes the words a person types, so drawing it would
   * ask the same thing twice and answer the server under a name it never asked
   * for. It is found by the `questionId` on it rather than by its own name,
   * which the adapter numbers when a question already has a note field.
   */
  expect((request?.questions as { id?: string }[] | undefined)?.map((one) => one.id))
    .toEqual(['branch', 'mode', 'size']);
  // The two the server marked take an answer of one's own; the plain field
  // beside them does not, since a box offered over a closed set of answers is
  // this bridge deciding what that server accepts.
  expect((request?.questions as { allowFreeformInput?: boolean }[] | undefined)
    ?.map((one) => one.allowFreeformInput))
    .toEqual([undefined, true, true]);
  // And the question itself is unchanged but for the box: its own options, with
  // the one the adapter appends for an answer that is none of them.
  expect((request?.questions as unknown[])?.[1]).toEqual({
    id: 'mode',
    message: 'How careful to be',
    required: false,
    kind: 'single-select',
    options: [
      { id: 'fast', label: 'Fast' },
      { id: 'careful', label: 'Careful' },
      {
        id: 'None of the above',
        label: 'None of the above',
        description: 'Provide a different answer in the note field.',
      },
    ],
    allowFreeformInput: true,
  });
});

it('sends the words a person typed to the note field, and the pick to the question', async () => {
  const { client, peer: p, chatUri } = await talking();
  begin(client, chatUri, 't1', 'elicitother please');
  await until(() => types(p, chatUri).includes('chat/inputRequested'));

  client.handle({
    method: 'dispatchAction',
    params: {
      channel: chatUri,
      action: {
        type: 'chat/inputCompleted',
        requestId: 'call-other:elicitation',
        response: 'accept',
        answers: {
          branch: { state: 'submitted', value: { kind: 'text', value: 'release/one' } },
          // A question picked and typed into both: the pick is the answer, and
          // the words go where the adapter reads them back from rather than in
          // the question's own field, which holds an option and nothing else.
          mode: {
            state: 'submitted',
            value: { kind: 'selected', value: 'careful', freeformValues: ['make it slow'] },
          },
          size: { state: 'submitted', value: { kind: 'selected', value: 'large' } },
        },
      },
    },
  });
  await endedTurn(p, chatUri, 1);
  expect(prose(p, chatUri))
    .toContain('elicit=accept|branch=release/one|mode=careful|note=make it slow|size=large');
});

it('answers a question typed into and never picked with the option the adapter offered for it', async () => {
  const { client, peer: p, chatUri } = await talking();
  begin(client, chatUri, 't1', 'elicitother please');
  await until(() => types(p, chatUri).includes('chat/inputRequested'));

  /*
   * What a person typing an answer of their own into a question they picked
   * none of the options of sends: words and no pick at all.
   *
   * The question cannot go unanswered at its own field, so it is answered with
   * the option the adapter wrote for exactly this. The question with no note
   * field has nowhere to put the words but itself, which is where a server that
   * wrote no note field reads its answer from.
   */
  client.handle({
    method: 'dispatchAction',
    params: {
      channel: chatUri,
      action: {
        type: 'chat/inputCompleted',
        requestId: 'call-other:elicitation',
        response: 'accept',
        answers: {
          mode: { state: 'submitted', value: { kind: 'selected', value: '', freeformValues: ['make it slow'] } },
          size: { state: 'submitted', value: { kind: 'selected', value: '', freeformValues: ['gigantic'] } },
        },
      },
    },
  });
  await endedTurn(p, chatUri, 1);
  expect(prose(p, chatUri))
    .toContain('elicit=accept|branch=-|mode=None of the above|note=make it slow|size=gigantic');
});

it('leaves out a question open to a typed answer that nobody picked or typed into', async () => {
  const { client, peer: p, chatUri } = await talking();
  begin(client, chatUri, 't1', 'elicitother please');
  await until(() => types(p, chatUri).includes('chat/inputRequested'));

  // A blank question is not one answered `None of the above`: that option
  // stands for a pick only where words were typed beside it.
  client.handle({
    method: 'dispatchAction',
    params: {
      channel: chatUri,
      action: {
        type: 'chat/inputCompleted',
        requestId: 'call-other:elicitation',
        response: 'accept',
        answers: {
          mode: { state: 'submitted', value: { kind: 'selected', value: '' } },
        },
      },
    },
  });
  await endedTurn(p, chatUri, 1);
  expect(prose(p, chatUri)).toContain('elicit=accept|branch=-|mode=-|note=-|size=-');
});

it('asks a field of a type it has no control for as a text question', async () => {
  const { client, peer: p, chatUri } = await talking();
  begin(client, chatUri, 't1', 'elicitunknown please');
  await until(() => types(p, chatUri).includes('chat/inputRequested'));

  const request = asked(p, chatUri);
  expect(request?.id).toBe('call-unknown:elicitation');
  // One question per field, the named one and the unnamed one alike: a form
  // drawn with a field missing is one nobody can fill in, so the shape this
  // bridge has no control of its own for is asked as a line to write.
  expect((request?.questions as { id?: string; kind?: string }[] | undefined)
    ?.map((one) => [one.id, one.kind]))
    .toEqual([['branch', 'text'], ['settings', 'text']]);

  client.handle({
    method: 'dispatchAction',
    params: {
      channel: chatUri,
      action: {
        type: 'chat/inputCompleted',
        requestId: 'call-unknown:elicitation',
        response: 'accept',
        answers: {
          branch: { state: 'submitted', value: { kind: 'text', value: 'feature/two' } },
          // What a person types for a shape the form has no control of: the
          // text itself, which is what the server is handed back for it.
          settings: { state: 'submitted', value: { kind: 'text', value: '{"theme":"dark"}' } },
        },
      },
    },
  });
  await endedTurn(p, chatUri, 1);
  expect(prose(p, chatUri)).toContain('elicit=accept|branch=feature/two|settings={"theme":"dark"}');
});

it('carries a page rather than a form, and the server\'s own completion ends it', async () => {
  const { client, peer: p, uri, chatUri } = await talking();
  begin(client, chatUri, 't1', 'eliciturl please');
  await endedTurn(p, chatUri, 1);

  const request = asked(p, chatUri);
  // The server's own id for the page, which is the name its completion comes
  // back under, and the URL it wants opened.
  expect(request?.id).toBe('url-1');
  expect(request?.url).toBe('https://example.test/authorize');
  expect(request?.message).toBe('Sign in to continue');
  // No questions at all: there is nothing here for anybody to fill in.
  expect(request?.questions).toBeUndefined();

  // An accept with nothing in it, which is what the server's own word is worth:
  // nobody typed anything, so there is no content to hand back.
  expect(prose(p, chatUri)).toContain('elicit=accept|content=none');
  // The chat is told the request is over, so the page is not left standing in
  // front of a client that would go on offering it.
  const done = actions(p, chatUri).find((e) => e.action.type === 'chat/inputCompleted')?.action as
    { requestId?: string; response?: string } | undefined;
  expect(done?.requestId).toBe('url-1');
  expect(done?.response).toBe('accept');
  expect(actions(p, uri).some((e) => e.action.type === 'session/inputNeededRemoved' && e.action.id === 'url-1'))
    .toBe(true);
});

it('takes a question the server withdrew off the chat, and completes the request', async () => {
  const { client, peer: p, uri, chatUri, log } = await talking();
  begin(client, chatUri, 't1', 'elicitwithdraw please');
  await until(() => types(p, chatUri).includes('chat/inputRequested'));

  expect(asked(p, chatUri)?.id).toBe('call-withdrawn:elicitation');
  // The question is on the chat, so the server may take it back now.
  writeFileSync(`${log}.go`, '');
  /*
   * The server's `$/cancel_request` reaches the bridge as the request's own
   * signal being aborted, and the question is answered from there: `cancel`,
   * which is the action the protocol has for a request given up on, and what
   * the server is handed rather than a question left blocking it for ever.
   */
  await until(() => readFileSync(log, 'utf8').includes('"action":"cancel"'));
  expect(readFileSync(log, 'utf8')).toContain('"action":"cancel"');
  // The chat is told the request is over, because nobody was going to answer
  // it and a client left drawing it would go on offering an answer.
  const done = actions(p, chatUri).find((e) => e.action.type === 'chat/inputCompleted')?.action as
    { requestId?: string; response?: string } | undefined;
  expect(done?.requestId).toBe('call-withdrawn:elicitation');
  expect(done?.response).toBe('cancel');
  // And the entry goes with it, so the session is not left saying somebody is
  // needed for a question that has stopped being asked.
  expect(actions(p, uri).some((e) => e.action.type === 'session/inputNeededRemoved'
    && e.action.id === 'call-withdrawn:elicitation')).toBe(true);
  expect(types(p, uri).at(-1)).not.toBe('session/inputNeededSet');

  // The turn is stopped, because the fixture holds its prompt until a cancel
  // ends it, the way a server whose question was taken back is still working.
  client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'chat/turnCancelled', turnId: 't1', duration: 0 } },
  });
  await until(() => readFileSync(log, 'utf8').includes('"method":"session/cancel"'));
});

it('answers a withdrawal that beats the question, and draws nothing', async () => {
  const { client, peer: p, uri, chatUri, log } = await talking();
  begin(client, chatUri, 't1', 'elicitaborted please');

  /*
   * The withdrawal leaves with the question, so the request is already given up
   * on before its handler runs. The answer is still the protocol's own cancel,
   * because a server that has stopped waiting on an answer must not be left
   * waiting on one anyway.
   */
  await until(() => existsSync(log) && readFileSync(log, 'utf8').includes('"action":"cancel"'));
  expect(readFileSync(log, 'utf8')).toContain('"action":"cancel"');

  /*
   * And nothing was drawn, which is the half a live abort could not do: an
   * entry put on the chat for a question that was over on arrival would never
   * come off it, because the abort that takes the entry away is the one that
   * has already gone by.
   */
  expect(types(p, chatUri)).not.toContain('chat/inputRequested');
  expect(types(p, uri)).not.toContain('session/inputNeededSet');
  expect(actions(p, chatUri).some((e) => e.action.type === 'chat/inputCompleted')).toBe(false);

  // The turn is stopped, because the fixture holds its prompt until a cancel
  // ends it, the way a server whose question was taken back is still working.
  client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'chat/turnCancelled', turnId: 't1', duration: 0 } },
  });
  await until(() => readFileSync(log, 'utf8').includes('"method":"session/cancel"'));
});

it('moves nothing for a withdrawal that arrives after the question was answered', async () => {
  const { client, peer: p, uri, chatUri } = await talking();
  begin(client, chatUri, 't1', 'elicitwdafter please');
  await until(() => types(p, chatUri).includes('chat/inputRequested'));

  client.handle({
    method: 'dispatchAction',
    params: {
      channel: chatUri,
      action: {
        type: 'chat/inputCompleted',
        requestId: 'call-wd-after:elicitation',
        response: 'accept',
        answers: { title: { state: 'submitted', value: { kind: 'text', value: 'release/one' } } },
      },
    },
  });
  await endedTurn(p, chatUri, 1);
  // The person's own answer is what the server was given, which is what the
  // withdrawal that follows is too late for.
  expect(prose(p, chatUri)).toContain('elicit=accept|title=release/one');
  /*
   * One completion and one removal, both of them the answer's: the echoed
   * `chat/inputCompleted` on the chat and the entry the answer took with it.
   * A second of either would be the withdrawal being treated as an ending for
   * a question nobody is holding, and the server told twice about one request.
   */
  expect(actions(p, chatUri).filter((e) => e.action.type === 'chat/inputCompleted')).toHaveLength(1);
  expect(actions(p, uri).filter((e) => e.action.type === 'session/inputNeededRemoved'
    && e.action.id === 'call-wd-after:elicitation')).toHaveLength(1);
});

it('answers the question a stopped turn left standing with `cancel`', async () => {
  const { client, peer: p, uri, chatUri, log } = await talking();
  begin(client, chatUri, 't1', 'elicitcancel please');
  await until(() => types(p, chatUri).includes('chat/inputRequested'));

  // No call is being made, so the form is counted rather than named for one.
  expect(asked(p, chatUri)?.id).toBe('elicitation:1');

  client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'chat/turnCancelled', turnId: 't1', duration: 0 } },
  });
  // The answer the server was handed, out of the fixture's own record of what
  // arrived: `cancel` and not a decline, because nobody said no - the asking
  // simply stopped, and a server told a person refused would be told a thing
  // that never happened.
  await until(() => readFileSync(log, 'utf8').includes('"action":"cancel"'));
  expect(readFileSync(log, 'utf8')).toContain('"action":"cancel"');
  // The entry goes with it, so a client is not left asking a question that can
  // no longer be answered.
  expect(actions(p, uri).some((e) => e.action.type === 'session/inputNeededRemoved'
    && e.action.id === 'elicitation:1')).toBe(true);
  expect(types(p, uri).at(-1)).not.toBe('session/inputNeededSet');
  // And the chat is told the request is over, which nothing else would say: the
  // stop is the ending, so no client sent the `chat/inputCompleted` for it and
  // the question would otherwise stand on every screen with no answer coming.
  const done = actions(p, chatUri).find((e) => e.action.type === 'chat/inputCompleted')?.action as
    { requestId?: string; response?: string } | undefined;
  expect(done?.requestId).toBe('elicitation:1');
  expect(done?.response).toBe('cancel');
  // And the stop reached the server, which is what ends the prompt it was held
  // on rather than a turn that waits for a person for ever.
  expect(readFileSync(log, 'utf8')).toContain('"method":"session/cancel"');
});
