import { INVALID_PARAMS, RpcError } from '../rpc.js';
import { idOf } from '../catalog.js';

export const ROOT = 'ahp-root://';
/**
 * Whether a channel is the root, in either spelling.
 *
 * `ahp-root://` is the protocol's, and `ahp-root:` is the same URI after a
 * client has parsed and printed it, which drops an empty authority's `//`.
 * VS Code's `isAhpRootChannel` takes both the same way.
 */
export const isRootChannel = (channel: string): boolean => channel === ROOT || channel.startsWith('ahp-root:');
/** The automation catalogue, which belongs to the host rather than to a session. */
export const AUTOMATIONS = 'ahp-automations://';

/** What a session's annotations channel is called, under the session's own URI. */
export const MARKS = '/annotations';

/** The scheme a URI names, lowercased, or the empty string when it names none. */
export const schemeOf = (uri: string): string => (/^([a-zA-Z][\w+.-]*):/.exec(uri)?.[1] ?? '').toLowerCase();

/** The kinds of name this host keeps a space of schemes for. */
export type Space = 'session' | 'chat' | 'terminal' | 'own';
/**
 * The space a name falls in by its scheme alone, whatever this host holds:
 * `ahp-session:` is a session's, `ahp-chat:` a chat's, `ahp-terminal:` a
 * terminal's, and `file:` and every other `ahp-` scheme - the root, the
 * logs, resource watches, the automations - this host's own. Any other
 * scheme says nothing, and the name is whatever `claims` holds it as.
 */
export const spaceOf = (uri: string): Space | undefined => {
  const scheme = schemeOf(uri);
  if (scheme === 'ahp-session') return 'session';
  if (scheme === 'ahp-chat') return 'chat';
  if (scheme === 'ahp-terminal') return 'terminal';
  return scheme === 'file' || scheme.startsWith('ahp-') ? 'own' : undefined;
};

/** A session's own channel under a name: the name, less `/annotations` or `/changeset/<scope>`. */
export const baseOf = (uri: string): string => {
  if (uri.endsWith(MARKS)) return uri.slice(0, -MARKS.length);
  const cut = uri.indexOf('/changeset/');
  return cut > 0 ? uri.slice(0, cut) : uri;
};

/** What the users gate reads a channel as: see `channelKind` in `createHost`. */
export type ChannelKind = 'session' | 'terminal' | 'other';

/**
 * The keys whose string values are URIs, in an action or a state.
 *
 * Every field the protocol types `URI`, a changeset's `uriTemplate`, and
 * `subagentChatUri`, the worker chat link this host stamps on a tool call's
 * `_meta`. What `respelledIn` rewrites for a client that knows a session by
 * another name.
 *
 * `chats` is the odd one out of those fields: the protocol types it `URI[]`
 * on `session/chatsReordered` and an array of summaries everywhere else, and
 * only a string is ever read for a URI here - so the reorder's list is
 * rewritten and a state's rows, being objects, are left to `spelledFor`.
 */
export const URI_KEYS = new Set([
  'automation', 'channel', 'chat', 'chats', 'cwd', 'defaultChat', 'defaultDirectory', 'destination', 'directory',
  'initialSubscriptions', 'logs', 'metrics', 'missing', 'primarySession', 'replacement', 'resource', 'root', 'run',
  'session', 'sessions', 'source', 'src', 'subscriptions', 'traces', 'uri', 'url', 'workingDirectories',
  'workingDirectory', 'uriTemplate', 'subagentChatUri',
]);

/**
 * A channel URI a client named, checked for being one at all.
 *
 * Not for its *scheme*: any scheme is taken. VS Code names a session after its
 * provider (`claude:/<uuid>`) and a terminal `agenthost-terminal:/<uuid>`, and
 * the protocol's own example is `ahp-session:/<uuid>`. For a session the
 * client names the id and the host names the scheme: `createSession` holds it
 * as `<provider>:/<id>` and the client's URI is an alias of that - decision
 * `a-session-is-held-under-its-providers-name`.
 */
export const named = (uri: string, what: string): string => {
  const colon = uri.indexOf(':');
  if (colon <= 0 || idOf(uri) === '') throw new RpcError(INVALID_PARAMS, `${uri} is not a ${what} URI`);
  return uri;
};

/**
 * How this host names a session's first chat.
 *
 * `ahp-chat://default/<base64url(sessionUri)>`, which is the reference
 * implementation's shape and not the one the specification illustrates. That
 * is a deliberate retreat, and it was forced.
 *
 * The specification documents `ahp-chat:/<uuid>` and says the owning session
 * is "**not** encoded in the chat URI - the relationship is expressed via the
 * session's `chats` catalogue". This host published exactly that. VS Code's
 * client computes the other shape from the session instead of reading the
 * catalogue, and subscribes to what it computed - so it asked about a channel
 * that did not exist while the conversation sat on the one it had been told
 * about.
 *
 * Answering *both* was tried first and is not enough, because the disagreement
 * is not only about which channel to open. `defaultChat`, every entry in
 * `chats`, and `ChatState.resource` all name a chat too, and a client that
 * subscribed to one string and is then told the chat is at another cannot pair
 * them up: it holds a subscription nothing refers to and a reference nothing
 * is subscribed to. One name has to win everywhere, and it has to be the one
 * the only other implementation computes.
 *
 * The other spelling is still answered - see `chatOf` - so nothing holding an
 * older URI is broken by this.
 */
export const chatUriFor = (session: string): string =>
  `ahp-chat://default/${Buffer.from(session, 'utf8').toString('base64url')}`;

/**
 * The name a chat's own conversation is kept under, or nothing for a
 * session's first chat.
 *
 * A chat is a conversation of its own, so a backend that can keep more than
 * one keeps each under a name of its own - `Start.chatId`, which is the id
 * inside the chat's URI. The exception is the session's first chat: its
 * conversation *is* the session, and a backend handed a second name for it
 * would open a second one beside the transcript everything else reads.
 *
 * Read from the URI rather than from `defaultChat`, because a chat that
 * became the default keeps the name it was opened under: disposing the first
 * chat moves the default to a peer, and that peer's conversation stays where
 * it was.
 */
export const chatIdFor = (session: string, chatUri: string): string | undefined =>
  chatUri === chatUriFor(session) ? undefined : idOf(chatUri);

/**
 * How this host names the chat of one tool call's worker.
 *
 * The reference's shape, `ahp-chat://subagent/<session>/<toolCallId>`, and
 * not a name of our own: VS Code's `isSubagentChatUri` reads the authority,
 * so a worker named any other way is one its client cannot tell from an
 * ordinary chat. The session is base64url like the default authority's, and
 * the call id is escaped because the CLI's ids are opaque.
 */
export const subagentChatUri = (session: string, toolCallId: string): string =>
  `ahp-chat://subagent/${Buffer.from(session, 'utf8').toString('base64url')}/${encodeURIComponent(toolCallId)}`;

/** The client actions a worker's chat takes: answers to what it asked, and a stop. */
export const WORKER_ACTIONS = new Set(['chat/toolCallConfirmed', 'chat/inputCompleted', 'chat/turnCancelled']);

/** The tool call a worker chat was opened for, or nothing when it is not one. */
export const toolCallOfSubagentChat = (uri: string): string | undefined => {
  const prefix = 'ahp-chat://subagent/';
  if (!uri.startsWith(prefix)) return undefined;
  const rest = uri.slice(prefix.length).split('/');
  if (rest.length < 2) return undefined;
  try { return decodeURIComponent(rest.slice(1).join('/')); }
  catch { return undefined; }
};

/**
 * Whether a URI names the automations catalogue, under any spelling.
 *
 * There is one catalogue and the protocol names it `ahp-automations://`.
 * For two weeks the reference host spelt it `ahp-automations://catalog` -
 * an authority added so the URI survived a round trip through its own URI
 * class - and Insiders builds from that window still subscribe under it,
 * and were refused `-32001` here about a session nobody had named. The
 * reference host now takes anything on the scheme, and so does this one:
 * a client is answered under the spelling it used, the way a chat is.
 */
export const isAutomations = (channel: string): boolean => channel.startsWith('ahp-automations:');
