/**
 * What this package is configured with, and what it keeps while a turn runs.
 *
 * Nothing here imports a runtime value, so the shapes can be read without
 * loading pi or the host.
 */

import type { Bag } from '@ahpd/sdk';

/**
 * The permission modes every backend offers, in the order a client reads them.
 *
 * The same six `@ahpd/agent-claude` and `@ahpd/agent-cofold` advertise, because
 * the labels are what a person reads and the harness owns the meanings -
 * decision `permission-modes-live-in-the-harness`. `default` asks before a
 * change, and is what a session that chooses none starts on.
 */
export const PERMISSION_MODES = ['default', 'acceptEdits', 'plan', 'auto', 'bypassPermissions', 'dontAsk'] as const;

/** One of the six modes. */
export type PermissionMode = (typeof PERMISSION_MODES)[number];

/** What each mode is called where a person reads it. */
export const PERMISSION_LABELS = [
  'Ask Before Edits',
  'Edit Automatically',
  'Plan Mode',
  'Auto Mode',
  'Bypass Permissions',
  "Don't Ask",
] as const;

/** One line about what each mode does, in this backend's words. */
export const PERMISSION_DESCRIPTIONS = [
  'Asks before writing, going online or destroying anything.',
  'Writes inside the working directory without asking, and asks for other tools.',
  'Reads only: anything that writes or destroys is refused.',
  'Asks only when a tool says it is destructive.',
  'Runs every tool without asking.',
  'Refuses anything that would have needed approval, without asking.',
] as const;

/** The mode a value names, or `default` for one this backend does not know. */
export const modeOf = (value: unknown): PermissionMode =>
  (typeof value === 'string' && (PERMISSION_MODES as readonly string[]).includes(value)
    ? value as PermissionMode
    : 'default');

/** The `permissionMode` control a session publishes, as a client draws it. */
export const permissionModeProperty = (): Bag => ({
  scope: 'session',
  type: 'string',
  title: 'Approvals',
  description: 'How the agent handles tool approvals.',
  enum: [...PERMISSION_MODES],
  enumLabels: [...PERMISSION_LABELS],
  enumDescriptions: [...PERMISSION_DESCRIPTIONS],
  default: 'default',
  sessionMutable: true,
});

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
  /**
   * The client that provides a tool, by the name pi calls it.
   *
   * A client-owned call is reported against that client rather than as the
   * host's own, which is what tells the client it has to run it.
   */
  ownerOf?: (toolName: string) => string | undefined;
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
  /** What the turn's last answer used, when pi reported any. */
  usage?: Bag;
}
