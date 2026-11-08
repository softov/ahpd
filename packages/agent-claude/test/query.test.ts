import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { claude } from '../src/claude.js';

/*
 * Which settings files a session loads, from the two answers it is started with.
 *
 * `trusted` decides whether the folder's own files may reach the model and
 * `userSettings` whether the person's own may. They are independent: a bot's
 * back session is trusted in its own folder and loads nothing of the person's,
 * so it gets the folder's `CLAUDE.md` and none of `~/.claude`.
 */

vi.mock('@anthropic-ai/claude-agent-sdk', async () => (await import('../../sdk/test/support/warmed.js')).warmed({
  createSdkMcpServer: (given: Record<string, unknown>) => ({ type: 'sdk', name: given.name, tools: given.tools }),
  query: ({ options }: { options: Record<string, unknown> }) => {
    sdk.options.push(options);
    return {
      async *[Symbol.asyncIterator]() { /* nothing streamed */ },
      interrupt: async () => {},
      setPermissionMode: async () => {},
      setModel: async () => {},
      applyFlagSettings: async () => {},
      toggleMcpServer: async () => {},
      reconnectMcpServer: async () => {},
      setMcpServers: async () => {},
      initializationResult: async () => ({}),
      mcpServerStatus: async () => [],
      reloadSkills: async () => ({ skills: [] }),
      reloadPlugins: async () => ({ plugins: [] }),
      supportedModels: async () => [],
      streamInput: async () => {},
      close: () => {},
    };
  },
}));

const sdk = vi.hoisted(() => ({ options: [] as Record<string, unknown>[] }));

let made: string[] = [];
afterEach(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
  made = [];
});

const settle = async (times = 8): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((done) => { setImmediate(done); });
};

const folder = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'ahpd-query-'));
  made.push(dir);
  return dir;
};

/** The `settingSources` one session's first send starts its CLI with, from the two answers. */
const sources = async (
  trusted: boolean | undefined,
  userSettings: boolean | undefined,
): Promise<unknown> => {
  const dir = folder();
  sdk.options = [];
  claude({ paths: [dir] }).create({
    uri: 'ahp-session:/sources',
    chatUri: 'ahp-chat:/sources',
    workingDirectory: dir,
    settings: {},
    ...(trusted === undefined ? {} : { trusted: () => trusted }),
    ...(userSettings === undefined ? {} : { userSettings }),
    // Nothing of this session's own is under test here: no client calls, and
    // the config schema an empty one.
    clientToolTimeoutMs: 0,
    schema: () => ({ type: 'object', properties: {} }),
    emit: () => {},
  }).sendMessage('t1', 'hello');
  await settle();
  const one = sdk.options.at(0);
  if (one === undefined) throw new Error('no query was built');
  return one.settingSources;
};

it('loads all three sources for a trusted folder and the person\'s settings', async () => {
  // The default, which is what every session did before the flag existed.
  expect(await sources(true, undefined)).toEqual(['user', 'project', 'local']);
});

it('loads the folder\'s own sources and none of the person\'s on request', async () => {
  // A bot's back session: its own `CLAUDE.md` reaches it, `~/.claude` does not.
  expect(await sources(true, false)).toEqual(['project', 'local']);
});

it('loads the person\'s settings alone in a folder nobody vouched for', async () => {
  expect(await sources(false, undefined)).toEqual(['user']);
});

it('loads no settings file at all when neither is allowed', async () => {
  // The empty list is how the CLI is told to read none: there is no other way
  // to say it, since an absent option loads all three.
  expect(await sources(false, false)).toEqual([]);
});
