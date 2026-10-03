/** Starting one of these in the background, and finding it again. */

import { spawn } from 'node:child_process';
import { closeSync, fstatSync, openSync, readdirSync, readFileSync, readSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
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
  /**
   * The line the child was started with, after the program: what a restart
   * starts again. Absent from a record an older daemon wrote.
   */
  argv?: string[];
  /**
   * What this daemon started without, one line each, in the order the plugins
   * found them: a plugin that failed, an item of a plugin's that it dropped.
   * Absent when nothing was skipped, and from a record an older daemon wrote.
   */
  skipped?: string[];
}

/**
 * How long a start waits for the new daemon to say where it is listening.
 * `ahpd restart` gives a successor longer than this, `SUCCESSOR_WAIT_MS`, so
 * the restarting daemon's own answer always reaches it first.
 */
export const READY_TIMEOUT_MS = 20_000;

/**
 * Set in the environment of a daemon `start` spawns: the one process that will
 * be recorded, and so the one that answers the restart signals.
 */
export const DETACHED_ENV = 'AHPD_DETACHED';

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
 * Whether that pid may be a process: one there, or one this user may not
 * signal (`EPERM`), which is somebody else's and not gone. What a sweep asks
 * before it removes a file named by a pid.
 */
const present = (pid: number): boolean => {
  if (pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  }
  catch (error) { return (error as { code?: unknown }).code === 'EPERM'; }
};

/**
 * The daemon this user has running, if the record names one that still is.
 *
 * A stale record is cleared rather than reported: a `daemon.json` left behind
 * by a crash would otherwise have `start` refuse for ever, on the strength of
 * a process that is not there. A file that holds no record at all, such as
 * `null` or text that is not JSON, is cleared the same way.
 *
 * This is the one reader of the record, and a caller printing one takes `url`:
 * `connectUrl` carries the secret and belongs on no line.
 */
export function running(): Running | undefined {
  let text: string;
  try { text = readFileSync(daemonPath(), 'utf8'); }
  catch { return undefined; }
  const found = recordIn(text);
  if (found === undefined) {
    // Not a record at all, so nobody's: it goes whatever it holds.
    try { unlinkSync(daemonPath()); }
    catch { /* it was already gone, which is what was wanted */ }
    return undefined;
  }
  if (!alive(found.pid)) {
    // Through `forget`, so a record another daemon claimed since the read stays.
    forget([found.pid]);
    return undefined;
  }
  return found;
}

/** The record in that text: a JSON object with a numeric pid, or nothing. */
const recordIn = (text: string): Running | undefined => {
  let parsed: unknown;
  try { parsed = JSON.parse(text) as unknown; }
  catch { return undefined; }
  if (typeof parsed !== 'object' || parsed === null || typeof (parsed as { pid?: unknown }).pid !== 'number') return undefined;
  return parsed as Running;
};

/** The record as the file holds it, alive or not; nothing when there is none or it is not a record. */
const recorded = (): Running | undefined => {
  try { return recordIn(readFileSync(daemonPath(), 'utf8')); }
  catch { return undefined; }
};

/** The temp file a process writes the record to before renaming it into place, by its pid. */
const TEMP = /^daemon\.json\.(\d+)\.tmp$/u;

/**
 * Remove the temp files of processes that are gone.
 *
 * A temp is named by its writer's pid, so one process leaves at most one, and
 * only when it died between the write and the rename; this clears those.
 */
const sweepTemps = (): void => {
  const dir = dirname(daemonPath());
  let names: string[];
  try { names = readdirSync(dir); }
  catch { return; }
  for (const name of names) {
    const pid = Number(TEMP.exec(name)?.[1]);
    if (!Number.isInteger(pid) || pid === process.pid || present(pid)) continue;
    try { unlinkSync(join(dir, name)); }
    catch { /* another process swept it first */ }
  }
};

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
 *
 * The lines it announced as skipped come off it too, which is the whole way
 * they travel: the child that skipped wrote them beside the origin it announced,
 * and the record is what a person who started it is shown.
 */
export function recordOf(announced: string, pid: number, token?: string, argv?: string[]): Running {
  const url = /ws:\/\/[^\s,]+/.exec(announced)?.[0] ?? announced;
  const automations = /^automations (.+)$/m.exec(announced)?.[1]?.trim();
  const skipped = skippedOf(announced);
  return {
    pid,
    url,
    connectUrl: readyUrl(url, token),
    paths: (/sessions in (.+)/.exec(announced)?.[1] ?? '')
      .trim().split(',').map((one) => one.trim()).filter((one) => one !== ''),
    startedAt: new Date().toISOString(),
    ...(automations !== undefined ? { automations } : {}),
    ...(argv !== undefined ? { argv } : {}),
    ...(skipped.length > 0 ? { skipped } : {}),
  };
}

/**
 * What an announcement said was skipped, without the `skipped: ` it is
 * announced under, in the order the daemon found it.
 *
 * One line each and the mark is the line's own: an announcement other daemons
 * also write to is read from an `ahpd on` line to the next one, so what this
 * says is only ever about the daemon that said it.
 */
export function skippedOf(announced: string): string[] {
  return [...announced.matchAll(/^skipped: (.*)$/gmu)].map((found) => found[1] as string);
}

/**
 * What `daemon.log` holds from byte `from` on, read from that offset rather
 * than whole; empty when there is no log or nothing after it.
 */
export function logSince(from: number): string {
  let fd: number;
  try { fd = openSync(daemonLog(), 'r'); }
  catch { return ''; }
  try {
    const size = fstatSync(fd).size;
    if (size <= from) return '';
    const buffer = Buffer.alloc(size - from);
    let at = 0;
    while (at < buffer.length) {
      const read = readSync(fd, buffer, at, buffer.length - at, from + at);
      if (read === 0) break;
      at += read;
    }
    return buffer.subarray(0, at).toString('utf8');
  }
  finally {
    closeSync(fd);
  }
}

/**
 * The announcement of the daemon `pid`, from its `ahpd on` line to the next
 * one, in a log other processes also write to; nothing until it has written it.
 *
 * The announcement is one write holding a `pid` line, so the block that holds
 * this pid's line is this daemon's, whatever other daemons wrote around it.
 */
export function announcementOf(log: string, pid: number): string | undefined {
  const starts = [...log.matchAll(/^ahpd on ws:\/\//gmu)].map((found) => found.index);
  const own = new RegExp(`^pid ${String(pid)}$`, 'mu');
  for (const [at, start] of starts.entries()) {
    const block = log.slice(start, starts[at + 1] ?? log.length);
    if (own.test(block)) return block;
  }
  return undefined;
}

/**
 * The one line `status` prints about a running daemon.
 *
 * Built from `url` alone, which is the token-free origin: a record dump would
 * print `connectUrl` and with it the secret. The line is a function so a test
 * can hold it to that.
 */
export function statusLine(record: Pick<Running, 'url' | 'pid' | 'startedAt'>): string {
  return `ahpd on ${record.url} (pid ${String(record.pid)}), started ${record.startedAt}`;
}

/**
 * The size `daemon.log` may reach before a start moves it aside: over this, and
 * the start that finds it renames it and opens a new one in its place.
 */
const LOG_LIMIT = 5 * 1024 * 1024;

/**
 * Move a log that has outgrown the limit aside, before a start appends to it.
 *
 * At the start and not on a timer, so nothing has to be running to watch the
 * file: the daemon whose log grew unchecked is the one nobody has been near.
 * One previous log is kept and this one replaces it, which is as much of a log
 * nobody has read in a while as is worth keeping.
 */
const rotateLog = (): void => {
  let size: number;
  try { size = statSync(daemonLog()).size; }
  catch { return; }
  if (size <= LOG_LIMIT) return;
  try { renameSync(daemonLog(), `${daemonLog()}.1`); }
  catch { /* another start got there first, and the log is its own to keep */ }
};

/**
 * Start one in the background, and wait until it says where it is.
 *
 * Detached and with its streams let go, so it outlives the shell that started
 * it - which is the whole point, and the difference between this and running
 * `ahpd` in a terminal you then have to keep open.
 *
 * `replacing` is the pid of a daemon restarting itself, whose record stays
 * until this one's is written, so a stop in between still reaches it.
 */
export async function start(argv: string[], self: string, token?: string, replacing?: number): Promise<Running> {
  const already = running();
  if (already && already.pid !== replacing) throw new Error(`One is already running: ${already.url} (pid ${String(already.pid)})`);

  ensureConfigDir();
  rotateLog();
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
  /*
   * The flags this process was given, ahead of the script.
   *
   * A daemon started by the dev runner is a second run of this program, and the
   * runner's loader is on node's own argv rather than in `NODE_OPTIONS`. A child
   * that is not handed the same flags cannot load the workspace's sources. An
   * installed daemon has an empty `execArgv`, so nothing changes for it.
   */
  const child = spawn(process.execPath, [...process.execArgv, self, ...argv], {
    detached: true,
    stdio: ['ignore', log, log],
    env: { ...process.env, [DETACHED_ENV]: '1' },
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
    const gaveUp = Date.now() + READY_TIMEOUT_MS;
    const look = (): void => {
      const said = logSince(from);
      const own = child.pid === undefined ? undefined : announcementOf(said, child.pid);
      if (own !== undefined) { announced = own; answer(own); return; }
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
  const record = recordOf(announced, child.pid, token, argv);
  /** Stop the child this start made, which no record will name. */
  const unmade = (): void => {
    try { process.kill(child.pid as number, 'SIGTERM'); }
    catch { /* already gone */ }
  };
  let other: Running | undefined;
  try {
    other = claim(record, replacing);
  }
  catch (error) {
    unmade();
    throw error;
  }
  if (other !== undefined) {
    unmade();
    throw new Error(`another daemon, pid ${String(other.pid)}, was started in its place while it started`);
  }
  return record;
}

/**
 * Write `record` as the one running, unless the record names another live
 * daemon than `replacing`, which is answered instead and left as it is.
 *
 * Checked again at the write rather than only before the spawn, because a
 * start can take seconds and a person can `ahpd stop` and `ahpd start` in them.
 */
export function claim(record: Running, replacing?: number): Running | undefined {
  const already = recorded();
  if (already !== undefined && already.pid !== replacing && alive(already.pid)) return already;
  sweepTemps();
  // Written whole beside it and renamed over it, so a reader never sees half a record.
  const written = `${daemonPath()}.${String(process.pid)}.tmp`;
  writeFileSync(written, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  renameSync(written, daemonPath());
  return undefined;
}

/**
 * Forget where it was: the record goes, and the process is left alone.
 *
 * With `only`, the record goes only when it names one of those pids, so a
 * daemon forgetting itself never takes another daemon's record with it.
 */
export function forget(only?: readonly number[]): void {
  if (only !== undefined) {
    const named: unknown = recorded()?.pid;
    if (typeof named !== 'number' || !only.includes(named)) return;
  }
  try { unlinkSync(daemonPath()); }
  catch { /* already gone */ }
}

/** Stop it, and forget where it was. Answers what was stopped, or nothing. */
export function stop(): Running | undefined {
  const found = running();
  if (!found) return undefined;
  try { process.kill(found.pid, 'SIGTERM'); }
  catch { /* it went between the check and the signal, which is a stop */ }
  // Only the record of the daemon stopped: a successor may have claimed it since.
  forget([found.pid]);
  return found;
}
