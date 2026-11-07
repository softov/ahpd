import { INVALID_PARAMS, RpcError } from '../rpc.js';
import { idOf } from '../sessions/catalog.js';
import { bag, ownerOf } from '../utils/values.js';
import { parseChatUri } from '../vscode/chatid.js';
import { parseNonPtyShellTerminalUri } from '../vscode/nonptyshellterminaluri.js';
import { URI } from '../vscode/uri.js';
import type { ServedChannel, ServedMethod } from '../types/plugin.js';
import type { Owner } from '../types/usage.js';

export const ROOT = 'ahp-root://';
/**
 * The notification that says a configuration change waits for a restart.
 *
 * An `x-ahpd` extension, sent to every connection watching the root as the
 * mark is set. The mark itself is the root config value `ahpd.restartNeeded`,
 * which every root snapshot carries from then on. A client that does not know
 * the name ignores it.
 */
export const RESTART_NEEDED = 'x-ahpd/restartNeeded';
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
/**
 * The catalogue narrowed to one owner, an RFC 6570 template the handshake
 * advertises and a client expands; `me` is the one owner it takes.
 */
export const AUTOMATIONS_TEMPLATE = `${AUTOMATIONS}{?owner}`;
/** The catalogue narrowed to the caller's own automations: the template with `owner` `me`. */
export const AUTOMATIONS_ME = `${AUTOMATIONS}?owner=me`;

/**
 * The segment a session's annotations channel adds to the session's URI, as
 * VS Code's.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/annotationsUri.ts#L22-L23
 */
export const ANNOTATIONS_PATH_SEGMENT = '/annotations';

/** The scheme a URI names, lowercased, or the empty string when it names none. */
export const schemeOf = (uri: string): string => (/^([a-zA-Z][\w+.-]*):/.exec(uri)?.[1] ?? '').toLowerCase();

/** The kinds of name this host keeps a space of schemes for. */
export type Space = 'session' | 'chat' | 'terminal' | 'own' | 'plugin';
/**
 * The space a name falls in by its scheme alone, whatever this host holds:
 * `ahp-session:` is a session's, `ahp-chat:` a chat's, `ahp-terminal:` a
 * terminal's, `file:` and every other `ahp-` scheme - the root, the
 * logs, resource watches, the automations - this host's own, and every `x-`
 * scheme a plugin channel's, served or not. Any other scheme says nothing, and the
 * name is whatever `claims` holds it as.
 */
export const spaceOf = (uri: string): Space | undefined => {
  const scheme = schemeOf(uri);
  if (scheme === 'ahp-session') return 'session';
  if (scheme === 'ahp-chat') return 'chat';
  if (scheme === 'ahp-terminal') return 'terminal';
  if (scheme.startsWith('x-')) return 'plugin';
  return scheme === 'file' || scheme.startsWith('ahp-') ? 'own' : undefined;
};

/** The plugin channel that serves a URI, or nothing when no plugin serves its scheme. */
export const servedIn = (channels: Readonly<Record<string, ServedChannel>> | undefined, uri: string): ServedChannel | undefined =>
  (spaceOf(uri) === 'plugin' ? channels?.[schemeOf(uri)] : undefined);

/** The served `x-` command a request names, or nothing when nobody serves it. */
export const methodIn = (methods: Readonly<Record<string, ServedMethod>> | undefined, name: string): ServedMethod | undefined =>
  (methods !== undefined && name.startsWith('x-') && Object.hasOwn(methods, name) ? methods[name] : undefined);

/**
 * The channel a name is nested under, the name less `/annotations` or
 * `/changeset/<scope>`: an annotations channel's `sessionUri` and a
 * changeset's `ownerUri`, as VS Code parses each back. Any other name is its
 * own.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/annotationsUri.ts#L30-L42
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/changesetUri.ts#L314
 */
export const ownerUriOf = (uri: string): string => {
  if (uri.endsWith(ANNOTATIONS_PATH_SEGMENT)) return uri.slice(0, -ANNOTATIONS_PATH_SEGMENT.length);
  const cut = uri.indexOf('/changeset/');
  return cut > 0 ? uri.slice(0, cut) : uri;
};

/** What the users gate reads a channel as: see `channelKind` in `createHost`. */
export type ChannelKind = 'session' | 'terminal' | 'other';

/**
 * A channel URI a client named, checked for being one at all.
 *
 * Not for its *scheme*: any scheme is taken. An older VS Code window names a
 * session after its provider (`claude:/<uuid>`) and a terminal
 * `agenthost-terminal:/<uuid>`, and the protocol's own example is
 * `ahp-session:/<uuid>`. A session a client creates is held under the URI it
 * named, as the reference host holds it, and is answered under that URI alone.
 * https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/node/protocolServerHandler.ts#L2213-L2221
 */
export const named = (uri: string, what: string): string => {
  const colon = uri.indexOf(':');
  if (colon <= 0 || idOf(uri) === '') throw new RpcError(INVALID_PARAMS, `${uri} is not a ${what} URI`);
  return uri;
};

/**
 * A session's derived default chat, `ahp-chat://default/<base64url(sessionUri)>`,
 * VS Code's frozen legacy shape.
 *
 * The default chat of a session made for an older VS Code window, which reads a
 * chat's session out of its URI and computes this one, and the default this
 * host derives for a session whose record names none. A session any other
 * client, a tool or an automation makes has an opaque default chat minted for
 * it (`mintDefaultChatUri`), whose relationship to the session its `chats`
 * catalogue carries, as the specification has it.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agentHostLegacyDefaultChat.ts#L10-L28
 *
 * It names the session's chat while the session's record says it is the
 * default, or says nothing: see `sessionOfChat`.
 */
export const chatUriFor = (session: string): string =>
  `ahp-chat://default/${Buffer.from(session, 'utf8').toString('base64url')}`;

/**
 * The session a shaped chat URI names, or nothing for any other URI.
 *
 * A shaped chat is `ahp-chat://<chatId>/<base64(session)>`, or a worker's
 * `ahp-chat://subagent/<base64(session)>/<toolCallId>`: the session it was made
 * in is inside it, which is how an older VS Code window reads a chat's session.
 * An opaque chat, `ahp-chat:/<uuid>`, names none.
 * https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/common/state/sessionState.ts#L899-L928
 */
export const shapedSession = (uri: string): string | undefined => {
  if (!uri.startsWith('ahp-chat://')) return undefined;
  const [chatId, ...rest] = uri.slice('ahp-chat://'.length).split('/');
  const encoded = chatId === 'subagent' ? rest[0] ?? '' : rest.join('/');
  if (chatId === '' || encoded === '' || (chatId === 'subagent' && rest.length < 2)) return undefined;
  try {
    const session = Buffer.from(encoded, 'base64url').toString('utf8');
    return session.includes(':') ? session : undefined;
  }
  catch { return undefined; }
};

/**
 * The name a chat's own conversation is kept under, or nothing for a
 * session's derived default chat.
 *
 * A chat is a conversation of its own, so a backend that can keep more than
 * one keeps each under a name of its own - `Start.chatId`, which is the id
 * inside the chat's URI: the chat id a shaped URI carries, as VS Code parses
 * one, and the id after the scheme of any other. The exception is the
 * session's first chat: its conversation *is* the session, and a backend
 * handed a second name for it would open a second one beside the transcript
 * everything else reads. A first chat minted opaque is told apart by its
 * record (`ownChat`); this answers from the URI alone.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/state/sessionState.ts#L894-L928
 *
 * Read from the URI rather than from `defaultChat`, because a chat that
 * became the default keeps the name it was opened under: disposing the first
 * chat moves the default to a peer, and that peer's conversation stays where
 * it was.
 */
export const chatIdFor = (session: string, chatUri: string): string | undefined =>
  chatUri === chatUriFor(session) ? undefined : parseChatUri(chatUri)?.chatId ?? idOf(chatUri);

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

/**
 * The client actions on a worker's chat that go to the backend running the
 * worker: answers to what it asked, drafts of them, a stop, and a client's run
 * of a tool the worker called and the confirmation of its result, as VS Code's
 * host serves a subagent chat's calls.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L1621-L1645
 */
export const WORKER_ACTIONS = new Set([
  'chat/toolCallConfirmed', 'chat/inputAnswerChanged', 'chat/inputCompleted', 'chat/turnCancelled',
  'chat/toolCallComplete', 'chat/toolCallResultConfirmed',
]);

/**
 * The client actions a session another host runs takes there, through its
 * backend's `relay`: those of its chat's turns, draft, pending messages and
 * read bit, and the requests to its MCP servers. Its config and its titles are
 * this host's, its customizations hold this host's client plugins beside the
 * backend's, and its lead chat is its default chat, which this host refuses to
 * archive as any session's.
 */
export const RELAYED = new Set([
  'chat/turnStarted', 'chat/turnCancelled', 'chat/turnResume', 'chat/draftChanged',
  'chat/pendingMessageSet', 'chat/pendingMessageRemoved', 'chat/queuedMessagesReordered',
  'chat/toolCallConfirmed', 'chat/inputCompleted', 'chat/inputAnswerChanged', 'chat/isReadChanged',
  'session/mcpServerStartRequested', 'session/mcpServerStopRequested', 'session/mcpServerBackgroundRequested',
]);

/** The tool call a worker chat was opened for, or nothing when it is not one. */
export const toolCallOfSubagentChat = (uri: string): string | undefined => {
  const prefix = 'ahp-chat://subagent/';
  if (!uri.startsWith(prefix)) return undefined;
  const rest = uri.slice(prefix.length).split('/');
  if (rest.length < 2) return undefined;
  try { return decodeURIComponent(rest.slice(1).join('/')); }
  catch { return undefined; }
};

/** What every canvas channel starts with. */
const CANVAS = 'ahp-canvas:/';

/**
 * How this host names one canvas of a chat.
 *
 * The reference host's shape, `ahp-canvas:/<base64url(chat)>/<id>`. The chat is
 * base64url because the reference host builds and reads the name that way.
 *
 * `id` names one lifetime of a canvas. A canvas drawn again under the
 * `instanceId` it was opened with keeps its name, and a canvas that closes and
 * opens again gets a new one.
 * https://github.com/microsoft/vscode/blob/e646868227c/src/vs/platform/agentHost/common/canvasUri.ts
 */
export const canvasResource = (chat: string, id: string): string =>
  `${CANVAS}${Buffer.from(chat, 'utf8').toString('base64url')}/${id}`;

/**
 * The chat a canvas channel names, or nothing when it names none.
 *
 * Read from the name and not from what this host holds, because a canvas that
 * is gone is still its chat's: what a client may read is the chat's question
 * whether or not there is a canvas left to answer it.
 */
export const chatOfCanvas = (resource: string): string | undefined => {
  if (!resource.startsWith(CANVAS)) return undefined;
  const [encoded = '', id = '', ...rest] = resource.slice(CANVAS.length).split('/');
  if (encoded === '' || id === '' || rest.length > 0) return undefined;
  try {
    const chat = Buffer.from(encoded, 'base64url').toString('utf8');
    return chat.startsWith('ahp-chat:') ? chat : undefined;
  }
  catch { return undefined; }
};

/**
 * The chat and the tool call a retained terminal link names, read from the
 * text a client sent as VS Code's `resourceChat` reads a link's chat, or
 * nothing when the text is no such link. A `!` command's tool call is the
 * call it answers; a backend's terminal carries a key of its own there.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agentHostSubscriptionService.ts#L64-L72
 */
export const nonPtyShellTerminalOf = (uri: string): { chat: string; toolCallId: string } | undefined => {
  try {
    const link = parseNonPtyShellTerminalUri(URI.parse(uri));
    return link === undefined ? undefined : { chat: link.chat.toString(), toolCallId: link.toolCallId };
  }
  catch { return undefined; }
};

/** What a resource watch is: its root, whether it reaches below it, and the globs it leaves out and keeps. */
export interface WatchDescriptor {
  root: string;
  recursive: boolean;
  excludes?: { items: string[] };
  includes?: { items: string[] };
}

/**
 * How this host names a resource watch: the reference host's shape, the
 * descriptor serialised into the channel's path under
 * `ahp-resource-watch://r/`, so a subscribe reads back what to watch with no
 * record kept between the two and a reconnecting client resumes its watch by
 * the name it holds.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/state/sessionState.ts#L374-L399
 */
export const buildResourceWatchChannelUri = (descriptor: WatchDescriptor): string => {
  const payload: Record<string, unknown> = { root: descriptor.root };
  if (descriptor.recursive) payload.recursive = true;
  if (descriptor.excludes !== undefined && descriptor.excludes.items.length > 0) payload.excludes = [...descriptor.excludes.items];
  if (descriptor.includes !== undefined && descriptor.includes.items.length > 0) payload.includes = [...descriptor.includes.items];
  return `ahp-resource-watch://r/${Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')}`;
};

/**
 * The descriptor a resource watch channel names, read from the path of any
 * `ahp-resource-watch:` URI, or nothing for a name that is not one, as the
 * reference host reads one back.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/state/sessionState.ts#L401-L440
 */
export const parseResourceWatchChannelUri = (uri: string): WatchDescriptor | undefined => {
  if (!URL.canParse(uri)) return undefined;
  const { protocol, pathname } = new URL(uri);
  if (protocol !== 'ahp-resource-watch:') return undefined;
  const encoded = pathname.startsWith('/') ? pathname.slice(1) : pathname;
  if (encoded === '') return undefined;
  try {
    const payload = bag(JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')));
    if (typeof payload.root !== 'string') return undefined;
    return {
      root: payload.root,
      recursive: payload.recursive === true,
      ...(Array.isArray(payload.excludes) ? { excludes: { items: payload.excludes.filter((one): one is string => typeof one === 'string') } } : {}),
      ...(Array.isArray(payload.includes) ? { includes: { items: payload.includes.filter((one): one is string => typeof one === 'string') } } : {}),
    };
  }
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
 * reference host takes anything on the scheme, and so does this one: a
 * subscribe is answered under the spelling it used, and every action goes
 * under the host's own channel, which VS Code's client matches by scheme.
 */
export const isAutomations = (channel: string): boolean => channel.startsWith('ahp-automations:');

/**
 * Whether a URI names one automation: any URI in the `ahp-automation` scheme,
 * as VS Code's automation service takes an automation's resource. A text that
 * reads as no URI names none.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostAutomationService.ts#L1513-L1517
 */
export const isAutomationResource = (resource: string): boolean => {
  try { return URI.parse(resource).scheme === 'ahp-automation'; } catch { return false; }
};

/** The text after a channel URI's `?`, or the empty string when it carries none. */
export const queryOf = (channel: string): string => {
  const at = channel.indexOf('?');
  return at < 0 ? '' : channel.slice(at + 1);
};

/**
 * The catalogue a subscription names, with the one filter it may carry.
 *
 * `owner` is the only key that decides anything. A URI with no `owner` is the
 * plain catalogue, whatever else its query says. Any value is kept in the name
 * so the snapshot refuses it as a wrong param rather than answering the whole
 * catalogue to a filter nobody meant.
 */
export const automationsChannel = (channel: string): string => {
  if (!isAutomations(channel)) return channel;
  const asked = new URLSearchParams(queryOf(channel)).get('owner');
  return asked === null ? AUTOMATIONS : `${AUTOMATIONS}?owner=${encodeURIComponent(asked)}`;
};

/**
 * Whose an automation entry is, as the entry carries it.
 *
 * Read from `_meta`, where the store writes `ahpd.owner` because the
 * protocol's `AutomationEntry` declares no owner of its own. An automation
 * nobody owns answers nothing, which matches no filter.
 */
export const automationOwner = (entry: unknown): Owner | undefined => ownerOf(bag(bag(entry)._meta)['ahpd.owner']);
