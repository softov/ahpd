import { WAIT_MS } from '../../../tools/wait.ts';
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
import { createHandlers } from '../src/session/handlers.js';
import type { SessionContext } from '../src/session/context.js';
import { anyone, signIn } from './people.js';
import type { ChangesetSource } from '../../sdk/src/types/changes.js';
import type { Peer } from '../../sdk/src/types/rpc.js';
import type { SpawnPty } from '../../sdk/src/types/terminals.js';
import { fakePty } from '../../sdk/test/support/pty.js';
import { checker } from '../../../tools/wire.mjs';
import { undeclaredIn } from '../../sdk/test/support/wire.js';
import { callsIn, openedFrom, replayed } from '../../sdk/test/support/replay.js';
import type { Bag } from '@ahpd/sdk';

/** The space a command is typed after, which keeps it out of a POSIX shell's history; PowerShell, Windows' shell here, keeps none. */
const HISTORY_SPACE = process.platform === 'win32' ? '' : ' ';

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
  throw new Error(`still waiting after ${times} tries`);
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
const listed = async (log: string, ms = WAIT_MS): Promise<void> => {
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
  /** The pseudoterminal the host's shells run under, or pipes. */
  pty?: SpawnPty;
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
    ...(options.shells === false ? {} : { terminals: shellTerminals(options.pty === undefined ? {} : { pty: options.pty }) }),
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
  // The chat the host minted for the session, read off its state.
  const opened = await client.handle({ method: 'subscribe', params: { channel: uri } }) as { snapshot: { state: { defaultChat: string } } };
  const chatUri = opened.snapshot.state.defaultChat;
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
    params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId, startedAt: new Date().toISOString(), message: { text, origin: { kind: 'user' } } } },
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

it('refuses a permission and a question asked with no turn running, and an empty question in one', async () => {
  const said: Bag[] = [];
  const ctx = {
    emit: (_channel: string, action: Bag) => { said.push(action); },
    provider: 'acp',
    start: { chatUri: 'ahp-chat:/none' },
    cwd: tmpdir(),
    seeds: [],
    replay: [],
    permissions: new Map(),
    terminals: new Map(),
    elicitations: new Map(),
    mapping: undefined,
    options: {},
  } as unknown as SessionContext;
  const handlers = createHandlers(ctx);
  const form = { sessionId: 's', mode: 'form', message: 'Which branch?', requestedSchema: { type: 'object', properties: { branch: { type: 'string' } } } };
  // No turn holds a call or a question to show, so the server is answered at
  // once, as VS Code's host rejects a permission without an active turn and
  // its Claude cancels a question asked outside one.
  expect(await handlers.requestPermission({
    sessionId: 's',
    toolCall: { toolCallId: 'c1', title: 'Remove a file', kind: 'delete' },
    options: [{ optionId: 'yes', name: 'Yes', kind: 'allow_once' }],
  } as never)).toBe('cancelled');
  expect(await handlers.askElicitation(form as never)).toEqual({ action: 'cancel' });
  // In a turn, a question with neither a page nor a field is cancelled unasked.
  ctx.mapping = { turnId: 't1', parts: [], calls: new Map(), opening: [] };
  expect(await handlers.askElicitation({ ...form, requestedSchema: { type: 'object', properties: {} } } as never)).toEqual({ action: 'cancel' });
  expect(said).toEqual([]);
});

it('hands back at most outputByteLimit bytes of output, cut at a character boundary', async () => {
  // Four bytes each: a cut that counted characters would keep twice the limit.
  const output = `start ${'\u{1F600}'.repeat(4)}`;
  const terminals = new Map([['t1', { handle: { output: () => ({ output }) }, outputByteLimit: 10, openedAt: '', command: 'x' }]]);
  const handlers = createHandlers({
    emit: () => {}, provider: 'acp', start: {}, cwd: tmpdir(),
    seeds: [], replay: [], permissions: new Map(), terminals, elicitations: new Map(), options: {},
  } as unknown as SessionContext);
  const read = await handlers.terminalOutput({ sessionId: 's', terminalId: 't1' } as never);
  // The last two characters, eight bytes: a third would cross the limit, and
  // half of one is no character.
  expect(read.output).toBe('\u{1F600}'.repeat(2));
  expect(Buffer.byteLength(read.output, 'utf8')).toBeLessThanOrEqual(10);
  expect(read.truncated).toBe(true);
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
      params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId, startedAt: new Date().toISOString(), message: { text, origin: { kind: 'user' } } } },
    });
  };
  // A call the server reports, a call the server asks about first, and a
  // person's own shell command, each of which holds a tool call part.
  begin('t1', 'tool now');
  await endedTurn(p, chatUri, 1);
  begin('t2', 'ask me first');
  await until(() => types(p, uri).includes('session/inputNeededSet'));
  // An approval as VS Code's client sends one, which the host says as it came
  // and the backend says nothing more of.
  client.handle({
    method: 'dispatchAction',
    // As the protocol declares an approval: with how it was confirmed.
    params: { channel: chatUri, action: { type: 'chat/toolCallConfirmed', turnId: 't2', toolCallId: 'call-perm', approved: true, confirmed: 'user-action' } },
  });
  await endedTurn(p, chatUri, 2);
  expect(p.notes.filter((note) => note.method === 'action' && ((note.params as Bag).action as Bag).type === 'chat/toolCallConfirmed')).toHaveLength(1);
  begin('t3', '!echo declared');
  await endedTurn(p, chatUri, 3);

  const late = await client.handle({ method: 'subscribe', params: { channel: chatUri } });
  const calls = ((((late as Bag).snapshot as Bag).state as Bag).turns as Bag[])
    .flatMap((turn) => turn.responseParts as Bag[])
    .filter((part) => part.kind === 'toolCall')
    .map((part) => String((part.toolCall as Bag).toolCallId));
  expect(calls).toEqual(expect.arrayContaining(['call-1', 'call-perm']));
  expect(calls.length).toBe(3);
  // The session too, which holds the server's commands as prompts and its
  // options as controls.
  const session = await client.handle({ method: 'subscribe', params: { channel: uri } });
  expect(undeclaredIn([
    ...p.notes,
    { asked: 'subscribe', params: { channel: chatUri }, result: late },
    { asked: 'subscribe', params: { channel: uri }, result: session },
  ])).toEqual([]);
  expect(callsIn(openedFrom(late).state)).toEqual(callsIn(replayed(opened, p.notes, chatUri)));
});

/*
 * A terminal shown as what it is: a server's, and a person's command's while
 * it runs, as the reference host names its own once its shell has printed, the
 * command typed into that shell and ended by the shell integration's mark that
 * it finished.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/localCommands/bangLocalCommand.ts#L52-L117
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/shared/shellCommandExecution.ts#L224-L285
 */
it('says a pseudoterminal runs a terminal, and names a command\'s while it runs', async () => {
  const pty = fakePty();
  const { client, peer: p, chatUri } = await talking({ pty: pty.spawn });
  const opened = openedFrom(await client.handle({ method: 'subscribe', params: { channel: chatUri } }));
  const begin = (turnId: string, text: string): void => {
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId, startedAt: new Date().toISOString(), message: { text, origin: { kind: 'user' } } } },
    });
  };
  // Named by VS Code's link for a call's terminal, which the host serves.
  const named = { type: 'terminal', resource: expect.stringMatching(/^agenthost-terminal:\/\/shell\//), title: 'Terminal', isPty: true };

  // A call whose content names a terminal the server opened through the host,
  // titled by the call it belongs to.
  begin('t1', 'paint it');
  // The fixture waits for the shell before it releases it, and this shell is
  // the test's to end: `echo painted` finishes at once on a real one.
  await until(() => pty.started.length > 0);
  pty.exit();
  await endedTurn(p, chatUri, 1);
  const painted = actions(p, chatUri).find((e) => e.action.type === 'chat/toolCallComplete' && e.action.toolCallId === 'call-paint');
  expect(((painted?.action.result as Bag).content as Bag[])[0]).toMatchObject({ ...named, title: 'Paint and preview' });

  // A person's command names its terminal once its shell has printed its
  // prompt, and the command is typed in.
  const shells = pty.started.length;
  begin('t2', '!make preview');
  const changed = (): Bag | undefined => actions(p, chatUri)
    .find((e) => e.action.type === 'chat/toolCallContentChanged' && e.action.turnId === 't2')?.action;
  await until(() => pty.started.length > shells);
  pty.say('\u001b]633;A\u0007$ \u001b]633;B\u0007');
  await until(() => changed() !== undefined && pty.typed.at(-1) === `${HISTORY_SPACE}make preview\r`);
  expect(changed()?.content).toEqual([named]);
  expect(changed()).not.toHaveProperty('_meta');
  const during = openedFrom(await client.handle({ method: 'subscribe', params: { channel: chatUri } }));
  expect(callsIn(during.state)).toEqual(callsIn(replayed(opened, p.notes, chatUri)));

  pty.say('\u001b]633;C\u0007built\r\n\u001b]633;D;0\u0007\u001b]633;A\u0007$ ');
  await endedTurn(p, chatUri, 2);
  const done = actions(p, chatUri).find((e) => e.action.type === 'chat/toolCallComplete' && e.action.turnId === 't2');
  expect((done?.action.result as Bag).content).toEqual([
    { ...named, result: { exitCode: 0, preview: 'built' } },
    { type: 'text', text: 'built' },
  ]);
  const late = await client.handle({ method: 'subscribe', params: { channel: chatUri } });
  expect(callsIn(openedFrom(late).state)).toEqual(callsIn(replayed(opened, p.notes, chatUri)));
  expect(undeclaredIn([...p.notes, { asked: 'subscribe', params: { channel: chatUri }, result: late }])).toEqual([]);
});

/** VS Code's options for a write whose path the call names nowhere, in its words. */
const ONCE = [
  { id: 'allow-once', label: 'Allow Once', kind: 'approve' },
  { id: 'skip', label: 'Skip', kind: 'deny', group: 2 },
];

/*
 * A question carries no option of the server's: the host puts VS Code's on
 * it, as VS Code's agents raise a pending confirmation for their host's chain
 * to put the options on, here a removal's, which names no path to grant.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/sessionPermissions.ts#L566-L610
 */
it('offers none of the server\'s options, the host putting VS Code\'s on the call and on the ask', async () => {
  const { client, peer: p, uri, chatUri } = await talking();
  begin(client, chatUri, 't1', 'ask me first');
  await until(() => types(p, uri).includes('session/inputNeededSet'));

  const ready = actions(p, chatUri)
    .filter((e) => e.action.type === 'chat/toolCallReady' && e.action.toolCallId === 'call-perm')
    .at(-1)?.action;
  // A ready with no `confirmed`, so a call the server announced as running
  // goes back to `pending-confirmation` with the choices on it.
  expect(ready?.confirmed).toBeUndefined();
  expect(ready?.options).toEqual(ONCE);
  expect(ready?.confirmationTitle).toBe('Remove a file');
  const entry = actions(p, uri).find((e) => e.action.type === 'session/inputNeededSet')?.action.request as {
    toolCall?: { options?: unknown };
  };
  expect(entry?.toolCall?.options).toEqual(ONCE);

  const snapshot = await client.handle({ method: 'subscribe', params: { channel: chatUri } }) as {
    snapshot: { state: { activeTurn?: { responseParts: { toolCall?: { toolCallId: string; status: string; options?: unknown } }[] } } };
  };
  const call = snapshot.snapshot.state.activeTurn?.responseParts.find((one) => one.toolCall?.toolCallId === 'call-perm')?.toolCall;
  expect(call?.status).toBe('pending-confirmation');
  expect(call?.options).toEqual(ONCE);

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

it('leaves the activity as it was while a confirmation waits', async () => {
  const { client, peer: p, uri, chatUri } = await talking();
  begin(client, chatUri, 't1', 'ask me first');
  await until(() => types(p, uri).includes('session/inputNeededSet'));

  // The status says a person is needed; the activity says nothing of the
  // turn or the wait, and so names neither.
  const said = actions(p, chatUri)
    .filter((e) => e.action.type === 'chat/activityChanged')
    .map((e) => e.action.activity);
  expect(said).toEqual([]);

  client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'chat/toolCallConfirmed', turnId: 't1', toolCallId: 'call-perm', approved: true, confirmed: 'user-action' } },
  });
  await endedTurn(p, chatUri, 1);
});

/*
 * What the host keeps of an answer is the host's, and the server is answered
 * once, as VS Code's Copilot agent answers its runtime `approve-once` whatever
 * its host kept.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/copilot/copilotAgentSession.ts#L8640
 */
it('answers the server once whatever the person picked of the host\'s options, and says which they picked', async () => {
  const { client, peer: p, uri, chatUri } = await talking({ rules: { 'make build': true } });
  begin(client, chatUri, 't1', 'execrun');
  await until(() => types(p, uri).includes('session/inputNeededSet'));

  // The command's grant in this session, which the host keeps.
  const ready = actions(p, chatUri)
    .filter((e) => e.action.type === 'chat/toolCallReady' && e.action.toolCallId === 'call-run')
    .at(-1)?.action;
  const grant = (ready?.options as Bag[] | undefined)?.find((one) => String(one.id).startsWith('allow-session-rules:'));
  expect(grant).toBeDefined();
  client.handle({
    method: 'dispatchAction',
    params: {
      channel: chatUri,
      action: {
        type: 'chat/toolCallConfirmed', turnId: 't1', toolCallId: 'call-run',
        approved: true, confirmed: 'user-action', selectedOptionId: grant?.id,
      },
    },
  });
  await endedTurn(p, chatUri, 1);
  expect(prose(p, chatUri)).toContain('exec=yes-once');
  const echoed = p.notes.find((n) => n.method === 'action' && (n.params as Note).channel === chatUri
    && (n.params as Note).action.type === 'chat/toolCallConfirmed');
  expect((echoed?.params as Note | undefined)?.action.selectedOptionId).toBe(grant?.id);
  expect(checker().frame(echoed)).toEqual([]);
});

/*
 * A refusal the host makes itself is said to no client: the server is
 * answered its refusal, and the failure it reports ends the call for every
 * client, a call it held as not yet started included, as VS Code's agents
 * report the failure their runtime gives a call their host refused.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L1727-L1735
 */
it('refuses a call the session\'s permissions deny before anybody is asked, and the server\'s failure ends it as a denial', async () => {
  const { client, peer: p, uri, chatUri } = await talking();
  await client.handle({
    method: 'dispatchAction',
    params: { channel: uri, action: { type: 'session/configChanged', config: { permissions: { allow: [], deny: ['drop_branch'] } } } },
  });
  begin(client, chatUri, 't1', 'hold it');
  await endedTurn(p, chatUri, 1);

  expect(types(p, uri)).not.toContain('session/inputNeededSet');
  expect(prose(p, chatUri)).toContain('perm=no-once');
  const late = await client.handle({ method: 'subscribe', params: { channel: chatUri } });
  const held = ((((late as Bag).snapshot as Bag).state as Bag).turns as Bag[])
    .flatMap((turn) => turn.responseParts as Bag[])
    .map((part) => part.toolCall as Bag | undefined)
    .find((one) => one?.toolCallId === 'call-hold');
  expect(held).toMatchObject({ status: 'completed', success: false, error: { code: 'denied' } });
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
 * The host's chain answers a line the window's rules allow, and the server is
 * sent its `allow_once` with nobody asked; an unmatched line and a call with no
 * command line are put to a person.
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

/*
 * The host's chain approves the line by the window's rules, the question
 * saying it is a bash command; a server that offers no once option is
 * answered `cancelled`, an "always" being a decision nobody made.
 */
it('answers the server cancelled where the host approves a call it offers no once option for', async () => {
  const { client, peer: p, uri, chatUri } = await talking({ rules: { 'make test': true } });
  begin(client, chatUri, 't1', 'execrun alwaysonly');
  await endedTurn(p, chatUri, 1);

  expect(types(p, uri)).not.toContain('session/inputNeededSet');
  expect(prose(p, chatUri)).toContain('exec=cancelled');
});

/*
 * A question says what the host decides it by, beside its ready, as VS Code's
 * agents raise a pending confirmation: the kind of call by its ACP kind, the
 * path its first location names, the URL a fetch's input names, a command's
 * line in bash, and an MCP server's tool by its name. It offers no options of
 * its own, save a mode switch's, whose buttons a person's pick reaches the
 * server as.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agent.ts#L1499-L1541
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeInteractiveTools.ts#L32-L47
 */
it('says what the host decides a question by on its ready, and offers no options save a mode switch\'s buttons', async () => {
  const said: Bag[] = [];
  const opened: string[] = [];
  const ctx = {
    emit: (_channel: string, action: Bag) => { said.push(action); },
    provider: 'acp',
    start: { chatUri: 'ahp-chat:/fields' },
    cwd: tmpdir(),
    seeds: [],
    replay: [],
    permissions: new Map(),
    terminals: new Map(),
    elicitations: new Map(),
    mapping: { turnId: 't1', parts: [], calls: new Map(), opening: [] },
    clientToolOf: () => undefined,
    openCall: (call: { toolCallId: string }) => { opened.push(call.toolCallId); },
    options: {},
  } as unknown as SessionContext;
  const handlers = createHandlers(ctx);
  const once = [
    { optionId: 'yes', name: 'Allow', kind: 'allow_once' },
    { optionId: 'ever', name: 'Always allow', kind: 'allow_always' },
    { optionId: 'no', name: 'Reject', kind: 'reject_once' },
  ];
  const ask = (toolCall: Bag, options: Bag[] = once): Promise<unknown> =>
    handlers.requestPermission({ sessionId: 's', toolCall, options } as never);
  const shell = ask({ toolCallId: 'c-shell', title: 'Run', kind: 'execute', rawInput: { command: 'make test', cwd: '/work' } });
  const read = ask({ toolCallId: 'c-read', title: 'Read', kind: 'read', locations: [{ path: '/work/a.txt' }] });
  const edit = ask({ toolCallId: 'c-edit', title: 'Edit', kind: 'edit', locations: [{ path: '/work/b.txt', line: 3 }] });
  const fetch = ask({ toolCallId: 'c-url', title: 'Fetch', kind: 'fetch', rawInput: { url: 'https://example.com/x' } });
  const mcp = ask({ toolCallId: 'c-mcp', title: 'Look up', name: 'mcp__docs__lookup', kind: 'other' });
  const plan = ask({ toolCallId: 'c-plan', title: 'Ready to code?', kind: 'switch_mode' }, [
    { optionId: 'auto', name: 'Yes, and auto-accept edits', kind: 'allow_always' },
    { optionId: 'manual', name: 'Yes, and manually approve edits', kind: 'allow_once' },
    { optionId: 'keep', name: 'No, keep planning', kind: 'reject_once' },
  ]);
  const readyOf = (id: string): Bag | undefined => said.find((one) => one.type === 'chat/toolCallReady' && one.toolCallId === id);
  // A command's question waits on the window's rules before it is said.
  await until(() => readyOf('c-shell') !== undefined);

  expect(readyOf('c-shell')).toMatchObject({ permissionKind: 'shell', shellCommand: 'make test', shellLanguage: 'bash' });
  expect(readyOf('c-read')).toMatchObject({ permissionKind: 'read', permissionPath: '/work/a.txt' });
  expect(readyOf('c-edit')).toMatchObject({ permissionKind: 'write', permissionPath: '/work/b.txt' });
  expect(readyOf('c-url')).toMatchObject({ permissionKind: 'url', permissionUrl: 'https://example.com/x' });
  expect(readyOf('c-mcp')).toMatchObject({ permissionKind: 'mcp' });
  for (const id of ['c-shell', 'c-read', 'c-edit', 'c-url', 'c-mcp']) expect(readyOf(id)).not.toHaveProperty('options');
  expect(readyOf('c-plan')).toMatchObject({ permissionKind: 'custom-tool' });
  expect(readyOf('c-plan')?.options).toEqual([
    { id: 'auto', label: 'Yes, and auto-accept edits', kind: 'approve', group: 1 },
    { id: 'manual', label: 'Yes, and manually approve edits', kind: 'approve', group: 1 },
    { id: 'keep', label: 'No, keep planning', kind: 'deny', group: 2 },
  ]);

  // The server is answered once whatever the host kept, and a mode switch's
  // button the person picked as itself.
  expect(handlers.confirm('c-shell', true, 'allow-session')).toBe(true);
  expect(handlers.confirm('c-read', false, 'skip')).toBe(true);
  expect(handlers.confirm('c-plan', true, 'auto')).toBe(true);
  expect(await shell).toEqual({ optionId: 'yes' });
  expect(await read).toEqual({ optionId: 'no' });
  expect(await plan).toEqual({ optionId: 'auto' });
  for (const id of ['c-edit', 'c-url', 'c-mcp']) handlers.confirm(id, false);
  await Promise.all([edit, fetch, mcp]);
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
  // many, with the bounds the array set. Both are closed sets of answers, said
  // with `allowFreeformInput: false`, as VS Code's Claude closes a form's selects.
  expect((request?.questions as unknown[])?.[3]).toMatchObject({
    kind: 'single-select', options: [{ id: 'fast', label: 'fast' }, { id: 'careful', label: 'careful' }], allowFreeformInput: false,
  });
  expect((request?.questions as unknown[])?.[4]).toMatchObject({
    kind: 'multi-select', options: [{ id: 'a', label: 'a' }, { id: 'b', label: 'b' }], allowFreeformInput: false,
  });

  // The session says somebody is needed, as a permission does, and the entry is
  // the chat input kind under VS Code's id for it: it names the chat rather
  // than a turn.
  // https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/chatContributions/sessionInputNeeded/sessionInputNeededContribution.ts#L85-L157
  const entry = needing(p, uri);
  expect(entry).toMatchObject({ id: `chatInput:${String(entry?.chat)}:call-elicit:elicitation`, kind: 'chatInput' });
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
    && e.action.id === entry?.id)).toBe(true);
});

it('leaves the activity as it was while a question waits', async () => {
  const { client, peer: p, chatUri } = await talking();
  begin(client, chatUri, 't1', 'elicitform please');
  await until(() => types(p, chatUri).includes('chat/inputRequested'));

  // The status says a person is needed; the activity says nothing of the
  // turn or the wait, and so names neither.
  const said = actions(p, chatUri)
    .filter((e) => e.action.type === 'chat/activityChanged')
    .map((e) => e.action.activity);
  expect(said).toEqual([]);

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
  // No completion in nobody's name, as the reference host says none: the page
  // stays in its turn, and its entry went with the turn that ended.
  expect(actions(p, chatUri).some((e) => e.action.type === 'chat/inputCompleted')).toBe(false);
  const entry = needing(p, uri);
  expect(entry?.id).toBe(`chatInput:${String(entry?.chat)}:url-1`);
  expect(actions(p, uri).some((e) => e.action.type === 'session/inputNeededRemoved' && e.action.id === entry?.id))
    .toBe(true);
});

it('answers a question the server withdrew with cancel, and says nothing to the chat', async () => {
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
  // The chat is told nothing in nobody's name, as the reference host tells it
  // nothing: the question stays in its turn until the turn ends.
  expect(actions(p, chatUri).some((e) => e.action.type === 'chat/inputCompleted')).toBe(false);

  // The turn is stopped, because the fixture holds its prompt until a cancel
  // ends it, the way a server whose question was taken back is still working.
  client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'chat/turnCancelled', turnId: 't1', duration: 0 } },
  });
  await until(() => readFileSync(log, 'utf8').includes('"method":"session/cancel"'));
  // And the session's entry for the question goes with the turn.
  await until(() => actions(p, uri).some((e) => e.action.type === 'session/inputNeededRemoved'));
  expect(types(p, uri).at(-1)).not.toBe('session/inputNeededSet');
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
  const entry = needing(p, uri);
  expect(entry?.id).toBe(`chatInput:${String(entry?.chat)}:call-wd-after:elicitation`);
  expect(actions(p, uri).filter((e) => e.action.type === 'session/inputNeededRemoved'
    && e.action.id === entry?.id)).toHaveLength(1);
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
  // The entry goes with the turn the stop ended, so a client is not left asking
  // a question that can no longer be answered.
  const entry = needing(p, uri);
  expect(entry?.id).toBe(`chatInput:${String(entry?.chat)}:elicitation:1`);
  expect(actions(p, uri).some((e) => e.action.type === 'session/inputNeededRemoved'
    && e.action.id === entry?.id)).toBe(true);
  expect(types(p, uri).at(-1)).not.toBe('session/inputNeededSet');
  // And no completion in nobody's name: the stop is the ending, and the turn it
  // ends closes the question in every client's state.
  expect(actions(p, chatUri).some((e) => e.action.type === 'chat/inputCompleted')).toBe(false);
  // And the stop reached the server, which is what ends the prompt it was held
  // on rather than a turn that waits for a person for ever.
  expect(readFileSync(log, 'utf8')).toContain('"method":"session/cancel"');
});
