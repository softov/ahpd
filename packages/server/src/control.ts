/**
 * The pipe a daemon on Windows takes a stop and a restart on.
 *
 * Windows cannot send `SIGHUP` or `SIGUSR2` to another process, and Node sends
 * `SIGTERM` as a hard kill that runs no `stopping` handler, so `ahpd stop` and
 * `ahpd restart` reach a daemon there as one line of JSON on a named pipe.
 * `start` makes the pipe and the token, hands them to the child in
 * `AHPD_CONTROL`, and records them; this is the other end, the listener.
 *
 * The request path is `node:net` on both platforms, so the pipe name is a
 * parameter and a case on Linux drives it over a unix socket path. What the
 * daemon runs for a signal is the handler `process.on` binds for that signal,
 * so a request and a signal reach the same code and do the same thing.
 */

import { timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:net';
import type { Socket } from 'node:net';
import type { Control, ControlledSignal } from './daemon.js';

/** What each one runs: the handler `process.on` binds for that signal. */
export type ControlHandlers = Readonly<Record<ControlledSignal, () => void>>;

/** A daemon's control pipe, listening. */
export interface ControlServer {
  /** Told once the pipe is there, which `listen` reaches asynchronously, or once it could not be. */
  listening: Promise<void>;
  /** Stop listening, and let the pipe go. */
  close(): Promise<void>;
}

/** That text as one line, because a log line is the unit a reader reads. */
const oneLine = (said: string): string => said.replace(/\s+/gu, ' ').trim();

/** Whether that is the name of a signal a request may stand for. */
const isSignal = (said: string): said is ControlledSignal =>
  said === 'SIGTERM' || said === 'SIGHUP' || said === 'SIGUSR2';

/**
 * The control a `start` handed this process in `AHPD_CONTROL`, or nothing.
 *
 * Nothing for a value that is not one, so a daemon handed a broken environment
 * serves without a control rather than refusing to start: the record the parent
 * wrote is what a verb reads, and a control this process cannot read is one no
 * request reaches.
 */
export function controlIn(said: string | undefined): Control | undefined {
  if (said === undefined) return undefined;
  let parsed: unknown;
  try { parsed = JSON.parse(said); }
  catch { return undefined; }
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const { pipe, connectionToken } = parsed as { pipe?: unknown; connectionToken?: unknown };
  if (typeof pipe !== 'string' || pipe === '' || typeof connectionToken !== 'string' || connectionToken === '') return undefined;
  return { pipe, connectionToken };
}

/** The request in that line, or nothing when the line is not one. */
const requestIn = (line: string): { connectionToken: string; signal: string } | undefined => {
  let parsed: unknown;
  try { parsed = JSON.parse(line); }
  catch { return undefined; }
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const { connectionToken, signal } = parsed as { connectionToken?: unknown; signal?: unknown };
  if (typeof connectionToken !== 'string' || typeof signal !== 'string') return undefined;
  return { connectionToken, signal };
};

/**
 * Whether that token is this daemon's, compared in constant time.
 *
 * A comparison that stops at the first byte that differs says how much of a
 * guess was right, which is what a token is guessed by. A token of another
 * length is answered without a compare, because two buffers of different
 * lengths are two tokens and `timingSafeEqual` throws on them.
 */
const sameToken = (own: string, said: string): boolean => {
  const mine = Buffer.from(own, 'utf8');
  const theirs = Buffer.from(said, 'utf8');
  return mine.length === theirs.length && timingSafeEqual(mine, theirs);
};

/**
 * Listen for the stop and the restart of a daemon on Windows.
 *
 * One line of JSON per connection - `{"connectionToken": "...", "signal":
 * "SIGTERM"}` - and the connection is closed once the line has been read, so a
 * caller that has written its request has nothing left to wait for. The token
 * decides whether anything runs at all, as VS Code's local endpoint refuses a
 * connection without its token or with the wrong one, and the name decides
 * what: a line that is not a request with the token this daemon holds and a
 * signal it takes is logged, and runs nothing.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/LOCAL_ENDPOINT.md?plain=1#L103
 *
 * No line this writes holds the token. A log is a file other things read, and
 * the token is worth what the token in the record's `connectUrl` is worth,
 * which no line prints either.
 */
export function controlServer(control: Control, handlers: ControlHandlers, log: (line: string) => void): ControlServer {
  /** One request, and the only thing that ever runs a handler. */
  const answer = (line: string): void => {
    const request = requestIn(line);
    if (request === undefined) {
      log('control: refused a request that is not a JSON line with a connectionToken and a signal');
      return;
    }
    if (!sameToken(control.connectionToken, request.connectionToken)) {
      log('control: refused a request with the wrong token');
      return;
    }
    if (!isSignal(request.signal)) {
      log(`control: refused a request naming ${oneLine(request.signal)}`);
      return;
    }
    handlers[request.signal]();
  };

  const server = createServer((socket: Socket) => {
    socket.setEncoding('utf8');
    let said = '';
    socket.on('data', (chunk: string) => {
      said += chunk;
      const end = said.indexOf('\n');
      // The line is the whole request, so nothing past it is read: a connection
      // that says more is answered on its first line and then closed.
      if (end === -1) return;
      socket.removeAllListeners('data');
      answer(said.slice(0, end));
      socket.end();
    });
    // A client that went away mid-line is one request this daemon never got.
    socket.on('error', () => { socket.destroy(); });
  });
  // A pipe that cannot be listened on is said rather than thrown: the daemon
  // still serves, and this is the one line that says why a verb cannot reach it.
  // Told on an error too, so a daemon waiting for the pipe is not held by one it will never have.
  const listening = new Promise<void>((done) => {
    server.on('error', (error: Error) => { log(`control: ${oneLine(error.message)}`); done(); });
    server.listen(control.pipe, done);
  });

  return {
    listening,
    close: () => new Promise<void>((done) => { server.close(() => { done(); }); }),
  };
}
