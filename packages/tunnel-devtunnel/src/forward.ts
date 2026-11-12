/**
 * Carrying a tunnel's connections into the daemon's process.
 *
 * A Dev Tunnel forwards a port number to the same number on the machine that
 * hosts it, so a client's connection to port 31546 would reach
 * `127.0.0.1:31546` and nothing else. The daemon is on whatever port it was
 * started on, and a client over a tunnel presents a token derived from the
 * tunnel's id rather than one the daemon keeps. This is where the two meet:
 * the relay host hands each stream to the daemon's own process, a stream for
 * the well-known port is read as HTTP, its `tkn` replaced when it names the
 * tunnel rather than a person, and the request carried to the daemon over a
 * loopback dial.
 *
 * VS Code's CLI does the same in its own process: each request that arrives
 * over its tunnel is rewritten there, before the agent host sees it.
 * https://github.com/microsoft/vscode/blob/1564f100807a/cli/src/tunnels/agent_host.rs#L1547-L1553
 *
 * The token is the request's one `tkn`. An `Authorization` header is never
 * read and never written, so a visitor who signs in with their own token is
 * carried exactly as they sent it.
 *
 * Loopback on the daemon's end, always. The tunnel reaches this from the
 * machine it is hosted on, which is this one, so a dial anywhere else would be
 * an unauthenticated way in that the daemon's own bind decision refused.
 */

import { connect } from 'node:net';
import type { Socket } from 'node:net';
import type { Duplex } from 'node:stream';
import type { LogLevel } from '@ahpd/sdk';

/** Where a line about a stream that could not be carried goes. */
export type Log = (line: string, level?: LogLevel) => void;

/**
 * What a request's own `tkn` becomes on the way in.
 *
 * `set` replaces it, `keep` carries the request as the client wrote it, and
 * `refuse` answers the client without reaching the daemon.
 */
export type Admission =
  | { readonly set: string }
  | { readonly keep: true }
  | { readonly refuse: string };

/** What the daemon is told about one request's token. */
export type Admit = (tkn: string | undefined) => Admission;

/** The query parameter a request's token is read from, as the daemon reads it. */
const TOKEN = 'tkn';

/** How many bytes of a request head are read before the stream is given up on. */
const MAX_HEAD = 64 * 1024;

/** One request head, split into the line that is rewritten and the bytes that are not. */
interface Head {
  readonly method: string;
  readonly target: string;
  readonly version: string;
  /** The header block, from after the request line to before the blank line. */
  readonly headers: Buffer;
  /** The bytes after the blank line: a body, or the first frames of an upgrade. */
  readonly rest: Buffer;
}

/** One request's head, read from the bytes the stream began with. */
const headOf = (raw: Buffer, rest: Buffer): Head | undefined => {
  const firstEnd = raw.indexOf('\r\n');
  const line = (firstEnd < 0 ? raw : raw.subarray(0, firstEnd)).toString('latin1');
  const [method, target, version] = line.split(' ');
  if (method === undefined || target === undefined || version === undefined || method === '' || target === '') {
    return undefined;
  }
  return {
    method,
    target,
    version,
    headers: firstEnd < 0 ? Buffer.alloc(0) : raw.subarray(firstEnd + 2),
    rest,
  };
};

/** A head as HTTP/1.1 writes it, with the request target it is given. */
const written = (head: Head, target: string): Buffer => {
  const first = Buffer.from(`${head.method} ${target} ${head.version}\r\n`, 'latin1');
  return Buffer.concat([first, head.headers, Buffer.from('\r\n\r\n', 'latin1')]);
};

/** The token a request's target carries, read as the daemon reads one. */
const tokenOf = (target: string): string | undefined => {
  try { return new URL(target, 'http://carry').searchParams.get(TOKEN) ?? undefined; }
  catch { return undefined; }
};

/** A request's target with `tkn` set to the token. */
const withToken = (target: string, token: string): string => {
  const at = new URL(target, 'http://carry');
  at.searchParams.set(TOKEN, token);
  return `${at.pathname}${at.search}`;
};

/**
 * The request head a stream begins with, and the bytes that came after it.
 *
 * A stream that ends or faults inside its head is answered with nothing: there
 * is no request to carry, so there is nobody to tell.
 */
const headFrom = (stream: Duplex): Promise<Head | undefined> => new Promise((resolve) => {
  let held: Buffer = Buffer.alloc(0);
  const done = (head: Head | undefined): void => {
    stream.removeListener('data', onData);
    stream.removeListener('end', onEnd);
    stream.removeListener('error', onEnd);
    stream.pause();
    resolve(head);
  };
  const onData = (chunk: Buffer): void => {
    held = held.length === 0 ? chunk : Buffer.concat([held, chunk]);
    const end = held.indexOf('\r\n\r\n');
    if (end < 0) {
      if (held.length > MAX_HEAD) {
        stream.destroy();
        done(undefined);
      }
      return;
    }
    done(headOf(held.subarray(0, end), held.subarray(end + 4)));
  };
  const onEnd = (): void => { done(undefined); };
  stream.on('data', onData);
  stream.on('end', onEnd);
  stream.on('error', onEnd);
});

/**
 * The sentence a client is answered with when the daemon cannot be reached.
 *
 * The client is a tunnel relay that will reconnect, and a socket held open
 * against a daemon that is not answering is one nothing ever closes. The
 * status is the one VS Code's CLI answers a failed forward with.
 */
const unavailable = (reason: string): string =>
  `HTTP/1.1 503 Service Unavailable\r\n`
  + 'content-type: text/plain; charset=utf-8\r\n'
  + `content-length: ${Buffer.byteLength(reason)}\r\n`
  + 'connection: close\r\n\r\n'
  + reason;

/** The answer a connection the tunnel refuses is given. */
const unauthorized = (reason: string): string =>
  `HTTP/1.1 401 Unauthorized\r\n`
  + 'content-type: text/plain; charset=utf-8\r\n'
  + `content-length: ${Buffer.byteLength(reason)}\r\n`
  + 'connection: close\r\n\r\n'
  + reason;

/** Two streams copied into each other, both dropped when either goes. */
const joined = (inbound: Duplex, outbound: Socket, log: Log, to: number): void => {
  const drop = (): void => {
    inbound.destroy();
    outbound.destroy();
  };
  inbound.on('error', drop);
  outbound.on('error', (error) => {
    log(`carry to 127.0.0.1:${to} failed: ${error.message}`, 'error');
    drop();
  });
  inbound.on('close', drop);
  outbound.on('close', drop);
  inbound.pipe(outbound);
  outbound.pipe(inbound);
};

/**
 * Carry one tunnel stream to the local port `to`.
 *
 * The stream's first request decides nothing on its own: `admit` is what the
 * kind answers about its token, and the request is carried as it came when
 * that answer is `keep`. A `refuse` is answered here, so a refused visitor's
 * request never reaches the daemon.
 *
 * The stream's first request is the one decided here. What follows it is
 * carried as it came, which is what a WebSocket's frames are; a client that
 * writes a second request on the same stream is answered by the daemon as the
 * token it wrote there says.
 *
 * Whatever the response is, it goes back over the same stream: a plain answer,
 * a WebSocket upgrade's 101, or the frames after either. Nothing here reads the
 * response.
 */
export async function carry(stream: Duplex, to: number, admit: Admit, log: Log): Promise<void> {
  const head = await headFrom(stream);
  if (head === undefined) {
    stream.destroy();
    return;
  }

  const told = admit(tokenOf(head.target));
  if ('refuse' in told) {
    stream.end(unauthorized(told.refuse));
    return;
  }
  const target = 'set' in told ? withToken(head.target, told.set) : head.target;

  const outbound = connect({ host: '127.0.0.1', port: to });
  let carried = false;
  outbound.on('connect', () => {
    carried = true;
    outbound.write(written(head, target));
    if (head.rest.length > 0) outbound.write(head.rest);
    joined(stream, outbound, log, to);
  });
  outbound.on('error', (error) => {
    const text = `carry to 127.0.0.1:${to} failed: ${error.message}`;
    log(text, 'error');
    if (!carried) stream.end(unavailable(`Error connecting to the daemon: ${error.message}`));
    else stream.destroy();
    outbound.destroy();
  });
}

/**
 * Carry one tunnel stream to the local port `to` exactly as it arrives.
 *
 * A port this plugin understands nothing about is one the tunnel's own access
 * decides, and what answers it is whatever listens on that number here.
 */
export function pipeTo(stream: Duplex, to: number, log: Log): void {
  const outbound = connect({ host: '127.0.0.1', port: to });
  outbound.on('connect', () => { joined(stream, outbound, log, to); });
  outbound.on('error', (error) => {
    log(`carry to 127.0.0.1:${to} failed: ${error.message}`, 'error');
    stream.destroy();
    outbound.destroy();
  });
}
