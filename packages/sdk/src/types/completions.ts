import type { SessionConfigValueItem } from '@microsoft/agent-host-protocol';

/**
 * Who answers a session setting's picker, for a key a plugin contributed.
 *
 * A contributed key reaches every client through the session schema, and a
 * property with no `enum` reads as a fact somebody types rather than a
 * question with answers - so the `computer` key the machine plugin contributes
 * arrived at VS Code and at a terminal client as a text box, and only a client
 * that knew the key by name could draw a picker for it. This is the seam that
 * fixes that: the plugin that named the key answers for it, and every client
 * gets the same list.
 *
 * `enumDynamic` is the protocol's word for "ask me", so registering one of
 * these is what marks the property - a key with no answerer must not claim to
 * have answers, because a client that asks would be told nothing and draw an
 * empty picker.
 */

/** What a client is asking about, as the protocol sends it. */
export interface SessionConfigAsk {
  /** The key being filled in, which is the one this answerer registered. */
  property: string;
  /** What has been typed so far. Empty means "what would you offer first". */
  query: string;
  /** The backend this session would run on, when the client named one. */
  provider?: string;
  /** The folder the session would work in, as a URI. */
  workingDirectory?: string;
  /**
   * The other answers so far.
   *
   * A picker may depend on one: a machine list is the same everywhere, but a
   * branch list is a question about a repository, and a key contributed beside
   * another may be a question about that one's value.
   */
  config?: Record<string, unknown>;
}

/**
 * One key's answers.
 *
 * Returning nothing and returning an empty list are the same to a client, and
 * both are honest: a host with no machines has no machines. A thrown error is
 * the host's to swallow - a picker that fails is an empty picker, not a failed
 * session.
 */
export type SessionConfigAnswerer =
  (ask: SessionConfigAsk) => SessionConfigValueItem[] | Promise<SessionConfigValueItem[]>;
