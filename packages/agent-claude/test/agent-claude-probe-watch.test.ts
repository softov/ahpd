import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, it, vi } from 'vitest';

/*
 * A probe's own CLI calls for no probe, whatever it writes.
 *
 * The probe of what the agent offers starts a CLI, and the watch of the
 * personal folder calls for a probe when a customization there changes. A CLI
 * that wrote there as it started would call for the next probe, whose CLI
 * would write again; so every probe's watch is quiet while a probe's own CLI
 * is up, from before it starts to after it exits. The CLI here writes in the
 * plugins folder as it starts and as it stops, files the watch calls for when
 * anything else writes them.
 */

const at = vi.hoisted(() => ({ config: '' }));

/** What the CLI writes where the watch looks, as a CLI might at any start or stop. */
const writeAll = (): void => {
  writeFileSync(join(at.config, 'plugins', 'known_marketplaces.json'), '{}\n');
  writeFileSync(join(at.config, 'plugins', 'installed_plugins.json'), '{}\n');
  writeFileSync(join(at.config, 'plugins', 'marketplaces', 'tools', 'FETCH_HEAD'), 'ref\n');
};

vi.mock('@anthropic-ai/claude-agent-sdk', async () => (await import('../../sdk/test/support/warmed.js')).warmed({
  query: () => {
    writeAll();
    return {
      initializationResult: async () => ({ models: [], commands: [] }),
      mcpServerStatus: async () => [],
      reloadSkills: async () => ({ skills: [] }),
      reloadPlugins: async () => ({ plugins: [] }),
      close: () => { writeAll(); },
      // A process takes a while to go once it is told to.
      [Symbol.asyncDispose]: () => new Promise<void>((done) => { setTimeout(done, 50); }),
    };
  },
}));

const home = mkdtempSync(join(tmpdir(), 'ahpd-probe-watch-'));
at.config = join(home, 'config');
mkdirSync(join(at.config, 'plugins', 'marketplaces', 'tools'), { recursive: true });
mkdirSync(join(home, 'work'));
const before = process.env.CLAUDE_CONFIG_DIR;
process.env.CLAUDE_CONFIG_DIR = at.config;
afterAll(() => {
  if (before === undefined) delete process.env.CLAUDE_CONFIG_DIR;
  else process.env.CLAUDE_CONFIG_DIR = before;
  rmSync(home, { recursive: true, force: true });
});

const { claude } = await import('../src/claude.js');

const pause = (ms: number): Promise<void> => new Promise((done) => { setTimeout(done, ms); });

it('calls for no probe for what a probe\'s own CLI writes, and for the same files written after it', async () => {
  const agent = claude({ paths: [join(home, 'work')] });
  let calls = 0;
  const stop = agent.probeChanged?.(() => { calls += 1; });
  try {
    await pause(100);
    await agent.probe?.();
    await pause(900);
    expect(calls).toBe(0);
    // The same file, written by anything but a probe's CLI, is a change.
    writeFileSync(join(at.config, 'plugins', 'installed_plugins.json'), '{"version":2}\n');
    for (let waited = 0; waited < 5000 && calls === 0; waited += 50) await pause(50);
    expect(calls).toBe(1);
  }
  finally { stop?.(); }
});
