import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import type { Bag, Session, Start } from '@ahpd/sdk';
import { DEFAULT_CLIENT_TOOL_TIMEOUT_MS } from '../../sdk/src/clientcalls.js';
import { acpAgent } from '../src/index.js';

/*
 * An ACP agent in a folder nobody vouched for.
 *
 * This host reads none of a project's own files for an ACP agent: it hands the
 * server a `cwd` and its own MCP servers, and the agent loads whatever it
 * finds there as it chooses. ACP carries no trust field, so what this host can
 * do about a folder it cannot vouch for is refuse to start the agent in it -
 * unless the preset says its agent asks before it loads the folder's own
 * configuration, and then the folder is the agent's business.
 */

const FIXTURE = fileURLToPath(new URL('./fixtures/acp-server.mjs', import.meta.url));

const made: string[] = [];
const started: Session[] = [];

afterEach(() => {
  for (const session of started.splice(0)) session.close();
  for (const path of made.splice(0)) rmSync(path, { recursive: true, force: true });
});

/** The subprocess's work finishing, up to a point. */
const until = async (check: () => boolean, times = 3000): Promise<void> => {
  for (let i = 0; i < times; i++) {
    if (check()) return;
    await new Promise((resolve) => { setTimeout(resolve, 1); });
  }
};

/** A folder of its own, with the file the fixture logs its requests to. */
const foldered = (): { folder: string; log: string } => {
  const folder = mkdtempSync(join(tmpdir(), 'ahpd-acp-trust-'));
  made.push(folder);
  return { folder, log: join(folder, 'requests.jsonl') };
};

/** A session of the fixture server, with the host's own answer about a folder. */
function sessionIn(over: Partial<Start>, log: string, honours?: boolean): { session: Session; actions: Bag[] } {
  const actions: Bag[] = [];
  const agent = acpAgent({
    command: process.execPath,
    args: [FIXTURE],
    provider: 'acp-trust',
    // The fixture appends every request it is sent here, so the file existing
    // is the server having been started and spoken to.
    env: { ACP_LOG: log },
    ...(honours === undefined ? {} : { honoursTrust: honours }),
  });
  const start: Start = {
    uri: 'ahp-session:/trust',
    chatUri: 'ahp-chat:/trust',
    settings: {},
    schema: () => ({ type: 'object', properties: {} }),
    emit: (_channel, action) => { actions.push(action); },
    clientToolTimeoutMs: DEFAULT_CLIENT_TOOL_TIMEOUT_MS,
    ...over,
  };
  const session = agent.create(start);
  started.push(session);
  return { session, actions };
}

/** The message on the `chat/error` that ended a turn, once one has. */
const failure = (actions: Bag[]): string | undefined => {
  const error = actions.find((action) => action.type === 'chat/error') as
    { part?: { error?: { message?: string } } } | undefined;
  return error?.part?.error?.message;
};

it('refuses a folder nobody vouched for, rather than starting the agent in it', async () => {
  const { folder, log } = foldered();
  const { session, actions } = sessionIn({ workingDirectory: folder, trusted: () => false }, log);
  session.begin('t1', 'hi');
  await until(() => failure(actions) !== undefined);
  // The sentence names the folder and the way out of it, so a person reading
  // the failure knows which folder and which flag.
  expect(failure(actions)).toContain(folder);
  expect(failure(actions)).toContain('honoursTrust');
  // And nothing was started: the fixture writes its log the moment it is sent
  // a request, and it was never given one.
  expect(existsSync(log)).toBe(false);
});

it('starts the agent in an untrusted folder when the preset says it honours trust', async () => {
  const { folder, log } = foldered();
  const { session } = sessionIn({ workingDirectory: folder, trusted: () => false }, log, true);
  session.begin('t1', 'hi');
  await until(() => existsSync(log));
  expect(existsSync(log)).toBe(true);
});

it('starts the agent in a folder the host vouched for', async () => {
  const { folder, log } = foldered();
  const { session } = sessionIn({ workingDirectory: folder, trusted: () => true }, log);
  session.begin('t1', 'hi');
  await until(() => existsSync(log));
  expect(existsSync(log)).toBe(true);
});
