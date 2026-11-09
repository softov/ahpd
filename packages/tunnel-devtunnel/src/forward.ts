/**
 * The hop from the well-known port to the one the daemon actually bound.
 *
 * A Dev Tunnel forwards a port number to the same port number: the tunnel's
 * 31546 is `127.0.0.1:31546` on this machine and nothing else. The well-known
 * port is fixed by the convention and the daemon's is whatever it was started
 * on, so unless somebody has started it on exactly 31546 the two do not meet.
 *
 * This is what makes them meet: a loopback listener on the well-known port
 * that carries each connection to the daemon's. For a daemon that requires no
 * token it is a socket-to-socket copy that reads nothing. For one that does,
 * it carries each request, a WebSocket upgrade among them, with the daemon's
 * own token set as its `tkn`, as VS Code's CLI injects its agent host's token
 * into each request arriving over a tunnel: reaching the tunnel already took
 * the Dev Tunnels access boundary.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/cli/src/tunnels/agent_host.rs#L1651-L1709
 *
 * The token is the request's one `tkn`, since the daemon reads one and the
 * one a client derived from the tunnel's id is not the daemon's own.
 *
 * Loopback on both ends. The tunnel reaches this from the machine it is
 * hosted on, which is this one, so a forwarder bound anywhere else would be an
 * unauthenticated way in that the daemon's own bind decision refused.
 */

import { createServer as createHttpServer, request as httpRequest } from 'node:http';
import type { IncomingMessage } from 'node:http';
import { createServer, connect } from 'node:net';
import type { AddressInfo, Server, Socket } from 'node:net';
import type { LogLevel } from '@ahpd/sdk';

/** A forwarder, for as long as the daemon runs. */
export interface Forward {
  /** The port it actually bound, which is the asked-for one unless that was zero. */
  readonly port: number;
  /** Stop accepting, and drop what is open. */
  close(): Promise<void>;
}

/** A request's path and query with `tkn` set to the token. */
const withToken = (url: string | undefined, token: string): string => {
  const at = new URL(url ?? '/', 'http://hop');
  at.searchParams.set('tkn', token);
  return `${at.pathname}${at.search}`;
};

/**
 * Accept on `from` and carry to `to`, both on loopback, setting `token` as each
 * request's `tkn` where there is one.
 *
 * A connection that cannot reach the daemon is destroyed rather than left
 * open: the client is a tunnel relay that will reconnect, and a socket held
 * open against a daemon that is not answering is one nothing ever closes. A
 * request that cannot reach it is answered 503, as VS Code's CLI answers one.
 */
export function forward(from: number, to: number, log: (line: string, level?: LogLevel) => void, token?: string): Promise<Forward> {
  const open = new Set<Socket>();

  /** Two sockets copied into each other, both dropped when either goes. */
  const joined = (inbound: Socket, outbound: Socket): void => {
    open.add(inbound);
    open.add(outbound);
    const drop = (): void => {
      open.delete(inbound);
      open.delete(outbound);
      inbound.destroy();
      outbound.destroy();
    };
    inbound.on('error', drop);
    outbound.on('error', (error) => {
      log(`forward to 127.0.0.1:${to} failed: ${error.message}`, 'error');
      drop();
    });
    inbound.on('close', drop);
    outbound.on('close', drop);
    inbound.pipe(outbound);
    outbound.pipe(inbound);
  };

  const server: Server = token === undefined
    ? createServer((inbound) => { joined(inbound, connect({ host: '127.0.0.1', port: to })); })
    : createHttpServer((asked, answer) => {
      const upstream = httpRequest({ host: '127.0.0.1', port: to, method: asked.method, path: withToken(asked.url, token), headers: asked.headers }, (said) => {
        answer.writeHead(said.statusCode ?? 502, said.headers);
        said.pipe(answer);
      });
      upstream.on('error', (error) => {
        log(`forward to 127.0.0.1:${to} failed: ${error.message}`, 'error');
        answer.writeHead(503).end(`Error connecting to the daemon: ${error.message}`);
      });
      asked.pipe(upstream);
    }).on('upgrade', (asked: IncomingMessage, inbound: Socket, head: Buffer) => {
      const outbound = connect({ host: '127.0.0.1', port: to }, () => {
        const headers: string[] = [];
        for (let at = 0; at + 1 < asked.rawHeaders.length; at += 2) headers.push(`${asked.rawHeaders[at] ?? ''}: ${asked.rawHeaders[at + 1] ?? ''}`);
        outbound.write(`${asked.method ?? 'GET'} ${withToken(asked.url, token)} HTTP/${asked.httpVersion}\r\n${headers.join('\r\n')}\r\n\r\n`);
        if (head.length > 0) outbound.write(head);
      });
      joined(inbound, outbound);
    });

  return new Promise<Forward>((resolve, reject) => {
    server.once('error', reject);
    server.listen(from, '127.0.0.1', () => {
      server.removeListener('error', reject);
      // Read back rather than echoed: `from` is zero when the caller wanted
      // any free port, and the number it got is the only one worth reporting.
      const bound = (server.address() as AddressInfo | null)?.port ?? from;
      server.on('error', (error) => { log(`forwarder on ${bound}: ${error.message}`, 'error'); });
      resolve({
        port: bound,
        close: () => new Promise<void>((done) => {
          for (const socket of open) socket.destroy();
          open.clear();
          // A request in flight is a connection the HTTP server holds itself.
          (server as Server & { closeAllConnections?: () => void }).closeAllConnections?.();
          server.close(() => done());
        }),
      });
    });
  });
}
