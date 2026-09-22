/**
 * The ACP connection: one command spawned, and one client over its stdio.
 *
 * `@agentclientprotocol/sdk` owns the JSON-RPC framing, the request ids and
 * the notification routing, so all this file does is spawn the program, hand
 * the SDK its two byte streams, and name the calls a session makes on a
 * connection. The `Client` handler is the server's way in: every
 * `session/update` it sends arrives at `sessionUpdate`, and every permission
 * it asks for arrives at `requestPermission`.
 */

import { spawn } from 'node:child_process';
import { Readable, Writable } from 'node:stream';
import { ClientSideConnection, PROTOCOL_VERSION, ndJsonStream } from '@agentclientprotocol/sdk';
import type {
  Client,
  InitializeResponse,
  ListSessionsRequest,
  ListSessionsResponse,
  LoadSessionRequest,
  LoadSessionResponse,
  NewSessionRequest,
  NewSessionResponse,
  PromptResponse,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionNotification,
  SetSessionConfigOptionRequest,
  SetSessionConfigOptionResponse,
  SetSessionModeRequest,
  SetSessionModeResponse,
} from '@agentclientprotocol/sdk';
import type { AcpConnection, AcpConnectionOptions } from './types.js';

/**
 * What this bridge answers a permission request with for now.
 *
 * `cancelled` is the protocol's refusal, and refusing is the honest answer: no
 * person is asked and nothing is allowed silently. Task 03 replaces this with
 * the host's `confirm`, where the question has somewhere to go.
 */
const REFUSED: RequestPermissionResponse = { outcome: { outcome: 'cancelled' } };

/** The version this bridge reports; it names the AHP package rather than a harness. */
const CLIENT_INFO = { name: 'ahpd', version: '0.0.1' };

/**
 * Spawn one ACP server and speak the protocol to it.
 *
 * The environment is the daemon's with the package's own over the top, the way
 * a subprocess is given its parent's: a server finds its own `PATH` and its
 * own credentials unless something named one, which is the whole reason a
 * token does not have to be repeated in a configuration.
 */
export function connectAcp(options: AcpConnectionOptions): AcpConnection {
  const child = spawn(options.command, options.args ?? [], {
    env: { ...process.env, ...options.env },
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
  });
  // Drained rather than inherited: a server that chatters on stderr must not
  // block on a full pipe, and it must not write into the daemon's own output.
  child.stderr.resume();

  const stream = ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout));

  const client: Client = {
    /*
     * One update, routed by the session id the server named.
     *
     * A connection is opened per AHP session, so there is one conversation
     * here; the id is still passed through, because a server is free to send
     * an update for a session this bridge did not open and dropping it is
     * better than writing it into the wrong turn.
     */
    sessionUpdate: (params: SessionNotification): void => {
      options.handlers.update(params.sessionId, params.update);
    },
    /*
     * Refused, never allowed silently.
     *
     * The two members above and this one are the `Client` interface's
     * required surface. The optional capabilities - a file read, a file write,
     * a terminal - are deliberately absent, because they are not advertised on
     * the handshake and a server that asked for one anyway would be answered
     * by nobody.
     */
    requestPermission: async (_params: RequestPermissionRequest): Promise<RequestPermissionResponse> => REFUSED,
  };

  const connection = new ClientSideConnection((_agent) => client, stream);

  /**
   * The handshake's reply, kept so it is asked for once.
   *
   * A server is told what a client can do at the start of a connection and
   * never again, so `initialize` answers the held reply on a second call
   * rather than negotiating twice.
   */
  let handshake: InitializeResponse | undefined;

  return {
    initialize: (): Promise<InitializeResponse> => {
      if (handshake !== undefined) return Promise.resolve(handshake);
      return connection.initialize({
        protocolVersion: PROTOCOL_VERSION,
        // No `fs` and no `terminal`: this task has no ports to serve them
        // through, and advertising one would invite a request nobody answers.
        clientCapabilities: {},
        clientInfo: CLIENT_INFO,
      }).then((reply) => {
        handshake = reply;
        return reply;
      });
    },
    newSession: (request: NewSessionRequest): Promise<NewSessionResponse> => connection.newSession(request),
    loadSession: (request: LoadSessionRequest): Promise<LoadSessionResponse> => connection.loadSession(request),
    listSessions: (request: ListSessionsRequest): Promise<ListSessionsResponse> => connection.listSessions(request),
    setSessionMode: (request: SetSessionModeRequest): Promise<SetSessionModeResponse> => connection.setSessionMode(request),
    setSessionConfigOption: (request: SetSessionConfigOptionRequest): Promise<SetSessionConfigOptionResponse> =>
      connection.setSessionConfigOption(request),
    prompt: (sessionId: string, text: string): Promise<PromptResponse> => connection.prompt({
      sessionId,
      prompt: [{ type: 'text', text }],
    }),
    cancel: (sessionId: string): Promise<void> => connection.cancel({ sessionId }),
    close: (): void => {
      // The stdin end is what a well-behaved server reads as a shutdown; the
      // kill is for one that does not.
      child.stdin.end();
      child.kill();
    },
  };
}
