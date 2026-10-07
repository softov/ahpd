import { expect, it } from 'vitest';
import { createHost } from '../src/host.js';
import { echo } from '../../../examples/echo/agent.js';
import type { ChangesetOperation, ChangesetSource } from '../src/types/changes.js';
import type { BroughtBack, ComputerPort } from '../src/types/computers.js';
import type { Peer } from '../src/types/rpc.js';

/*
 * The machine, put where the host's branch is before a turn reads it.
 *
 * A machine whose profile guards its git directory with `fetch` commits in a
 * git directory of its own - decision
 * `a-machine-commits-in-its-own-repository-and-the-host-fetches-it` - so a
 * commit made on the host between two turns is not in the history the agent's
 * git reads. The two moments that hand it over are a turn starting and a
 * changeset operation that has run; a machine holding work the host has not
 * fetched is left as it is, which is the port's own call and is said in the log
 * rather than refused, since what could not be moved costs one turn on a branch
 * that is behind and refusing the turn would cost the work.
 *
 * The port counts what it was asked and answers what the case wants, the way
 * the bring-back cases do: what is under test here is *when* the host asks.
 */

const DIR = '/tmp/ahpd-follow';

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

const settle = async (times = 8): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((r) => { setTimeout(r, 0); });
};

/** Settle until something is true, rather than a fixed number of times. */
const until = async (ready: () => boolean, tries = 80): Promise<void> => {
  for (let i = 0; i < tries && !ready(); i++) await settle(2);
};

/** A port with one machine called `box`, saying everything it was asked. */
function machinePort(
  said: string[],
  follow: (id: string) => Promise<void> = async () => {},
): ComputerPort {
  return {
    how: async () => undefined,
    create: async () => 'box',
    enter: async (id, session) => { said.push(`enter ${id} ${session}`); },
    leave: async (id, session) => { said.push(`leave ${id} ${session}`); },
    bringBack: async (id): Promise<BroughtBack> => {
      said.push(`bringBack ${id}`);
      return { moved: false };
    },
    follow: async (id) => {
      said.push(`follow ${id}`);
      await follow(id);
    },
  };
}

/** A connected client, one session in the machine `box`, watching its two channels. */
async function running(port: ComputerPort, changes?: ChangesetSource, onEvent?: (line: string) => void) {
  const host = createHost({
    path: DIR,
    agents: [echo({ path: DIR })],
    computers: port,
    ...(changes === undefined ? {} : { changes }),
    ...(onEvent === undefined ? {} : { onEvent }),
  });
  const p = peer();
  const client = host.accept(p);
  await client.handle({
    method: 'initialize',
    params: { clientId: 'probe', protocolVersions: ['0.9.0'], initialSubscriptions: ['ahp-root://'] },
  });
  const uri = 'ahp-session:/one';
  await client.handle({
    method: 'createSession',
    params: { channel: uri, provider: 'echo', config: { computer: 'computer://box' } },
  });
  const opened = await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
    snapshot: { state: { defaultChat: string } };
  };
  const chatUri = opened.snapshot.state.defaultChat;
  await client.handle({ method: 'subscribe', params: { channel: chatUri } });
  return { client, peer: p, uri, chatUri, changeset: `${uri}/changeset/uncommitted` };
}

const COMMIT: ChangesetOperation = {
  id: 'commit', label: 'Commit', scopes: ['changeset'], icon: 'git-commit', writes: true,
};

/** A changeset source with one verb, saying when it was invoked. */
function scripted(said: string[]): ChangesetSource {
  return {
    scopes: () => [{ id: 'uncommitted', label: 'Uncommitted Changes', changeKind: 'uncommitted' }],
    state: async () => ({ status: 'ready', files: [] }),
    summary: () => ({ files: 0 }),
    operations: () => [COMMIT],
    invoke: async (request) => {
      said.push(`invoke ${request.operationId}`);
      return { message: 'did it' };
    },
  };
}

const turnEnded = (p: ReturnType<typeof peer>, chatUri: string): boolean => p.notes
  .filter((n) => n.method === 'action')
  .some((n) => (n.params as { channel: string; action: { type: string } }).channel === chatUri
    && (n.params as { action: { type: string } }).action.type === 'chat/turnComplete');

it('hands the machine the host\'s branch before a turn starts, and not after', async () => {
  const said: string[] = [];
  /*
   * A machine that has not answered yet: whether the turn is *begun* while the
   * hand-over is still in flight is the whole of this case, so the port holds
   * it open until the test says. A backend is what a turn is begun on, and a
   * turn begun on a machine that is not there yet is a turn on a stale branch.
   */
  let letGo = (): void => {};
  const held = new Promise<void>((resolve) => { letGo = resolve; });
  const port = machinePort(said, async () => await held);
  const { client, peer: p, chatUri } = await running(port);
  await until(() => said.includes('enter box echo:/one'));

  client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'hello' } } },
  });
  await until(() => said.includes('follow box'));
  await settle(4);
  expect(turnEnded(p, chatUri)).toBe(false);

  letGo();
  await until(() => turnEnded(p, chatUri));
  expect(said.filter((one) => one === 'follow box')).toEqual(['follow box']);
});

it('hands it over after a changeset operation, and not for a read', async () => {
  const said: string[] = [];
  const { client, changeset } = await running(machinePort(said), scripted(said));
  await client.handle({ method: 'subscribe', params: { channel: changeset } });
  await settle();
  // A read of the changeset moves nothing on the host, so there is nothing to
  // hand over: a follow on every look would be a command in a machine for a
  // change nobody made.
  expect(said).not.toContain('follow box');

  await client.handle({
    method: 'invokeChangesetOperation',
    params: { channel: changeset, operationId: 'commit' },
  });
  await until(() => said.includes('follow box'));
  // After, and not before: what the operation left on the branch is what the
  // machine is handed, and the fetch that precedes it is the bring-back.
  expect(said).toEqual(['enter box echo:/one', 'bringBack box', 'invoke commit', 'follow box']);
});

it('does not hand it over for a message queued behind a running turn', async () => {
  const said: string[] = [];
  const { client, chatUri } = await running(machinePort(said));
  await until(() => said.includes('enter box echo:/one'));

  await client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'chat/pendingMessageSet', id: 'q1', kind: 'queued', message: { text: 'later' } } },
  });
  await settle(4);
  // The turn a queued message becomes runs behind the one that is running, in a
  // machine an agent is working in: the writes a hand-over makes are not for a
  // turn that has not begun, and the fetch at the running turn's end is what
  // puts the machine where the host is.
  expect(said).not.toContain('follow box');
});

it('starts the turn anyway where the machine could not be moved, and says so', async () => {
  const said: string[] = [];
  const lines: string[] = [];
  const port = machinePort(said, async () => { throw new Error('docker is not running'); });
  const { client, peer: p, chatUri } = await running(port, undefined, (line) => { lines.push(line); });
  await until(() => said.includes('enter box echo:/one'));

  client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'hello' } } },
  });
  await until(() => turnEnded(p, chatUri));
  // A machine that could not be moved costs one turn on a branch that is
  // behind, which is what it was before this existed: refusing the turn would
  // cost the work, and the fetch at the turn's end still brings it back.
  expect(lines.some((one) => one.includes('computers: setting box to the host\'s branch for echo:/one failed: docker is not running'))).toBe(true);
});

it('asks for nothing where the session is in no machine', async () => {
  const said: string[] = [];
  const host = createHost({ path: DIR, agents: [echo({ path: DIR })], computers: machinePort(said) });
  const p = peer();
  const client = host.accept(p);
  await client.handle({
    method: 'initialize',
    params: { clientId: 'probe', protocolVersions: ['0.9.0'], initialSubscriptions: ['ahp-root://'] },
  });
  const uri = 'ahp-session:/two';
  await client.handle({ method: 'createSession', params: { channel: uri, provider: 'echo', config: {} } });
  const opened = await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
    snapshot: { state: { defaultChat: string } };
  };
  const chatUri = opened.snapshot.state.defaultChat;
  await client.handle({ method: 'subscribe', params: { channel: chatUri } });
  // A turn with no machine stays the turn it was: answered in the tick it
  // arrived in, with nothing asked of a port.
  await client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'hello' } } },
  });
  await until(() => turnEnded(p, chatUri));
  expect(said).toEqual([]);
});
