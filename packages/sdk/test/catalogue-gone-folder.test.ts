import { WAIT_MS } from '../../../tools/wait.ts';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHost, firstMessage, flushed, hello, machine, peer, resetSdk, settle } from './support/host.js';
import { echo } from '../../../examples/echo/agent.js';
import { uriOf } from '../src/resources/fileuri.js';
import { memorySessions } from '../src/sessions/sessions.js';
import type { Agent, Listed } from '@ahpd/sdk';
import type { SessionStore } from '../src/types/sessions.js';

/*
 * A session whose folder has gone.
 *
 * A git worktree removed by hand leaves the session's record behind. Its row
 * carries the folders recorded for it all the same, as VS Code's listing
 * carries a session's recorded folders, so a client groups and opens the
 * session by the folder it ran in.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L14736
 */

vi.mock('@anthropic-ai/claude-agent-sdk', async () => (await import('./support/claude-sdk.js')).fake);

beforeEach(resetSdk);

const PATH = '/home/softov';

/** One row, as a backend answers it, naming the folder the session ran in. */
const row = (id: string, title: string, folder: string): Listed => ({
  id,
  title,
  createdAt: '2026-10-18T00:00:00.000Z',
  modifiedAt: '2026-10-18T09:00:00.000Z',
  workingDirectories: [folder],
});

/** A backend over the rows it lists. */
const backend = (provider: string, listed: Listed[]): Agent => ({
  ...echo({ path: PATH, pace: 0 }),
  provider,
  displayName: provider,
  directories: () => [PATH],
  list: async () => [...listed],
  transcript: async () => [],
});

/** A host, a client watching its root, and what that client was told. */
const watching = async (agents: Agent[], store: SessionStore = memorySessions()) => {
  const host = createHost({ path: PATH, agents, ...machine(), sessions: store });
  const p = peer();
  const client = host.accept(p);
  await client.handle(hello(['0.9.0'], { initialSubscriptions: ['ahp-root://'] }));
  return { client, notes: p.notes };
};

/**
 * Remove a folder a running session works in, as a person removes it by hand.
 *
 * Windows will not remove a folder that a process has as its working
 * directory, and the host runs `git -C` in a session's folder, each with a 2 s
 * timeout; on a busy runner several of them outlasted a fixed set of retries.
 * So the removal is retried until the case's own budget runs out, and a
 * failure on Windows names the processes the worker had started, so it says
 * what was holding the folder.
 */
const removeWhileRunning = async (folder: string): Promise<void> => {
  for (const until = Date.now() + WAIT_MS; ;) {
    try {
      rmSync(folder, { recursive: true, force: true });
      return;
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EBUSY' && (error as NodeJS.ErrnoException).code !== 'EPERM') throw error;
      if (Date.now() < until) {
        await new Promise((r) => { setTimeout(r, 100); });
        continue;
      }
      if (process.platform !== 'win32') throw error;
      const tree = execFileSync('powershell.exe', ['-NoProfile', '-Command', `$all = Get-CimInstance Win32_Process; $ids = @(${process.pid}); $found = @(); do { $kids = $all | Where-Object { $ids -contains $_.ParentProcessId -and $found.ProcessId -notcontains $_.ProcessId }; $found += $kids; $ids = @($kids.ProcessId) } while ($kids); $found | ForEach-Object { "$($_.Name) $($_.CommandLine)" }`]).toString().trim();
      throw new Error(`${(error as Error).message}; the worker's processes: ${tree === '' ? 'none' : tree}`);
    }
  }
};

/** The whole of what one listing answers. */
const list = async (client: { handle(request: unknown): Promise<unknown> }) =>
  await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } }) as {
    items: { resource: string; workingDirectories: string[] }[];
  };

/** A session recorded where it ran, as the store keeps it. */
const recorded = (store: SessionStore, id: string, folder: string): SessionStore => {
  store.setProvider(id, 'claude');
  store.setWorkingDirectory?.(id, folder);
  return store;
};

/** The folder the session worked in, under a root the test removes at the end. */
const workingRoot = () => {
  const root = mkdtempSync(join(tmpdir(), 'ahpd-gone-'));
  return { root, folder: join(root, 'worktree') };
};

describe('a folder that has gone', () => {
  it('stays in the row, the record and the opened session', async () => {
    const { root, folder } = workingRoot();
    try {
      mkdirSync(folder);
      // The record is written while the folder is there, and then the folder
      // is removed outside this host, as a worktree removed by hand is.
      const store = recorded(memorySessions(), 'gone', folder);
      rmSync(folder, { recursive: true, force: true });

      const { client } = await watching([backend('claude', [row('gone', 'Gone', uriOf(folder))])], store);

      const items = (await list(client)).items;
      expect(items.find((one) => one.resource === 'claude:/gone')?.workingDirectories).toEqual([uriOf(folder)]);
      expect(store.workingDirectory?.('gone')).toBe(folder);
      const opened = await client.handle({ method: 'subscribe', params: { channel: 'claude:/gone' } }) as {
        snapshot: { state: { workingDirectories: string[] } };
      };
      expect(opened.snapshot.state.workingDirectories).toEqual([uriOf(folder)]);
    }
    // Awaited, with retries: on Windows the host can hold the folder a moment longer.
    finally { await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
  });

  it('keeps a URI that names another machine', async () => {
    const folder = 'computer://box/workspaces/app';
    // A session this host ran in that machine.
    const store = memorySessions();
    store.setProvider('box', 'claude');
    const { client } = await watching([backend('claude', [row('box', 'Box', folder)])], store);
    expect((await list(client)).items[0]?.workingDirectories).toEqual([folder]);
  });

  it('stays in a running session\'s row', async () => {
    const { root, folder } = workingRoot();
    try {
      mkdirSync(folder);
      const { client, notes } = await watching([echo({ path: PATH, pace: 0 })]);
      await client.handle({
        method: 'createSession',
        params: { channel: 'ahp-session:/live', provider: 'echo', workingDirectories: [uriOf(folder)] },
      });
      // Announced at its first message, on the chat the host minted for it.
      const minted = ((await client.handle({ method: 'subscribe', params: { channel: 'ahp-session:/live' } })) as { snapshot: { state: { defaultChat: string } } }).snapshot.state.defaultChat;
      await firstMessage(client, minted);
      await settle(4);
      const added = notes.filter((one) => one.method === 'root/sessionAdded').at(-1)?.params as
        { summary?: { workingDirectories?: string[] } } | undefined;
      expect(added?.summary?.workingDirectories).toEqual([uriOf(folder)]);

      await removeWhileRunning(folder);
      await client.handle({
        method: 'dispatchAction',
        params: { channel: 'ahp-session:/live', action: { type: 'session/titleChanged', title: 'Gone' } },
      });
      await settle(4);
      await flushed();
      // The title moved and the folders did not.
      const moved = notes.filter((one) => one.method === 'root/sessionSummaryChanged').at(-1)?.params as
        { changes?: { title?: string; workingDirectories?: string[] } } | undefined;
      expect(moved?.changes?.title).toBe('Gone');
      expect(moved?.changes).not.toHaveProperty('workingDirectories');
      expect((await list(client)).items.find((one) => one.resource === 'ahp-session:/live')?.workingDirectories)
        .toEqual([uriOf(folder)]);
    }
    // Awaited, with retries: on Windows the host can hold the folder a moment longer.
    finally { await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
  });
});
