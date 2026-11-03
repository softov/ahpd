/*
 * Every grant this daemon requires, as the root state advertises it.
 *
 * A role editor draws its subjects and chips from `_meta['ahpd.grants']`, on
 * the handshake and on the root state, so a grant that is not on that map
 * cannot be given to a role at all. The daemon's own channels and the bot
 * plugin are both here: the clients and tunnels channels are the daemon's, and
 * the bot is a plugin this configuration names as any other.
 *
 * The daemon runs as a process, because the map under test is the one the
 * daemon itself publishes and not one a case built.
 */

import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';

const REPO = join(import.meta.dirname, '../../..');
const MAIN = 'packages/server/src/main.ts';
/** A backend, so the daemon has an agent to serve and reaches its handshake. */
const ECHO = './packages/server/test/fixtures/plugin-echo';
/** The plugin that registers `bot:chat`. */
const BOT = './packages/bot/src/index.ts';

/** One entry of the advertised map, as a role editor reads it. */
interface Advertised {
  title?: string;
  description?: string;
  operations?: string[];
  groups?: { read?: string[]; write?: string[] };
}

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'ahpd-grants-'));
  mkdirSync(join(home, 'ahpd'), { recursive: true });
  writeFileSync(join(home, 'config.json'), JSON.stringify({ plugins: [ECHO, BOT] }));
});
afterEach(() => { rmSync(home, { recursive: true, force: true }); });

/** The child's own directories, so nothing reads the configuration of whoever runs the suite. */
const environment = (): NodeJS.ProcessEnv => ({
  ...process.env,
  XDG_CONFIG_HOME: home,
  XDG_DATA_HOME: join(home, 'data'),
  XDG_STATE_HOME: join(home, 'state'),
  XDG_CACHE_HOME: join(home, 'cache'),
  CI: '1',
  NODE_OPTIONS: '--conditions development --import ./scripts/dev.mjs',
});

const HANDSHAKE = JSON.stringify({
  id: 1,
  method: 'initialize',
  params: { clientId: 'probe', protocolVersions: ['0.9.0'], initialSubscriptions: ['ahp-root://'] },
});

/** The map on the handshake, from a daemon started for this one question. */
const advertised = (): Promise<Record<string, Advertised>> => new Promise((done, fail) => {
  const child = spawn(
    process.execPath,
    [MAIN, '--stdio', '--config-file', join(home, 'config.json'), '--no-update-check'],
    { cwd: REPO, env: environment(), stdio: ['pipe', 'pipe', 'pipe'] },
  );
  let held = '';
  let said = '';
  let answered = false;
  const give = setTimeout(() => { child.stdin.end(); }, 20000);
  child.stderr.on('data', (chunk: Buffer) => { said += String(chunk); });
  child.stdout.on('data', (chunk: Buffer) => {
    held += String(chunk);
    let at = held.indexOf('\n');
    while (at !== -1) {
      const line = held.slice(0, at);
      held = held.slice(at + 1);
      at = held.indexOf('\n');
      let frame: { id?: number; result?: { _meta?: Record<string, unknown> } };
      try {
        frame = JSON.parse(line) as typeof frame;
      }
      catch {
        continue;
      }
      if (frame.id !== 1 || answered) continue;
      answered = true;
      clearTimeout(give);
      const grants = frame.result?._meta?.['ahpd.grants'];
      // The map is the same to everybody, so the question goes away with it.
      child.stdin.end();
      done((grants ?? {}) as Record<string, Advertised>);
    }
  });
  child.on('exit', (code) => {
    if (answered) return;
    clearTimeout(give);
    fail(new Error(`the daemon exited ${String(code)} before the handshake:\n${said}`));
  });
  child.stdin.write(`${HANDSHAKE}\n`);
});

it('advertises the grants the daemon and the bot require, with the groups the table gives them', async () => {
  const grants = await advertised();

  // The daemon's own two channels, registered where it builds them.
  expect(grants['client']).toMatchObject({ title: 'Clients', operations: ['drop'] });
  expect(grants['tunnel']).toMatchObject({ title: 'Tunnels', operations: ['put', 'delete'] });
  // The command over the channels that offer operations, which the daemon
  // serves itself beside them.
  expect(grants['operation']).toMatchObject({ title: 'Operations', operations: ['invoke'] });
  // The bot plugin registers the one operation it asks for, beside the
  // resource operations its provider serves, and the entry's title comes from
  // that provider's `describe`.
  expect(grants['bot']).toMatchObject({ title: 'Bot', operations: expect.arrayContaining(['chat']) });

  // `apply` and `reload` are table operations now, and `plugin:write` is the
  // group that holds them.
  expect(grants['plugin']?.operations).toEqual(expect.arrayContaining(['apply', 'reload']));
  expect(grants['plugin']?.groups?.write).toEqual(expect.arrayContaining(['apply', 'reload']));
  // `install` stays out of both groups, so `plugin:write` still does not hold it.
  expect(grants['plugin']?.groups?.write).not.toContain('install');
}, 60000);
