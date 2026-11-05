import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import type { McpServer } from '@ahpd/sdk';
import { claude } from '../src/claude.js';

/*
 * The MCP servers the host offers every session reach a Claude session.
 *
 * The daemon's `mcpServers`, with the servers its client plugins contribute,
 * arrive as `Start.mcpServers`. The CLI is told to skip a plugin's own servers
 * and does not read the daemon's configuration at all, so a server the session
 * is not declared here is one its agent never has.
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
  const dir = mkdtempSync(join(tmpdir(), 'ahpd-host-servers-'));
  made.push(dir);
  writeFileSync(join(dir, '.mcp.json'), JSON.stringify({
    mcpServers: { gmail: { type: 'http', url: 'https://mcp.example.com/gmail' } },
  }));
  return dir;
};

/** The servers one session in `dir` is declared, and what its backend said. */
const declared = async (
  dir: string,
  servers: Record<string, McpServer>,
  trusted: boolean,
): Promise<{ servers: Record<string, Record<string, unknown>>; said: string[] }> => {
  sdk.options = [];
  const said: string[] = [];
  claude({ paths: [dir], log: (line) => { said.push(line); } }).create({
    uri: 'ahp-session:/host-servers',
    chatUri: 'ahp-chat:/host-servers',
    workingDirectory: dir,
    settings: {},
    trusted: () => trusted,
    mcpServers: servers,
    clientToolTimeoutMs: 0,
    schema: () => ({ type: 'object', properties: {} }),
    emit: () => {},
  }).sendMessage('t1', 'hello');
  await settle();
  const one = sdk.options.at(0);
  if (one === undefined) throw new Error('no query was built');
  return { servers: (one.mcpServers ?? {}) as Record<string, Record<string, unknown>>, said };
};

it("declares the host's servers beside the ones the CLI's own files name", async () => {
  const { servers } = await declared(project(), {
    issues: { type: 'http', url: 'http://127.0.0.1:9310/mcp', headers: { Authorization: 'Bearer token' } },
    files: { type: 'stdio', command: 'mcp-server-filesystem', args: ['/srv'], env: { TOKEN: 'secret' } },
  }, true);

  expect(servers['issues']).toEqual({ type: 'http', url: 'http://127.0.0.1:9310/mcp', headers: { Authorization: 'Bearer token' } });
  expect(servers['files']).toEqual({ type: 'stdio', command: 'mcp-server-filesystem', args: ['/srv'], env: { TOKEN: 'secret' } });
  expect(servers['gmail']).toEqual({ type: 'http', url: 'https://mcp.example.com/gmail' });
});

it("hands the SDK the host's server for a name the project's file uses too, and leaves the clash to the CLI", async () => {
  const { servers } = await declared(project(), { gmail: { type: 'http', url: 'https://host.example.com/gmail' } }, true);
  // The CLI reads the project's file itself, and its own precedence weighs that
  // server against the one it was handed.
  expect(servers['gmail']).toEqual({ type: 'http', url: 'https://host.example.com/gmail' });
});

it("declares the host's servers in a folder nobody vouched for, and leaves out one that starts elsewhere, saying so", async () => {
  const dir = project();
  const { servers, said } = await declared(dir, {
    here: { type: 'stdio', command: 'mcp-here', cwd: dir },
    elsewhere: { type: 'stdio', command: 'mcp-elsewhere', cwd: '/srv' },
  }, false);

  // The folder's own file is not read, and the host's own servers are.
  expect(servers).not.toHaveProperty('gmail');
  expect(servers).not.toHaveProperty('elsewhere');
  // The CLI starts it in the session's folder, which is the one it names.
  expect(servers['here']).toEqual({ type: 'stdio', command: 'mcp-here' });
  expect(said.some((line) => line.includes('elsewhere') && line.includes('/srv'))).toBe(true);
});
