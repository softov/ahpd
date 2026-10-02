/*
 * The daemon's policy switch, and where the rows it keeps live.
 *
 * Three things are under test and they are three different layers. The
 * configuration file is read in this process, so a wrong value is the same
 * refusal `usage.per` gets and nothing is spawned. The daemon is then run for
 * real, once to be told it refuses everybody but root and once to have a row
 * written through `policy://` - over stdio, where the connection is the host
 * itself and the gate stands aside. What the gate does to a person who does not
 * hold `policy:write` is `policy-scheme.test.ts`'s, and the refusals themselves
 * are `policy-checks.test.ts`'s; this file is about the wiring between the
 * configuration and the store.
 *
 * Every run gets a temporary configuration directory, so nothing here reads or
 * writes the configuration of whoever runs the suite.
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { configSchema, flagFields, optionsFrom } from '../src/commands/options.js';

const REPO = join(import.meta.dirname, '../../..');
const MAIN = 'packages/server/src/main.ts';

let home: string;
let config: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'ahpd-policy-option-'));
  mkdirSync(join(home, 'ahpd'), { recursive: true });
  config = join(home, 'config.json');
});
afterEach(() => { rmSync(home, { recursive: true, force: true }); });

/** The options a run would take with this file and no flags. */
const folded = (value: unknown) => {
  writeFileSync(config, JSON.stringify(value));
  return optionsFrom({ configFile: config });
};

/** What refusing this file said, or the case fails for the file being accepted. */
const refusal = (value: unknown): string => {
  try {
    folded(value);
  }
  catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error(`${JSON.stringify(value)} was accepted`);
};

it('reads the switch out of the file, and leaves it off when the file says nothing', () => {
  expect(folded({ policies: { check: true } }).policiesCheck).toBe(true);
  expect(folded({ policies: {} }).policiesCheck).toBe(false);
  expect(folded({}).policiesCheck).toBe(false);
});

it('refuses a check that is not a boolean, naming the file and the nested key', () => {
  // The same shape as a wrong `usage.per`: the daemon does not start on a
  // setting it cannot read.
  expect(refusal({ policies: { check: 'yes' } })).toBe(`${config}: policies.check must be true or false`);
});

it('has no flag for it, because a decision to refuse is the deployment\'s', () => {
  // The file-only set is what the registry builds its flags from, so a key
  // outside it would be typed on a command line. `usage` and `http` are in it
  // for the same reason.
  expect(Object.keys(flagFields)).not.toContain('policies');
  expect(configSchema.properties).toHaveProperty('policies.properties.check.type', 'boolean');
});

interface Answered {
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

/**
 * A daemon over stdio, and the frames it answered.
 *
 * Over stdio the wire is this process's stdout and the log is stderr, which is
 * what lets one handle do both: write a request, read the line back, and still
 * read what the daemon said about itself. A stdio daemon serves until the client
 * goes away, so the pipes are closed once the frames asked for have been
 * answered - which is what the case is about, and not the next turn.
 */
const daemon = (settings: Record<string, unknown>, frames: string[], waiting: number[]): Promise<{ stderr: string; answered: Answered[] }> => {
  writeFileSync(config, JSON.stringify({ plugins: ['./packages/server/test/fixtures/plugin-echo'], ...settings }));
  const child = spawn(
    process.execPath,
    [MAIN, '--stdio', '--config-file', config, '--no-update-check'],
    {
      cwd: REPO,
      env: { ...process.env, XDG_CONFIG_HOME: home, CI: '1', NODE_OPTIONS: '--conditions development --import ./scripts/dev.mjs' },
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );
  const answered: Answered[] = [];
  let stderr = '';
  let held = '';
  const close = (): void => { child.stdin.end(); };
  child.stderr.on('data', (chunk: Buffer) => { stderr += String(chunk); });
  child.stdout.on('data', (chunk: Buffer) => {
    held += String(chunk);
    // One frame is one line, and a frame that straddles two reads is one frame.
    let at = held.indexOf('\n');
    while (at !== -1) {
      const line = held.slice(0, at).trim();
      held = held.slice(at + 1);
      if (line.startsWith('{')) {
        const frame = JSON.parse(line) as Answered;
        if (frame.id !== undefined) answered.push(frame);
      }
      at = held.indexOf('\n');
    }
    if (waiting.every((one) => answered.some((frame) => frame.id === one))) close();
  });
  for (const frame of frames) child.stdin.write(`${frame}\n`);
  return new Promise((done) => {
    // The run is over when the client goes away, and a case that never gets
    // there is a case that failed rather than one that hung.
    const give = setTimeout(close, 10000);
    child.on('exit', () => {
      clearTimeout(give);
      done({ stderr, answered });
    });
  });
};

const HANDSHAKE = JSON.stringify({
  id: 1,
  method: 'initialize',
  params: { clientId: 'probe', protocolVersions: ['0.9.0'], initialSubscriptions: ['ahp-root://'] },
});

it('says at start that it is switched on with nothing in the store', async () => {
  const { stderr } = await daemon({ policies: { check: true } }, [HANDSHAKE], [1]);
  expect(stderr).toContain('the policy checks are on and the store holds no policy');
}, 30000);

it('says nothing when the switch is off, however empty the store is', async () => {
  const { stderr } = await daemon({}, [HANDSHAKE], [1]);
  expect(stderr).not.toContain('policy checks are on');
}, 30000);

it('keeps a row written through `policy:` beside the configuration, and reads it back', async () => {
  const write = JSON.stringify({
    id: 2,
    method: 'resourceWrite',
    params: {
      channel: 'ahp-root://',
      uri: 'policy://M1',
      data: JSON.stringify({ scope: 'all', kind: 'model', effect: 'allow', match: { model: ['deepseek/*'], proxy: ['local-vllm'] } }),
      encoding: 'utf-8',
    },
  });

  const first = await daemon({ policies: { check: true } }, [HANDSHAKE, write], [2]);
  expect(first.answered.find((one) => one.id === 2)?.error).toBeUndefined();

  // The row is a file beside the configuration, not in the folder the usage
  // records live in.
  const file = join(home, 'ahpd', 'policies.json');
  expect(existsSync(file)).toBe(true);
  expect(JSON.parse(readFileSync(file, 'utf-8'))).toMatchObject({ policies: [{ id: 'M1' }] });

  // A second daemon over the same directory reads it back, and this one has a
  // policy to show, so it is not the host that refuses everybody but root.
  const list = JSON.stringify({ id: 3, method: 'resourceList', params: { channel: 'ahp-root://', uri: 'policy://' } });
  const second = await daemon({ policies: { check: true } }, [HANDSHAKE, list], [3]);
  expect(second.stderr).not.toContain('the policy checks are on');
  expect(second.answered.find((one) => one.id === 3)?.result).toMatchObject({ entries: [{ name: 'M1', type: 'file' }] });
}, 60000);