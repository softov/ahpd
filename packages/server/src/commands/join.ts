/**
 * `ahpd join`: this host joins another one, and serves the sessions it opens.
 *
 * The node dials the hub, not the other way about, so a box behind NAT needs no
 * port open. The socket is opened on the hub's join path, where a node's own
 * token is the only credential asked for. One control socket carries the
 * protocol's own lines: the node says
 * `node/hello` with its versions and its working directory, and the hub asks for
 * a session with `node/open`. Each open is answered with one data socket back to
 * the hub, piped to an `ahpd --stdio --plugin <each>` of this node's own and
 * started in the node's working directory - as p9 reaches a machine over ssh,
 * and for the same reason: a path the hub names is a path on the hub.
 *
 * A control socket that drops is dialled again with a backoff of up to a
 * minute, and the sessions already open are left to their own data sockets, so
 * a hub that restarts is one the node waits for rather than one that ends its
 * sessions. A hub that answers and refuses this node is another matter: the
 * token or the version is not something a retry changes, so the command stops
 * and shows the hub's sentence.
 *
 * Only the CLI declares it. A hub runs no `join` itself, and a `--remote`
 * client would be joining from its own network rather than the daemon's.
 */

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SUPPORTED_PROTOCOL_VERSIONS } from '@microsoft/agent-host-protocol';
import { JOIN_PATH } from '@ahpd/sdk';
import type { Command, Registry } from '@cofold/commands';
import { version } from '../version.js';
import { conflict, stop } from './options.js';

/** How long the first wait after a control socket drops is, and the longest. */
const FIRST_WAIT_MS = 1_000;
const LONGEST_WAIT_MS = 60_000;
/** How long a plain request to the hub's port may take before it is a port that does not answer. */
const ANSWER_WAIT_MS = 5_000;

/**
 * The browser-compatible socket Node, Bun and Deno each have, as far as this
 * file uses it.
 *
 * Typed here rather than imported: all three put a `WebSocket` on the global
 * object and this package depends on none of them for a client, so this is the
 * one shape every runtime answers.
 */
interface Socket {
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  send(data: string): void;
  close(): void;
}

/** A client socket to `url`, whichever runtime this is. */
const connect = (url: URL): Socket =>
  new (globalThis as unknown as { WebSocket: new (url: string) => Socket }).WebSocket(url.href);

/** What a node tells the hub once per control socket. */
interface Hello {
  versions: { ahpd: string; protocol: string[] };
  workdir: string;
}

/**
 * What the hub asks the node for: one session, served by a host of the node's
 * own.
 *
 * `plugins` are the specs that host is started with, relative ones against the
 * node's working directory. `env` is what p12 sends, and nothing here adds to
 * it.
 */
interface Open {
  id: string;
  plugins?: string[];
  env?: Record<string, string>;
}

/** One line of JSON-RPC, either way. */
interface Frame {
  id?: number;
  method?: string;
  params?: unknown;
  error?: { code?: number; message?: unknown };
}

/** The line a frame is sent as: one frame per line, as stdio speaks it. */
const lineOf = (value: unknown): string => JSON.stringify(value);

/**
 * One line at a time out of a stream, because a frame is a line.
 *
 * A stream hands over whatever has arrived, which is a line and a half as often
 * as it is one, so what is held is carried into the next chunk. A line with
 * nothing but spaces is dropped: a host writes nothing but frames to its
 * stdout, and an empty line there is not one.
 */
const lines = (onLine: (line: string) => void): (chunk: string) => void => {
  let held = '';
  return (chunk) => {
    held += chunk;
    let at = held.indexOf('\n');
    while (at !== -1) {
      const line = held.slice(0, at);
      held = held.slice(at + 1);
      at = held.indexOf('\n');
      if (line.trim() !== '') onLine(line);
    }
  };
};

/** Wait, for a retry that is the whole point of the wait. */
const pause = (ms: number): Promise<void> => new Promise((done) => { setTimeout(done, ms); });

/**
 * The URL a node dials, with `http` said as the socket scheme it stands for.
 *
 * A hub is named the way a client names it, and an origin is what an operator
 * copies out of an announcement: both spellings are the same port, so both are
 * taken and only the two that name a node's door are kept.
 */
const socketUrlOf = (written: string): URL => {
  let at: URL;
  try { at = new URL(written); }
  catch { stop(`${written} is not a hub's address: pass ws://host:port or http://host:port.`); }
  if (at.protocol === 'http:') at.protocol = 'ws:';
  else if (at.protocol === 'https:') at.protocol = 'wss:';
  else if (at.protocol !== 'ws:' && at.protocol !== 'wss:') stop(`${written} is not a hub's address: pass ws://host:port or http://host:port.`);
  return at;
};

/**
 * The URL the control socket is opened on: the hub's own, on its join path.
 *
 * `<url>` is how a person names a hub - an origin, or the address an
 * announcement prints - and the path is the hub's, not theirs to spell. A path
 * that already ends in it is kept, so a joiner can copy the address its own
 * sessions arrived on.
 */
const controlOf = (hub: URL): URL => {
  const at = new URL(hub.href);
  const base = at.pathname.replace(/\/+$/u, '');
  at.pathname = base.endsWith(JOIN_PATH) ? base : `${base}${JOIN_PATH}`;
  return at;
};

/**
 * The credential the node joins with.
 *
 * `--token` and `--token-file` are the program's own globals and are read here
 * rather than declared again, because `token` is one word on the program and a
 * command that declared a second `--token` would answer for the first one
 * depending on where it was typed. `AHPD_TOKEN` comes in with the flag's own
 * environment, so the three spellings of one secret disagree about nothing.
 */
const tokenOf = (globals: Readonly<Record<string, unknown>>, url: string): string => {
  const inline = typeof globals['token'] === 'string' ? globals['token'].trim() : undefined;
  const file = typeof globals['tokenFile'] === 'string' ? globals['tokenFile'] : undefined;
  if (inline !== undefined && file !== undefined) stop('pass --token or --token-file, not both.');
  let held = inline;
  if (file !== undefined) {
    try { held = readFileSync(file, 'utf8').trim(); }
    catch { stop(`no token file at ${file}.`); }
  }
  if (held === undefined || held === '') stop(`${url} needs a token: pass --token, --token-file or AHPD_TOKEN.`);
  return held;
};

/**
 * Whether the hub answers on that port at all, which is what tells a refusal
 * from a hub that is not up.
 *
 * A refused token and a closed port are the same failed handshake to the
 * socket, and only one of them is worth waiting out. The plain request asks the
 * port the question the upgrade asked, and any answer at all - a 401 included -
 * means something is there and has turned this node away, so a joiner with a
 * token nobody minted stops with a sentence rather than waiting on it.
 */
const answering = async (url: URL): Promise<boolean> => {
  const at = new URL(url.href);
  at.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
  try {
    await fetch(at, { method: 'GET', signal: AbortSignal.timeout(ANSWER_WAIT_MS) });
    return true;
  }
  catch { return false; }
};

/** The sentence a joiner reads when the hub is there and will not have it. */
const refusedSaid = (where: string): string =>
  `${where} answered and refused this node. Add the node on the hub with "ahpd node add <name>" and join with the token it prints.`;

/**
 * One session: one data socket back to the hub, and one host of this node's own.
 *
 * The socket carries the same newline-delimited AHP a stdio host speaks, one
 * frame per message, so the pipe is the whole of the relay: a message in is a
 * line on the host's stdin, a line out is a message. Either end going ends the
 * other, because a host with no client is a session nobody is watching and a
 * socket with no host is one the hub cannot reach.
 *
 * `program` is this process's own entry, so the session is served by the ahpd
 * that joined and not by whichever one a `PATH` happens to have. `say` is where
 * this node's operator reads what went wrong, which is stderr: the hub's client
 * sees the session fail, and the reason is here.
 */
const serveSession = (options: {
  url: URL;
  workdir: string;
  program: string;
  open: Open;
  say: (text: string) => void;
}): void => {
  const { url, workdir, program, open: asked, say } = options;
  const at = new URL(url.href);
  at.searchParams.set('data', asked.id);
  const child = spawn(process.execPath, [
    ...process.execArgv,
    program,
    '--stdio',
    // `--no-plugins` leaves the host's own list out, and one `--plugin` per
    // spec names what loads.
    ...((asked.plugins ?? []).length > 0 ? ['--no-plugins'] : []),
    ...(asked.plugins ?? []).flatMap((plugin) => ['--plugin', plugin]),
  ], {
    cwd: workdir,
    env: { ...process.env, ...(asked.env ?? {}) },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  // The host's log is this node's log, at the moment it is written: its
  // announcement, a plugin's lines and everything it says about a turn.
  child.stderr.pipe(process.stderr);
  child.on('error', (error: Error) => { say(`ahpd join: session ${asked.id} could not start a host: ${error.message}`); });
  // A host that went while a frame was being written is a session that already
  // failed, which its exit says: the write's own EPIPE is not a second failure.
  child.stdin.on('error', () => {});

  const socket = connect(at);
  let sending = false;
  const held: string[] = [];
  const send = (line: string): void => {
    if (sending) socket.send(line);
    else held.push(line);
  };
  socket.onopen = () => {
    sending = true;
    for (const line of held.splice(0)) socket.send(line);
  };
  socket.onmessage = (event) => {
    const line = typeof event.data === 'string' ? event.data : String(event.data);
    if (line.trim() === '') return;
    child.stdin.write(`${line}\n`);
  };
  // A hub that went takes its session with it: a host nobody is talking to is
  // a turn nobody is reading.
  socket.onclose = () => { child.kill(); };
  socket.onerror = () => { /* the close that follows is the one acted on */ };
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', lines(send));
  child.on('exit', () => { socket.close(); });
};

/** What one control socket ended as: whether the hub answered the hello, and what it said if not. */
interface Ended {
  helloed: boolean;
  refused?: string;
}

/**
 * One control socket, from hello to close.
 *
 * Resolves when the socket is gone, with whether the hub answered the hello and,
 * when it refused this node, its own sentence. A hub that says nothing is a
 * socket that closed, which is a retry; a hub that answers the hello with an
 * error is a node that will not be admitted however many times it asks.
 */
const once = (options: {
  control: URL;
  hello: Hello;
  workdir: string;
  program: string;
  say: (text: string) => void;
}): Promise<Ended> => new Promise((done) => {
  const { control, hello } = options;
  const socket = connect(control);
  let helloSent = false;
  let settled = false;
  const finish = (ended: Ended): void => {
    if (settled) return;
    settled = true;
    socket.onopen = null;
    socket.onmessage = null;
    socket.onclose = null;
    socket.onerror = null;
    try { socket.close(); }
    catch { /* it was already gone, which is what is being said */ }
    done(ended);
  };
  const answer = (id: number, value: Record<string, unknown>): void => {
    if (settled) return;
    socket.send(lineOf({ jsonrpc: '2.0', id, ...value }));
  };
  // The hello's own id, which is what a refusal is answered to.
  const HELLO = 1;

  socket.onopen = () => {
    helloSent = true;
    socket.send(lineOf({ jsonrpc: '2.0', id: HELLO, method: 'node/hello', params: hello }));
  };
  socket.onmessage = (event) => {
    let frame: Frame;
    try { frame = JSON.parse(String(event.data)) as Frame; }
    catch { return; } // A line that is not a frame is not this node's business.
    if (frame.error !== undefined && frame.id === HELLO) {
      const said = typeof frame.error.message === 'string' && frame.error.message.trim() !== ''
        ? frame.error.message
        : 'the hub refused this node.';
      finish({ helloed: true, refused: said });
      return;
    }
    if (frame.method !== 'node/open') return;
    const asked = (frame.params ?? {}) as Partial<Open>;
    if (typeof asked.id !== 'string' || asked.id === '') {
      if (frame.id !== undefined) answer(frame.id, { error: { code: -32602, message: 'node/open needs an id: the data socket is named after it.' } });
      return;
    }
    try {
      serveSession({
        url: control,
        workdir: options.workdir,
        program: options.program,
        open: asked as Open,
        say: options.say,
      });
    }
    catch (error: unknown) {
      const said = error instanceof Error ? error.message : String(error);
      options.say(`ahpd join: session ${asked.id} could not be served: ${said}`);
      if (frame.id !== undefined) answer(frame.id, { error: { code: -32000, message: said } });
      return;
    }
    // Answered once the host is started and its socket is dialling, so the hub
    // knows the session exists and waits for the data socket rather than asking
    // again.
    if (frame.id !== undefined) answer(frame.id, { result: { id: asked.id } });
  };
  socket.onclose = () => { finish({ helloed: helloSent }); };
  socket.onerror = () => { finish({ helloed: helloSent }); };
});

/**
 * The join, kept: hello, serve, and dial again when the hub goes.
 *
 * Sessions live outside this loop, each on its own data socket, so a control
 * socket dropping ends this join's socket and nothing else. Only a refusal
 * ends the command, and it ends it with the hub's words.
 */
const joined = async (options: {
  url: URL;
  token: string;
  workdir: string;
  program: string;
  say: (text: string) => void;
}): Promise<never> => {
  const { url, token, workdir, program, say } = options;
  const control = controlOf(url);
  control.searchParams.set('tkn', token);
  const where = url.pathname === '/' ? url.origin : `${url.origin}${url.pathname}`;
  const hello: Hello = {
    versions: { ahpd: version(), protocol: [...SUPPORTED_PROTOCOL_VERSIONS] },
    workdir,
  };
  let wait = FIRST_WAIT_MS;
  for (;;) {
    const ended = await once({ control, hello, workdir, program, say });
    if (ended.refused !== undefined) conflict(ended.refused);
    if (ended.helloed) {
      // The hub had this node and then went. Anything already open keeps its
      // own data socket, so this is a line and not a failure.
      say(`ahpd join: ${where} closed the connection; joining again in ${String(FIRST_WAIT_MS / 1000)}s.`);
      await pause(FIRST_WAIT_MS);
      wait = FIRST_WAIT_MS * 2;
      continue;
    }
    if (await answering(url)) conflict(refusedSaid(where));
    say(`ahpd join: ${where} is not answering; joining again in ${String(wait / 1000)}s.`);
    await pause(wait);
    wait = Math.min(wait * 2, LONGEST_WAIT_MS);
  }
};

/** The entry this process was started from, which is the ahpd a session is served by. */
const programOf = (): string => {
  const program = process.argv[1];
  // A process started from something other than a file - a REPL, a bundle that
  // runs itself - has nothing to start a second host from.
  if (program === undefined) stop('ahpd join cannot serve a session: this process was not started from a program file.');
  return resolve(program);
};

export const declareJoin = (registry: Registry<object>): Command => registry.action({
  id: 'node.join',
  summary: 'Join a hub, so it can run sessions on this host',
  description: 'Dials the hub at <url> with this node\'s token, says what version this ahpd is and which folder sessions start in, and keeps the control socket, joining again with a backoff of up to a minute when it drops. Each session the hub opens is served by an ahpd of this host\'s own, in one process and one socket of its own. No port is opened here: the node dials the hub. Ctrl-C leaves.',
  surfaces: { cli: { pattern: ['join', ':url'] } },
  // The hub holds the sessions, so this changes no file under this host: what it
  // does is join, and what that leaves is `node list` on the hub.
  effect: 'change',
  resource: { kind: 'node' },
  input: {
    url: { type: 'string', description: 'The hub to join, as ws://host:port or http://host:port.' },
    workdir: { type: 'string', description: 'The folder a session served here starts in. Defaults to this one.' },
  },
  required: ['url'],
  run: async (context) => {
    const url = socketUrlOf(context.value<string>('url'));
    const token = tokenOf(context.globals, context.value<string>('url'));
    const asked = context.optional<string>('workdir');
    const workdir = resolve(asked ?? process.cwd());
    const program = programOf();
    const say = (text: string): void => { context.error(text); };
    await joined({ url, token, workdir, program, say });
  },
});
