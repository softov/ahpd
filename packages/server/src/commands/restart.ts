/**
 * `ahpd restart`: the same daemon, stopped and started again with the line it
 * was started with.
 *
 * Served, the daemon answering is the one restarted: it answers, closes its
 * listeners, starts its successor from the record `ahpd start` wrote, and
 * exits; `ahpd --remote <url> restart` and a client reach that one. At the
 * terminal, the process the record names is sent a signal and decides for
 * itself, and its answer is read off the daemon log. Neither falls back to the
 * other. A daemon run in the foreground has no such record, and a respawn would
 * leave the terminal it runs in, so it is restarted where it runs.
 */

import { statSync } from 'node:fs';
import { output } from '@cofold/commands';
import type { Command, Registry } from '@cofold/commands';
import { daemonLog } from '../config.js';
import { READY_TIMEOUT_MS, logSince, running } from '../daemon.js';
import type { Running } from '../daemon.js';
import { conflict } from './options.js';
import type { ServedFacts } from './served.js';

/**
 * How long the terminal waits for the successor, counted from the daemon's
 * `STARTING` line: the daemon's own start gives up after `READY_TIMEOUT_MS`
 * and says so in the log, so a wait longer by a margin always hears that
 * answer. Before that line the old daemon is still stopping, and the terminal
 * waits for as long as it lives, since `stopping` handlers have no limit.
 */
export const SUCCESSOR_WAIT_MS = READY_TIMEOUT_MS + 5_000;

/*
 * The two signals a recorded daemon restarts on: SIGHUP for a restart, refused
 * while a turn runs, and SIGUSR2 for a forced one. SIGUSR1 is Node's inspector,
 * so it is not one of them.
 */
export const RESTART_SIGNAL = 'SIGHUP';
export const FORCED_SIGNAL = 'SIGUSR2';

/**
 * How long the terminal waits for the daemon to answer its signal at all. The
 * daemon answers with one line, a receipt or a refusal, once it has read its
 * recorded line and token over the configuration, which is a file read and a
 * parse; a daemon that says nothing in that time is not one that will, and a
 * pid taken by another process is not a daemon.
 */
export const RECEIPT_WAIT_MS = 5_000;

/**
 * What the daemon writes when it will not restart, naming the signal it
 * answers; the terminal reads the rest of the line.
 */
const refusedTo = (signal: string): string => `restart refused (${signal}): `;
/**
 * What the daemon writes once it has read its line and token and begins to
 * stop. The signal is named because a signal carries no sender: a terminal
 * reads its own kind of answer, and two of one kind are the same request.
 */
const receiptOf = (signal: string): string => `restart: stopping (${signal})`;
/** What the daemon writes once its successor has announced itself. */
const RESTARTED = /restarted as (\S+) \(pid (\d+)\)/u;
/** What the daemon writes once it has stopped and is starting its successor. */
const STARTING = 'restart: starting the successor';
/** What the daemon writes when it left no successor running. */
const COULD_NOT = 'Could not restart it: ';
const FAILED = /Could not restart it: .*/u;
/** What the daemon writes when its way down failed on a stop. */
const COULD_NOT_STOP = 'Could not stop cleanly: ';

const FOREGROUND = 'This daemon runs in the foreground, not from ahpd start; restart it where it runs.';
const notRecorded = (pid: number): string =>
  `The record names pid ${String(pid)}, not this daemon; restart this one where it runs.`;
const OLDER = 'This daemon was started by an older ahpd, which did not record its line; run ahpd stop and ahpd start.';
const busy = (turning: string[]): string => `A turn is running in ${turning.join(', ')}; pass --force to restart anyway.`;

/** Why the daemon `self`, with that record, is not one a restart may start again, or nothing. */
const notRestartable = (record: Running | undefined, self: number): string | undefined => {
  if (record === undefined) return FOREGROUND;
  if (record.pid !== self) return notRecorded(record.pid);
  if (record.argv === undefined) return OLDER;
  return undefined;
};

/** The words of a thrown value. */
const wordsOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** What a restart in place is done with, so the steps can be driven without a process. */
export interface InPlace {
  /** Take the listeners and the host down, as a shutdown does. */
  close(): Promise<void>;
  /** Whether a stop arrived while the restart ran, which the restart gives way to. */
  stopped(): boolean;
  /** Start the successor with that line in this daemon's place, and answer its record. */
  start(argv: string[]): Promise<Running>;
  /** Stop a successor that was started before a stop arrived, and drop its record. */
  stop(successor: Running): void;
  /** Drop this daemon's record. */
  forget(): void;
  log(line: string): void;
  exit(code: number): void;
}

/**
 * Stop this daemon and start it again with `argv`.
 *
 * The listeners close before the successor starts, because it binds the same
 * port. The record stays until the successor's replaces it, so `ahpd stop`
 * reaches this daemon throughout, and a stop that arrives wins: no successor
 * is left running. A successor that does not start leaves none running, and
 * the log says why. Any other failure once the way down has begun is logged
 * and exits 1: a daemon with nothing listening does not stay up.
 */
export async function restartInPlace(argv: string[], steps: InPlace): Promise<void> {
  try {
    await steps.close();
    if (steps.stopped()) {
      steps.forget();
      steps.log(`${COULD_NOT}it was stopped first, so none was started.`);
      steps.exit(0);
      return;
    }
    let begun: Running;
    steps.log(STARTING);
    try {
      begun = await steps.start(argv);
    }
    catch (error) {
      steps.log(`${COULD_NOT}${wordsOf(error)}`);
      steps.forget();
      steps.exit(1);
      return;
    }
    if (steps.stopped()) {
      steps.stop(begun);
      steps.log(`${COULD_NOT}it was stopped while pid ${String(begun.pid)} started, so that one was stopped too.`);
      steps.exit(0);
      return;
    }
    steps.log(`restarted as ${begun.url} (pid ${String(begun.pid)})`);
    steps.exit(0);
  }
  catch (error) {
    steps.log(`${COULD_NOT}${wordsOf(error)}`);
    steps.exit(1);
  }
}

/** A daemon's two ways down: a stop, and a restart. */
export interface Lifecycle {
  /** SIGINT and SIGTERM: down once, then exit; during a restart, the restart gives way and leaves nothing running. */
  shutdown(): void;
  /**
   * Restart with that line, and the connection token it was read to have, once
   * the answer in hand has gone; refused while a restart runs or once a stop has begun.
   */
  restart(argv: string[], token?: string): void;
}

/** What a daemon's lifecycle is done with, so it can be driven without a process. */
export interface LifecycleSteps extends Omit<InPlace, 'close' | 'stopped' | 'start'> {
  /** Start the successor with that line and token in this daemon's place, and answer its record. */
  start(argv: string[], token?: string): Promise<Running>;
  /** The stopping event, then the API's own listener, then the daemon's, each awaited. */
  down(): Promise<void>;
  /** Run that after the answer in hand has gone. */
  later(step: () => void): void;
}

/**
 * The stop and the restart, each once.
 *
 * A second restart, or a restart once a stop has begun, is refused rather than
 * run beside the first: two successors would bind one port, and the second's
 * failure would end the daemon mid-restart.
 */
export function lifecycle(steps: LifecycleSteps): Lifecycle {
  /** The way down, once it has begun. */
  let going: Promise<void> | undefined;
  let restarting = false;
  let stopAsked = false;
  return {
    shutdown: () => {
      if (restarting) {
        stopAsked = true;
        return;
      }
      // Both signals are wired, and `ahpd stop` sends one to a daemon a person
      // may also be holding a terminal on: twice would take a tunnel down under
      // the handler still bringing it down.
      if (going !== undefined) return;
      going = steps.down();
      going.then(() => { steps.exit(0); }, (error: unknown) => {
        steps.log(`${COULD_NOT_STOP}${wordsOf(error)}`);
        steps.exit(1);
      });
    },
    restart: (argv, token) => {
      if (restarting) conflict('A restart is already under way.');
      if (going !== undefined) conflict('It is stopping.');
      restarting = true;
      steps.later(() => {
        void restartInPlace(argv, {
          close: () => {
            going = steps.down();
            return going;
          },
          stopped: () => stopAsked,
          start: (line) => steps.start(line, token),
          stop: steps.stop,
          forget: steps.forget,
          log: steps.log,
          exit: steps.exit,
        });
      });
    },
  };
}

/** What a restart whose recorded line no longer runs is refused with. */
const UNRUNNABLE = 'Its line cannot run now, so it was not stopped: ';

/**
 * A restart that reads its line before anything goes down.
 *
 * `read` is the recorded line read over the configuration as it is now, and
 * answers the connection token the successor will have; when it throws, the
 * restart is refused with why and the daemon runs on. The running turns are
 * read again after it, so a turn that began during the read refuses a restart
 * that is not forced. Otherwise the lifecycle restarts with that line and token.
 */
export const checkedRestart = (
  read: (argv: string[]) => Promise<string | undefined>,
  turning: () => string[],
  way: Pick<Lifecycle, 'restart'>,
) => async (argv: string[], force: boolean): Promise<void> => {
  let token: string | undefined;
  try {
    token = await read(argv);
  }
  catch (error) {
    conflict(`${UNRUNNABLE}${wordsOf(error)}`);
  }
  const now = turning();
  if (now.length > 0 && !force) conflict(busy(now));
  way.restart(argv, token);
};

/** What the daemon reads when a restart signal arrives. */
export interface SignalFacts {
  /** This process's pid, which the record must name. */
  self: number;
  recorded(): Running | undefined;
  turning(): string[];
  log(line: string): void;
  /** Read that line and begin the restart, forced or not; throws, or rejects, with why it will not, and the daemon runs on. */
  restart(argv: string[], force: boolean): void | Promise<void>;
}

/**
 * A restart signal, answered by the daemon it reached.
 *
 * One line in the log either way, which the terminal that sent the signal is
 * reading: a refusal, and the daemon keeps running, or the receipt, written
 * before the restart, which is the served one, begins.
 */
export async function answerRestartSignal(forced: boolean, facts: SignalFacts): Promise<void> {
  const signal = forced ? FORCED_SIGNAL : RESTART_SIGNAL;
  const refuse = (why: string): void => { facts.log(`${refusedTo(signal)}${why}`); };
  const record = facts.recorded();
  const refused = notRestartable(record, facts.self);
  if (refused !== undefined) {
    refuse(refused);
    return;
  }
  const turning = facts.turning();
  if (turning.length > 0 && !forced) {
    refuse(busy(turning));
    return;
  }
  try {
    await facts.restart((record as Running).argv as string[], forced);
  }
  catch (error) {
    refuse(wordsOf(error));
    return;
  }
  facts.log(receiptOf(signal));
}

/** What the terminal's restart is done with, so it can be driven without a process. */
export interface AtTerminal {
  running(): Running | undefined;
  signal(pid: number, signal: string): void;
  /** Whether that process is still there. */
  alive(pid: number): boolean;
  /** Where the log ends now. */
  mark(): number;
  /** The log written since `from`. */
  read(from: number): string;
  wait(): Promise<void>;
  /** How long the daemon is given to answer the signal. */
  receiptMs: number;
  /** How long the successor is given, from the daemon's `STARTING` line. */
  timeoutMs: number;
  now(): number;
}

/** The terminal's restart against the real record, log and process table. */
const realTerminal = (): AtTerminal => ({
  running,
  signal: (pid, signal) => { process.kill(pid, signal); },
  alive: (pid) => {
    try { process.kill(pid, 0); return true; }
    catch { return false; }
  },
  mark: () => {
    try { return statSync(daemonLog()).size; }
    catch { return 0; }
  },
  read: logSince,
  wait: () => new Promise((done) => { setTimeout(done, 100); }),
  receiptMs: RECEIPT_WAIT_MS,
  timeoutMs: SUCCESSOR_WAIT_MS,
  now: () => Date.now(),
});

/** Why a signal to the recorded pid could not be sent, in words. */
const unsignalled = (pid: number, error: unknown): string => {
  const code = (error as { code?: unknown }).code;
  if (code === 'ESRCH') return `pid ${String(pid)}, which the record names, is gone; nothing was restarted.`;
  return `Could not signal pid ${String(pid)}: ${wordsOf(error)}`;
};

/**
 * Signal the recorded daemon and wait for its answer in the log: a refusal, a
 * successor that did not start, or the successor's record.
 *
 * Three waits, one after another. `receiptMs` for the daemon to answer the
 * signal at all; then no limit while it stops, as there is none on its
 * `stopping` handlers; then `timeoutMs` from its `STARTING` line. Only this
 * signal's kind of answer is read, and once its receipt is in, a refusal is
 * another terminal's. A daemon that went without an answer ends the wait.
 */
export async function restartAtTerminal(force: boolean, steps: AtTerminal): Promise<Running> {
  const record = steps.running();
  if (record === undefined) conflict('None running in the background; a daemon run in the foreground is restarted where it runs.');
  if (record.argv === undefined) conflict(OLDER);
  const signal = force ? FORCED_SIGNAL : RESTART_SIGNAL;
  const receipt = receiptOf(signal);
  const refusal = refusedTo(signal);
  const from = steps.mark();
  try {
    steps.signal(record.pid, signal);
  }
  catch (error) {
    conflict(unsignalled(record.pid, error));
  }
  const askedAt = steps.now();
  /** Where this signal's receipt is in the log, once it is. */
  let received: number | undefined;
  let gaveUp: number | undefined;
  let log = '';
  /** The pid the daemon said it restarted as, once it has. */
  let successor: string | undefined;
  /** The daemon's answer in the log so far, or nothing yet. */
  const answered = (): Running | undefined => {
    log = steps.read(from);
    if (received === undefined) {
      const took = log.indexOf(receipt);
      const refused = log.indexOf(refusal);
      if (refused !== -1 && (took === -1 || refused < took)) {
        conflict(log.slice(refused + refusal.length).split('\n')[0] as string);
      }
      if (took === -1) return undefined;
      received = took;
    }
    const since = log.slice(received);
    const failed = FAILED.exec(since);
    if (failed !== null) conflict(failed[0]);
    if (gaveUp === undefined && since.includes(STARTING)) gaveUp = steps.now() + steps.timeoutMs;
    const restarted = RESTARTED.exec(since);
    if (restarted === null) return undefined;
    successor = restarted[2];
    const now = steps.running();
    return now !== undefined && now.pid !== record.pid ? now : undefined;
  };
  let why = 'It never said it had restarted.';
  for (;;) {
    const begun = answered();
    if (begun !== undefined) return begun;
    if (received === undefined && steps.now() > askedAt + steps.receiptMs) {
      why = `It did not answer the signal within ${String(steps.receiptMs / 1000)} seconds, and may still take it; run ahpd status before asking again.`;
      break;
    }
    if (gaveUp !== undefined && steps.now() > gaveUp) break;
    if (!steps.alive(record.pid)) {
      // It may have answered and then gone between the read and the check.
      const last = answered();
      if (last !== undefined) return last;
      break;
    }
    await steps.wait();
  }
  if (successor !== undefined) why = `It restarted as pid ${successor}, which is not running now.`;
  const last = log.trim().split('\n').slice(-10).join('\n');
  return conflict(`${why} The log's last lines:\n${last}`);
}

export const declareRestart = (registry: Registry<object>, served?: ServedFacts): Command => registry.action({
  id: 'daemon.restart',
  summary: 'Stop it and start it again with the line it was started with',
  description: 'Refused while a turn is running, naming the sessions, unless --force; sessions resume from the store.',
  surfaces: { cli: { pattern: ['restart'] }, http: { method: 'POST', path: '/restart' } },
  input: {
    force: { type: 'boolean', description: 'Restart even while a turn is running.' },
  },
  scopes: ['config:write'],
  // A restart runs the plugins' code again in a new process, as an install
  // does, so over HTTP it is the deployment's own token and never a person.
  meta: { deploymentTokenOnly: 'restart the daemon' },
  run: async (context) => {
    if (served === undefined) {
      const before = running();
      const begun = await restartAtTerminal(context.flag('force'), realTerminal());
      // The successor's own skips, from the record it wrote of its own start, in
      // the terminal that asked for it and above the line that says it is up.
      let text = '';
      for (const line of begun.skipped ?? []) text += `skipped: ${line}\n`;
      return output(
        { url: begun.url, pid: begun.pid },
        text + `ahpd on ${begun.url} (pid ${String(begun.pid)}), restarted from pid ${String(before?.pid)}\n`,
      );
    }
    const self = served.running();
    const record = running();
    const refused = notRestartable(record, self.pid);
    if (refused !== undefined) conflict(refused);
    const turning = served.turning();
    if (turning.length > 0 && !context.flag('force')) conflict(busy(turning));
    await served.restart((record as Running).argv as string[], context.flag('force'));
    return output({ restarting: true, pid: self.pid }, `Restarting ${self.url} (pid ${String(self.pid)}).\n`);
  },
});
