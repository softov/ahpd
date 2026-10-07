import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { claude } from '../src/claude.js';

/*
 * What a session carries from a folder nobody vouched for.
 *
 * A folder carries things a model is made to obey and nobody has read: settings
 * with hooks that run on this host, MCP servers that are commands, a `CLAUDE.md`
 * that is instructions. None of it loads in a folder the host says is not
 * trusted - decision `a-folder-is-untrusted-until-a-client-says-otherwise` -
 * and all of it loads as before where the host says the folder is trusted.
 */

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
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
  for (let i = 0; i < times; i++) await new Promise((done) => { setTimeout(done, 0); });
};

/** A folder with a project of its own: one MCP server, in the file the CLI reads. */
const project = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'ahpd-trusted-'));
  made.push(dir);
  writeFileSync(join(dir, '.mcp.json'), JSON.stringify({
    mcpServers: { gmail: { type: 'http', url: 'https://mcp.example.com/gmail' } },
  }));
  return dir;
};

/** The `query()` options one session in that folder is built with. */
const created = async (
  dir: string,
  trusted: ((folder: string) => boolean) | undefined,
): Promise<Record<string, unknown>> => {
  sdk.options = [];
  claude({ paths: [dir] }).create({
    uri: 'ahp-session:/trust',
    chatUri: 'ahp-chat:/trust',
    workingDirectory: dir,
    settings: {},
    ...(trusted === undefined ? {} : { trusted }),
    // Nothing of this session's own is under test here: no client calls, and
    // the config schema an empty one.
    clientToolTimeoutMs: 0,
    schema: () => ({ type: 'object', properties: {} }),
    emit: () => {},
  });
  await settle();
  const one = sdk.options.at(0);
  if (one === undefined) throw new Error('no query was built');
  return one;
};

/** The servers a query was handed, by name. */
const declared = (options: Record<string, unknown>): string[] =>
  Object.keys((options.mcpServers ?? {}) as Record<string, unknown>);

it('loads none of a project\'s own files in a folder nobody vouched for', async () => {
  const options = await created(project(), () => false);

  // `['user']` alone: the project's settings and the local ones beside them are
  // dropped, and the hooks they declare with them - hooks are commands on this
  // host, which is the whole of why a folder nobody vouched for may not set one.
  expect(options.settingSources).toEqual(['user']);
  // The MCP server is not this host's to declare either, and the CLI is not
  // left to find it: a directory the host does not trust is one whose
  // `.mcp.json` is not read at all.
  expect(declared(options)).not.toContain('gmail');
});

it('leaves the project\'s CLAUDE.md unloaded, which is the same switch', async () => {
  const options = await created(project(), () => false);

  /*
   * The file itself is the CLI's to skip - it loads a project's `CLAUDE.md`
   * only when `project` is among the sources - so what this pins is the switch
   * that governs it. An untrusted folder that loaded it would be one whose
   * instructions reached the model with nobody having read them.
   */
  expect(options.settingSources).not.toContain('project');
});

it('loads them all in a folder the host vouched for', async () => {
  const options = await created(project(), () => true);

  // Named rather than left off, which is what the CLI defaults to: an answer
  // that says "all of them" is the one that can be read beside the other case.
  expect(options.settingSources).toEqual(['user', 'project', 'local']);
  expect(declared(options)).toContain('gmail');
});

it('loads none of them when the host said nothing at all', async () => {
  // Absent is the host saying nothing, and a folder nobody vouched for is
  // untrusted - the same reading `Start.trusted` asks a backend for.
  const options = await created(project(), undefined);
  expect(options.settingSources).toEqual(['user']);
  expect(declared(options)).not.toContain('gmail');
});
