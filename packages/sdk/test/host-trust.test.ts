import { mkdirSync, mkdtempSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createHost, ROOT } from '../src/host.js';
import { uriOf } from '../src/fileuri.js';
import { trusted } from '../src/host/trust.js';
import { memorySessions } from '../src/sessions.js';
import { memoryAutomations } from '../src/automations.js';
import { echo } from '../../../examples/echo/agent.js';
import type { Agent, Start } from '../src/types/agent.js';
import type { Peer } from '../src/types/rpc.js';
import type { SessionStore } from '../src/types/sessions.js';
import type { Users } from '../src/types/users.js';
import type { Worktrees } from '../src/types/worktrees.js';

/*
 * What a backend is told about the folders it is handed.
 *
 * A folder VS Code has not vouched for is a folder whose project files an
 * agent must not load, and the host is the only thing that knows which those
 * are: trust arrives on a connection, from a window, and belongs to the person
 * whose session it is. So the start carries the answer, and this is what that
 * answer is in each of the cases the decision names - decision
 * `a-folder-is-untrusted-until-a-client-says-otherwise`.
 */

const DIR = mkdtempSync(join(tmpdir(), 'ahpd-trust-'));
const A = join(DIR, 'a');
const AB = join(A, 'b');
const B = join(DIR, 'b');
mkdirSync(AB, { recursive: true });
mkdirSync(B, { recursive: true });

/** The folders every start is asked about, one of them inside another. */
const FOLDERS = [A, AB, B];

const RESOURCE = 'ahpd://users';

/** Two people, each of whom may do anything, and neither of whom is the other. */
const directory = (): Users => ({
  resource: { resource: RESOURCE, resource_name: 'ahpd users', authorization_servers: [RESOURCE], required: false },
  verify: async (token) => (token === 'ana' || token === 'bo' ? { id: token, roles: [], can: () => true } : undefined),
  list: async () => [],
  grantsOfRoles: async () => [],
  grantsOfPerson: async () => undefined,
  add: async () => {},
  roles: async () => [],
  addRole: async () => {},
  removeRole: async () => false,
  teams: async () => [],
  projects: async () => [],
  addTeam: async () => {},
  addProject: async () => {},
  removeTeam: async () => false,
  removeProject: async () => false,
  remove: async () => false,
  mint: async () => 'ana',
});

const peer = (
  answer: (method: string, params: unknown) => unknown = () => ({}),
): Peer & { notes: { method: string; params: unknown }[] } => {
  const notes: { method: string; params: unknown }[] = [];
  return {
    notes,
    send: () => {},
    notify: (method, params) => notes.push({ method, params }),
    request: async (method, params) => answer(method, params),
    answered: () => {},
    close: () => {},
  };
};

const settle = async (times = 20): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((r) => { setTimeout(r, 0); });
};

type Client = ReturnType<ReturnType<typeof createHost>['accept']>;

/** What one start was told about each of the folders. */
type Told = { folder: string; trusted: boolean | undefined }[];

/**
 * The example backend, keeping what the last start was told.
 *
 * `folders` is asked of every start and is the test's own list, so a case that
 * learns a folder's name while the session starts - a worktree the host makes -
 * adds it before the backend is asked.
 */
function backend(folders: string[], listed = false) {
  const base = echo({ path: DIR, pace: 0 });
  let told: Told = [];
  const agent: Agent = {
    ...base,
    provider: 'echo',
    displayName: 'Echo backend',
    // A backend a client may add a folder to, since a host refuses a
    // `session/workingDirectorySet` before it asks anybody about the folder.
    multipleDirectories: true,
    /*
     * The one row this backend knows, so a session the daemon before this one
     * wrote can be opened by a turn - which is the whole of how browsing
     * becomes continuing. Off for a host that is making the session rather
     * than finding it, where the row is the thing being created.
     */
    ...(listed ? {
      list: async () => [{
        id: 'bo-one',
        title: 'Bo one',
        createdAt: '2026-10-06T00:00:00.000Z',
        modifiedAt: '2026-10-06T09:00:00.000Z',
        workingDirectories: [uriOf(A)],
      }],
      transcript: async () => [],
    } : {}),
    create: (start: Start) => {
      // Asked of every start rather than of the session's own folder alone,
      // because the answer is what a backend gates its project files on and a
      // folder beside the session's is a place it may also look.
      told = folders.map((folder) => ({ folder, trusted: start.trusted?.(folder) }));
      return base.create(start);
    },
  };
  return { agent, told: (): Told => told };
}

/** What the last start was told about one folder. */
const about = (told: Told, folder: string): boolean | undefined =>
  told.find((one) => one.folder === folder)?.trusted;

/**
 * A host, and the backend behind it.
 *
 * `people` is whether the host was given a people directory at all, which is
 * what `--users` decides: without one there is nobody a connection can be, and
 * the deployment is the single-person case - decision
 * `the-sender-decides-on-a-host-with-no-people`. `answer` is what a client says
 * when the host asks it a question, which is where a trust question lands.
 */
function serving({
  store, automations = false, listed = false, people = true, worktrees, folders = [...FOLDERS], answer = () => ({}),
}: {
  store?: SessionStore;
  automations?: boolean;
  listed?: boolean;
  people?: boolean;
  worktrees?: Worktrees;
  folders?: string[];
  answer?: (method: string, params: unknown) => unknown;
} = {}) {
  const { agent, told } = backend(folders, listed);
  const host = createHost({
    path: DIR,
    agents: [agent],
    ...(people ? { users: directory() } : {}),
    ...(store === undefined ? {} : { sessions: store }),
    ...(automations ? { automations: memoryAutomations() } : {}),
    ...(worktrees === undefined ? {} : { worktrees }),
  });
  /** Everything the host put to a client, which is where a trust question lands. */
  const asked: { method: string; params: unknown }[] = [];
  /** One connection: signed in when the host has somebody to sign in as. */
  const join = async (token?: string): Promise<Client> => {
    const client = host.accept(peer((method, params) => {
      asked.push({ method, params });
      return answer(method, params);
    }));
    await client.handle({
      method: 'initialize',
      params: { clientId: token ?? 'probe', protocolVersions: ['0.9.0'], initialSubscriptions: [ROOT] },
    });
    if (token !== undefined && people) {
      await client.handle({ method: 'authenticate', params: { channel: ROOT, resource: RESOURCE, token } });
    }
    return client;
  };
  const signedIn = (token: string): Promise<Client> => join(token);
  const connect = (): Promise<Client> => join();
  /** The trust questions only, since a host asks its clients other things too. */
  const questions = (): { method: string; params: unknown }[] =>
    asked.filter((one) => one.method === 'vscode/requestWorkspaceTrust');
  return { host, signedIn, connect, told, questions };
}

/** The trust one window pushed, which is that window's own. */
const trusting = (client: Client, folders: string[]) => client.handle({
  method: 'dispatchAction',
  params: {
    channel: ROOT,
    action: { type: 'root/configChanged', config: { workspaceTrust: { enabled: true, trustedUris: folders.map(uriOf) } } },
  },
});

/** A session somebody asked for, in one folder, watched by the client that made it. */
const opening = async (client: Client, name: string, folder: string): Promise<void> => {
  const uri = `ahp-session:/${name}`;
  await client.handle({
    method: 'createSession',
    params: { channel: uri, provider: 'echo', workingDirectories: [uriOf(folder)] },
  });
  await client.handle({ method: 'subscribe', params: { channel: uri } });
};

it('tells a backend its own person trusted the folder, and nothing else', async () => {
  const { signedIn, told } = serving();
  const ana = await signedIn('ana');
  const bo = await signedIn('bo');
  await trusting(ana, [A]);
  await trusting(bo, []);
  await settle();

  // B trusts nothing, so B's session in the folder A trusts is in a folder B
  // does not: trust is the window's, and one person's vouching is not
  // another's.
  await opening(bo, 'bo-one', A);
  await settle();
  expect(about(told(), A)).toBe(false);
  expect(about(told(), AB)).toBe(false);

  // A trusts it, and the folder inside it with it.
  await opening(ana, 'ana-one', A);
  await settle();
  expect(about(told(), A)).toBe(true);
  expect(about(told(), AB)).toBe(true);
  // A sibling is not a child, however much of a path the two share.
  expect(about(told(), B)).toBe(false);
});

it('tells a session nothing is trusted when somebody else sends its turn', async () => {
  const store = memorySessions();
  const first = serving({ store });
  const bo = await first.signedIn('bo');
  await trusting(bo, []);
  await opening(bo, 'bo-one', A);
  // One turn, so the session is a transcript the next daemon can read rather
  // than a session it has never heard of.
  await bo.handle({
    method: 'dispatchAction',
    params: { channel: 'ahp-chat:/bo-one', action: { type: 'chat/turnStarted', turnId: 't0', message: { text: 'hello' } } },
  });
  await settle(60);

  /*
   * The daemon again, holding what the first one wrote: B's session is now a
   * row rather than a process, and the turn that starts it again is the one
   * `chat/turnStarted` sends into a session this host is not running.
   */
  const second = serving({ store, listed: true });
  const ana = await second.signedIn('ana');
  await trusting(ana, [A]);
  await settle();
  await ana.handle({
    method: 'dispatchAction',
    params: { channel: 'ahp-chat:/bo-one', action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'go' } } },
  });
  await settle(60);

  // A's window trusts this folder, and the session is B's: a turn into
  // somebody else's session is not theirs to widen.
  expect(about(second.told(), A)).toBe(false);
});

it('tells an automation nothing is trusted, since no window sent it', async () => {
  const { signedIn, told } = serving({ automations: true });
  const ana = await signedIn('ana');
  await trusting(ana, [A]);
  await settle();
  await ana.handle({
    method: 'dispatchAction',
    params: {
      channel: 'ahp-automations://',
      action: {
        type: 'automation/createRequested',
        resource: 'ahp-automation:/nightly',
        definition: {
          title: 'Nightly',
          enabled: true,
          message: { text: 'go' },
          session: { provider: 'echo', workingDirectories: [uriOf(A)] },
          triggers: [],
        },
      },
    },
  });
  await ana.handle({
    method: 'runAutomation',
    params: { channel: 'ahp-automations://', automation: 'ahp-automation:/nightly', requestId: 'r' },
  });
  await settle(60);

  // The automation is ana's - she wrote it and it runs as her - and it is
  // still nobody's window that sent it, which is the whole of what trust is.
  expect(about(told(), A)).toBe(false);
});

/*
 * A host started without `--users` has no people directory and so no owner:
 * `ownerFor` answers `undefined` for every connection there, deliberately, and
 * a session on such a host has no owner either. Comparing the two would refuse
 * every folder, which would make the value a window pushes dead on exactly the
 * deployment - one person, one machine - most likely to have anything to
 * trust - decision `the-sender-decides-on-a-host-with-no-people`. So the
 * sender decides, and an automation, which has no sender at all, still decides
 * nothing.
 */
it('reads a window\'s push on a host with no people directory', async () => {
  const { connect, told } = serving({ people: false });
  const window = await connect();
  await trusting(window, [A]);
  await settle();

  await opening(window, 'one', A);
  await settle();
  expect(about(told(), A)).toBe(true);
  expect(about(told(), AB)).toBe(true);
  expect(about(told(), B)).toBe(false);
});

it('tells an automation on a host with no people directory nothing is trusted', async () => {
  const { connect, told } = serving({ people: false, automations: true });
  const window = await connect();
  await trusting(window, [A]);
  await settle();
  await window.handle({
    method: 'dispatchAction',
    params: {
      channel: 'ahp-automations://',
      action: {
        type: 'automation/createRequested',
        resource: 'ahp-automation:/nightly',
        definition: {
          title: 'Nightly',
          enabled: true,
          message: { text: 'go' },
          session: { provider: 'echo', workingDirectories: [uriOf(A)] },
          triggers: [],
        },
      },
    },
  });
  await window.handle({
    method: 'runAutomation',
    params: { channel: 'ahp-automations://', automation: 'ahp-automation:/nightly', requestId: 'r' },
  });
  await settle(60);

  // No connection sent it, so there is nobody whose answer it could be - the
  // same on this host as on one with people.
  expect(about(told(), A)).toBe(false);
});

/*
 * A worktree lives beside its repository - `<repo>.worktrees/<branch>` - so it
 * is never a folder under one a window vouched for, and a window cannot be
 * asked about a folder it has never opened. One the host made is trusted
 * exactly when the repository it was cut from is - decision
 * `a-worktree-inherits-its-repositorys-trust`.
 */

/**
 * A git port that makes nothing, watching the paths the host asks it for.
 *
 * `make` runs before the host hands the path on, so a test's folder list holds
 * the worktree's name by the time the start that runs in it asks.
 */
const worktreesMaking = (made: string[], make?: (path: string) => void): Worktrees => ({
  repository: async (dir) => dir,
  branches: async () => ['main'],
  create: async (one) => { made.push(one.path); make?.(one.path); },
  dirty: async () => false,
  remove: async () => {},
  gitDir: async () => undefined,
});

/** A session started in a worktree of `A`, and what its backend was told. */
const inWorktree = async (vouching: string[]) => {
  const made: string[] = [];
  const folders = [...FOLDERS];
  const { signedIn, told } = serving({ folders, worktrees: worktreesMaking(made, (path) => folders.push(path)) });
  const ana = await signedIn('ana');
  await trusting(ana, vouching);
  await settle();
  await ana.handle({
    method: 'createSession',
    params: {
      channel: 'ahp-session:/tree',
      provider: 'echo',
      config: { isolation: 'worktree' },
      workingDirectories: [uriOf(A)],
    },
  });
  await settle(60);
  return { tree: made[0] as string, told };
};

it('trusts the worktree of a repository the window vouched for', async () => {
  const { tree, told } = await inWorktree([A]);
  expect(tree).toContain('.worktrees');
  // Beside A rather than under it, and trusted all the same: the repository
  // the worktree was cut from is what the window vouched for.
  expect(about(told(), tree)).toBe(true);
});

it('tells a session in a worktree nothing is trusted when the repository is not', async () => {
  const { tree, told } = await inWorktree([]);
  expect(about(told(), tree)).toBe(false);
});

/*
 * A folder a window says yes to is the window's answer for that folder, and it
 * stands: the move starts the backend again, and the process that starts has
 * never heard the question - decision `a-yes-is-kept-until-the-next-push`. A
 * push of `workspaceTrust` is the window answering for every folder at once, so
 * it puts the folders it answered one at a time behind it.
 */
it('tells the backend restarted in a folder the window said yes to that it is trusted', async () => {
  const { signedIn, told, questions } = serving({ answer: () => ({ trusted: true }) });
  const ana = await signedIn('ana');
  await trusting(ana, [A]);
  await opening(ana, 'ana-one', A);
  await settle();
  expect(about(told(), B)).toBe(false);

  await ana.handle({
    method: 'dispatchAction',
    params: { channel: 'ahp-session:/ana-one', action: { type: 'session/workingDirectorySet', directory: uriOf(B) } },
  });
  await settle(60);

  // Asked, because B is not a folder this window pushed.
  expect(questions()).toEqual([{ method: 'vscode/requestWorkspaceTrust', params: { workspace: uriOf(B) } }]);
  // And the backend started again in B is told B is trusted, on the window's
  // own answer rather than on anything it pushed.
  expect(about(told(), B)).toBe(true);

  // A new push is the window answering for every folder at once.
  await trusting(ana, [A]);
  await settle();
  await opening(ana, 'ana-two', B);
  await settle();
  expect(about(told(), B)).toBe(false);
});

it('asks about a folder that only begins like one the window trusted', async () => {
  const { signedIn, questions } = serving({ answer: () => ({ trusted: false }) });
  const ana = await signedIn('ana');
  await trusting(ana, [A]);
  await opening(ana, 'ana-one', A);
  await settle();

  // Written by hand rather than with `join`, which resolves `..` itself: this
  // is a path a client can send, and reading it as the folder it names is the
  // host's job.
  const outOfA = `${A}/../../etc`;
  await ana.handle({
    method: 'dispatchAction',
    params: { channel: 'ahp-session:/ana-one', action: { type: 'session/workingDirectorySet', directory: outOfA } },
  });
  await settle(60);

  // Not a folder under A, so it is asked about like any other folder nobody
  // vouched for - and asked about as the folder it lands in.
  expect(questions()).toEqual([
    { method: 'vscode/requestWorkspaceTrust', params: { workspace: uriOf(join(dirname(dirname(A)), 'etc')) } },
  ]);
});

/*
 * The folders a window vouched for are read as the folders they name, not as
 * the text they were written as - decision `a-folder-is-compared-by-its-target`.
 * Without that, `..` walks out of a trusted folder and a symlink inside one
 * opens whatever it points at.
 */
describe('the folders a window vouched for, read as the folders they name', () => {
  const ROOT = mkdtempSync(join(tmpdir(), 'ahpd-named-'));
  const inside = join(ROOT, 'inside');
  const below = join(inside, 'under');
  const outside = join(ROOT, 'outside');
  mkdirSync(below, { recursive: true });
  mkdirSync(outside, { recursive: true });
  symlinkSync(outside, join(inside, 'link'));
  /** What a window pushes when it trusts these folders and no others. */
  const vouching = (folders: string[]): unknown => ({ enabled: true, trustedUris: folders.map(uriOf) });

  it('reads a folder that walks out of a trusted one as the folder it lands in', () => {
    // Written as text, since `join` would resolve the `..` before it is read.
    expect(trusted(`${inside}/../outside`, vouching([inside]))).toBe(false);
    expect(trusted(`${inside}/../inside/under`, vouching([inside]))).toBe(true);
  });

  it('reads a folder under a symlink out of a trusted one as its target', () => {
    expect(trusted(join(inside, 'link'), vouching([inside]))).toBe(false);
    expect(trusted(join(inside, 'link', 'deeper'), vouching([inside]))).toBe(false);
  });

  it('trusts nothing for an entry that names no folder on this machine', () => {
    expect(trusted(inside, { enabled: true, trustedUris: [''] })).toBe(false);
    expect(trusted(inside, { enabled: true, trustedUris: ['file://'] })).toBe(false);
    expect(trusted(inside, { enabled: true, trustedUris: [`file://elsewhere${inside}`] })).toBe(false);
    // The same folder said with this machine's own name is this machine's.
    expect(trusted(inside, { enabled: true, trustedUris: [`file://localhost${inside}`] })).toBe(true);
    // And one bad entry beside a good one does not take the good one with it.
    expect(trusted(inside, { enabled: true, trustedUris: ['file://elsewhere/a', uriOf(inside)] })).toBe(true);
  });
});
