import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import type { Account, Bag, Session, Start } from '@ahpd/sdk';
import { DEFAULT_CLIENT_TOOL_TIMEOUT_MS } from '../../sdk/src/tools/clientcalls.js';
import { acpAgent } from '../src/index.js';
import type { AcpOptions } from '../src/types.js';

/*
 * The account an ACP server reports its sign-in as.
 *
 * A harness signed in out of band - Codex through its own CLI - tells the
 * client it is given: the handshake says it reports one with an `authStatus`
 * key of its own, and `_auth/status_update` carries it. The bridge spawns no
 * server until a session runs, so what the host has for such an agent comes
 * from a live connection, which is why this is a session's report rather than
 * a probe's answer.
 *
 * The states are VS Code's, read off `codexAccountState.ts`: a signed-in
 * account carries its email and plan, a key or a gateway is one this host does
 * not bill, and a server with no sign-in of its own has none.
 */

const FIXTURE = fileURLToPath(new URL('./fixtures/acp-server.mjs', import.meta.url));

/** The subprocess's work finishing, up to a point. */
const until = async (check: () => boolean, times = 3000): Promise<void> => {
  for (let i = 0; i < times; i++) {
    if (check()) return;
    await new Promise((resolve) => { setTimeout(resolve, 1); });
  }
  throw new Error(`still waiting after ${times} tries`);
};

const started: Session[] = [];

afterEach(async () => {
  for (const session of started.splice(0)) await session.close();
});

/** A session of the fixture, with every action it emits and every account it reports. */
function talking(flags: string[], options: Partial<AcpOptions> = {}): { session: Session; actions: Bag[]; accounts: Account[] } {
  const actions: Bag[] = [];
  const accounts: Account[] = [];
  const agent = acpAgent({ command: process.execPath, args: [FIXTURE, ...flags], provider: 'acp-account', ...options });
  const opening: Start = {
    uri: 'ahp-session:/account',
    chatUri: 'ahp-chat:/account',
    settings: {},
    schema: () => ({ type: 'object', properties: {} }),
    emit: (_channel, action) => { actions.push(action); },
    clientToolTimeoutMs: DEFAULT_CLIENT_TOOL_TIMEOUT_MS,
    // This case is not about trust, and an absent answer is untrusted - so the
    // folder is one the host vouched for.
    trusted: () => true,
    onAccount: (account) => { accounts.push(account); },
  };
  const session = agent.create(opening);
  started.push(session);
  return { session, actions, accounts };
}

/** One turn, run to its end, which is also what opens the connection. */
async function turn(session: Session, actions: Bag[], text = 'hi'): Promise<void> {
  session.sendMessage('t1', text);
  await until(() => actions.some((action) => action.type === 'chat/turnComplete'
    || action.type === 'chat/turnCancelled'
    || action.type === 'chat/error'));
}

it('takes the account a server reports, with its email and its plan', async () => {
  const { session, actions, accounts } = talking(['--auth-status=account']);
  await turn(session, actions);

  expect(accounts).toHaveLength(1);
  expect(accounts[0]).toMatchObject({ status: 'signedIn', email: 'ana@example.test', planType: 'max' });
  // The time is this reading's own, so a client can say how old the answer is.
  expect(typeof accounts[0]?.observedAt).toBe('number');
});

/*
 * The other kinds, which are the states a sign-in that is not an account has.
 * An API key and a gateway are credentials this host does not hold, Bedrock or
 * an agent's own identity is a sign-in it cannot speak for, and a kind this
 * bridge does not know is read as VS Code's Codex reads any account that is
 * not a ChatGPT sign-in; none of those is a sign-out, which is the server
 * saying it has no sign-in at all.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/codex/codexAccountState.ts#L22-L31
 */
const ELSEWHERE: [kind: string, state: Account['status']][] = [
  ['api_key', 'unavailable'],
  ['gateway', 'unavailable'],
  ['external', 'unavailable'],
  ['workspace_sso', 'unavailable'],
  ['none', 'signedOut'],
];

for (const [kind, state] of ELSEWHERE) {
  it(`reads a ${kind} sign-in as ${state}, with no email`, async () => {
    const { session, actions, accounts } = talking([`--auth-status=${kind}`]);
    await turn(session, actions);

    expect(accounts).toHaveLength(1);
    expect(accounts[0]?.status).toBe(state);
    expect(accounts[0]).not.toHaveProperty('email');
  });
}

it('ignores a sign-in reported by a server that never said it would', async () => {
  // A server that sends the update without the handshake key is one this
  // bridge was never told to expect it from, and an account is a claim about
  // who is billed.
  const { session, actions, accounts } = talking(['--auth-status=account', '--auth-silent']);
  await turn(session, actions);

  expect(actions.some((action) => action.type === 'chat/turnComplete')).toBe(true);
  expect(accounts).toEqual([]);
});
