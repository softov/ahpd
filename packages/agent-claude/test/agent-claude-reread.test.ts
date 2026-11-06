import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, expect, it, vi } from 'vitest';
import type { Bag } from '@ahpd/sdk';

/*
 * A session's list, read again when a Claude folder changes.
 *
 * `initializationResult()` answers once, for the first connect, so an agent
 * written after it is in no list a session holds until it asks the CLI again.
 * The watcher is faked here: what is under test is what a change does, and the
 * watch of real folders has its own test.
 */

const sdk = vi.hoisted(() => ({
  /** The agents and skills the next reloads answer. */
  agents: [] as Bag[],
  skills: [] as Bag[],
  /** Whether the next reloads fail. */
  failing: false,
  /** How many `reloadPlugins` calls were made, and the ones still waiting. */
  reloads: 0,
  held: [] as (() => void)[],
  /** Whether a reload waits until it is let go. */
  holding: false,
  reset() {
    sdk.agents = [];
    sdk.skills = [];
    sdk.failing = false;
    sdk.reloads = 0;
    sdk.held = [];
    sdk.holding = false;
  },
}));

const watched = vi.hoisted(() => ({
  /** The calls a change makes, one per watch started. */
  changes: [] as (() => void)[],
  stopped: 0,
}));

vi.mock('../src/session/watch.js', () => ({
  watchFolders: (_roots: unknown, onChange: () => void) => {
    watched.changes.push(onChange);
    return () => { watched.stopped += 1; };
  },
}));

vi.mock('@anthropic-ai/claude-agent-sdk', async () => (await import('../../sdk/test/support/warmed.js')).warmed({
  createSdkMcpServer: (given: Record<string, unknown>) => ({ type: 'sdk', name: given.name, tools: given.tools }),
  query: () => {
    let closed = false;
    let wake: (() => void) | undefined;
    const reloaded = async <T>(answer: () => T): Promise<T> => {
      sdk.reloads += 1;
      if (sdk.holding) await new Promise<void>((done) => { sdk.held.push(done); });
      if (sdk.failing) throw new Error('the CLI went away');
      return answer();
    };
    return {
      async *[Symbol.asyncIterator]() {
        while (!closed) await new Promise<void>((done) => { wake = done; });
      },
      interrupt: async () => {},
      setPermissionMode: async () => {},
      setModel: async () => {},
      applyFlagSettings: async () => {},
      toggleMcpServer: async () => {},
      reconnectMcpServer: async () => {},
      setMcpServers: async () => {},
      initializationResult: async () => ({ agents: [], commands: [] }),
      mcpServerStatus: async () => [],
      reloadSkills: () => reloaded(() => ({ skills: sdk.skills })),
      reloadPlugins: () => reloaded(() => ({ plugins: [], agents: sdk.agents, commands: [] })),
      supportedModels: async () => [],
      streamInput: async () => {},
      close: () => {
        closed = true;
        wake?.();
      },
    };
  },
}));

const { createSession } = await import('../src/session.js');

const settle = async (times = 30): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((r) => { setTimeout(r, 0); });
};

/** A session whose first send started its CLI and whose first list has been said, with what it says from then on. */
async function open(extra: Record<string, unknown> = {}) {
  const said: Bag[] = [];
  const session = createSession({
    uri: 'ahp-session:/reread',
    chatUri: 'ahp-chat:/reread',
    cwd: mkdtempSync(join(tmpdir(), 'ahpd-reread-')),
    emit: (_channel, action) => { said.push(action as Bag); },
    ...extra,
  });
  session.sendMessage('t1', 'hello');
  await settle();
  return { session, said };
}

/** The names of the agents in the last list a session said. */
const agentsSaid = (said: Bag[]): unknown[] => {
  const last = said.filter((one) => one.type === 'session/customizationsChanged').at(-1);
  return ((last?.customizations as Bag[] | undefined) ?? [])
    .flatMap((one) => (one.children as Bag[] | undefined) ?? [])
    .filter((one) => one.type === 'agent')
    .map((one) => one.name);
};

beforeEach(() => {
  sdk.reset();
  watched.changes = [];
  watched.stopped = 0;
});

it('lists an agent written after the first connect, once a folder changes', async () => {
  const { said } = await open();
  expect(agentsSaid(said)).toEqual([]);
  expect(watched.changes).toHaveLength(1);

  sdk.agents = [{ name: 'scout', description: 'Looks around' }];
  watched.changes[0]?.();
  await settle();
  // `initializationResult()` still answers no agents: the list is the reload's.
  expect(agentsSaid(said)).toEqual(['scout']);
});

it('keeps the list it had, and says nothing, when a reload fails', async () => {
  const { said } = await open();
  sdk.agents = [{ name: 'scout' }];
  watched.changes[0]?.();
  await settle();
  const before = said.length;

  sdk.failing = true;
  sdk.agents = [];
  watched.changes[0]?.();
  await settle();
  expect(said).toHaveLength(before);
  expect(agentsSaid(said)).toEqual(['scout']);
});

it('reads one at a time, and once more for a change during a read', async () => {
  const { said } = await open();
  const first = sdk.reloads;
  sdk.holding = true;
  watched.changes[0]?.();
  await settle();
  // Both reloads of one read, and no more for the changes that come during it.
  expect(sdk.reloads - first).toBe(2);
  sdk.agents = [{ name: 'scout' }];
  watched.changes[0]?.();
  watched.changes[0]?.();
  await settle();
  expect(sdk.reloads - first).toBe(2);

  sdk.holding = false;
  for (const done of sdk.held.splice(0)) done();
  await settle();
  // One more read for the two changes, which saw the agent written during the first.
  expect(sdk.reloads - first).toBe(4);
  expect(agentsSaid(said)).toEqual(['scout']);
});

it('starts no watch for a session in a machine', async () => {
  await open({ spawn: () => { throw new Error('not started in this test'); } });
  // Its first list was asked for, so the watch was the thing left out.
  expect(sdk.reloads).toBeGreaterThan(0);
  expect(watched.changes).toHaveLength(0);
});

/*
 * A list that empties is a list that moved.
 *
 * A session in a machine lists no folder rows of its own, so the CLI answering
 * nothing leaves it nothing beside the list it started with. The action
 * replaces the list every client holds, so the empty one is said as any other.
 * https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/docs/guide/actions.md#L3
 */
it('says its list when the first answer empties it', async () => {
  const seeded = { type: 'skill', id: 'skill:handed', name: 'handed', uri: 'file:///handed/SKILL.md', enabled: true };
  const { session, said } = await open({
    spawn: () => { throw new Error('not started in this test'); },
    seedCustomizations: [seeded],
  });
  expect(session.customizations()).toEqual([]);
  expect(said.filter((one) => one.type === 'session/customizationsChanged').map((one) => one.customizations)).toEqual([[]]);
});

it('reads nothing again once the session is closed, and stops its watch', async () => {
  const { session } = await open();
  expect(watched.changes).toHaveLength(1);
  session.close();
  await settle();
  expect(watched.stopped).toBe(1);
  const before = sdk.reloads;
  watched.changes[0]?.();
  await settle();
  expect(sdk.reloads).toBe(before);
});
