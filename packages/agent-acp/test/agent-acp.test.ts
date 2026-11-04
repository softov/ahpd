import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { DEFAULT_CLIENT_TOOL_TIMEOUT_MS } from '../../sdk/src/tools/clientcalls.js';
import type { Agent, Session, Start, StartTerminals } from '@ahpd/sdk';
import { createHost } from '../../sdk/src/host.js';
import { acpAgent } from '../src/index.js';

/*
 * The ACP backend's identity, mostly without starting anything.
 *
 * `acpAgent` builds an `Agent` from an options object and spawns nothing, so
 * what most of this checks is the part a client reads before a session exists:
 * the provider it may name, the name it sees, the controls it may fill in, and
 * the values they start at. The two `resumable` cases at the end are the
 * exception, because whether a session can be handed back is the server's own
 * answer and only a real handshake has one - they run the scripted server in
 * `test/fixtures/acp-server.mjs`.
 */

const FIXTURE = fileURLToPath(new URL('./fixtures/acp-server.mjs', import.meta.url));

/** Everything this file made, so each case leaves nothing behind. */
const made: string[] = [];
const started: Session[] = [];

afterEach(async () => {
  // The close awaited, and the removal too: on Windows a folder stays held
  // until the server in it is gone, and the release happens on the event loop
  // a sync retry blocks.
  for (const session of started.splice(0)) await session.close();
  for (const path of made.splice(0)) await rm(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

/** A fresh directory under the system temp root, kept for cleanup. */
const scratch = (): string => {
  const path = mkdtempSync(join(tmpdir(), 'ahpd-acp-'));
  made.push(path);
  return path;
};

/** A backend on the scripted server, with the flags a case needs. */
const backend = (flags: string[]): Agent => acpAgent({
  command: process.execPath,
  args: [FIXTURE, ...flags],
  provider: 'acp',
});

/** The start a session is handed, without the host that would normally build it. */
const opening = (id: string): Start => ({
  uri: `ahp-session:/${id}`,
  chatUri: `ahp-chat:/${id}`,
  settings: {},
  schema: () => ({ type: 'object', properties: {} }),
  emit: () => {},
  clientToolTimeoutMs: DEFAULT_CLIENT_TOOL_TIMEOUT_MS,
  // An ACP agent loads a project's own settings from the folder it runs in, so
  // the host starts one only in a folder it can vouch for. Nothing here is
  // about trust, and the folder is this test's own.
  trusted: () => true,
});

it('registers the acp provider and display name by default', () => {
  const agent = acpAgent({ command: 'node' });
  expect(agent.provider).toBe('acp');
  expect(agent.displayName).toBe('ACP');
  expect(agent.description).toBeUndefined();
});

it('carries an approvals control on the session, with the named model as the default', () => {
  const agent = acpAgent({ command: 'node', model: 'gpt-5' });
  const schema = agent.schema();
  const properties = schema.properties as Record<string, Record<string, unknown>>;
  expect(Object.keys(properties)).toEqual(['permissionMode']);
  expect(properties.permissionMode).toMatchObject({ type: 'string', scope: 'session', sessionMutable: true });
  // The server's modes are unknown until a session asks it, so there is no
  // enum here; a session that has asked reports the learned one instead.
  expect(properties.permissionMode?.enum).toBeUndefined();
  /*
   * The model is not a control, because it belongs to the turn rather than to
   * the conversation - but the configured id is still the default a client is
   * offered, and sends back as the model the turn runs on.
   */
  expect(agent.defaults()).toEqual({ model: 'gpt-5' });
  // Nothing was named, so nothing is defaulted: a default invented for a model
  // nobody can reach is a session that fails at the first call.
  expect(acpAgent({ command: 'node' }).defaults()).toEqual({});
});

it('names two providers from two options objects', () => {
  const first = acpAgent({ command: 'copilot', args: ['--acp'], provider: 'copilot' });
  const second = acpAgent({ command: 'codex-acp', provider: 'codex-acp', displayName: 'Codex' });
  expect([first.provider, second.provider]).toEqual(['copilot', 'codex-acp']);
  expect(second.displayName).toBe('Codex');
  expect(first.description).toBeUndefined();
});

it('will not take two backends that call themselves the same thing', () => {
  expect(() => createHost({
    path: process.cwd(),
    agents: [acpAgent({ command: 'node' }), acpAgent({ command: 'node' })],
  })).toThrow(/acp/);
});

/**
 * A session whose server has spoken: one turn run to its end, which is what
 * spawns the server and shakes hands with it.
 */
const spoken = async (agent: Agent, id: string): Promise<Session> => {
  let ended = (): void => {};
  const done = new Promise<void>((resolve) => { ended = resolve; });
  const session = agent.create({
    ...opening(id),
    emit: (_channel, action) => { if (action.type === 'chat/turnComplete') ended(); },
  });
  started.push(session);
  void session.sendMessage('t1', 'hi');
  await done;
  return session;
};

/*
 * Whether the server could be handed this conversation again, which the host
 * asks before it offers a chat as movable: a move starts the backend once more
 * with the id the conversation was kept under, so a server that would open a
 * new one instead is a chat that must stay where it is.
 *
 * A turn is run to make the handshake happen, because that answer only exists
 * once the server has spoken.
 */
it('says a conversation can be taken back when the server advertised loadSession', async () => {
  const session = await spoken(backend([]), 'movable');

  expect(session.agentId()).toBeDefined();
  expect(session.resumable?.()).toBe(true);
});

it('says it cannot when the server advertised neither loadSession nor a resume', async () => {
  // The id is still there, since this bridge can name what it is running, so
  // the answer comes from the handshake and never from whether there is a name.
  const session = await spoken(backend(['--no-load', '--no-resume']), 'fixed');

  expect(session.agentId()).toBeDefined();
  expect(session.resumable?.()).toBe(false);
});

it('is busy while an acp terminal runs', async () => {
  // A shell the test ends by hand, so the turn is caught while the server waits on it.
  let exit: (() => void) | undefined;
  const opened: string[] = [];
  const terminals: StartTerminals = {
    open: () => {
      const uri = `ahp-terminal:/t${String(opened.length)}`;
      opened.push(uri);
      const done = new Promise<{ exitCode?: number }>((resolve) => { exit = () => { resolve({ exitCode: 0 }); }; });
      return {
        uri,
        output: () => ({ output: 'hello from the shell\n', exitCode: 0 }),
        waitForExit: () => done,
        write: () => {},
        resize: () => {},
        kill: () => {},
        release: () => {},
      };
    },
  };
  const session = backend([]).create({ ...opening('busy'), workingDirectory: scratch(), terminals });
  started.push(session);
  await session.setConfig?.('permissionMode', 'code');
  expect(session.busy?.()).toBe(false);

  session.sendMessage('t1', 'term');
  for (let i = 0; i < 400 && opened.length === 0; i++) await new Promise((r) => { setTimeout(r, 5); });
  expect(opened).toHaveLength(1);
  expect(session.busy?.()).toBe(true);

  exit?.();
  for (let i = 0; i < 400 && session.busy?.() === true; i++) await new Promise((r) => { setTimeout(r, 5); });
  expect(session.busy?.()).toBe(false);
});
