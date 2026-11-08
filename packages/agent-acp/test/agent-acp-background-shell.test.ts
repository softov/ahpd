import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { uriOf } from '@ahpd/sdk';
import type { Bag } from '@ahpd/sdk';
import { createHost } from '../../sdk/src/host.js';
import { shellTerminals } from '../../sdk/src/machines/terminals.js';
import { acpAgent } from '../src/index.js';
import { anyone, signIn } from './people.js';
import type { Peer } from '../../sdk/src/types/rpc.js';

/*
 * A shell the agent opened, still running when its call is over.
 *
 * ACP has no notion of background work: a server asks for a terminal and the
 * call that made it ends while the process goes on. The bridge reads that off
 * the call's content, and reports it through the host's seam so the host draws
 * the row. The server here is the real fixture, so what is checked is a whole
 * turn - a terminal opened over JSON-RPC, a call completed, and the row that
 * follows.
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
const until = async (check: () => boolean | Promise<boolean>, times = 4000): Promise<void> => {
  for (let i = 0; i < times; i++) {
    if (await check()) return;
    await new Promise((r) => { setTimeout(r, 1); });
  }
  throw new Error(`still waiting after ${times} tries`);
};

/** Lets `times` timer ticks pass, for a check that something did not happen. */
const pause = async (times: number): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((r) => { setTimeout(r, 1); });
};

type Note = { channel: string; action: Bag };

const actions = (p: ReturnType<typeof peer>, channel: string): Note[] => p.notes
  .filter((n) => n.method === 'action')
  .map((n) => n.params as Note)
  .filter((e) => e.channel === channel);

const types = (p: ReturnType<typeof peer>, channel: string): string[] =>
  actions(p, channel).map((e) => String(e.action.type)).filter((type) => type !== 'chat/isReadChanged');

/** The turn-ending actions, one per `begin`. */
const finished = (p: ReturnType<typeof peer>, chatUri: string, turns: number): boolean =>
  types(p, chatUri).filter((type) => type === 'chat/turnComplete' || type === 'chat/turnCancelled').length >= turns;

/** The background actions on one chat, in the order they arrived. */
const work = (p: ReturnType<typeof peer>, chatUri: string): Bag[] => actions(p, chatUri)
  .map((e) => e.action)
  .filter((action) => String(action.type).startsWith('chat/backgroundWork'));

const sets = (p: ReturnType<typeof peer>, chatUri: string): Bag[] =>
  work(p, chatUri).filter((action) => action.type === 'chat/backgroundWorkSet');

const removals = (p: ReturnType<typeof peer>, chatUri: string): Bag[] =>
  work(p, chatUri).filter((action) => action.type === 'chat/backgroundWorkRemoved');

/** A connected client with one ACP session, watching both its channels. */
async function talking() {
  const path = mkdtempSync(join(tmpdir(), 'ahpd-acp-bg-'));
  const host = createHost({
    path,
    agents: [acpAgent({ command: process.execPath, args: [FIXTURE], provider: 'acp' })],
    terminals: shellTerminals(),
    users: anyone(),
  });
  const p = peer();
  const client = host.accept(p);
  await client.handle({
    method: 'initialize',
    params: { clientId: 'probe', protocolVersions: ['0.9.0'], initialSubscriptions: ['ahp-root://'] },
  });
  await signIn(client);
  const uri = 'ahp-session:/one';
  await client.handle({
    method: 'dispatchAction',
    params: {
      channel: 'ahp-root://',
      action: { type: 'root/configChanged', config: { workspaceTrust: { enabled: true, trustedUris: [uriOf(path)] } } },
    },
  });
  await client.handle({
    method: 'createSession',
    params: { channel: uri, provider: 'acp', workingDirectories: [uriOf(path)] },
  });
  const chatUri = ((await client.handle({ method: 'subscribe', params: { channel: uri } })) as {
    snapshot: { state: { defaultChat: string } };
  }).snapshot.state.defaultChat;
  await client.handle({ method: 'subscribe', params: { channel: chatUri } });
  opened.push({ client, uri });
  return { host, client, p, uri, chatUri, path };
}

/** The sessions this file started, so each one's subprocess is stopped. */
const opened: { client: ReturnType<ReturnType<typeof createHost>['accept']>; uri: string }[] = [];

afterEach(async () => {
  for (const one of opened.splice(0)) {
    await one.client.handle({ method: 'disposeSession', params: { channel: one.uri } });
  }
});

/** One turn, dispatched the way a client dispatches it. */
const begin = (client: Awaited<ReturnType<typeof talking>>['client'], chatUri: string, turnId: string, text: string): void => {
  client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId, startedAt: new Date().toISOString(), message: { text, origin: { kind: 'user' } } } },
  });
};

/** The stop a client sends for one row. */
const stop = async (
  client: Awaited<ReturnType<typeof talking>>['client'],
  chatUri: string,
  id: string,
): Promise<Bag> => client.handle({ method: 'vscode/stopBackgroundWork', params: { chat: chatUri, id } }) as Promise<Bag>;

it('lists a terminal that runs past its call, and the stop ends it', async () => {
  const { client, p, chatUri } = await talking();
  begin(client, chatUri, 't1', 'linger on');
  await until(() => finished(p, chatUri, 1));
  await until(() => sets(p, chatUri).length > 0);

  // One row, named with the call's title and carrying what a client needs to
  // draw the shell: the command line, the start, the terminal and the flag.
  const rows = sets(p, chatUri);
  expect(rows).toHaveLength(1);
  const work_ = rows[0]?.work as Bag;
  expect(work_).toMatchObject({
    kind: 'shell',
    label: 'Watch for changes',
    command: 'sh -c sleep 30',
    startedAt: expect.any(String),
    terminal: expect.stringMatching(/^agenthost-terminal:\/\/shell\//u),
    _meta: { 'vscode.stopBackgroundWork': true },
  });
  // The row is the terminal: a client reading the task and a client opening the
  // channel are looking at the same work.
  expect(work_.id).toBe(work_.terminal);

  const id = String(work_.id);
  expect(await stop(client, chatUri, id)).toEqual({ stopped: true });
  // A second press while the first kill is still on its way to an exit, and
  // after it: the answer is false either way, because nothing is left to stop.
  expect(await stop(client, chatUri, id)).toEqual({ stopped: false });

  await until(() => removals(p, chatUri).length > 0);
  expect(removals(p, chatUri)).toHaveLength(1);
  expect(removals(p, chatUri)[0]?.id).toBe(id);
});

it('says nothing for a terminal that had exited before its call ended', async () => {
  const { client, p, chatUri } = await talking();
  begin(client, chatUri, 't1', 'brief it');
  await until(() => finished(p, chatUri, 1));
  // The call's content names a terminal whose process is gone, which is a call
  // that used a shell rather than one that left work behind.
  expect(work(p, chatUri)).toEqual([]);
});

it('lists a running terminal no call named, labelled with its command line', async () => {
  const { client, p, chatUri } = await talking();
  begin(client, chatUri, 't1', 'unspoken');
  await until(() => finished(p, chatUri, 1));
  await until(() => sets(p, chatUri).length > 0);

  const rows = sets(p, chatUri);
  expect(rows).toHaveLength(1);
  const work_ = rows[0]?.work as Bag;
  // No call carried a title, so the line the agent ran is what the row says.
  expect(work_).toMatchObject({
    kind: 'shell',
    label: 'sh -c sleep 30',
    command: 'sh -c sleep 30',
    startedAt: expect.any(String),
    terminal: expect.stringMatching(/^agenthost-terminal:\/\/shell\//u),
  });

  // Stopped here so the process does not outlive the case.
  await stop(client, chatUri, String(work_.id));
  await until(() => removals(p, chatUri).length > 0);
});

it('takes the row down when the process exits', async () => {
  const { client, p, chatUri, path } = await talking();
  begin(client, chatUri, 't1', 'fade out');
  await until(() => sets(p, chatUri).length > 0);
  expect(removals(p, chatUri)).toEqual([]);

  // The shell the fixture started watches for this file, so the exit is the
  // test's to time rather than a race with a sleep.
  writeFileSync(join(path, 'fade-away'), '');
  await until(() => removals(p, chatUri).length > 0);

  expect(removals(p, chatUri)).toHaveLength(1);
  expect(removals(p, chatUri)[0]?.id).toBe((sets(p, chatUri)[0]?.work as Bag).id);
});

it('takes the row down once when the agent releases the terminal', async () => {
  const { client, p, chatUri } = await talking();
  begin(client, chatUri, 't1', 'release it');
  await until(() => finished(p, chatUri, 1));
  await until(() => removals(p, chatUri).length > 0);

  // The release ends the process too, and the exit behind it must not say the
  // same removal again.
  await pause(200);
  expect(sets(p, chatUri)).toHaveLength(1);
  expect(removals(p, chatUri)).toHaveLength(1);
});
