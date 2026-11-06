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
import { INTERNAL_ERROR, RpcError } from '@ahpd/sdk';
import type { PluginMethod } from '@ahpd/sdk';
import { daemonLog } from '../config.js';
import { READY_TIMEOUT_MS, configuredMs, deliver, logSince, running, throughPipe } from '../daemon.js';
import type { ControlledSignal, Running } from '../daemon.js';
import { realManager } from '../service.js';
import type { Manager, Service } from '../service.js';
import { conflict } from './options.js';
import { deploymentOnly } from './scopes.js';
import type { ServedFacts } from './served.js';

/**
 * How long the terminal waits for the successor, counted from the daemon's
 * `STARTING` line: the daemon's own start gives up after the configuration's
 * `readyTimeoutMs`, `READY_TIMEOUT_MS` unless it says otherwise, and says so in
 * the log, so a wait longer by a margin always hears that answer. A start that
 * waits for ever is waited for as long. Before that line the old daemon is
 * still stopping, and the terminal waits for as long as it lives, since
 * `stopping` handlers have no limit.
 */
export const successorWaitMs = (readyMs: number = configuredMs('readyTimeoutMs', READY_TIMEOUT_MS)): number =>
  (readyMs === 0 ? Number.POSITIVE_INFINITY : readyMs + 5_000);

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
 * How the log names a restart asked through the control pipe, in the place a
 * signal's name goes: no signal was sent. A forced one says so, so a terminal
 * reads only its own kind of answer, as the two signals let it.
 */
const CONTROL_PIPE = 'control pipe';
const FORCED_PIPE = 'control pipe, forced';

/** How the log names a restart that came that way: the pipe, or the signal. */
const cameBy = (piped: boolean, forced: boolean): string => {
  if (piped) return forced ? FORCED_PIPE : CONTROL_PIPE;
  return forced ? FORCED_SIGNAL : RESTART_SIGNAL;
};

/**
 * What the daemon writes when it will not restart, naming how the request
 * came, the signal or the control pipe; the terminal reads the rest of the line.
 */
const refusedTo = (came: string): string => `restart refused (${came}): `;
/**
 * What the daemon writes once it has read its line and token and begins to
 * stop. How the request came is named because a request carries no sender: a
 * terminal reads its own kind of answer, and two of one kind are the same
 * request.
 */
const receiptOf = (came: string): string => `restart: stopping (${came})`;
/** What the daemon writes once its successor has announced itself. */
const RESTARTED = /restarted as (\S+) \(pid (\d+)\)/u;
/** What the daemon writes once it has stopped and is starting its successor. */
const STARTING = 'restart: starting the successor';
/** What the daemon writes when it left no successor running. */
const COULD_NOT = 'Could not restart it: ';
const FAILED = /Could not restart it: .*/u;
/** What the daemon writes when its way down failed on a stop. */
const COULD_NOT_STOP = 'Could not stop cleanly: ';
/**
 * What a stop writes either side of its way down, one line each.
 *
 * The `stopping` event a plugin's handlers are raised with is not one of these:
 * an event is not a log line, and a daemon with no plugin listening would leave
 * nothing behind saying it had been asked to stop. These two are the daemon's
 * own, and they are what a log read after the fact is read for.
 */
const STOPPING = 'stopping';
const STOPPED = 'stopped';

export const FOREGROUND = 'This daemon runs in the foreground, not from ahpd start; restart it where it runs.';
const notRecorded = (pid: number): string =>
  `The record names pid ${String(pid)}, not this daemon; restart this one where it runs.`;
const OLDER = 'This daemon was started by an older ahpd, which did not record its line; run ahpd stop and ahpd start.';
/**
 * The refusal while a turn runs, naming how the caller forces the restart: the
 * terminal's flag unless the caller is a client of the API or of AHP, which
 * force it in the request.
 */
export const busy = (turning: readonly string[], forces = '--force'): string => `A turn is running in ${turning.join(', ')}; pass ${forces} to restart anyway.`;

/**
 * Why the daemon `self`, with that record, is not one a restart may start
 * again, or nothing. Shared with `ahpd update`, which refuses the same ways.
 */
export const notRestartable = (record: Running | undefined, self: number): string | undefined => {
  if (record === undefined) return FOREGROUND;
  if (record.pid !== self) return notRecorded(record.pid);
  // A daemon a service manager holds has no line of its own: the line is the
  // one the unit or the agent runs, and the manager starts the next daemon
  // with it.
  if (record.service !== undefined) return undefined;
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

/** What a restart handed to the service manager is done with, so it can be driven without a process. */
export interface Managed {
  /** Take the listeners and the host down, as a shutdown does. */
  close(): Promise<void>;
  /** Ask the manager that holds this daemon to stop it and start it again. */
  hand(): Promise<void>;
  /** Drop this daemon's record. */
  forget(): void;
  log(line: string): void;
  exit(code: number): void;
}

/** What the daemon writes once the manager has the restart. */
const HANDED = 'restart: handed to the service manager';

/**
 * Stop this daemon and let the service manager start it again.
 *
 * No successor is started here and no line is read: the line this daemon was
 * started with is the manager's own, and the manager is what starts the next
 * daemon with it. The record goes before the manager is asked, because the
 * daemon that comes up next serves this same configuration folder and reads a
 * record still naming this process as a live daemon beside it. A way down or a
 * call that failed exits 1: nothing is listening by then, and an exit of zero
 * is one the unit's own policy leaves stopped.
 */
export async function restartUnderManager(steps: Managed): Promise<void> {
  /** As a shutdown does: a record that is not this daemon's to remove, or cannot be, is not a way up. */
  const drop = (): void => {
    try { steps.forget(); }
    catch { /* the record names another daemon, or cannot be removed */ }
  };
  try {
    await steps.close();
  }
  catch (error) {
    drop();
    steps.log(`${COULD_NOT}${wordsOf(error)}`);
    steps.exit(1);
    return;
  }
  drop();
  try {
    await steps.hand();
  }
  catch (error) {
    steps.log(`${COULD_NOT}${wordsOf(error)}`);
    steps.exit(1);
    return;
  }
  steps.log(HANDED);
  steps.exit(0);
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
  /**
   * Ask the service manager that holds this daemon to stop it and start it
   * again, set only by a daemon a manager started. A restart of one of those is
   * the manager's, not this process's: the daemon it starts next would be in
   * the unit's own cgroup, and the stop job the restart begins with ends
   * everything left in it.
   */
  hand?(): Promise<void>;
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
  /** A restart under way, VS Code's agent host manager's pending start. */
  let pendingStart = false;
  /** A stop asked during that restart, the manager's quit requested. */
  let wasQuitRequested = false;
  return {
    shutdown: () => {
      if (pendingStart) {
        wasQuitRequested = true;
        return;
      }
      // Both signals are wired, and `ahpd stop` sends one to a daemon a person
      // may also be holding a terminal on: twice would take a tunnel down under
      // the handler still bringing it down.
      if (going !== undefined) return;
      // Before the way down, so a log read while it runs says where the daemon
      // was when the stop arrived, and not only that it went.
      steps.log(STOPPING);
      going = steps.down();
      /*
       * The record goes with the daemon, on the way down and on a way down
       * that failed.
       *
       * `steps.forget` is handed this process's own pid, so it removes the
       * record only where that record is this daemon's: a record a successor
       * has claimed in the meantime names the successor, and is left alone.
       * A removal that fails is not a reason to stay up - a daemon with
       * nothing listening and a record naming it is worse than no record -
       * so each arm reaches its own exit either way.
       */
      going.then(() => {
        steps.log(STOPPED);
        try { steps.forget(); }
        catch { /* the record is not this daemon's to remove, or cannot be */ }
        steps.exit(0);
      }, (error: unknown) => {
        steps.log(`${COULD_NOT_STOP}${wordsOf(error)}`);
        try { steps.forget(); }
        catch { /* as above */ }
        steps.exit(1);
      });
    },
    restart: (argv, token) => {
      if (pendingStart) conflict('A restart is already under way.');
      if (going !== undefined) conflict('It is stopping.');
      pendingStart = true;
      steps.later(() => {
        const close = (): Promise<void> => {
          going = steps.down();
          return going;
        };
        const hand = steps.hand;
        void (hand === undefined
          ? restartInPlace(argv, {
              close,
              stopped: () => wasQuitRequested,
              start: (line) => steps.start(line, token),
              stop: steps.stop,
              forget: steps.forget,
              log: steps.log,
              exit: steps.exit,
            })
          : restartUnderManager({
              close,
              hand,
              forget: steps.forget,
              log: steps.log,
              exit: steps.exit,
            }));
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
 * successor a minute. The bound is not for a slow check but for a child
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
    // No console window on Windows, where this is a second `node.exe` and the
    // daemon that starts it has no console of its own.
    windowsHide: true,
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
  read: (argv: string[] | undefined) => Promise<string | undefined>,
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
export async function answerRestartSignal(forced: boolean, facts: SignalFacts, piped = false): Promise<void> {
  const came = cameBy(piped, forced);
  const refuse = (why: string): void => { facts.log(`${refusedTo(came)}${why}`); };
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
  facts.log(receiptOf(came));
}

/** What the terminal's restart is done with, so it can be driven without a process. */
export interface AtTerminal {
  running(): Running | undefined;
  /** Send that signal to the daemon the record names, as a signal or a request. */
  signal(record: Running, signal: ControlledSignal): void | Promise<void>;
  /** Whether that process is still there. */
  alive(pid: number): boolean;
  /** Where the log ends now. */
  mark(): number;
  /** The log written since `from`. */
  read(from: number): string;
  wait(): Promise<void>;
  /** How long the daemon is given to answer the signal. */
  receiptMs: number;
  /**
   * How long the successor is given: from the daemon's `STARTING` line, or from
   * the manager's call for a daemon a manager holds.
   */
  timeoutMs: number;
  now(): number;
  /** Whether `signal` reaches the daemon through its control pipe, so its answer names the pipe. */
  piped: boolean;
  /**
   * The service manager of this machine, asked instead of a signal for a record
   * that names one: the manager is what starts that daemon, and a signal to it
   * is a crash the manager would answer by starting it again.
   */
  manager: Manager;
}

/** The terminal's restart against the real record, log and process table. */
const realTerminal = (): AtTerminal => ({
  running,
  // The signal on Linux and macOS, and the record's own pipe on Windows, which
  // `deliver` decides by the same `throughPipe` that `piped` reads.
  signal: (record, signal) => deliver(record, signal),
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
  timeoutMs: successorWaitMs(),
  now: () => Date.now(),
  piped: throughPipe(),
  manager: realManager(),
});

/** Why a signal to the recorded pid could not be sent, in words. */
const unsignalled = (pid: number, error: unknown): string => {
  const code = (error as { code?: unknown }).code;
  if (code === 'ESRCH') return `pid ${String(pid)}, which the record names, is gone; nothing was restarted.`;
  return `Could not signal pid ${String(pid)}: ${wordsOf(error)}`;
};

/**
 * Ask the service manager to restart the daemon it holds, and answer the record
 * of the one that came back in its place.
 *
 * Nothing is started from here and no signal is sent: the line this daemon was
 * started with is the unit's or the agent's, and the manager starts the next
 * daemon with it. The successor is read off the record rather than the log,
 * because this is not the daemon's own successor but the manager's, and the
 * record it writes itself is what says it is up - the record `ahpd status`
 * reads. The old daemon's record goes on the way down, so a record naming
 * another pid is the new one, and one still naming the old pid after
 * `timeoutMs` is a daemon that did not come back.
 */
const restartedUnderService = async (record: Running, service: Service, steps: AtTerminal): Promise<Running> => {
  try {
    await steps.manager.restart(service, record.serviceName);
  }
  catch (error) {
    conflict(`Could not restart it under ${service}: ${wordsOf(error)}`);
  }
  const until = steps.now() + steps.timeoutMs;
  for (;;) {
    const now = steps.running();
    if (now !== undefined && now.pid !== record.pid) return now;
    if (steps.now() > until) break;
    await steps.wait();
  }
  return conflict(`It did not come back within ${String(steps.timeoutMs / 1000)} seconds; run ahpd status.`);
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
 *
 * A record that names a service manager is not one of these: that daemon is
 * restarted through the manager, since a signal to it is a crash the manager
 * answers by starting it again.
 */
export async function restartAtTerminal(force: boolean, steps: AtTerminal): Promise<Running> {
  const record = steps.running();
  if (record === undefined) conflict('None running in the background; a daemon run in the foreground is restarted where it runs.');
  const service = record.service;
  if (service !== undefined) return restartedUnderService(record, service, steps);
  if (record.argv === undefined) conflict(OLDER);
  const signal = force ? FORCED_SIGNAL : RESTART_SIGNAL;
  const came = cameBy(steps.piped, force);
  const receipt = receiptOf(came);
  const refusal = refusedTo(came);
  const from = steps.mark();
  try {
    await steps.signal(record, signal);
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

/**
 * The restart `ahpd restart` runs at a terminal, against this machine's record,
 * log and process table.
 *
 * Shared with `ahpd update`, which runs the same restart after it has answered:
 * the signal, the answer read in the log and the successor it names are one
 * path, not two that would have to agree.
 */
export const restartFromTerminal = (force: boolean): Promise<Running> => restartAtTerminal(force, realTerminal());

/** What a restart asked of the daemon serving it answers, over the API and over AHP. */
export interface ServedRestartAnswer {
  restarting: true;
  pid: number;
}

/**
 * The restart the daemon runs when the caller is the one that reaches it.
 *
 * The checks are `ahpd restart`'s own: the record must name this daemon, and a
 * turn running refuses the restart unless the caller forces it. The refusal
 * names `force: true`, because a client of the API or of AHP forces it in the
 * request rather than on a command line. The restart itself is
 * `served.restart`, which defers it until the answer in hand has gone, as it
 * does for an update.
 */
export const servedRestart = async (served: ServedFacts, force: boolean): Promise<ServedRestartAnswer> => {
  const self = served.running();
  const record = running();
  const refused = notRestartable(record, self.pid);
  if (refused !== undefined) conflict(refused);
  const turning = served.turning();
  if (turning.length > 0 && !force) conflict(busy(turning, 'force: true'));
  await served.restart((record as Running).argv as string[], force);
  return { restarting: true, pid: self.pid };
};

/** The code this host refuses a caller with, as `updateMethod` and the usage methods do. */
const REFUSED = -32009;

/**
 * `x-ahpd/restart`, the daemon's own restart for a client of its AHP.
 *
 * The grant lets in whoever holds `config:write`, and the owner is what decides:
 * a restart ends the running turns of every person on the host, so it is the
 * host's own connection and never one of its people. A host with no users
 * directory has no owner to name, and every connection it admits is the host
 * itself, so only an owner that names somebody else is refused - with the words
 * the API refuses the same person with.
 *
 * The answer is `{ restarting, pid }`, as the API answers, because
 * `served.restart` defers the restart until the answer has gone.
 */
export const restartMethod = (served: ServedFacts): PluginMethod => ({
  grant: 'config:write',
  describe: () => ({ title: 'Restart the daemon', description: 'Stop the daemon and start it again with the line it was started with.' }),
  handle: async (params, reader, _client, owner) => {
    if (reader !== undefined || (owner !== undefined && !owner.startsWith('root:'))) {
      throw new RpcError(REFUSED, deploymentOnly(reader?.id ?? owner ?? 'This caller', 'restart the daemon'));
    }
    try {
      return await servedRestart(served, params.force === true);
    }
    catch (error) {
      if (error instanceof RpcError) throw error;
      throw new RpcError(INTERNAL_ERROR, wordsOf(error));
    }
  },
});

export const declareRestart = (registry: Registry<object>, served?: ServedFacts): Command => registry.action({
  id: 'daemon.restart',
  summary: 'Stop it and start it again with the line it was started with',
  description: 'Refused while a turn is running, naming the sessions, unless --force; sessions resume from the store.',
  surfaces: { cli: { pattern: ['restart'] }, http: { method: 'POST', path: '/restart' } },
  // The process is the thing changed, and it is not a row any list returns.
  effect: 'change',
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
    const answer = await servedRestart(served, context.flag('force'));
    return output(answer, `Restarting ${served.running().url} (pid ${String(answer.pid)}).\n`);
  },
});
