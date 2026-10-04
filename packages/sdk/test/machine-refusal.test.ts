import { expect, it } from 'vitest';
import { createHost, ROOT } from '../src/host.js';
import { machineRefusal } from '../src/computers.js';
import { echo } from '../../../examples/echo/agent.js';
import type { ComputerPort, KeptFor } from '../src/types/computers.js';
import type { Peer } from '../src/types/rpc.js';
import type { Principal, Users } from '../src/types/users.js';

/*
 * The sentences a machine says instead of being reached.
 *
 * A machine made for a session alone is refused to every other session, and a
 * channel is the client's to choose: a session opened under a disposed one's
 * id spells the same URI. The owner is what a client cannot choose for itself,
 * and the daemon that made the machine is what tells two daemons on one Docker
 * apart, since both keep their sessions under the same ids.
 */

/** A port that answers one machine's labels and nothing else. */
const kept = (keptFor: KeptFor | undefined): ComputerPort => ({
  how: async () => undefined,
  ...(keptFor === undefined ? {} : { keptFor: async () => keptFor }),
});

it('refuses a machine kept for another session', async () => {
  const port = kept({ session: 'echo:/theirs' });
  expect(await machineRefusal(port, 'box', 'echo', 'echo:/ours')).toBe(
    'computer://box belongs to another session, which is the only one it runs; make a machine of your own for this session or run it on the host',
  );
  // And lets its own session in, whoever that session's owner is compared to
  // nobody: no owner asked for is no owner to disagree with.
  expect(await machineRefusal(port, 'box', 'echo', 'echo:/theirs')).toBeUndefined();
});

it('refuses a machine made for another owner, on the same session id', async () => {
  const port = kept({ session: 'echo:/one', owner: 'user:ana' });
  // The channel is the client's, so this is the same URI the machine was made
  // for and a different person behind it.
  expect(await machineRefusal(port, 'box', 'echo', 'echo:/one', 'user:bruno')).toBe(
    'computer://box was made for another owner, which is the only one it runs for; make a machine of your own for this session or run it on the host',
  );
  // The same owner, or a session with nobody behind it, is not a refusal: a
  // host with no users directory has no owner to disagree about.
  expect(await machineRefusal(port, 'box', 'echo', 'echo:/one', 'user:ana')).toBeUndefined();
  expect(await machineRefusal(port, 'box', 'echo', 'echo:/one')).toBeUndefined();
});

it('refuses a machine another daemon made, whoever is asking', async () => {
  const port = kept({ session: 'echo:/one', mine: false });
  expect(await machineRefusal(port, 'box', 'echo', 'echo:/one', 'user:ana')).toBe(
    "computer://box is another daemon's machine, and this daemon neither runs in it nor removes it; make a machine of your own for this session or run it on the host",
  );
});

it('lets a machine of this daemon\'s own through, whatever else it is kept for', async () => {
  const port = kept({ session: 'echo:/one', owner: 'user:ana', mine: true });
  expect(await machineRefusal(port, 'box', 'echo', 'echo:/one', 'user:ana')).toBeUndefined();
  // A port that keeps no such record is a check this reader cannot make, and a
  // machine this reader cannot place is not somebody else's.
  expect(await machineRefusal(kept(undefined), 'box', 'echo', 'echo:/one')).toBeUndefined();
});

/*
 * Who the owner check is asked about, at the two roads that ask it.
 *
 * The rule above is `machineRefusal`'s, and it does nothing at all unless the
 * host hands it an owner to compare. A session's owner is recorded when it
 * opens, which is after the check on the way in, so a host that reads the store
 * here asks with nothing on a brand new session and with the last person's on a
 * reused id - and neither is the person asking. These are the two roads, asked
 * with a machine that is kept for somebody else.
 */

const DIR = '/tmp/ahpd-machine-refusal';

const RECORD = {
  resource: 'ahpd://users',
  resource_name: 'ahpd users',
  authorization_servers: ['https://example.test/users'],
  required: false,
};

const person = (id: string): Principal => ({
  id, roles: [], can: () => true, memberships: ['backend'], teams: [{ id: 'backend' }],
});

const directory = (): Users => ({
  resource: RECORD,
  verify: async (token) => {
    const found = { ana: person('ana'), bruno: person('bruno') }[token ?? ''];
    return found;
  },
  list: async () => [],
  grantsOfRoles: async () => [],
  grantsOfPerson: async () => undefined,
  add: async () => {},
  roles: async () => [],
  addRole: async () => {},
  removeRole: async () => false,
  teams: async () => [{ id: 'backend' }],
  projects: async () => [],
  addTeam: async () => {},
  addProject: async () => {},
  removeTeam: async () => false,
  removeProject: async () => false,
  remove: async () => false,
  mint: async () => 'nonsense',
});

const peer = (): Peer & { notes: { method: string; params: unknown }[] } => {
  const notes: { method: string; params: unknown }[] = [];
  return {
    notes,
    send: () => {},
    notify: (method, params) => { notes.push({ method, params }); },
    request: async () => ({}),
    answered: () => {},
    close: () => {},
  };
};

const settle = async (times = 40): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((r) => { setTimeout(r, 0); });
};

/** A machine kept for whoever asked for it, and for ana rather than for them. */
const keptForAna = (): ComputerPort => ({
  how: async () => undefined,
  create: async () => 'box',
  keptFor: async (_id, asked) => ({ session: asked?.session ?? '', owner: 'user:ana' }),
});

/** This host with one machine behind it, and a way in as whoever is asking. */
async function serving() {
  const host = createHost({
    path: DIR,
    agents: [echo({ path: DIR, pace: 0 })],
    users: directory(),
    computers: keptForAna(),
    sessionConfig: { computer: { type: 'string', title: 'Computer', sessionMutable: false } },
  });
  // One connection a person, because a client id belongs to the person who took
  // it and a second person cannot take it over the first.
  const as = async (who: string): Promise<{ client: ReturnType<typeof host.accept>; peer: ReturnType<typeof peer> }> => {
    const p = peer();
    const client = host.accept(p);
    await client.handle({
      method: 'initialize',
      params: { clientId: `probe-${who}`, protocolVersions: ['0.9.0'], initialSubscriptions: [ROOT] },
    });
    await client.handle({
      method: 'authenticate', params: { channel: ROOT, resource: RECORD.resource, token: who },
    });
    return { client, peer: p };
  };
  return { host, as };
}

/** What a refused request said, which is the sentence the host answers with. */
const refusal = async (work: Promise<unknown>): Promise<string> => {
  try {
    await work;
    return 'accepted';
  }
  catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
};

/** And what a refused action was told, which arrives as a note rather than a throw. */
const rejected = (said: { method: string; params: unknown }[]): string | undefined => said
  .filter((note) => note.method === 'action')
  .map((note) => (note.params as { rejectionReason?: string }).rejectionReason)
  .filter((one): one is string => one !== undefined)
  .pop();

const OTHER_OWNER = 'computer://box was made for another owner, which is the only one it runs for; make a machine of your own for this session or run it on the host';

it('refuses a session created for another owner\'s machine, though the store says the old owner', async () => {
  const { as } = await serving();

  // Ana's session, in the machine she made it for, and it goes again.
  const hers = await as('ana');
  await hers.client.handle({
    method: 'createSession',
    params: { channel: 'ahp-session:/one', provider: 'echo', config: { computer: 'computer://box' } },
  });
  await hers.client.handle({ method: 'disposeSession', params: { channel: 'ahp-session:/one' } });
  await settle();

  /*
   * Bruno, on the same channel, which is a client's to choose: the same URI and
   * a different person behind it. The store still holds ana as the owner of
   * `one`, because a disposed session keeps its row, so a host that asked the
   * store would be asking about the person who has already gone.
   */
  const his = await as('bruno');
  expect(await refusal(his.client.handle({
    method: 'createSession',
    params: { channel: 'ahp-session:/one', provider: 'echo', config: { computer: 'computer://box' } },
  }))).toBe(OTHER_OWNER);
});

it('refuses a change onto another owner\'s machine, before the first turn', async () => {
  const { as } = await serving();

  /*
   * A session bruno opened with no machine in it, changed onto ana's before it
   * has said anything. This road asks against the session's own recorded owner
   * - the work belongs to whoever started it, and a colleague who can see the
   * session is not thereby able to move it onto a machine of their own.
   */
  const { client, peer: on } = await as('bruno');
  await client.handle({
    method: 'createSession',
    params: { channel: 'ahp-session:/two', provider: 'echo' },
  });
  await client.handle({
    method: 'dispatchAction',
    params: {
      channel: 'echo:/two',
      action: { type: 'session/configChanged', config: { computer: 'computer://box' } },
    },
  });
  await settle();

  expect(rejected(on.notes)).toBe(OTHER_OWNER);
});
