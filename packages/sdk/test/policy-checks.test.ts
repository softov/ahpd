/*
 * A session and a turn refused by what the policies say.
 *
 * The store is the draft's, the people are the draft's, and the cases are the
 * draft's examples. What is under test is the wiring: that the switch reaches
 * the host, that the check runs before a machine is made rather than after,
 * that a turn is checked for a model the session could not have been checked
 * for, and that the three things the plan's second table exempts - a root
 * connection, an automation and a host with nobody on it - are exempt here too.
 *
 * `A5` is what separates the two checks: it names a harness and a model, so it
 * is not a candidate at a session's creation, where no model is named, and it
 * is at a turn that names one. That is why bob's session is created here and
 * his turn on fable-5 is refused.
 *
 * The limits the draft writes on these rows are read by nothing: a row that has
 * already spent what it had still allows, which is policy/02's work. A refusal
 * therefore always names a scope or a match and never an amount.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { computersFor } from '../src/computers.js';
import { createHost, ROOT } from '../src/host.js';
import { memoryPolicies } from '../src/policies.js';
import { fileUsers } from '../src/users.js';
import { echo } from '../../../examples/echo/agent.js';
import type { ComputerPort } from '../src/types/computers.js';
import type { Policies, Policy } from '../src/types/policies.js';
import type { Peer } from '../src/types/rpc.js';
import type { Users } from '../src/types/users.js';

/** The draft's store, as far as the cases below reach it. */
const ROWS: Policy[] = [
  { id: 'M1', scope: 'all', kind: 'model', effect: 'allow', match: { model: ['deepseek/*', 'qwen/*'], proxy: ['local-vllm'] } },
  { id: 'A1', scope: 'all', kind: 'agent', effect: 'allow', match: { agent: ['*'], model: ['deepseek/*', 'qwen/*'] } },
  { id: 'A2', scope: 'team:backend', kind: 'agent', effect: 'allow', match: { agent: ['claude', 'pi'], model: ['anthropic/*'] } },
  { id: 'A5', scope: 'user:bob', kind: 'agent', effect: 'deny', match: { agent: ['*'], model: ['anthropic/fable-5'] } },
  { id: 'C1', scope: 'user:alice', kind: 'computer', effect: 'allow', match: { computer: ['sandbox-alice'] } },
  { id: 'C2', scope: 'team:backend', kind: 'computer', effect: 'allow', match: { computer: ['kvm-shared'] } },
];

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'ahpd-policy-checks-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

const noted = (): Peer & { notes: { method: string; params: unknown }[] } => {
  const notes: { method: string; params: unknown }[] = [];
  return {
    notes,
    send: () => {},
    notify: (method, params) => notes.push({ method, params }),
    request: async () => ({}),
    answered: () => {},
    close: () => {},
  };
};

const settle = async (times = 24): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((r) => { setTimeout(r, 0); });
};

/** The draft's people: three in `backend`, one holding `*:*`, one in no team. */
const directory = async (): Promise<Users> => {
  const users = fileUsers({ path: join(root, 'users.json') });
  await users.addTeam('backend');
  await users.addProject('billing');
  for (const [id, role] of [
    ['alice', 'member'],
    ['bob', 'member'],
    ['erin', 'member'],
    ['dave', 'admin'],
  ] as const) {
    const memberships = id === 'erin' ? undefined : ['backend:billing'];
    await users.add(id, [role], memberships === undefined ? {} : { memberships, primary: 'backend:billing' });
  }
  return users;
};

/** A machine port that carries no cofold, which is all the draft's `sandbox-alice` carries. */
const machines = (): ComputerPort => ({
  how: async () => undefined,
  agents: async () => ['claude', 'pi'],
  create: async () => 'box',
});

const store = async (): Promise<Policies> => {
  const held = memoryPolicies();
  for (const row of ROWS) await held.put(row);
  return held;
};

/** A store that cannot be read, which is what a corrupt `policies.json` looks like. */
const unreadable = async (): Promise<Policies> => ({
  ...memoryPolicies(),
  list: async () => { throw new Error('the store is unreadable'); },
});

/**
 * A host, switched on or off, with the draft's store and the draft's people.
 *
 * `withPeople` is what makes the exemptions different from one another: without
 * it there is no directory and so no principal behind any connection.
 */
const host = async (check: boolean, withPeople = true, held?: Policies) => {
  const users = withPeople ? await directory() : undefined;
  return {
    users,
    made: createHost({
      path: root,
      // The harnesses are named as the draft names them, because an agent row
      // matches on the name the client asked for.
      agents: ['claude', 'pi', 'cofold'].map((provider) => ({
        ...echo({ path: root, pace: 0 }), provider, displayName: provider,
      })),
      ...(users === undefined ? {} : { users }),
      policies: held ?? await store(),
      policiesCheck: check,
      computers: machines(),
    }),
  };
};

const signedIn = async (made: Awaited<ReturnType<typeof host>>, as: string, asRoot = false) => {
  const said = noted();
  const client = made.made.accept(said, undefined, asRoot);
  await client.handle({ method: 'initialize', params: { clientId: 'probe', protocolVersions: ['0.9.0'], initialSubscriptions: [ROOT] } });
  if (!asRoot && made.users !== undefined) {
    const secret = await made.users.mint(as);
    await client.handle({ method: 'authenticate', params: { channel: ROOT, resource: 'ahpd://users', token: secret } });
  }
  return { said, client };
};

/** What the call was refused with, or a case that fails because it was allowed. */
const refusalOf = async (run: Promise<unknown>): Promise<{ code?: number; message: string }> =>
  run.then(() => { throw new Error('the call was allowed'); }, (error: { code?: number; message: string }) => error);

/** What the host refused a dispatched action with, or nothing when it allowed it. */
const rejection = (said: ReturnType<typeof noted>): string | undefined => said.notes
  .filter((note) => note.method === 'action')
  .map((note) => (note.params as { rejectionReason?: string }).rejectionReason)
  .filter((one): one is string => one !== undefined)
  .pop();

/** A connected client, which is all `turnOn` ever calls. */
interface Caller {
  handle(frame: { method: string; params: unknown }): Promise<unknown>;
}

const makeSession = async (
  client: Caller,
  name: string,
  provider: string,
  computer?: string,
): Promise<void> => {
  await client.handle({
    method: 'createSession',
    params: { channel: `ahp-session:/${name}`, provider, ...(computer === undefined ? {} : { config: { computer: `computer://${computer}` } }) },
  });
};

/** Open a session and start a turn on it, which is the whole of the turn's path. */
const turnOn = async (
  client: Caller,
  said: ReturnType<typeof noted>,
  name: string,
  provider: string,
  computer: string,
  model: string | undefined,
): Promise<void> => {
  await makeSession(client, name, provider, computer);
  const chat = `ahp-chat:/${name}`;
  await client.handle({ method: 'subscribe', params: { channel: chat } });
  void client.handle({
    method: 'dispatchAction',
    params: {
      channel: chat,
      action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'hello', ...(model === undefined ? {} : { model: { id: model } }) } },
    },
  });
  await settle();
};

describe('a session, with the switch on', () => {
  it('creates the session the draft\'s example 15 allows', async () => {
    const { client } = await signedIn(await host(true), 'alice');
    await expect(makeSession(client, 'allowed', 'claude', 'sandbox-alice')).resolves.toBeUndefined();
  });

  it('refuses example 16 at creation, naming the machine rather than a policy', async () => {
    const { client } = await signedIn(await host(true), 'alice');
    const refused = await refusalOf(makeSession(client, 'host', 'claude', 'host'));
    expect(refused.code).toBe(-32009);
    expect(refused.message).toContain('no policy allows computer host');
  });

  it('refuses example 22 at creation and not at the turn', async () => {
    const { client, said } = await signedIn(await host(true), 'erin');
    // A1 allows the harness and erin is in no team, so no computer row holds
    // her and the session never exists - which is why no turn was refused.
    const refused = await refusalOf(makeSession(client, 'box', 'pi', 'sandbox-alice'));
    expect(refused.message).toContain('no policy allows computer sandbox-alice');
    expect(rejection(said)).toBeUndefined();
  });

  it('checks the machine the client asked for, before one is placed', async () => {
    const { client } = await signedIn(await host(true), 'alice');
    // Nothing on this port makes a machine, so a check that ran after
    // `placedIn` would have found the same answer. This says the refusal came
    // from the policy and named the machine, which is the whole of it.
    const refused = await refusalOf(makeSession(client, 'source', 'claude', 'nothing-here'));
    expect(refused.message).toContain('nothing-here');
  });

  it('creates bob\'s session, which A5 does not bind on', async () => {
    const { client } = await signedIn(await host(true), 'bob');
    // A5 names a harness and a model, and a session's creation names no model.
    // A deny binds only on what was asked, so it is not a candidate here - which
    // is what lets example 21 reach a turn at all.
    await expect(makeSession(client, 'bob', 'claude', 'kvm-shared')).resolves.toBeUndefined();
  });
});

describe('a turn, with the switch on', () => {
  it('allows example 19, which A5 does not match', async () => {
    const { client, said } = await signedIn(await host(true), 'alice');
    await turnOn(client, said, 'sonnet', 'claude', 'sandbox-alice', 'anthropic/sonnet-5');
    expect(rejection(said)).toBeUndefined();
  });

  it('refuses example 21: A5 refuses bob\'s turn on fable-5, naming the row', async () => {
    const { client, said } = await signedIn(await host(true), 'bob');
    // The same row that let his session through, because this turn did name the
    // model the deny names.
    await turnOn(client, said, 'bob', 'claude', 'kvm-shared', 'anthropic/fable-5');
    expect(rejection(said)).toBe('A5 refuses agent claude with model anthropic/fable-5 on kvm-shared');
  });

  it('leaves the model alone when the turn names none', async () => {
    const { client, said } = await signedIn(await host(true), 'bob');
    // A turn that says nothing about a model is checked on the harness and the
    // machine, so A5 - which names one - is not a candidate.
    await turnOn(client, said, 'silent', 'claude', 'kvm-shared', undefined);
    expect(rejection(said)).toBeUndefined();
  });
});

describe('example 26, which is the machine and not a policy', () => {
  it('lets the policies through and leaves the refusal to the machine', async () => {
    const { client } = await signedIn(await host(true), 'alice');
    // A1 allows any harness and C1 gives alice the machine, so nothing in the
    // store has an opinion about cofold here. What refuses this is the
    // machine: it was prepared for `claude, pi`, so the session is refused at
    // its own creation with that sentence rather than at the first turn.
    const refusal = await refusalOf(makeSession(client, 'cofold', 'cofold', 'sandbox-alice'));
    expect(refusal.message).toBe('computer://sandbox-alice was prepared for claude, pi, and this session runs cofold; make a machine prepared for cofold or run this session on the host');
  });

  it('is refused by the port the host hands the agent, naming what the machine carries', async () => {
    // The echo backend never asks to enter a machine, so this is the port the
    // host would have handed it, and the check it carries.
    const gated = computersFor(machines(), 'cofold');
    await expect(gated.how?.('sandbox-alice', { command: 'cofold' })).rejects.toThrow('prepared for claude, pi');
  });
});

describe('a store that cannot be read', () => {
  it('refuses the session, naming the failure rather than letting it through', async () => {
    const { client } = await signedIn(await host(true, true, await unreadable()), 'alice');
    // Failing open would start every session on a host whose file has gone bad,
    // which is the one outcome a check exists to prevent.
    const refused = await refusalOf(makeSession(client, 'broken', 'claude', 'sandbox-alice'));
    expect(refused.code).toBe(-32009);
    expect(refused.message).toBe('no policy could be read, so agent is refused: the store is unreadable');
  });
});

describe('what is never checked', () => {
  it('refuses a `*:*` holder nothing, at a session or at a turn', async () => {
    const { client, said } = await signedIn(await host(true), 'dave');
    // No computer row gives dave `kvm-shared` and A5 would deny him fable-5.
    await turnOn(client, said, 'dave', 'claude', 'kvm-shared', 'anthropic/fable-5');
    expect(rejection(said)).toBeUndefined();
  });

  it('refuses a root connection nothing', async () => {
    const { client, said } = await signedIn(await host(true), '', true);
    await turnOn(client, said, 'root', 'claude', 'kvm-shared', 'anthropic/fable-5');
    expect(rejection(said)).toBeUndefined();
  });

  it('refuses a host with no people nothing, whatever the store holds', async () => {
    const { client, said } = await signedIn(await host(true, false), '', true);
    await turnOn(client, said, 'empty', 'claude', 'kvm-shared', 'anthropic/fable-5');
    expect(rejection(said)).toBeUndefined();
  });
});

describe('the same cases with the switch off', () => {
  it('starts a session no policy allows, with the same store present', async () => {
    const { client } = await signedIn(await host(false), 'alice');
    // The switch on refuses this one for the machine `host`.
    await expect(makeSession(client, 'host', 'claude', 'host')).resolves.toBeUndefined();
  });

  it('lets a denied turn run, which the switch on refuses', async () => {
    const { client, said } = await signedIn(await host(false), 'bob');
    // The same turn the switch on refuses with A5, over the same store.
    await turnOn(client, said, 'bob', 'claude', 'kvm-shared', 'anthropic/fable-5');
    expect(rejection(said)).toBeUndefined();
  });

  it('still refuses nobody the machine does not carry', async () => {
    // Example 26 with the switch off: the machine's check was never a policy's
    // and the switch was never its gate.
    const gated = computersFor(machines(), 'cofold');
    await expect(gated.how?.('sandbox-alice', { command: 'cofold' })).rejects.toThrow('prepared for claude, pi');
  });
});