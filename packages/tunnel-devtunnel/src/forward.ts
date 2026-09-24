/**
 * The hop from the well-known port to the one the daemon actually bound.
 *
 * A Dev Tunnel forwards a port number to the same port number: the tunnel's
 * 31546 is `127.0.0.1:31546` on this machine and nothing else. The well-known
 * port is fixed by the convention and the daemon's is whatever it was started
 * on, so unless somebody has started it on exactly 31546 the two do not meet.
 *
 * This is what makes them meet: a loopback listener on the well-known port
 * that pipes each connection to the daemon's. It is a socket-to-socket copy
 * and reads nothing - the frames crossing it are the protocol's, the tap in
 * the daemon is what writes them down.
 *
 * Loopback on both ends. The tunnel reaches this from the machine it is
 * hosted on, which is this one, so a forwarder bound anywhere else would be an
 * unauthenticated way in that the daemon's own bind decision refused.
 */

import { createServer, connect } from 'node:net';
import type { AddressInfo, Server, Socket } from 'node:net';

/** A forwarder, for as long as the daemon runs. */
export interface Forward {
  /** The port it actually bound, which is the asked-for one unless that was zero. */
  readonly port: number;
  /** Stop accepting, and drop what is open. */
  close(): Promise<void>;
}

/**
 * Accept on `from` and pipe to `to`, both on loopback.
 *
 * A connection that cannot reach the daemon is destroyed rather than left
 * open: the client is a tunnel relay that will reconnect, and a socket held
 * open against a daemon that is not answering is one nothing ever closes.
 */
export function forward(from: number, to: number, log: (line: string) => void): Promise<Forward> {
  const open = new Set<Socket>();

  const pair = (inbound: Socket): void => {
    open.add(inbound);
    const outbound = connect({ host: '127.0.0.1', port: to });
    open.add(outbound);
    const drop = (): void => {
      open.delete(inbound);
      open.delete(outbound);
      inbound.destroy();
      outbound.destroy();
    };
    inbound.on('error', drop);
    outbound.on('error', (error) => {
      log(`forward to 127.0.0.1:${to} failed: ${error.message}`);
      drop();
    });
    inbound.on('close', drop);
    outbound.on('close', drop);
    inbound.pipe(outbound);
    outbound.pipe(inbound);
  };

  return new Promise<Forward>((resolve, reject) => {
    const server: Server = createServer(pair);
    server.once('error', reject);
    server.listen(from, '127.0.0.1', () => {
      server.removeListener('error', reject);
      // Read back rather than echoed: `from` is zero when the caller wanted
      // any free port, and the number it got is the only one worth reporting.
      const bound = (server.address() as AddressInfo | null)?.port ?? from;
      server.on('error', (error) => { log(`forwarder on ${bound}: ${error.message}`); });
      resolve({
        port: bound,
        close: () => new Promise<void>((done) => {
          for (const socket of open) socket.destroy();
          open.clear();
          server.close(() => done());
        }),
      });
    });
  });
}
