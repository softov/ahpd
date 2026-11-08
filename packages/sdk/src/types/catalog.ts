/** The session catalogue, as the root channel reports it. */

import type { ChangesSummary } from './changes.js';

/** One row of the session list. */
export interface Summary {
  /** The session's channel URI, `ahp-session:/<id>`. */
  resource: string;
  /** The agent backend that runs it. Always `claude` here. */
  provider: string;
  /** Display title: the host's own summary, or the first prompt. */
  title: string;
  /** `SessionStatus` bitset - activity in the low bits, client flags above. */
  status: number;
  /** ISO 8601 timestamp of creation. */
  createdAt: string;
  /** ISO 8601 timestamp of the last change. */
  modifiedAt: string;
  /** Directories the agent has tool access to, as `file://` URIs. */
  workingDirectories: string[];
  /**
   * What started it, when it was not a person.
   *
   * Absent for a session somebody opened, which is what the protocol says
   * absent means. Only automations set it.
   */
  origin?: { kind: 'automation'; automation: string; run: string };
  /**
   * The session's chats, as the protocol's compact `SessionChatSummary` has
   * them: enough to draw a chat in a list without opening it.
   *
   * Absent for a row read from a transcript with nothing running, which is a
   * row whose chats are the store's rather than a session's - the same answer
   * `defaultChat` gives.
   */
  chats?: SummaryChat[];
  /** The chat a client gets when it names none, as the session state says it. */
  defaultChat?: string;
}

/** One chat of a row: the protocol's compact `SessionChatSummary`, field for field. */
export interface SummaryChat {
  /** The chat's channel URI. */
  resource: string;
  /** What the chat is called. */
  title: string;
  /** What it was made from, when it was made out of something. */
  origin?: Record<string, unknown>;
  /** The agent the chat runs on, where it is not its session's. */
  provider?: string;
  /** `full` for a chat somebody talks in. */
  interactivity?: string;
  /** `SessionStatus` bits, which for a chat are its activity and its own flags. */
  status?: number;
  /** Set on an archived chat, for a client of AHP 0.9, which reads the flag here and not in `status`. */
  archived?: true;
  /** What the chat changed, as its catalogue entry carries it. */
  changes?: ChangesSummary;
}
