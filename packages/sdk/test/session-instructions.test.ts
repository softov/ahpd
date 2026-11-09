import { loggerOf } from '../src/log.js';
import { beforeEach, expect, it, vi } from 'vitest';
import { idOf } from '../src/sessions/catalog.js';
import { foldHostOptions, pluginHost } from '../src/plugins/plugins.js';
import { memorySessions } from '../src/sessions/sessions.js';
import { sdkVersion } from '../src/version.js';
import {
  createHost, echo, machine, resetSdk,
} from './support/host.js';
import {
  directory, hello, peer, signIn,
} from './users-gate-helpers.js';
import type { Agent, Start } from '../src/types/agent.js';
import type { HostOptions, HostTool } from '../src/types/host.js';
import type { LoaderContext } from '../src/types/plugin.js';

vi.mock('@anthropic-ai/claude-agent-sdk', async () => (await import('./support/claude-sdk.js')).fake);

beforeEach(resetSdk);

/*
 * What a session is told, and the tools it is told with.
 *
 * A request may carry instructions, which the host adds to `Start.instructions`
 * after what its own tools say, and may name the opt-in tools it wants. The
 * two are one road: an opt-in tool is offered only to a session that names it,
 * so an instruction about one belongs only where the tool is.
 *
 * Every case starts its session the way a plugin does, because neither field
 * has a door a client can use: `createSession` is a person asking for a session,
 * and these are a plugin's words about one.
 */

const DIR = '/home/softov';

/** The context every plugin in this repository is handed, without a daemon. */
const context = (): LoaderContext => ({
  path: DIR, paths: [DIR], version: sdkVersion(), hostName: 'test', configDir: DIR, log: loggerOf(() => {}), say: () => {},
});

/** A host tool with nothing but the members the contract requires. */
const tool = (name: string, extra: Partial<HostTool> = {}): HostTool => ({
  definition: { name, title: name, description: `${name} tool`, inputSchema: { type: 'object', properties: {} } },
  run: () => name,
  ...extra,
});

/**
 * One host, one plugin that asks for sessions, and the starts its sessions made.
 *
 * The plugin is folded into the host the way the loader folds it, and the
 * backend keeps the `Start` it was handed, so `instructions` and `tools` are
 * read from the half a model actually sees rather than from the wire alone.
 */
function starting(tools: HostTool[] = []) {
  const sessions = memorySessions();
  const base = echo({ path: DIR, pace: 0 });
  const seen: Start[] = [];
  const agent: Agent = {
    ...base,
    create: (start: Start) => {
      seen.push(start);
      return base.create(start);
    },
  };
  const { host: plugin, contribution } = pluginHost('bots', context());
  for (const one of tools) plugin.registerTool(one);
  const { options, problems } = foldHostOptions({
    path: DIR,
    agents: [agent],
    ...machine(),
    sessions,
    users: directory({ soft: ['session:*'] }),
  } as HostOptions, [contribution]);
  const host = createHost(options);
  return { plugin, host, sessions, seen, problems };
}

/** A client signed in as `who`, which is what a run on their behalf needs. */
const open = async (host: ReturnType<typeof createHost>, who: string): Promise<void> => {
  const client = host.accept(peer());
  await hello(client, who);
  await signIn(client, who);
};

/** The names of the tools one `Start` was handed. */
const boundNames = (at: number, seen: Start[]): string[] =>
  (seen.at(at)?.tools ?? []).map((one) => one.definition.name);

it('tells the session what its request says, after what the host tools say', async () => {
  const { plugin, host, seen } = starting([tool('alpha', { instruction: 'Reach for the alpha tool.' })]);
  await open(host, 'soft');

  await plugin.startSession({
    owner: 'user:soft', prompt: 'Say hello', instructions: ['Close the door.', 'Do not open it.'],
  });

  expect(seen).toHaveLength(1);
  const told = seen[0]?.instructions ?? [];
  // The tool's own instruction first, and the request's after it, in the order
  // the request wrote them: a request may be about a tool only its session has,
  // so nothing in front of it could account for what it says.
  expect(told).toContain('Reach for the alpha tool.');
  expect(told.slice(-2)).toEqual(['Close the door.', 'Do not open it.']);
});

it('refuses instructions that are not an array of strings', async () => {
  const { plugin, host } = starting();
  await open(host, 'soft');

  // A single line where a list belongs is the mistake a plugin makes, and the
  // check is the only place it is caught: the type is gone by the time a plugin
  // runs.
  expect(() => plugin.startSession({
    owner: 'user:soft', prompt: 'Say hello', instructions: 'Close the door.',
  } as never)).toThrow(/startSession needs instructions to be an array of strings, or nothing/);
});

it('offers an opt-in tool only to a session that names it, and keeps the name', async () => {
  const { plugin, host, sessions, seen } = starting([tool('optional', { optIn: true })]);
  await open(host, 'soft');

  const plain = await plugin.startSession({ owner: 'user:soft', prompt: 'Say hello' });
  const asked = await plugin.startSession({ owner: 'user:soft', prompt: 'Say hello', tools: ['optional'] });

  expect(seen.map((one) => one.uri)).toEqual([plain, asked]);
  // Bound is what a model is offered: a tool left out here is one it is never
  // told about, not one it is refused after calling.
  expect(boundNames(0, seen)).not.toContain('optional');
  expect(boundNames(1, seen)).toContain('optional');

  // The names are held with the session, which is what offers the same tools
  // again when a restart opens it without the request being repeated.
  expect(sessions.tools?.(idOf(plain))).toBeUndefined();
  expect(sessions.tools?.(idOf(asked))).toEqual(['optional']);
});
