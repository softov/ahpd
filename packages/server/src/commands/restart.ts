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

import { spawn } from 'node:child_process';
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

/** What a turn is refused with from the moment a restart has begun. */
export const RESTARTING = 'The daemon is restarting';

/**
 * The variable a check run is reached by: set on the successor's binary, which
 * is handed the recorded line as its arguments like a start, and which reads
 * that line and answers rather than serving it.
 *
 * An environment variable rather than a flag, because the line is the one
 * thing here that was written by another ahpd: a flag meaning "check only"
 * would be a flag that ahpd does not declare, in a line that is only ever read
 * by the code that wrote it - and the reading that matters is the strict one.
 */
export const CHECK_LINE_ENV = 'AHPD_CHECK_LINE';

/** The first line a check said, which is the whole of what a refusal can carry. */
const firstLine = (said: string): string | undefined =>
  said.split('\n').map((one) => one.trim()).find((one) => one !== '');

/**
 * How long a check is given before it is killed and the restart refused.
 *
 * A check is a parse and a file read, and the daemon's own start gives a whole
 * successor twenty seconds. The bound is not for a slow check but for a child
 * that is not one: the entry at that path may be an ahpd older than the
 * variable this asks by - a downgrade under a running daemon - and what that
 * one does with a line is start serving it.
 */
const CHECK_WAIT_MS = 10_000;

/**
 * Ask the binary the successor will run whether it takes that line at all.
 *
 * `process.argv[1]` is this daemon's entry as the install has it *now*, which
 * is the file `start` runs a successor from: a daemon started before an
 * `npm i -g` is holding a line that only the ahpd now on disk can read, and it
 * is that ahpd which answers here. The child is handed the recorded line
 * exactly as the successor would be handed it, in the same environment and
 * from the same working directory, so what it reads is what the successor will
 * read; `CHECK_LINE_ENV` is the whole difference between this and a start.
 *
 * Rejects with the child's own words when it does not exit zero, which is why
 * the caller refuses the restart with them: a successor that dies on its line
 * takes the daemon down with it, and the words are what it would have died of.
 * One line of them, because the daemon's refusal is one line of its log, which
 * a terminal reads the rest of. A child that says nothing by `CHECK_WAIT_MS` is
 * killed and rejected with that instead, since a restart that hangs here is a
 * restart that neither happens nor is refused.
 */
export async function successorTakes(argv: readonly string[]): Promise<void> {
  const child = spawn(process.execPath, [...process.execArgv, process.argv[1] as string, ...argv], {
    stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env, [CHECK_LINE_ENV]: '1' },
    timeout: CHECK_WAIT_MS,
    killSignal: 'SIGKILL',
  });
  const answer = await new Promise<{ code: number | null; said: string }>((done) => {
    let said = '';
    child.stderr.on('data', (chunk: Buffer) => { said += String(chunk); });
    // A spawn that never happened answers as one that failed does, and answers
    // once: a settled promise ignores the second answer.
    child.once('error', (error: Error) => { done({ code: null, said: error.message }); });
    child.once('close', (code) => { done({ code, said }); });
  });
  if (answer.code === 0) return;
  throw new Error(firstLine(answer.said) ?? (answer.code === null
    ? `it did not answer within ${String(CHECK_WAIT_MS / 1000)} seconds, and was killed`
    : `it exited with ${String(answer.code)} and said nothing`));
}

/**
 * A restart that reads its line before anything goes down.
 *
 * `read` is the recorded line read over the configuration as it is now, and
 * answers the connection token the successor will have; when it throws, the
 * restart is refused with why and the daemon runs on. Asking the successor's
 * own binary whether it takes the line is part of that read - `successorTakes`
 * - because a line only this daemon can read is a line the successor dies on,
 * and it dies after this one has already gone.
 *
 * `hold` stops the host taking new turns, and is asked *before* the line is
 * read: a turn that begins anywhere between this and the close at the end of
 * the way down is a turn that close ends, and a check a turn can slip past is
 * no check. The running turns are read again after it, so a turn that began
 * during the read refuses a restart that is not forced. A restart that does
 * not run - an unreadable line, a running turn, a lifecycle that refuses it -
 * lets turns go again, because this daemon carries on. Otherwise the lifecycle
 * restarts with that line and token, and turns stay held until the process
 * ends.
 */
export const checkedRestart = (
  read: (argv: string[]) => Promise<string | undefined>,
  turning: () => string[],
  way: Pick<Lifecycle, 'restart'>,
  hold: (why: string | undefined) => void,
) => async (argv: string[], force: boolean): Promise<void> => {
  hold(RESTARTING);
  let token: string | undefined;
  try {
    token = await read(argv);
  }
  catch (error) {
    hold(undefined);
    conflict(`${UNRUNNABLE}${wordsOf(error)}`);
  }
  const now = turning();
  if (now.length > 0 && !force) {
    hold(undefined);
    conflict(busy(now));
  }
  try {
    way.restart(argv, token);
  }
  catch (error) {
    hold(undefined);
    throw error;
  }
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
