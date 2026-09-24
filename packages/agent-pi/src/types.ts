/**
 * What this package is configured with, and what it keeps while a turn runs.
 *
 * Nothing here imports a runtime value, so the shapes can be read without
 * loading pi or the host.
 */

import type { Bag } from '@ahpd/sdk';

/** One pi backend, as the configuration names it. */
export interface PiOptions {
  /**
   * The id a client names in `createSession`, unique among a host's agents.
   *
   * Per registration rather than per package, so a configuration could put two
   * pi backends side by side on different defaults.
   */
  provider?: string;
  /** What a person reads instead of the id. */
  displayName?: string;
  /** One line about what this backend is. */
  description?: string;
  /**
   * The model a session runs on when nobody chooses, as `provider/modelId`.
   *
   * Left out means pi's own current model, which is what its settings say.
   */
  model?: string;
  /**
   * What to do about a project's own pi resources - its extensions, skills and
   * prompts, which are code in the directory being worked in.
   *
   * `trust` loads them, `deny` does not, and `ask` is not available to a
   * daemon: there is nobody at a terminal to ask, and a prompt nothing can
   * answer is a session that never starts.
   */
  projectTrust?: 'trust' | 'deny';
  /**
   * Where pi keeps its sessions, when it should not use its own default.
   *
   * Left out means `~/.pi`, which is where the `pi` command a person runs by
   * hand looks - so a session started here is one they can open there.
   */
  sessionDir?: string;
}

/** One tool call inside a running turn, as far as the wire cares. */
export interface PiCall {
  toolCallId: string;
  toolName: string;
  displayName: string;
}

/** The running turn, and what has been opened inside it. */
export interface PiTurn {
  turnId: string;
  /** The markdown part every answer streams into, opened with the turn. */
  textPartId: string;
  /** The reasoning part, opened the first time pi thinks and not before. */
  reasoningPartId?: string;
  /** The parts, as the snapshot carries them. Mutated as the answer arrives. */
  parts: Bag[];
  /** The calls this turn opened, by pi's own id for each. */
  calls: Map<string, PiCall>;
}

/** One session this process watched, kept so a transcript can be read back. */
export interface WatchedSession {
  /** pi's own id for the conversation. */
  id: string;
  title: string;
  createdAt: string;
  modifiedAt: string;
  directory: string;
  turns: WatchedTurn[];
}

/** One turn of a watched session, sealed when the turn ended. */
export interface WatchedTurn {
  turnId: string;
  startedAt: string;
  message: Bag;
  parts: Bag[];
  state: 'complete' | 'cancelled' | 'error';
  duration?: number;
}
