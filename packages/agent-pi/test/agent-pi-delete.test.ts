import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { piAgent } from '../src/agent.js';
import { forget, forgetSession, watch } from '../src/catalog.js';
import { loadPi } from '../src/pi.js';
import type { PiOptions, WatchedSession } from '../src/types.js';

/*
 * Deleting a pi session.
 *
 * pi has no delete of its own: the file `stateFile` names is the session as
 * far as pi is concerned, so removing it is the delete, and removing this
 * process's record of it is the half that makes the next listing agree.
 *
 * pi's own lookup is replaced here, because the two things worth testing are
 * what a delete does with the path the lookup answers and what it does with a
 * path the lookup answers badly - and the second one is not reachable through
 * a real store.
 */

const found = vi.hoisted(() => ({ at: undefined as string | undefined }));

vi.mock('@earendil-works/pi-coding-agent', () => ({
  SessionManager: {
    list: async () => [],
    findById: () => found.at,
    open: () => ({}),
    create: () => ({}),
  },
  // pi's own per-line parse, which `loadPi` takes from the module whether or
  // not a suite reads a session file through it.
  parseSessionEntries: (content: string) => content
    .split('\n')
    .filter((line) => line.trim() !== '')
    .flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } }),
  SettingsManager: { create: () => ({}) },
  createAgentSessionServices: async () => ({}),
  createAgentSessionFromServices: async () => ({ session: {} }),
  defineTool: (tool: unknown) => tool,
  ModelRuntime: { create: async () => ({ getAvailable: async () => [] }) },
  getAgentDir: () => '/nonexistent/pi-agent',
}));

vi.mock('@earendil-works/pi-ai', () => ({
  getSupportedThinkingLevels: () => ['off'],
  Type: { Unsafe: (schema: unknown) => schema },
}));

let root: string;
/** pi's session directory, and the file inside it the lookup will answer. */
let store: string;
let file: string;
let options: PiOptions;

beforeEach(async () => {
  await loadPi();
  root = mkdtempSync(join(tmpdir(), 'ahpd-pi-delete-'));
  store = join(root, 'sessions');
  mkdirSync(store, { recursive: true });
  file = join(store, 'pi-1.jsonl');
  writeFileSync(file, '{}\n');
  found.at = file;
  options = { sessionDir: store } as PiOptions;
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); forget(); });

it('removes the file pi keeps the session in', async () => {
  await forgetSession(options, 'pi', 'pi-1', root);

  expect(existsSync(file)).toBe(false);
});

it('is on the agent', async () => {
  const agent = piAgent(options, [root]);

  expect(agent.delete).toBeTypeOf('function');
  await agent.delete?.('pi-1', root);

  expect(existsSync(file)).toBe(false);
});

it('forgets a running session too, so the next listing does not offer it again', async () => {
  // pi keeps the record here, and `catalogue` lists what this process watched
  // over what is on disk - so a deleted session whose record stayed would come
  // back in the next listing, which is the bug this delete exists to close.
  watch('pi', {
    id: 'pi-1',
    title: 'one',
    createdAt: '2026-01-01T00:00:00.000Z',
    modifiedAt: '2026-01-01T00:00:00.000Z',
    directory: root,
    turns: [],
  } satisfies WatchedSession);

  await forgetSession(options, 'pi', 'pi-1', root);

  const { catalogue } = await import('../src/catalog.js');
  expect(await catalogue(options, 'pi', [root])).toEqual([]);
});

it('counts a session pi has no file for as deleted', async () => {
  // Nothing on disk: a session deleted twice, or a row for a project pi has no
  // store for. Neither is a failure - there is nothing left to remove.
  found.at = undefined;
  await expect(forgetSession(options, 'pi', 'gone', root)).resolves.toBeUndefined();

  // And with no directory at all, which is what a listed row may carry.
  found.at = file;
  await expect(forgetSession(options, 'pi', 'pi-1', undefined)).resolves.toBeUndefined();
  expect(existsSync(file)).toBe(true);
});

it('refuses a path outside pi\'s own session directory', async () => {
  // A lookup answering outside its store is not reachable through a real one,
  // which is the point: the caller named a session, and a session is a file
  // under pi's own directory.
  const away = join(root, 'elsewhere.jsonl');
  writeFileSync(away, '{}\n');
  found.at = away;

  await expect(forgetSession(options, 'pi', 'pi-1', root)).rejects.toThrow(/not one of pi/);

  expect(existsSync(away)).toBe(true);
});

it('keeps the rest of a provider\'s watched sessions', async () => {
  const two = { id: 'pi-2', title: 'two', createdAt: '2026-01-01T00:00:00.000Z', modifiedAt: '2026-01-01T00:00:00.000Z', directory: root, turns: [] } satisfies WatchedSession;
  watch('pi', two);

  await forgetSession(options, 'pi', 'gone', root);

  const { watchedSession } = await import('../src/catalog.js');
  expect(watchedSession('pi', 'pi-2')).toBe(two);
});