import { idOf, reason } from '@ahpd/sdk';
import type { Plugin, PluginHost, PluginPeer } from '@ahpd/sdk';

/**
 * A plugin that is a client of its own host.
 *
 * A daemon answers connections and never opens one, so a plugin with work to do
 * on the sessions of its own host has to arrive as a client does. This fixture
 * is that arrival, with nothing else on it: it connects when the socket is
 * bound, starts a session of the backend the daemon already serves, and sends
 * the first turn - which is what a bot watching a host would do.
 *
 * The test reads what happened off the daemon's log, and one log line per thing
 * is the whole of the fixture's report. A request the host refused is a line
 * too, carrying the code it answered with, which is how a test reads the gate.
 *
 * Two options decide what it does once it is connected. `when: 'apply'` asks for
 * the connection at the wrong moment, to check that a plugin asking then is told
 * rather than handed a connection to nothing. `act: 'automation'` asks its host
 * for an automation after the session is up, which is the request a grant of
 * `session:write` alone does not cover.
 */

export const name = 'plugin-connect';

/** The session this plugin opens, as a client names one. */
const SESSION = 'ahp-session:/connect';
/** The chat its turn is sent in, which is the session's own. */
const CHAT = 'ahp-chat:/connect';
/** What this connection calls itself, which is how it knows its own frames. */
const CLIENT = 'plugin-connect';
/** The host's automation channel, which is the one `runAutomation` is sent on. */
const AUTOMATIONS = 'ahp-automations://';

export const apply: Plugin['apply'] = (host, options) => {
  /** The connection, once there is one. The session case below waits for it. */
  let conn: PluginPeer | undefined;
  /** What this run asks for beyond opening the session. */
  const act = typeof options.act === 'string' ? options.act : 'session';

  if (options.when === 'apply') {
    try {
      host.connect();
      host.log('plugin-connect connect answered during apply');
    }
    catch (error) {
      host.log(`plugin-connect connect during apply: ${reason(error)}`);
    }
    return;
  }

  /*
   * A session somebody else is in, and only then the turn.
   *
   * A session with this plugin alone in it is a session nobody is watching, and
   * the two ends are the point: the connection asks, and a client that is not
   * this plugin sees the work happen. The handler is registered here rather
   * than after connecting, because the fold takes its copy of the listeners
   * when `apply` returns.
   */
  host.on('session_opened', (event) => {
    if (conn === undefined) return;
    if (event.client === CLIENT || idOf(event.session) !== idOf(SESSION)) return;
    conn.notify('dispatchAction', {
      channel: CHAT,
      action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'hello there' } },
    });
  });

  /*
   * And the other end of the connection's life: when the daemon stops it takes
   * the connections a plugin opened down with it, and this is that seen from
   * the plugin's side. Reported the way a client's departure always is, which
   * is the same event any other client's socket raises.
   */
  host.on('client_disconnect', (event) => {
    if (event.client !== CLIENT) return;
    host.log('plugin-connect heard client_disconnect');
  });

  /*
   * Fired and forgotten, because `raise` awaits a handler: a connection made
   * here that waited for its own answers would hold up the announcement of a
   * socket that is already bound.
   */
  host.on('listening', () => { void open(host, act, (one) => { conn = one; }); });
};

/** What an error was, as the client that sent the request reads it. */
const fault = (error: unknown): string =>
  `${String((error as { code?: unknown }).code)} ${reason(error)}`;

/**
 * Ask the host one thing and say what it answered.
 *
 * A refusal is a line rather than a throw, because a plugin that may not do one
 * thing is still a plugin and the test is reading what it was told. The answer
 * is whether it was allowed, which is what the fixture's own flow is decided by.
 */
const ask = async (host: PluginHost, conn: PluginPeer, method: string, params: unknown): Promise<boolean> => {
  try {
    await conn.request(method, params);
    return true;
  }
  catch (error) {
    host.log(`plugin-connect refused ${method}: ${fault(error)}`);
    return false;
  }
};

/** Connect, start a session, and watch what the host says. */
const open = async (host: PluginHost, act: string, keep: (conn: PluginPeer) => void): Promise<void> => {
  let conn: PluginPeer;
  try {
    conn = host.connect();
  }
  catch (error) {
    host.log(`plugin-connect could not connect: ${reason(error)}`);
    return;
  }
  keep(conn);

  conn.onMessage((message) => {
    /*
     * Everything here is what the host said of its own accord: the answers to
     * this connection's own requests settle the promises that asked and are not
     * delivered to this handler. So a frame that arrived is an action.
     */
    if (message.method !== 'action') return;
    const action = (message.params as { action: { type: string } }).action;
    host.log(`plugin-connect saw ${action.type}`);
  });

  await conn.request('initialize', { clientId: CLIENT, protocolVersions: ['0.9.0'] });
  /*
   * A session this host refuses is the end of this run: there is no session to
   * subscribe to and no turn to send, and the refusal is already a line.
   */
  if (!await ask(host, conn, 'createSession', { channel: SESSION, provider: 'echo' })) return;

  if (act === 'automation') {
    host.log(`plugin-connect opened ${SESSION}`);
    // An automation this host serves, asked for by a connection that may not
    // run one: the params are the ones a client sends, so what is refused is
    // the grant rather than the request.
    await ask(host, conn, 'runAutomation', { channel: AUTOMATIONS, automation: 'nothing' });
    return;
  }

  await ask(host, conn, 'subscribe', { channel: SESSION });
  await ask(host, conn, 'subscribe', { channel: CHAT });
  /*
   * Said once the subscribes have settled, because the line is what a test
   * waits for before it puts a client of its own in the room: a connection that
   * reported itself open before it could hear the chat would miss the turn it
   * is about to start.
   */
  host.log(`plugin-connect opened ${SESSION}`);
};
