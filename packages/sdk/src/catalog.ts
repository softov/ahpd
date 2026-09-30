/**
 * How a session is named, and what its status bits are worth.
 *
 * URIs and numbers, and nothing that knows what a session *is*: the listing
 * itself belongs to whichever backend wrote the sessions down, because only
 * that one can say which exist. See `catalogue` in `@ahpd/agent-claude`.
 */

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

/**
 * `ahp-session:/<id>`, the protocol's own spelling of a session URI.
 *
 * What the host names an id no backend has named. A session it holds or
 * lists is named `<provider>:/<id>`, and a client may use any scheme for it -
 * see {@link idOf}.
 */
export const uriFor = (sessionId: string): string => `ahp-session:/${sessionId}`;

/**
 * The id inside a channel URI, whatever its scheme.
 *
 * A client may name a channel under any scheme: VS Code names a session after
 * its provider, `claude:/<uuid>`, and its terminals `agenthost-terminal:/<uuid>`,
 * and the id is what identifies it. Everything after the scheme, without its
 * leading slashes: an opaque key, not something to parse further.
 */
export const idOf = (uri: string): string => {
  const colon = uri.indexOf(':');
  return (colon < 0 ? uri : uri.slice(colon + 1)).replace(/^\/+/, '');
};
/** The same, and the name it goes by where a session rather than a chat is meant. */
export const idFor = idOf;
