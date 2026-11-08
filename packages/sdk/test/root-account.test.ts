import { join } from 'node:path';
import { expect, it } from 'vitest';
import { ROOT } from '../src/host.js';
import { accountKey } from '../src/host/root.js';
import { fileUsers } from '../src/access/users.js';
import { echo } from '../../../examples/echo/agent.js';
import { directory, hello, host, root, signIn, watching } from './users-gate-helpers.js';
import type { Bag } from './users-gate-helpers.js';
import type { Account } from '../src/types/probe.js';
import type { Agent, Start } from '../src/types/agent.js';

/*
 * The account each agent bills to, on the root config.
 *
 * The value is the operator's own email, out of the CLI this host runs, and
 * root state answers before anybody signs in - so reading it is a grant of its
 * own. The key is the one VS Code's window already reads for the Codex agent it
 * delegates to, and this host's own name for every other backend.
 */

const SIGNED_IN: Account = {
  status: 'signedIn', email: 'ana@example.test', planType: 'max', observedAt: 1_700_000_000_000,
};

/** Let the probe's answer, its dispatch and the writes behind them come to. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) await new Promise((done) => { setTimeout(done, 0); });
};

/** The echo backend, whose probe answers whatever `answer` is holding. */
const accounting = (provider: string, answer: () => Promise<{ account?: Account }>): Agent => ({
  ...echo({ path: root, pace: 0 }),
  provider,
  probe: async () => ({ models: [], commands: [], customizations: [], ...await answer() }),
});

/** The echo backend, which says nothing at boot and reports its account when a session starts. */
const reporting = (provider: string, account: Account): Agent => {
  const inner = echo({ path: root, pace: 0 });
  return {
    ...inner,
    provider,
    probe: async () => ({ models: [], commands: [], customizations: [] }),
    create: (start: Start) => {
      start.onAccount?.(account);
      return inner.create(start);
    },
  };
};

type Client = ReturnType<ReturnType<typeof host>['accept']>;

const configOf = async (client: Client): Promise<Bag> => {
  const { snapshot } = await client.handle({ method: 'subscribe', params: { channel: ROOT } }) as { snapshot: { state: Bag } };
  return snapshot.state.config as Bag;
};

const valuesOf = async (client: Client): Promise<Bag> => (await configOf(client)).values as Bag;

/** Every root config change a connection was sent, the empty ones included. */
const changesOnRoot = (seen: ReturnType<typeof watching>): Bag[] => seen.seen
  .filter((one) => one.method === 'action' && one.params.channel === ROOT && one.params.action?.type === 'root/configChanged')
  .map((one) => one.params.action.config as Bag);

it('publishes each account under its own key, to the host and to a role holding account:read', async () => {
  const users = fileUsers({ path: join(root, 'users.json') });
  await users.addRole('accountants', ['account:read']);
  await users.add('ana', ['accountants']);
  const secret = await users.mint('ana');
  const made = host({
    users,
    agents: [accounting('codex', async () => ({ account: SIGNED_IN })), accounting('claude', async () => ({ account: SIGNED_IN }))],
  });

  const hostSeen = watching();
  const theHost = made.accept(hostSeen, undefined, true);
  await hello(theHost, 'host');
  await settle();
  const hostValues = await valuesOf(theHost);
  // VS Code's own name for the Codex account, and this host's for anything the
  // window has no name for.
  expect(accountKey('codex')).toBe('vscode.codexAccount');
  expect(accountKey('claude')).toBe('ahpd.claudeAccount');
  expect(hostValues['vscode.codexAccount']).toEqual(SIGNED_IN);
  expect(hostValues['ahpd.claudeAccount']).toEqual(SIGNED_IN);

  // The grant is the group's, asked as the operation the gate asks for.
  const seen = watching();
  const accountant = made.accept(seen);
  await hello(accountant, 'ana'); await signIn(accountant, secret);
  expect((await valuesOf(accountant))['ahpd.claudeAccount']).toEqual(SIGNED_IN);
});

/*
 * A host with no people directory serves the whole root config to every
 * connection, as VS Code's host serves it to every client.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/protocolServerHandler.ts#L4307-L4317
 */
it('shows every connection the accounts and the daemon\'s keys on a host with no people directory', async () => {
  const made = host({
    agents: [accounting('claude', async () => ({ account: SIGNED_IN }))],
    rootConfig: {
      schema: () => ({ type: 'object', properties: { 'ahpd.port': { type: 'number', title: 'Port' } } }),
      values: async () => ({ 'ahpd.port': 7600 }),
      write: async () => ({}),
    },
  });
  const seen = watching();
  const plain = made.accept(seen);
  await hello(plain, 'plain');
  await settle();
  const config = await configOf(plain);
  expect((config.values as Bag)['ahpd.claudeAccount']).toEqual(SIGNED_IN);
  expect((config.values as Bag)['ahpd.port']).toBe(7600);
  expect(((config.schema as Bag).properties as Bag)).toHaveProperty('ahpd.port');
});

it('shows no account to a connection without the grant, in its snapshot or in anything it is told', async () => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const made = host({
    users: directory({ g: ['session:read'] }),
    agents: [accounting('claude', () => held.then(() => ({ account: SIGNED_IN })))],
  });

  const hostSeen = watching();
  const theHost = made.accept(hostSeen, undefined, true);
  await hello(theHost, 'host');
  const guestSeen = watching();
  const guest = made.accept(guestSeen);
  await hello(guest, 'g'); await signIn(guest, 'g');

  /*
   * Nothing yet, which is the honest shape: a backend that has not answered has
   * no account, and a connection that may not read one is shown the same
   * absence rather than an empty value it could mistake for an answer.
   */
  expect(await valuesOf(theHost)).not.toHaveProperty('ahpd.claudeAccount');
  expect(await valuesOf(guest)).not.toHaveProperty('ahpd.claudeAccount');

  release();
  await settle();

  // The host heard it, in the change the probe's answer dispatched.
  expect(changesOnRoot(hostSeen)).toContainEqual({ 'ahpd.claudeAccount': SIGNED_IN });
  expect((await valuesOf(theHost))['ahpd.claudeAccount']).toEqual(SIGNED_IN);
  // And the guest was told nothing carrying it, then or now.
  expect(JSON.stringify(guestSeen.seen)).not.toContain('ana@example.test');
  expect(JSON.stringify(await configOf(guest))).not.toContain('ana@example.test');
  expect(changesOnRoot(guestSeen).flatMap((config) => Object.keys(config))).not.toContain('ahpd.claudeAccount');
});

it('refuses a client write to an account key', async () => {
  const made = host({ agents: [accounting('claude', async () => ({ account: SIGNED_IN }))] });
  const seen = watching();
  const client = made.accept(seen, undefined, true);
  await hello(client);
  await settle();

  client.handle({
    method: 'dispatchAction',
    params: { channel: ROOT, action: { type: 'root/configChanged', config: { 'ahpd.claudeAccount': { status: 'signedOut' } } } },
  });
  await settle();

  const refused = seen.seen
    .filter((one) => one.method === 'action' && typeof one.params.rejectionReason === 'string')
    .map((one) => String(one.params.rejectionReason));
  // In the words VS Code's host refuses a remote client's change to a
  // property it holds read-only.
  // https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/protocolServerHandler.ts#L2830-L2840
  expect(refused).toEqual(['Host configuration property is read-only: ahpd.claudeAccount']);
  // A refusal, not a stored value: a client cannot say who the operator is.
  expect((await valuesOf(client))['ahpd.claudeAccount']).toEqual(SIGNED_IN);
});

it('takes a running session\'s account for a backend that says nothing at boot', async () => {
  const made = host({ agents: [reporting('acp', SIGNED_IN)] });
  const seen = watching();
  // The host's own connection, which is the one a running session's account is
  // reported to as much as a probe's is.
  const client = made.accept(seen, undefined, true);
  await hello(client);

  // An ACP backend's probe answers empty and spawns nothing, so until a session
  // starts this host has been told no account at all.
  await settle();
  expect(await valuesOf(client)).not.toHaveProperty('ahpd.acpAccount');

  await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/acp', provider: 'acp' } });
  await settle();

  expect((await valuesOf(client))['ahpd.acpAccount']).toEqual(SIGNED_IN);
});
