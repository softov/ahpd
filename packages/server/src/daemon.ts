/** Starting one of these in the background, and finding it again. */

import { spawn } from 'node:child_process';
import { closeSync, openSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { daemonLog, daemonPath, ensureConfigDir } from './config.js';

/** What a detached daemon records about itself. */
export interface Running {
  pid: number;
  /** The origin it listens on, without the token. What every verb prints. */
  url: string;
  /**
   * The origin with the token in the query, for a person to copy out of the
   * 0600 record. This field carries the secret and `url` does not.
   */
  connectUrl: string;
  paths: string[];
  startedAt: string;
  /**
   * Where automations are kept and whether their schedules fire, in the
   * daemon's own words. Absent from a record an older daemon wrote.
   */
  automations?: string;
}

/** Is that process still there? A record outlives a crash, and says nothing about one. */
const alive = (pid: number): boolean => {
  // `0` and the negatives are not processes: to `kill` they mean process
  // *groups*, and pid 0 is the caller's own - which would report any record
  // holding one as running, and then signal this process rather than it.
  if (pid <= 0) return false;
  try {
    // Signal 0 checks for existence without asking the process to do anything.
    process.kill(pid, 0);
    return true;
  }
  catch { return false; }
};

/**
 * The daemon this user has running, if the record names one that still is.
 *
 * A stale record is cleared rather than reported: a `daemon.json` left behind
 * by a crash would otherwise have `start` refuse for ever, on the strength of
 * a process that is not there.
 *
 * This is the one reader of the record, and a caller printing one takes `url`:
 * `connectUrl` carries the secret and belongs on no line.
 */
export function running(): Running | undefined {
  let found: Running;
  try {
    found = JSON.parse(readFileSync(daemonPath(), 'utf8')) as Running;
  }
  catch { return undefined; }
  if (typeof found?.pid !== 'number' || !alive(found.pid)) {
    try { unlinkSync(daemonPath()); }
    catch { /* it was already gone, which is what was wanted */ }
    return undefined;
  }
  return found;
}

/**
 * The URL a person connects with: the announced origin, with the token in the
 * query when there is one.
 *
 * The one place the query is appended, and the only function that puts the
 * secret into a URL. `url` on the record stays the token-free origin, because
 * the verbs print it and stdout is a log.
 */
export function readyUrl(origin: string, token?: string): string {
  const base = `${origin.endsWith('/') ? origin.slice(0, -1) : origin}/`;
  // Encoded, because a token read from a file may hold anything.
  return token === undefined ? base : `${base}?tkn=${encodeURIComponent(token)}`;
}

/**
 * The record built from what the child announced.
 *
 * Pure, so the shape it writes is testable without spawning anything. The
 * origin and the directories come off its own announcement rather than off the
 * command line, because the directories may have come from the configuration
 * file and a record built from argv would name none of them.
 */
export function recordOf(announced: string, pid: number, token?: string): Running {
  const url = /ws:\/\/[^\s,]+/.exec(announced)?.[0] ?? announced;
  const automations = /^automations (.+)$/m.exec(announced)?.[1]?.trim();
  return {
    pid,
    url,
    connectUrl: readyUrl(url, token),
    paths: (/sessions in (.+)/.exec(announced)?.[1] ?? '')
      .trim().split(',').map((one) => one.trim()).filter((one) => one !== ''),
    startedAt: new Date().toISOString(),
    ...(automations !== undefined ? { automations } : {}),
  };
}

/**
 * The one line `status` prints about a running daemon.
 *
 * Built from `url` alone, which is the token-free origin: a record dump would
 * print `connectUrl` and with it the secret. The line is a function so a test
 * can hold it to that.
 */
export function statusLine(record: Running): string {
  return `ahpd on ${record.url} (pid ${String(record.pid)}), started ${record.startedAt}`;
}

/**
 * Start one in the background, and wait until it says where it is.
 *
 * Detached and with its streams let go, so it outlives the shell that started
 * it - which is the whole point, and the difference between this and running
 * `ahpd` in a terminal you then have to keep open.
 */
export async function start(argv: string[], self: string, token?: string): Promise<Running> {
  const already = running();
  if (already) throw new Error(`One is already running: ${already.url} (pid ${String(already.pid)})`);

  ensureConfigDir();
  /*
   * Where this run's output will start.
   *
   * The log is appended to across runs, so reading the whole file for an
   * address finds the *previous* daemon's - which is a record pointing at a
   * port this process never bound, and was.
   */
  const from = (() => {
    try { return statSync(daemonLog()).size; }
    catch { return 0; }
  })();
  /*
   * Its output goes to a file, not to a pipe held here.
   *
   * A pipe dies with the process holding its other end, and this process is
   * about to exit - so the daemon's next log line would kill it. A file also
   * leaves something to read when it misbehaves, which a background process
   * with no output at all does not.
   */
  const log = openSync(daemonLog(), 'a');
  const child = spawn(process.execPath, [self, ...argv], {
    detached: true,
    stdio: ['ignore', log, log],
  });
  child.unref();
  closeSync(log);

  /*
   * Wait for it to say where it is, by reading what it wrote.
   *
   * Polling rather than listening, because nothing here is holding its
   * output any more - which is exactly the point.
   */
  /** What it said about itself, so the record is its answer and not a guess. */
  let announced = '';
  await new Promise<string>((answer, fail) => {
    const gaveUp = Date.now() + 20_000;
    const look = (): void => {
      let said = '';
      try { said = readFileSync(daemonLog(), 'utf8').slice(from); }
      catch { /* not written yet */ }
      const found = /ws:\/\/[^\s,]+/.exec(said);
      if (found) { announced = said; answer(found[0]); return; }
      if (child.exitCode !== null) {
        fail(new Error(`it exited with ${String(child.exitCode)}. See ${daemonLog()}`));
        return;
      }
      if (Date.now() > gaveUp) {
        fail(new Error(`it started but never said where it was listening. See ${daemonLog()}`));
        return;
      }
      setTimeout(look, 100);
    };
    look();
  }).catch((error: unknown) => {
    if (child.pid !== undefined) {
      try { process.kill(child.pid, 'SIGKILL'); }
      catch { /* already gone */ }
    }
    throw error;
  });

  // It announced where it was listening, so it started; this is for the type
  // rather than for the case, and `0` must never reach the record.
  if (child.pid === undefined) throw new Error('it started but has no process id');
  const record = recordOf(announced, child.pid, token);
  writeFileSync(daemonPath(), `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  return record;
}

/** Stop it, and forget where it was. Answers what was stopped, or nothing. */
export function stop(): Running | undefined {
  const found = running();
  if (!found) return undefined;
  try { process.kill(found.pid, 'SIGTERM'); }
  catch { /* it went between the check and the signal, which is a stop */ }
  try { unlinkSync(daemonPath()); }
  catch { /* already gone */ }
  return found;
}
