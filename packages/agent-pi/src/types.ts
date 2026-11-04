/**
 * What this package is configured with, and what it keeps while a turn runs.
 *
 * Nothing here imports a runtime value, so the shapes can be read without
 * loading pi or the host.
 */

import type { Bag } from '@ahpd/sdk';
import type { BackendOptions, PiBackend } from './backend.js';

/**
 * The title a pi conversation carries until something better is known.
 *
 * `session` gives it to a session nobody has said anything in, and `catalog`
 * gives it to a row pi itself never named, so the two are here rather than
 * written twice: a client sent one word for a row and another for the session
 * behind it would be sent a change that never happened.
 */
export const UNTITLED = 'pi session';

/**
 * The custom entry a turn's message is kept under in pi's file.
 *
 * pi's prompt is one text, the person's words joined with the attachments
 * inlined and the reference block, so the message as the turn had it is kept
 * beside it as pi keeps an extension's data: an entry the model never reads,
 * written just before pi writes the turn's prompt. `replay.ts` reads it back as
 * the message of the prompt that follows it, as VS Code's readers take a
 * restored message's text, attachments and model from the runtime's record.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/copilot/mapSessionEvents.ts#L852-L890
 */
export const MESSAGE_ENTRY = 'ahpd.message';

/**
 * The error a turn still running when its record is read ends with, as VS
 * Code's reader ends a turn whose request is still active at the end of its
 * events: a resumable `executionInterrupted`.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/copilot/copilotAgent.ts#L7991-L7994
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/copilot/mapSessionEvents.ts#L1152-L1155
 */
export const INTERRUPTED = {
  errorType: 'executionInterrupted',
  message: 'The agent was interrupted before this request finished.',
} as const;

/**
 * The permission modes every backend offers, in the order a client reads them.
 *
 * The same six `@ahpd/agent-claude` and `@ahpd/agent-cofold` advertise, because
 * the labels are what a person reads and the harness owns the meanings. `default` asks before a
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
  /**
   * Variables the record names, by name, as pi's runtime takes them.
   *
   * A record's key is here, read back from the vault by the channel. The
   * session puts these on pi's own runtime at each turn, so what a record names
   * wins over the daemon's environment and what it does not name is left as it
   * is.
   */
  env?: Record<string, string>;
  /**
   * A reader for the record this backend was opened for, or nothing for one
   * that was not.
   *
   * The session calls it at the start of each turn, which is how an edit of a
   * running agent's record applies at the next turn rather than at a restart.
   */
  recordOf?: () => PiOptions;
  /**
   * How a session opens pi: the embedded one by default, or a caller's own.
   *
   * Only an embedder or a test passes one - a function is not something a
   * configuration file carries - and it is what lets a suite drive a whole
   * turn lifecycle without a model provider.
   */
  open?: (options: BackendOptions) => Promise<PiBackend>;
  /** Where a line for the daemon's log goes; the plugin hands the host's. */
  log?: (line: string) => void;
}

/** One tool call inside a running turn, as far as the wire cares. */
export interface PiCall {
  toolCallId: string;
  toolName: string;
  displayName: string;
  /** What the call runs on, as its row is titled once pi names its arguments. */
  said?: string;
  /** The arguments pi named for the call, which its past tense reads. */
  input?: Bag;
  /** The output a shell call has printed so far, which each change says whole. */
  output?: string;
}

/** The running turn, and what has been opened inside it. */
export interface PiTurn {
  turnId: string;
  /** How many assistant messages this turn has started, which numbers the one streaming. */
  messages: number;
  /** Each thinking or text block's part id, by `${message}:${contentIndex}`. */
  blocks: Map<string, string>;
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
  /** How the turn ended, or nothing while it runs. */
  state?: 'complete' | 'cancelled' | 'error';
  duration?: number;
  /** What the turn's last answer used, when pi reported any. */
  usage?: Bag;
}
