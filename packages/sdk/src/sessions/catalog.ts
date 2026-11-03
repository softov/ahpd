/**
 * How a session is named, what its status bits are worth, what it is doing, and
 * whether its queue waits.
 *
 * URIs, numbers, the one activity line and the queue's one rule, and nothing
 * that knows what a session *is*: the listing itself belongs to whichever
 * backend wrote the sessions down, because only that one can say which exist.
 * See `catalogue` in `@ahpd/agent-claude`.
 */

import type { Bag } from '../types/common.js';
import type { Emit } from '../types/session.js';

/**
 * `SessionStatus`, as values.
 *
 * The protocol declares it as a `const enum`, which exists only in the type
 * system - importing it at runtime is a value import of something that was
 * erased. So the numbers are restated here, and they are the protocol's:
 * `InputNeeded` is 24 and *carries* `InProgress` (8), which is why anything
 * testing activity has to test it first.
 */
export const Status = {
  Idle: 1,
  Error: 2,
  InProgress: 8,
  InputNeeded: 24,
  IsRead: 32,
  IsArchived: 64,
} as const;

/** Which of a session's conditions hold, as the three a status is read from. */
export interface StatusBits {
  /** Somebody is being waited on: a permission, a question, a call. */
  waiting: boolean;
  /** A turn is running. */
  active: boolean;
  /** The last turn failed. */
  failed: boolean;
}

/**
 * What a session's status is, from the three conditions it is read from.
 *
 * One shape for the four backends, which hold those conditions under four sets
 * of names. `waiting` comes first, because `InputNeeded` (24) carries
 * `InProgress` (8) - anything reading the number has to see the wait.
 *
 * A boolean each rather than the value each is read from: one backend tests
 * truthiness and the rest test against nothing, and which of the two a
 * condition is belongs to the caller.
 */
export const statusOf = ({ waiting, active, failed }: StatusBits): number =>
  (waiting ? Status.InputNeeded
    : active ? Status.InProgress
      : failed ? Status.Error
        : Status.Idle);

/** What a session is doing, as the one handle that says it. */
export interface Activity {
  /** Say what the session is doing now, or nothing while it is idle. */
  say(said?: string): void;
  /** What it is doing, or nothing while it is idle. */
  current(): string | undefined;
}

/**
 * The one place a session's activity is said.
 *
 * Both channels go out together, because the protocol has a session mirror its
 * default chat: a client watching either one reads the same line, and a client
 * watching both reads it once. A repeat says nothing, and the last line is held
 * here, so the four backends cannot disagree about whether it changed.
 */
export const activityOf = (emit: Emit): Activity => {
  let said: string | undefined;
  const say = (next?: string): void => {
    if (said === next) return;
    said = next;
    emit('chat', { type: 'chat/activityChanged', ...(next !== undefined ? { activity: next } : {}) });
    emit('session', { type: 'session/activityChanged', ...(next !== undefined ? { activity: next } : {}) });
  };
  return { say, current: () => said };
};

/**
 * `ahp-session:/<id>`, the protocol's own spelling of a session URI.
 *
 * What the host names an id no backend has named, and a session it makes for
 * any client but an older VS Code window. A session keeps the URI it was
 * created with - a provider's scheme included - and is answered under that
 * URI alone.
 */
export const uriFor = (sessionId: string): string => `ahp-session:/${sessionId}`;

/**
 * The id inside a channel URI, whatever its scheme.
 *
 * A client may name a channel under any scheme: an older VS Code window names
 * a session after its provider, `claude:/<uuid>`, and its terminals
 * `agenthost-terminal:/<uuid>`. The id is what the store keeps a session's
 * record by. Everything after the scheme, without its leading slashes: an
 * opaque key, not something to parse further.
 */
export const idOf = (uri: string): string => {
  const colon = uri.indexOf(':');
  return (colon < 0 ? uri : uri.slice(colon + 1)).replace(/^\/+/, '');
};

/**
 * The first non-blank line of a message, as a title for a session nobody named.
 *
 * One rule for the four backends, so the same message titles a session the same
 * way whichever agent is behind it. The first line rather than the whole text
 * because a title is one row, and the line is trimmed because the indentation
 * of a pasted snippet is not part of what it says.
 *
 * A message that is blank throughout answers the caller's `fallback`: a session
 * with nothing said in it is drawn by a word of the backend's own, and every
 * backend has one. `max` is the caller's for the same reason - a row is drawn
 * at a width the caller knows.
 */
export const titleFrom = (text: string, fallback: string, max = 80): string => {
  const line = text.split('\n').map((one) => one.trim()).find((one) => one !== '') ?? '';
  return line === '' ? fallback : line.slice(0, max);
};

/**
 * Whether a chat's latest turn holds its queue: a turn that ended in an error
 * whose last part says a client may resume it.
 *
 * One rule for every backend's queue: the reference host's drain starts nothing
 * behind such a turn, a message queued after it included, and the turn's last
 * part is the error part it reads.
 * https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/chatContributions/queueDrain/queueDrainContribution.ts#L262-L265
 * https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/common/state/sessionState.ts#L121-L127
 */
export const holdsTheQueue = (turn: Bag | undefined): boolean => {
  const last = (Array.isArray(turn?.responseParts) ? turn.responseParts as Bag[] : []).at(-1);
  return turn?.state === 'error' && last?.kind === 'error' && last.resumable === true;
};

/** The scheme a channel URI names, or nothing where it names none. */
export const schemeOf = (uri: string): string | undefined => {
  const said = /^([a-zA-Z][\w+.-]*):/.exec(uri)?.[1];
  return said === undefined ? undefined : said.toLowerCase();
};
/** The same, and the name it goes by where a session rather than a chat is meant. */
export const idFor = idOf;
