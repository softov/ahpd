import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';

/*
 * What a daemon with no backend does.
 *
 * The daemon bundles none of its own - decision `the-daemon-bundles-no-agent` -
 * so "no agent is configured" is an ordinary configuration, not an impossible
 * one, and what it costs has to be a startup that stops and says so rather
 * than a host that accepts clients it can never answer.
 *
 * A process, because `main.ts` runs the daemon on import and the exit code is
 * half of what is being checked.
 */

const REPO = join(import.meta.dirname, '..');

let home: string;
beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'ahpd-backend-')); });
afterEach(() => { rmSync(home, { recursive: true, force: true }); });

/**
 * The daemon on a pipe, answered with its exit code and what it said.
 *
 * Everything it says is on stderr here, because stdout is the protocol in
 * `--stdio` mode and a line written there would be a frame nobody sent.
 */
const run = async (config: Record<string, unknown>): Promise<{ code: number | null; said: string; path: string }> => {
  const path = join(home, 'config.json');
  writeFileSync(path, JSON.stringify({ paths: [], withoutConnectionToken: true, sessions: 'memory', automations: 'memory', ...config }));
  const child = spawn(
    process.execPath,
    ['--conditions', 'development', '--import', './scripts/dev.mjs', 'packages/server/src/main.ts', '--stdio', '--config-file', path],
    { cwd: REPO, env: { ...process.env, CI: '1' }, stdio: ['pipe', 'pipe', 'pipe'] },
  );
  // The peer's end of the pipe, closed at once: a host on stdio serves until
  // the client goes away, and this one has nothing to say to it. Without this
  // the run would have to be killed, and a killed process loses whatever it
  // had buffered for stdout - which is the announcement being read below.
  child.stdin.end();
  let said = '';
  child.stderr.on('data', (chunk: Buffer) => { said += String(chunk); });
  child.stdout.resume();
  return await new Promise((done) => {
    // A daemon that does start is one this test has to stop, so a run that
    // somehow sat on the pipe fails on an assertion rather than a timeout.
    const timer = setTimeout(() => { child.kill(); }, 4000);
    child.on('exit', (code) => { clearTimeout(timer); done({ code, said, path }); });
  });
};

it('refuses to start when nothing contributed a backend, and names the fix', async () => {
  const { code, said, path } = await run({});
  expect(code).toBe(1);
  expect(said).toContain('No backend is loaded');
  // The sentence is for somebody holding a configuration file, so it names
  // the key they have to edit, the file it is in, and a package they can put
  // in it. The file because this is the sentence an upgrade from a daemon
  // that bundled Claude ends at, and the one that was read is not always the
  // one under the configuration directory.
  expect(said).toContain('"plugins"');
  expect(said).toContain(path);
  expect(said).toContain('@ahpd/agent-claude');
});

it('starts when a plugin brought one', async () => {
  const { code, said } = await run({ plugins: ['./test/fixtures/plugin-echo'] });
  // It got as far as announcing itself, which is past the refusal, and then
  // ended the way a host on stdio ends: the peer at the other end left.
  expect(said).toContain('ahpd over stdio');
  expect(said).toContain('plugins echo-plugin');
  expect(said).not.toContain('No backend is loaded');
  expect(code).toBe(0);
}, 10000);
