import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { uriOf } from '@ahpd/sdk';

/*
 * The folder a session works in, as the URI the host reads back.
 *
 * Every `file:` URI this backend sends was `` `file://${cwd}` `` - the path as
 * it is - and a folder called `C# a b` reaches the host as a URI that names a
 * different folder twice over: a reader that treats `#` as a fragment opens
 * `C`, and one that takes the text literally opens a directory called `C# a b`
 * where the real name has a space in it. `lifecycle.ts:731` is where that
 * shows: a `!` command runs in the directory the host read.
 */

const sdk = vi.hoisted(() => ({ options: [] as Record<string, unknown>[] }));

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

const { createSession } = await import('../src/session.js');

let made: string[] = [];
afterEach(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
  made = [];
});

it('reports the folder it works in as a URI a host reads back as that folder', () => {
  const root = mkdtempSync(join(tmpdir(), 'ahpd-claude-uris-'));
  made.push(root);
  const where = join(root, 'C# a b');
  mkdirSync(where);
  const session = createSession({
    uri: 'ahp-session:/uris',
    chatUri: 'ahp-chat:/uris',
    cwd: where,
    emit: () => {},
    settings: {},
  });
  const asked = [uriOf(where)];
  expect(session.workingDirectories()).toEqual(asked);
  expect((session.sessionState() as { workingDirectories: string[] }).workingDirectories).toEqual(asked);
  expect((session.chatState() as { workingDirectories: string[] }).workingDirectories).toEqual(asked);
  session.close();
});
