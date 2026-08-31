/** Starting one of these in the background, and finding it again. */

import { spawn } from 'node:child_process';
import { closeSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { daemonLog, daemonPath, ensureConfigDir } from './config.js';

/** What a detached daemon records about itself. */
export interface Running {
  pid: number;
  url: string;
  paths: string[];
  startedAt: string;
}

/** Is that process still there? A record outlives a crash, and says nothing about one. */
const alive = (pid: number): boolean => {
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
 * Start one in the background, and wait until it says where it is.
 *
 * Detached and with its streams let go, so it outlives the shell that started
 * it - which is the whole point, and the difference between this and running
 * `ahpd` in a terminal you then have to keep open.
 */
export async function start(argv: string[], self: string): Promise<Running> {
  const already = running();
  if (already) throw new Error(`One is already running: ${already.url} (pid ${String(already.pid)})`);

  ensureConfigDir();
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
  const url = await new Promise<string>((answer, fail) => {
    const gaveUp = Date.now() + 20_000;
    const look = (): void => {
      let said = '';
      try { said = readFileSync(daemonLog(), 'utf8'); }
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
    try { process.kill(child.pid ?? 0, 'SIGKILL'); }
    catch { /* already gone */ }
    throw error;
  });

  const record: Running = {
    pid: child.pid ?? 0,
    url,
    // Off its own announcement rather than off the command line: the
    // directories may have come from the configuration file, and a record
    // built from argv would name none of them.
    paths: (/sessions in (.+)/.exec(announced)?.[1] ?? '')
      .trim().split(',').map((one) => one.trim()).filter((one) => one !== ''),
    startedAt: new Date().toISOString(),
  };
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
