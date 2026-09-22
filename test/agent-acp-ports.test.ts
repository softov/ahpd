import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { createHost } from '../packages/sdk/src/host.js';
import { fileResources } from '../packages/sdk/src/resources.js';
import { shellTerminals } from '../packages/sdk/src/terminals.js';
import { acpAgent } from '../packages/agent-acp/src/index.js';
import type { Peer } from '../packages/sdk/src/types/rpc.js';

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
    close: () => {},
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

afterEach(async () => {
  for (const one of running.splice(0)) {
    await one.client.handle({ method: 'disposeSession', params: { channel: one.uri } });
  }
  for (const path of made.splice(0)) rmSync(path, { recursive: true, force: true });
});

/** The `clientCapabilities` the bridge advertised, out of the fixture's log. */
const capabilitiesOf = (log: string): unknown => {
  const lines = readFileSync(log, 'utf8').trim().split('\n').filter((one) => one !== '');
  for (const line of lines) {
    const held = JSON.parse(line) as { method?: string; params?: { clientCapabilities?: unknown } };
    if (held.method === 'initialize') return held.params?.clientCapabilities;
  }
  return undefined;
};

/** A connected client with one ACP session, watching both its channels. */
async function talking(options: { files?: boolean; shells?: boolean } = {}) {
  const path = mkdtempSync(join(tmpdir(), 'ahpd-acp-ports-'));
  made.push(path);
  writeFileSync(join(path, 'note.txt'), 'the note body');
  const log = join(path, 'requests.jsonl');
  const host = createHost({
    path,
    agents: [acpAgent({ command: process.execPath, args: [FIXTURE], env: { ACP_LOG: log }, provider: 'acp' })],
    ...(options.files === false ? {} : { resources: fileResources() }),
    ...(options.shells === false ? {} : { terminals: shellTerminals() }),
  });
  const p = peer();
  const client = host.accept(p);
  await client.handle({
    method: 'initialize',
    params: { clientId: 'probe', protocolVersions: ['0.8.0'], initialSubscriptions: ['ahp-root://'] },
  });
  const uri = 'ahp-session:/ports';
  const chatUri = 'ahp-chat:/ports';
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
  expect(capabilitiesOf(both.log)).toEqual({ fs: { readTextFile: true, writeTextFile: true }, terminal: true });

  // A capability advertised without an implementation is a request nobody
  // answers, so a host with neither port asks a server for neither.
  const neither = await talking({ files: false, shells: false });
  begin(neither.client, neither.chatUri, 't1', 'hello');
  await endedTurn(neither.peer, neither.chatUri, 1);
  expect(capabilitiesOf(neither.log)).toEqual({});
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
