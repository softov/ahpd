import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FSWatcher } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createClaudeCustomizationWatcher } from '../src/session/watch.js';
import { WAIT_MS } from '../../../tools/wait.ts';

/*
 * Every `fs.watch` the watcher opens, counted: how many were opened, how many
 * are open now, and each handle by the folder it is on, so a case can make one
 * fail. A handle counts as closed once, at its first `close()`.
 */
const fsw = vi.hoisted(() => ({ opened: 0, open: 0, handles: [] as { at: string; handle: FSWatcher }[] }));
vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs')>();
  const watch = ((...args: Parameters<typeof real.watch>) => {
    const handle = real.watch(...args);
    fsw.opened += 1;
    fsw.open += 1;
    fsw.handles.push({ at: String(args[0]), handle });
    const close = handle.close.bind(handle);
    let shut = false;
    handle.close = () => {
      if (!shut) { shut = true; fsw.open -= 1; }
      close();
    };
    return handle;
  }) as typeof real.watch;
  return { ...real, watch, default: { ...real, watch } };
});

/*
 * The watcher of a session's Claude folders, on real folders.
 *
 * A watch is told of a change some time after it, and a call comes 300 ms
 * after the last one, so each case waits for the calls it expects and then a
 * while longer for any it does not.
 */

const made: string[] = [];
const stops: (() => void)[] = [];
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const fresh = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'ahpd-watch-'));
  made.push(root);
  return root;
};

const pause = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

/** Wait until `count()` is at least `want`, or until `WAIT_MS` passed by the clock. */
async function until(count: () => number, want: number): Promise<void> {
  const end = Date.now() + WAIT_MS;
  while (count() < want && Date.now() < end) await pause(50);
}

/** Watch `roots`, counting the calls, after the watch had time to start. */
async function watched(roots: { configDir: string; cwd?: string; waitMs?: number }): Promise<{ calls: () => number; stop: () => void }> {
  let calls = 0;
  const stop = createClaudeCustomizationWatcher(roots, () => { calls += 1; });
  stops.push(stop);
  await pause(100);
  return { calls: () => calls, stop };
}

describe('the watcher of the Claude folders', () => {
  it('calls for an agent written into the personal folder, and a skill into the project one', async () => {
    const root = fresh();
    const config = join(root, 'config');
    const work = join(root, 'work');
    mkdirSync(join(config, 'agents'), { recursive: true });
    mkdirSync(join(work, '.claude', 'skills', 'build'), { recursive: true });
    const { calls } = await watched({ configDir: config, cwd: work });
    writeFileSync(join(config, 'agents', 'scout.md'), '---\nname: scout\n---\n');
    await until(calls, 1);
    expect(calls()).toBe(1);
    writeFileSync(join(work, '.claude', 'skills', 'build', 'SKILL.md'), '---\nname: build\n---\n');
    await until(calls, 2);
    expect(calls()).toBe(2);
    writeFileSync(join(work, 'CLAUDE.md'), '# Project\n');
    await until(calls, 3);
    expect(calls()).toBe(3);
  });

  it('does not call for a file the CLI keeps for itself', async () => {
    const root = fresh();
    mkdirSync(join(root, 'projects', 'one'), { recursive: true });
    mkdirSync(join(root, 'todos'), { recursive: true });
    const work = join(root, 'work');
    mkdirSync(work);
    const { calls } = await watched({ configDir: root, cwd: work });
    writeFileSync(join(root, 'projects', 'one', 'session.jsonl'), '{}\n');
    writeFileSync(join(root, 'todos', 'list.json'), '[]\n');
    writeFileSync(join(work, 'index.ts'), 'export {};\n');
    await pause(900);
    expect(calls()).toBe(0);
  });

  /*
   * The project's MCP servers are a customization source at the top of the
   * working directory, which VS Code's Claude watcher triggers on.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/customizations/claudeSessionCustomizationDiscovery.ts#L461-L520
   */
  it('calls for the working directory\'s .mcp.json', async () => {
    const root = fresh();
    const work = join(root, 'work');
    mkdirSync(work);
    const { calls } = await watched({ configDir: join(root, 'config'), cwd: work });
    writeFileSync(join(work, '.mcp.json'), '{ "mcpServers": {} }\n');
    await until(calls, 1);
    expect(calls()).toBe(1);
  });

  /*
   * The plugins folder whole, as VS Code's Claude watcher triggers on it.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/customizations/claudeSessionCustomizationDiscovery.ts#L443-L452
   */
  it('calls for every change in the plugins folder, its subfolders among them', async () => {
    const root = fresh();
    mkdirSync(join(root, 'plugins', 'marketplaces', 'tools'), { recursive: true });
    const { calls } = await watched({ configDir: root });
    writeFileSync(join(root, 'plugins', 'known_marketplaces.json'), '{}\n');
    await until(calls, 1);
    expect(calls()).toBe(1);
    writeFileSync(join(root, 'plugins', 'marketplaces', 'tools', 'plugin.json'), '{}\n');
    await until(calls, 2);
    expect(calls()).toBe(2);
  });

  it('drops a change told while it is quiet, and calls for one after', async () => {
    const root = fresh();
    mkdirSync(join(root, 'plugins', 'marketplaces', 'tools'), { recursive: true });
    let quiet = true;
    let calls = 0;
    stops.push(createClaudeCustomizationWatcher({ configDir: root }, () => { calls += 1; }, () => quiet));
    await pause(100);
    writeFileSync(join(root, 'plugins', 'installed_plugins.json'), '{}\n');
    writeFileSync(join(root, 'plugins', 'marketplaces', 'tools', 'plugin.json'), '{}\n');
    await pause(900);
    expect(calls).toBe(0);
    quiet = false;
    writeFileSync(join(root, 'plugins', 'known_marketplaces.json'), '{}\n');
    await until(() => calls, 1);
    expect(calls).toBe(1);
  });

  it('does not call for the files the CLI rewrites in a synced skills folder, and calls for a skill there', async () => {
    const root = fresh();
    const bucket = join(root, 'skills', 'synced', 'org_user');
    mkdirSync(join(bucket, 'docs'), { recursive: true });
    const { calls } = await watched({ configDir: root });
    writeFileSync(join(bucket, 'manifest.json'), '{}\n');
    writeFileSync(join(bucket, '.last-complete-round'), 'round\n');
    await pause(900);
    expect(calls()).toBe(0);
    writeFileSync(join(bucket, 'docs', 'SKILL.md'), '---\nname: docs\n---\n');
    await until(calls, 1);
    expect(calls()).toBe(1);
  });

  it('calls once for a burst of changes', async () => {
    const root = fresh();
    mkdirSync(join(root, 'commands'));
    const { calls } = await watched({ configDir: root });
    for (let at = 0; at < 5; at += 1) writeFileSync(join(root, 'commands', `c${at}.md`), `# ${at}\n`);
    await until(calls, 1);
    await pause(700);
    expect(calls()).toBe(1);
  });

  it('calls after the quiet the record\'s watchWaitMs names', async () => {
    const root = fresh();
    mkdirSync(join(root, 'commands'));
    const { calls } = await watched({ configDir: root, waitMs: 20 });
    writeFileSync(join(root, 'commands', 'a.md'), '# a\n');
    await pause(200);
    writeFileSync(join(root, 'commands', 'b.md'), '# b\n');
    await until(calls, 2);
    await pause(400);
    // Two changes 200 ms apart are two bursts after a 20 ms quiet, where 300 ms makes them one.
    expect(calls()).toBe(2);
  });

  it('starts to watch a folder when it appears', async () => {
    const root = fresh();
    const config = join(root, 'config');
    const work = join(root, 'work');
    mkdirSync(work);
    const { calls } = await watched({ configDir: config, cwd: work });
    mkdirSync(join(config, 'agents'), { recursive: true });
    await until(calls, 1);
    writeFileSync(join(config, 'agents', 'scout.md'), '---\nname: scout\n---\n');
    await until(calls, 2);
    expect(calls()).toBe(2);
    mkdirSync(join(work, '.claude', 'rules'), { recursive: true });
    await until(calls, 3);
    writeFileSync(join(work, '.claude', 'rules', 'api.md'), '# Api\n');
    await until(calls, 4);
    expect(calls()).toBe(4);
  });

  it('calls nothing after it is closed, also for a change it had not called for yet', async () => {
    const root = fresh();
    mkdirSync(join(root, 'agents'));
    const { calls, stop } = await watched({ configDir: root });
    writeFileSync(join(root, 'agents', 'scout.md'), '---\nname: scout\n---\n');
    await pause(100);
    stop();
    writeFileSync(join(root, 'agents', 'other.md'), '---\nname: other\n---\n');
    await pause(900);
    expect(calls()).toBe(0);
  });

  it('watches the home folder\'s .claude once, as the personal folder', async () => {
    const root = fresh();
    mkdirSync(join(root, '.claude', 'agents'), { recursive: true });
    const { calls } = await watched({ configDir: join(root, '.claude'), cwd: root });
    writeFileSync(join(root, '.claude', 'agents', 'scout.md'), '---\nname: scout\n---\n');
    await until(calls, 1);
    writeFileSync(join(root, 'CLAUDE.md'), '# Home\n');
    await until(calls, 2);
    await pause(700);
    expect(calls()).toBe(2);
  });

  it('throws nothing for folders it cannot watch', () => {
    const root = fresh();
    const stop = createClaudeCustomizationWatcher({ configDir: join(root, 'no', 'such'), cwd: join(root, 'missing') }, () => undefined);
    expect(stop).not.toThrow();
  });
});

/*
 * One handle per folder, however many watchers hold it: each preset's probe
 * and each session watch the same personal folder, and the sessions of one
 * project the same project.
 */
describe('the handles of the Claude folders', () => {
  /** A personal folder with `agents`, and a working directory with a project `.claude/skills`. */
  const folders = (): { config: string; work: string } => {
    const root = fresh();
    const config = join(root, 'config');
    const work = join(root, 'work');
    mkdirSync(join(config, 'agents'), { recursive: true });
    mkdirSync(join(work, '.claude', 'skills'), { recursive: true });
    return { config, work };
  };

  it('opens each folder once for two watchers of the same folders, and calls both for one change', async () => {
    const { config, work } = folders();
    const before = fsw.opened;
    const one = await watched({ configDir: config, cwd: work });
    const first = fsw.opened - before;
    expect(first).toBeGreaterThan(0);
    const two = await watched({ configDir: config, cwd: work });
    expect(fsw.opened - before).toBe(first);
    writeFileSync(join(config, 'agents', 'scout.md'), '---\nname: scout\n---\n');
    await until(one.calls, 1);
    await until(two.calls, 1);
    await pause(700);
    expect([one.calls(), two.calls()]).toEqual([1, 1]);
  });

  it('keeps calling one watcher when the other closes, and closes the handles with the last', async () => {
    const { config, work } = folders();
    const open = fsw.open;
    const one = await watched({ configDir: config, cwd: work });
    const two = await watched({ configDir: config, cwd: work });
    one.stop();
    expect(fsw.open).toBeGreaterThan(open);
    writeFileSync(join(work, '.claude', 'skills', 'build.md'), '# Build\n');
    await until(two.calls, 1);
    await pause(700);
    expect([one.calls(), two.calls()]).toEqual([0, 1]);
    two.stop();
    expect(fsw.open).toBe(open);
  });

  it('shares no handle between two personal folders', async () => {
    const a = folders();
    const b = folders();
    const before = fsw.opened;
    await watched({ configDir: a.config });
    const first = fsw.opened - before;
    await watched({ configDir: b.config });
    expect(fsw.opened - before).toBe(2 * first);
  });

  it('hears a folder removed and made again, in both watchers', async () => {
    const { config } = folders();
    const one = await watched({ configDir: config });
    const two = await watched({ configDir: config });
    rmSync(join(config, 'agents'), { recursive: true, force: true });
    mkdirSync(join(config, 'agents'));
    // The removal and the making are a change of their own.
    await until(one.calls, 1);
    await until(two.calls, 1);
    await pause(700);
    const was = [one.calls(), two.calls()];
    writeFileSync(join(config, 'agents', 'scout.md'), '---\nname: scout\n---\n');
    await until(one.calls, (was[0] ?? 0) + 1);
    await until(two.calls, (was[1] ?? 0) + 1);
    expect([one.calls(), two.calls()]).toEqual([(was[0] ?? 0) + 1, (was[1] ?? 0) + 1]);
  });

  it('drops a handle that fails for both watchers, and throws nothing', async () => {
    const { config } = folders();
    const one = await watched({ configDir: config });
    const two = await watched({ configDir: config });
    const open = fsw.open;
    const agents = fsw.handles.filter((one) => one.at === join(config, 'agents')).at(-1);
    expect(agents).toBeDefined();
    expect(() => agents?.handle.emit('error', new Error('gone'))).not.toThrow();
    expect(fsw.open).toBe(open - 1);
    writeFileSync(join(config, 'agents', 'scout.md'), '---\nname: scout\n---\n');
    await pause(700);
    expect([one.calls(), two.calls()]).toEqual([0, 0]);
  });
});
