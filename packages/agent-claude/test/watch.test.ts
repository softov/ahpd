import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createClaudeCustomizationWatcher } from '../src/session/watch.js';
import { WAIT_MS } from '../../../tools/wait.ts';

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
