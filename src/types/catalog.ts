/** The session catalogue, as the root channel reports it. */

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
}
