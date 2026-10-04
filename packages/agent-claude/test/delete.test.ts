import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { claude } from '../src/claude.js';
import { forgetSession, transcriptOf } from '../src/catalog.js';

/*
 * Deleting a Claude session.
 *
 * The SDK removes `<id>.jsonl` and the `<id>/` folder its subagents wrote, and
 * throws when neither is there. What matters here is that a throw means one of
 * two things - the session is already gone, or the store would not let go of
 * it - and this backend tells them apart by looking at the store, because
 * which of the SDK's throws it is has never been a stable thing to read off
 * the message.
 */

let root: string;
let config: string;
/** Where a session ran, and the folder the CLI spells that directory as. */
const ran = '/home/softov';
const elsewhere = '/home/elsewhere';
const project = (dir: string): string => join(config, 'projects', dir.replace(/[^A-Za-z0-9]/g, '-'));

const was = process.env.CLAUDE_CONFIG_DIR;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ahpd-claude-delete-'));
  config = join(root, '.claude');
  mkdirSync(project(ran), { recursive: true });
  mkdirSync(project(elsewhere), { recursive: true });
  process.env.CLAUDE_CONFIG_DIR = config;
});
afterEach(() => {
  if (was === undefined) delete process.env.CLAUDE_CONFIG_DIR;
  else process.env.CLAUDE_CONFIG_DIR = was;
  // The mode is put back before the tree goes, so a directory this file made
  // unreadable does not stop the next test's cleanup.
  for (const dir of [ran, elsewhere]) if (existsSync(project(dir))) chmodSync(project(dir), 0o755);
  rmSync(root, { recursive: true, force: true });
});

/** A session on disk, transcript and subagent folder, as the CLI leaves it. */
const written = (id: string, dir = ran): string => {
  const file = join(project(dir), `${id}.jsonl`);
  writeFileSync(file, `${JSON.stringify({ type: 'summary', summary: 'probe', sessionId: id, cwd: dir })}\n`);
  mkdirSync(join(project(dir), id), { recursive: true });
  writeFileSync(join(project(dir), id, 'agent-1.jsonl'), '{"type":"summary"}\n');
  return file;
};

const ONE = '11111111-1111-4111-8111-111111111111';
const TWO = '22222222-2222-4222-8222-222222222222';
const THREE = '33333333-3333-4333-8333-333333333333';
const FOUR = '44444444-4444-4444-8444-444444444444';

it('removes the transcript and the subagent folder it wrote under', async () => {
  const file = written(ONE);

  await forgetSession(ONE, ran);

  expect(existsSync(file)).toBe(false);
  expect(existsSync(join(project(ran), ONE))).toBe(false);
  expect(transcriptOf(ONE, ran)).toBeUndefined();
});

it('deletes a session it has no directory for, by looking through every project', async () => {
  const file = written(TWO);

  await forgetSession(TWO, undefined);

  expect(existsSync(file)).toBe(false);
});

it('deletes a session whose transcript is in another project than it ran in', async () => {
  // Written under the directory it started in, which is what resuming a
  // session from somewhere else leaves behind.
  const file = written(THREE, elsewhere);

  await forgetSession(THREE, ran);

  expect(existsSync(file)).toBe(false);
});

it('counts a session the store does not have as deleted', async () => {
  await expect(forgetSession(FOUR, ran)).resolves.toBeUndefined();
  // And again, which is what a second `rm` of the same row does.
  await expect(forgetSession(FOUR, ran)).resolves.toBeUndefined();
});

it('counts a session whose subagent folder is already gone as deleted', async () => {
  const file = written(ONE);
  rmSync(join(project(ran), ONE), { recursive: true, force: true });

  await expect(forgetSession(ONE, ran)).resolves.toBeUndefined();
  expect(existsSync(file)).toBe(false);
});

it('refuses an id that is not a filename', () => {
  // A client may name anything at all, and one id would be a path out of the
  // store - so this is answered as "no such file", not used.
  expect(transcriptOf('../../etc/passwd', ran)).toBeUndefined();
  expect(transcriptOf('a/b', ran)).toBeUndefined();
});

it('raises a delete that failed, rather than reporting a session as gone', async () => {
  written(ONE);
  // Findable and not removable: the file is still there after the SDK gives
  // up, which is what says this was not a not-found.
  chmodSync(project(ran), 0o555);

  await expect(forgetSession(ONE, ran)).rejects.toThrow();
  expect(existsSync(join(project(ran), `${ONE}.jsonl`))).toBe(true);
});

it('is on the agent, for every variant of it', async () => {
  // One factory serves the built-in provider and every preset a plugin
  // resolves, so the hook is here rather than spelled per variant - a preset
  // that could not delete would be the bug this plan fixes, in a variant
  // nobody would think to check.
  const file = written(TWO);
  const agent = claude({ paths: [ran] });

  expect(agent.delete).toBeTypeOf('function');
  await agent.delete?.(TWO, ran);

  expect(existsSync(file)).toBe(false);
});
