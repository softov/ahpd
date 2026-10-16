/**
 * A session a window sent here, and where it came from.
 *
 * The window hands a session to another host by naming its origin on the
 * `createSession` config: the session the work was delegated from, the exact
 * chat inside it, and how far the work has already travelled. Five keys carry
 * that, and they are the window's own convention layered on the protocol's
 * `_meta` bag, so they are spelled once here and read once here.
 *
 * The reader is the window's host's own, transcribed. It is stricter than
 * "the three fields are present": an origin names a chat session the window
 * could have opened, and a value that is not one leaves the session with no
 * origin at all rather than with half of one. That is what the window's host
 * does with it, and a session taken with an origin nobody can report back to
 * is worse than one taken with none.
 *
 * Nothing here reads or writes a store - these are value functions - so the
 * session store can validate what it reads back with the same reader the host
 * used when the value arrived.
 */

import type { Bag } from './types/common.js';
import type { CreatedBy, RemoteOrigin } from './types/sessions.js';

/** The key on the root `_meta` that says this host takes a session from another window. */
export const REMOTE_SESSIONS_META = 'vscode.remoteSessions';

/** The key the window sets on a `createSession` config: where the session came from. */
export const REMOTE_ORIGIN_META = 'vscode.remoteSession.origin';

/** The key a delegated session's depth is read and written under. */
export const SPAWN_DEPTH_META = 'agentHost/sessionSpawnDepth';

/** The key the session that made this one is read and written under. */
export const CREATED_BY_META = 'agentHost/createdBySession';

/** The tool the agent reports back with, which a client has to offer for it to be told to. */
export const SEND_REMOTE_MESSAGE = 'send_remote_message';

/**
 * The two session-type prefixes the window names a chat session under.
 *
 * `agent-host-<provider>` is the window's own host and `remote-<authority>-
 * <provider>` is one it reaches over the network, and an origin is one of the
 * two. The bare prefix is neither: it names no provider.
 */
const LOCAL_PREFIX = 'agent-host-';
const REMOTE_PREFIX = 'remote-';

/** One `scheme:` and everything after it. A scheme is letters, digits, `+`, `-` and `.`. */
const SCHEME = /^([A-Za-z][A-Za-z0-9+.-]*):([^]*)$/;

/** A value that is a bag, or nothing where it is an array, a null or not an object. */
const bag = (value: unknown): Bag | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Bag) : undefined;

/** The `_meta` of a config or a state, or nothing where it holds none. */
const metaOf = (source: unknown): Bag | undefined => bag(bag(source)?._meta);

/**
 * The name back, where the text is a chat session the window could have opened.
 *
 * No authority, no query and no fragment: an origin's session is the session
 * itself, and the chat that goes with it is the same name with a fragment. A
 * path of `/` alone names no session, which is the difference between a URI
 * and a URI with an id in it. `//` after the scheme is an authority spelled
 * without one, and goes the same way.
 *
 * The name is kept as it arrived rather than rewritten: the window sent it, so
 * it is by construction a name the window knows, and handing back a spelling
 * of this host's own would be this host's answer to a question it was told.
 */
const sessionName = (value: string): string | undefined => {
  const parts = SCHEME.exec(value);
  if (parts === null) return undefined;
  const scheme = (parts[1] as string).toLowerCase();
  const rest = parts[2] as string;
  if ((!scheme.startsWith(LOCAL_PREFIX) && !scheme.startsWith(REMOTE_PREFIX)) || scheme === LOCAL_PREFIX) return undefined;
  if (!rest.startsWith('/') || rest.startsWith('//') || rest.length <= 1) return undefined;
  if (rest.includes('?') || rest.includes('#')) return undefined;
  return value;
};

/**
 * An origin, or nothing where the value is not one.
 *
 * `chat` is the session with a fragment on it - or the session itself, which
 * is a chat the window named none for - because what the agent is told to
 * report back to is one chat and not a session. Both keep the spelling they
 * arrived with.
 */
export const asOrigin = (value: unknown): RemoteOrigin | undefined => {
  const held = bag(value);
  if (held === undefined) return undefined;
  const session = typeof held.session === 'string' ? sessionName(held.session) : undefined;
  const chat = typeof held.chat === 'string' ? held.chat : '';
  const depth = held.depth;
  if (session === undefined) return undefined;
  if (typeof depth !== 'number' || !Number.isSafeInteger(depth) || depth < 0) return undefined;
  if (chat !== session && !chat.startsWith(`${session}#`)) return undefined;
  return { session, chat, depth };
};

/** The origin a config or a state carries, or nothing where it carries none. */
export const readOrigin = (source: unknown): RemoteOrigin | undefined => asOrigin(metaOf(source)?.[REMOTE_ORIGIN_META]);

/**
 * The session that made this one, or nothing where the value is not one.
 *
 * Looser than an origin on purpose, and as loose as the window's own reader: a
 * creator is a reference a window wrote, and the id alone is what makes it
 * one. An empty id is kept as it stands, because the window's reader keeps it.
 */
export const asCreatedBy = (value: unknown): CreatedBy | undefined => {
  const held = bag(value);
  if (held === undefined || typeof held.session !== 'string') return undefined;
  return {
    session: held.session,
    ...(typeof held.chat === 'string' ? { chat: held.chat } : {}),
    ...(typeof held.turnId === 'string' ? { turnId: held.turnId } : {}),
  };
};

/** The creator a config or a state carries, or nothing where it carries none. */
export const readCreatedBy = (source: unknown): CreatedBy | undefined => asCreatedBy(metaOf(source)?.[CREATED_BY_META]);

/**
 * The config a `createSession` request opens its session with, holding the
 * window's keys where `openSession` reads them.
 *
 * VS Code sends the origin and the creator on the request's own `_meta`, the
 * protocol's place for request metadata, and leaves `config` to the agent's
 * settings. Every road into a session reads them off the config, so they are
 * moved there, and a key on the request wins over one in the config.
 */
export const configOf = (params: Bag): Bag => {
  const config = bag(params.config) ?? {};
  const sent = metaOf(params);
  const carried = Object.fromEntries([REMOTE_ORIGIN_META, CREATED_BY_META]
    .filter((key) => sent?.[key] !== undefined)
    .map((key) => [key, sent?.[key]]));
  return Object.keys(carried).length === 0 ? config : { ...config, _meta: { ...metaOf(config), ...carried } };
};

/** A meta bag's own depth, or `0` where it holds none or holds something else. */
export const readDepth = (meta: Bag | undefined): number => {
  const value = meta?.[SPAWN_DEPTH_META];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
};

/**
 * How far a session is from the one that began the work.
 *
 * The window's own arithmetic: the depth the session was made with and the
 * depth the origin says it already had, whichever is further. A session sent
 * on from here is that much deeper, which is what bounds the recursion.
 */
export const depthOf = (meta: Bag | undefined, origin: RemoteOrigin): number =>
  Math.max(readDepth(meta), origin.depth);
