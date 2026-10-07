import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { createHost } from '../../sdk/src/host.js';
import { fileResources } from '../../sdk/src/resources.js';
import { fileSessions, memorySessions } from '../../sdk/src/sessions.js';
import { loadPlugins } from '../../server/src/plugins.js';
import { echo } from '../../../examples/echo/agent.js';
import { closeAll, keeping } from './support/closing.js';
import type { Agent } from '../../sdk/src/types/agent.js';
import type { ComputerPort } from '../../sdk/src/types/computers.js';
import type { HostOptions } from '../../sdk/src/types/host.js';
import type { Peer } from '../../sdk/src/types/rpc.js';
import type { SessionStore } from '../../sdk/src/types/sessions.js';

/*
 * A session in a machine reads its attachments at the path the host wrote.
 *
 * A message's attachment is a file this host wrote under the session's own
 * folder and the message names it by path, so a session running in a machine
 * is handed a path only once the machine holds a file at the same one. A
 * machine takes no new mount while it runs and a machine an operator made ahead
 * of time belongs to no session, so the file is written into the machine
 * instead - decision `a-session-in-a-machine-gets-each-attachment-copied-into-it`.
 * Read-only, as root, because the bytes are a copy of what somebody sent and
 * the machine's own user could write over its own file.
 *
 * Both recipes are scripted: the Docker fixture records every call and every
 * command run in a machine, and the Dev Container fixture records what the CLI
 * made, which is where the second recipe's machine comes from.
 */

const REPO = join(import.meta.dirname, '../../..');
const SOURCE = './packages/computer/src/index.ts';
const DEV = fileURLToPath(new URL('./fixtures/devcontainer.mjs', import.meta.url));
const DOCKER = fileURLToPath(new URL('./fixtures/docker.mjs', import.meta.url));

/** A PNG's first bytes. Nothing here decodes it, so a header is a picture. */
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489', 'hex');

/** Temporary directories, removed after the test that made them. */
const loose: string[] = [];
afterEach(async () => {
  await closeAll();
  for (const one of loose.splice(0)) rmSync(one, { recursive: true, force: true });
});

const temp = (): string => {
  const one = mkdtempSync(join(tmpdir(), 'ahpd-attachments-computer-'));
  loose.push(one);
  return one;
};

/** A folder that is a dev container: a `devcontainer.json` and nothing else. */
function workspace(root: string): string {
  const folder = mkdtempSync(join(root, 'work-'));
  mkdirSync(join(folder, '.devcontainer'), { recursive: true });
  writeFileSync(join(folder, '.devcontainer', 'devcontainer.json'), '{ "image": "base" }');
  return folder;
}

/** What the scripted Docker holds. */
interface Held {
  machines: { name: string; mounts?: string[]; labels?: Record<string, string> }[];
  calls: string[][];
  /** Every command run in a machine, with the flags it was reached under. */
  commands?: { id: string; user?: string; command: string[]; input?: string }[];
}

const held = (state: string): Held => (existsSync(state)
  ? JSON.parse(readFileSync(state, 'utf8')) as Held
  : { machines: [], calls: [] });

/** What the scripted Dev Container CLI recorded. */
interface DevHeld {
  calls: string[][];
  overrides?: { where: string; mode: number; config: Record<string, unknown> }[];
}

const devHeld = (state: string): DevHeld => (existsSync(state)
  ? JSON.parse(readFileSync(state, 'utf8')) as DevHeld
  : { calls: [] });

const until = async (check: () => boolean, times = 1000): Promise<void> => {
  for (let i = 0; i < times; i++) {
    if (check()) return;
    await new Promise((r) => { setTimeout(r, 5); });
  }
};

/** The one a case waited for, which nothing hands back without one. */
const first = <T>(list: T[]): T => list[0] as T;

/** Every command a machine was given, in the order it was given them. */
const commands = (state: string): NonNullable<Held['commands']> => held(state).commands ?? [];

/**
 * The lines a session's files were written into a machine with.
 *
 * The one road into a machine that carries bytes: one `docker exec` per file,
 * as root, with the file on the command's own input.
 */
const writes = (state: string): NonNullable<Held['commands']> =>
  commands(state).filter((one) => one.command.some((said) => said.includes('chmod 0444')));

/** The lines a session's folder was taken back out with. */
const removals = (state: string): NonNullable<Held['commands']> =>
  commands(state).filter((one) => one.command[0] === 'rm' && one.command.includes('-rf'));

/** The machine the scripted Docker holds, once the session has made one. */
const machine = async (state: string): Promise<Held['machines'][number]> => {
  await until(() => held(state).machines.length > 0);
  return first(held(state).machines);
};

/** The machine a session's message was written into, once it has been. */
const written = async (state: string): Promise<NonNullable<Held['commands']>[number]> => {
  await until(() => writes(state).length > 0);
  return first(writes(state));
};

/**
 * A Docker state file whose writes are read rather than drained.
 *
 * A file written into a machine arrives on the command's own input, and the
 * scripted Docker reads the input of a command it is told about: a command a
 * caller keeps a pipe open on must not be waited on, and a launched host is one
 * of those.
 */
const reading = (state: string): void =>
  writeFileSync(state, JSON.stringify({ machines: [], calls: [], inputCommands: ['chmod 0444'] }));

/** The plugin's options, with the two scripted programs as its runtime and CLI. */
const optionsOf = (states: { dev?: string; docker: string }, more: Record<string, unknown> = {}): Record<string, unknown> => ({
  command: process.execPath,
  args: [DOCKER],
  env: { DOCKER_FAKE_STATE: states.docker },
  ...(states.dev === undefined ? {} : {
    devcontainer: {
      command: process.execPath,
      args: [DEV],
      env: { DEVCONTAINER_FAKE_STATE: states.dev, DOCKER_FAKE_STATE: states.docker },
    },
  }),
  ...more,
});

/** The echo backend, declaring nothing a machine has to be prepared with. */
const agent = (): Agent => ({ ...echo({ path: '/tmp/ahpd-attachments-computer', pace: 0 }), machine: () => ({}) });

/** The plugin, loaded with a sessions store and a configuration directory of its own. */
const load = async (
  pluginOptions: Record<string, unknown>,
  sessions: SessionStore,
  agents: Agent[] = [agent()],
  lines: string[] = [],
) => {
  const result = await loadPlugins(
    [{ name: SOURCE, options: pluginOptions }],
    {
      base: { path: '/tmp/ahpd-attachments-computer', agents, resources: fileResources(), sessions },
      configDir: temp(),
      cwd: REPO,
      // Every line the plugin says, which is where a refusal is read from.
      log: (line: string) => { lines.push(line); },
    },
  );
  keeping(result.options);
  return result;
};

const peer = (): Peer => ({ send: () => {}, notify: () => {}, request: async () => ({}), answered: () => {}, close: () => {} });

/** One client, the sessions a case opens, and the messages it sends them. */
async function room(hostOptions: HostOptions) {
  const host = createHost(hostOptions);
  keeping(hostOptions, host);
  const client = host.accept(peer());
  await client.handle({
    method: 'initialize',
    params: { clientId: 'probe', protocolVersions: ['0.9.0'], initialSubscriptions: ['ahp-root://'] },
  });
  const open = async (uri: string, config: Record<string, unknown>, folder?: string): Promise<void> => {
    await client.handle({
      method: 'createSession',
      params: {
        channel: uri,
        provider: 'echo',
        config,
        ...(folder === undefined ? {} : { workingDirectories: [folder] }),
      },
    });
    await client.handle({ method: 'subscribe', params: { channel: uri } });
  };
  /** One message with a pasted picture, into the session's own chat. */
  const send = async (uri: string, label = 'pasted.png'): Promise<void> => {
    const opened = await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: { state: { defaultChat: string } };
    };
    const chat = opened.snapshot.state.defaultChat;
    await client.handle({ method: 'subscribe', params: { channel: chat } });
    await client.handle({
      method: 'dispatchAction',
      params: {
        channel: chat,
        clientSeq: 0,
        action: {
          type: 'chat/turnStarted',
          turnId: 't1',
          message: {
            text: 'what is this',
            attachments: [{ type: 'embeddedResource', label, contentType: 'image/png', data: PNG.toString('base64') }],
          },
        },
      },
    });
  };
  return { client, open, send };
}

/** The profile a session makes its machine from, which works in the session's folder. */
const DISPOSABLE = { claude: { title: 'Claude', image: 'node:22', disposable: true, sessionFolder: true } };

/** The folder the host keeps one session's own files in, as the store names it. */
const folderOf = (sessions: string, id: string): string => join(sessions, 'attachments', id);

it('writes a session\'s attachment into its machine at the path the host wrote', async () => {
  const dir = temp();
  const dockerState = join(dir, 'docker.json');
  const sessions = join(dir, 'sessions');
  const folder = join(dir, 'project');
  mkdirSync(folder);
  reading(dockerState);

  const { options: loaded } = await load(optionsOf({ docker: dockerState }, { profiles: DISPOSABLE }), fileSessions({ dir: sessions }));
  const { open, send } = await room(loaded);
  await open('ahp-session:/one', { computer: 'disposable:claude' }, folder);
  const made = await machine(dockerState);
  await send('ahp-session:/one');

  const copy = await written(dockerState);
  // As root, because the machine's own user cannot make the folders above a
  // path this host chose, and a file it owns is one it could write over.
  expect(copy.user).toBe('0');
  expect(copy.command.slice(0, 3)).toEqual([
    'sh', '-c', 'mkdir -p "$(dirname "$1")" && cat > "$1" && chmod 0444 "$1"',
  ]);
  const path = copy.command[copy.command.length - 1] as string;
  // The path the message names, which is the one the host wrote the file to.
  expect(path).toMatch(new RegExp(`^${folderOf(sessions, 'one')}/.*\\.png$`));
  expect(Buffer.from(copy.input ?? '', 'base64')).toEqual(PNG);
  // And the bytes crossed as a file on this host, written before the machine
  // was asked for them.
  expect(existsSync(path)).toBe(true);
  expect(readFileSync(path)).toEqual(PNG);

  // Nothing was mounted to make that work: a running machine takes no new
  // mount, and this one was made before the message existed.
  expect((made.mounts ?? []).some((one) => one.includes('/attachments/'))).toBe(false);
});

it('writes each session\'s own file into the machine the two share', async () => {
  const dir = temp();
  const dockerState = join(dir, 'docker.json');
  const sessions = join(dir, 'sessions');
  const folder = join(dir, 'project');
  mkdirSync(folder);

  const { options: loaded } = await load(optionsOf({ docker: dockerState }, { profiles: DISPOSABLE }), fileSessions({ dir: sessions }));
  const { open, send } = await room(loaded);
  await open('ahp-session:/one', { computer: 'disposable:claude' }, folder);
  const made = await machine(dockerState);
  // The same machine, named the way the store was told to name it, which is
  // what a second session in it says.
  await open('ahp-session:/two', { computer: `computer://${made.name}` }, folder);
  await send('ahp-session:/one', 'one.png');
  await send('ahp-session:/two', 'two.png');
  await until(() => writes(dockerState).length === 2);

  const paths = writes(dockerState).map((one) => one.command[one.command.length - 1] as string);
  // Each under its own session's folder, and both into the one machine: a
  // machine is nobody's, so what it is handed is per session.
  expect(first(paths)).toMatch(new RegExp(`^${folderOf(sessions, 'one')}/.*\\.png$`));
  expect(paths[1]).toMatch(new RegExp(`^${folderOf(sessions, 'two')}/.*\\.png$`));
  expect(writes(dockerState).map((one) => one.id)).toEqual([made.name, made.name]);
});

it('writes it into a dev container the same way', async () => {
  const dir = temp();
  const devState = join(dir, 'dev.json');
  const dockerState = join(dir, 'docker.json');
  const sessions = join(dir, 'sessions');
  const folder = workspace(dir);
  reading(dockerState);

  const { options: loaded } = await load(
    optionsOf({ dev: devState, docker: dockerState }),
    fileSessions({ dir: sessions }),
  );
  const { open, send } = await room(loaded);
  await open('ahp-session:/one', { computer: `devcontainer://${folder}` }, folder);
  await send('ahp-session:/one');

  // The CLI's container is reached by the name its own labels give it, which
  // is the one road every command in a machine goes through.
  const copy = await written(dockerState);
  const path = copy.command[copy.command.length - 1] as string;
  expect(copy.user).toBe('0');
  expect(path).toMatch(new RegExp(`^${folderOf(sessions, 'one')}/.*\\.png$`));
  expect(Buffer.from(copy.input ?? '', 'base64')).toEqual(PNG);
  // And the CLI was handed no mount for the folder either.
  const config = first(devHeld(devState).overrides ?? []).config;
  expect(JSON.stringify(config)).not.toContain('/attachments/');
});

it('takes the folder back out of the machine when the session goes', async () => {
  const dir = temp();
  const dockerState = join(dir, 'docker.json');
  const sessions = join(dir, 'sessions');
  const folder = join(dir, 'project');
  mkdirSync(folder);

  const { options: loaded } = await load(optionsOf({ docker: dockerState }, { profiles: DISPOSABLE }), fileSessions({ dir: sessions }));
  const { client, open, send } = await room(loaded);
  await open('ahp-session:/one', { computer: 'disposable:claude' }, folder);
  await machine(dockerState);
  await send('ahp-session:/one');
  await written(dockerState);

  await client.handle({ method: 'disposeSession', params: { channel: 'ahp-session:/one' } });
  await until(() => removals(dockerState).length > 0);
  // The folder this one session's files are under, removed with whatever is
  // in it: the machine outlives the session and keeps nothing of it.
  expect(removals(dockerState).map((one) => ({ user: one.user, command: one.command }))).toEqual([
    { user: '0', command: ['rm', '-rf', folderOf(sessions, 'one')] },
  ]);
});

it('refuses a path that is no session\'s attachments, before a copy and before a removal', async () => {
  const dir = temp();
  const dockerState = join(dir, 'docker.json');
  const sessions = join(dir, 'sessions');
  const lines: string[] = [];
  const { options: loaded } = await load(
    optionsOf({ docker: dockerState }, { profiles: DISPOSABLE }),
    fileSessions({ dir: sessions }),
    [agent()],
    lines,
  );
  /*
   * The port itself, asked the way the host asks it, with no session and no
   * machine in the way. One shape is a session's own files - the folder the
   * host keeps them under, and something below it - and the folder that holds
   * every session is the one path a removal must never reach. A copy of it and
   * a `rm -rf` of it are both refused, and nothing is run in a machine.
   */
  const port = loaded.computers as ComputerPort;
  const attachments = join(sessions, 'attachments');
  const outside = join(dir, 'elsewhere.png');
  await port.putIn?.('box', [attachments, outside]);
  await port.takeOut?.('box', [attachments, join(attachments, 'one', '..'), outside]);

  expect(commands(dockerState)).toEqual([]);
  const refused = lines.filter((one) => one.startsWith('ahpd-computer: '));
  expect(refused).toHaveLength(5);
  for (const line of refused) expect(line).toContain("it is not a session's attachments path");
});

it('writes nothing into a machine for a store that keeps no files', async () => {
  const dir = temp();
  const dockerState = join(dir, 'docker.json');
  const folder = join(dir, 'project');
  mkdirSync(folder);

  const { options: loaded } = await load(optionsOf({ docker: dockerState }, { profiles: DISPOSABLE }), memorySessions());
  const { open, send } = await room(loaded);
  await open('ahp-session:/one', { computer: 'disposable:claude' }, folder);
  await machine(dockerState);
  await send('ahp-session:/one');
  // A host that keeps its sessions in memory has no attachments folder, so
  // there is nothing written here and nothing to write into the machine. The
  // message goes as it arrived, as it did before any of this.
  await until(() => held(dockerState).calls.length > 0);
  expect(writes(dockerState)).toEqual([]);
});
