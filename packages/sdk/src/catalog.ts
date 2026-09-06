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
 * A URI for a session this host found on disk. `ahp-session:/<uuid>`, and the
 * SDK's id is already a uuid.
 *
 * Only for rows this host names itself. A session a *client* created is named
 * by that client, in whatever scheme it likes - see {@link idOf}.
 */
export const uriFor = (sessionId: string): string => `ahp-session:/${sessionId}`;

/**
 * The id inside a channel URI, whatever scheme the client chose.
 *
 * A channel URI is the **client's** to name and this host's to echo. VS Code
 * names a session after its provider - `claude:/<uuid>`, with the provider as
 * the *scheme* - and its terminals `agenthost-terminal:/<uuid>`. This used to
 * strip a literal `ahp-session:/` and refuse anything else, so every session
 * and every terminal VS Code opened was answered `is not a session URI`.
 *
 * So: everything after the scheme, without its leading slashes. The result is
 * an opaque key, not something to parse further.
 */
export const idOf = (uri: string): string => {
  const colon = uri.indexOf(':');
  return (colon < 0 ? uri : uri.slice(colon + 1)).replace(/^\/+/, '');
};
/** The same, and the name it goes by where a session rather than a chat is meant. */
export const idFor = idOf;
