import { expect, it } from 'vitest';
import { createHost } from '../src/host.js';
import { echo } from '../../../examples/echo/agent.js';
import type { ChangesetOperation, ChangesetSource } from '../src/types/changes.js';
import type { BroughtBack, ComputerPort } from '../src/types/computers.js';
import type { Peer } from '../src/types/rpc.js';

/*
 * What a machine committed, taken back at the four moments it matters.
 *
 * A machine whose profile guards its git directory with `fetch` commits in a
 * git directory of its own - decision
 * `a-machine-commits-in-its-own-repository-and-the-host-fetches-it` - so until
 * ahpd fetches it, the work is nowhere on the host: the branch has not moved,
 * and an operation on the changeset would act on a folder that does not hold
 * it. The four moments are a turn ending, a turn cancelled, an operation about
 * to run, and a machine about to go; a read of the changeset is not one of
 * them, because a read runs on every look and the turn's end has fetched
 * already.
 *
 * The port counts what it was asked rather than fetching anything, and answers
 * what the case wants it to: what is under test here is *when* the host asks,
 * and what it does with each answer.
 */

const DIR = '/tmp/ahpd-bringback';

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
  answer: (id: string) => Promise<BroughtBack | undefined> = async () => ({ moved: false }),
): ComputerPort {
  return {
    how: async () => undefined,
    create: async () => 'box',
    enter: async (id, session) => { said.push(`enter ${id} ${session}`); },
    leave: async (id, session) => { said.push(`leave ${id} ${session}`); },
    bringBack: async (id) => {
      said.push(`bringBack ${id}`);
      return await answer(id);
    },
  };
}

/** A connected client, one session in the machine `box`, watching its two channels. */
async function running(
  port: ComputerPort,
  changes?: ChangesetSource,
  onEvent?: (line: string) => void,
  pace = 0,
) {
  const host = createHost({
    path: DIR,
    agents: [echo({ path: DIR, pace })],
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

it('brings the machine\'s work back when a turn ends, and exactly once', async () => {
  const said: string[] = [];
  const { client, peer: p, chatUri } = await running(machinePort(said));
  await until(() => said.includes('enter box echo:/one'));

  client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'hello' } } },
  });
  await until(() => turnEnded(p, chatUri));
  await settle();
  expect(said.filter((one) => one === 'bringBack box')).toEqual(['bringBack box']);
});

it('brings it back when a turn is cancelled', async () => {
  const said: string[] = [];
  // A paced backend, so there is a turn left to cancel: one that answers at
  // once is over in the same tick the turn started in.
  const { client, chatUri } = await running(machinePort(said), undefined, undefined, 10);
  await until(() => said.includes('enter box echo:/one'));

  client.handle({
    method: 'dispatchAction',
    params: {
      channel: chatUri,
      action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'one two three four five six seven eight nine ten' } },
    },
  });
  await settle(2);
  client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'chat/turnCancelled', turnId: 't1' } },
  });
  await until(() => said.includes('bringBack box'));
  await settle();
  expect(said.filter((one) => one === 'bringBack box')).toEqual(['bringBack box']);
});

it('brings it back before a changeset operation runs, and not for a read of the changeset', async () => {
  const said: string[] = [];
  const { client, changeset } = await running(machinePort(said), scripted(said));
  await client.handle({ method: 'subscribe', params: { channel: changeset } });
  await settle();
  // A read of the changeset is not a moment: it runs on every look, and the
  // turn's end has fetched already.
  expect(said).not.toContain('bringBack box');

  await client.handle({
    method: 'invokeChangesetOperation',
    params: { channel: changeset, operationId: 'commit' },
  });
  await until(() => said.includes('invoke commit'));
  // The order is the whole point: the host's git has the machine's commit on
  // the branch before anything acts on the folder it is checked out in.
  expect(said).toEqual(['enter box echo:/one', 'bringBack box', 'invoke commit']);
});

it('refuses an operation while the work waits in a ref of ahpd\'s own', async () => {
  const said: string[] = [];
  const port = machinePort(said, async () => ({ moved: false, waiting: 'refs/ahpd/machines/box/main' }));
  const { client, changeset } = await running(port, scripted(said));
  await client.handle({ method: 'subscribe', params: { channel: changeset } });

  const refused = await client.handle({
    method: 'invokeChangesetOperation',
    params: { channel: changeset, operationId: 'commit' },
  }).then(() => undefined, (error: { code: number; message: string }) => error);
  // The changeset is not what it was: the machine's commit is not on the
  // branch, so an operation that committed the folder would commit somebody
  // else's work.
  expect(refused?.code).toBe(-32011);
  expect(refused?.message).toContain('refs/ahpd/machines/box/main');
  expect(said).not.toContain('invoke commit');
});

it('brings it back when the session leaves its machine, before the port is told it left', async () => {
  const said: string[] = [];
  const { client, uri } = await running(machinePort(said));
  await until(() => said.includes('enter box echo:/one'));

  await client.handle({ method: 'disposeSession', params: { channel: uri } });
  // The name a port is told is the one this host holds the session by, so a
  // machine's work is asked for under the same name it was counted in under.
  await until(() => said.includes('leave box echo:/one'));
  expect(said).toEqual(['enter box echo:/one', 'bringBack box', 'leave box echo:/one']);
});

it('logs a machine that could not be brought back, and the turn still ends', async () => {
  const said: string[] = [];
  const lines: string[] = [];
  const port = machinePort(said, async () => { throw new Error('docker is not running'); });
  const { client, peer: p, chatUri } = await running(port, undefined, (line) => { lines.push(line); });
  await until(() => said.includes('enter box echo:/one'));

  client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'hello' } } },
  });
  await until(() => lines.some((one) => one.includes('bringBack')));
  // A turn that could not have its work fetched is still a turn that ended:
  // the failure is a line a person reads, not a turn left running.
  expect(lines.some((one) => one
    .includes('computers: bringing the work of box back for echo:/one failed: docker is not running')))
    .toBe(true);
  await until(() => turnEnded(p, chatUri));
});
