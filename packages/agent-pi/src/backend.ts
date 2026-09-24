/**
 * pi, embedded in this process.
 *
 * `AgentSession` is pi's own abstraction over a conversation and it is
 * constructible from the SDK, so there is no `pi --mode rpc` subprocess here
 * and no stdio between the host and the agent. A subprocess would add process
 * lifecycle and backpressure without isolating anything: the model credentials
 * and the files are the same either way, and the daemon already runs as
 * whoever started it.
 *
 * The seam is deliberately narrow. Everything above it - the turn, the parts,
 * the actions - works against this interface rather than against pi, so the
 * session can be driven in a test without a model provider.
 */

import type { AgentSession, AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import {
  createAgentSessionFromServices,
  createAgentSessionServices,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent';
import { getSupportedThinkingLevels } from '@earendil-works/pi-ai';
import type { PiModel } from './models.js';
import { idOf, modelFor, THINKING_KEY } from './models.js';

/** What a session drives, and all it may ask of pi. */
export interface PiBackend {
  /** pi's own id for this conversation. */
  readonly id: string;
  /** Where the session file is, or nothing when it keeps none. */
  readonly file: string | undefined;
  /** Every event pi raises, until the returned function is called. */
  subscribe(listener: (event: AgentSessionEvent) => void): () => void;
  /** Run a turn. The promise spans the whole run. */
  prompt(text: string): Promise<void>;
  /** Put a message into the turn that is already running. */
  steer(text: string): Promise<void>;
  /** Stop the running turn. */
  abort(): Promise<void>;
  /** The models this session could run on. */
  models(): Promise<PiModel[]>;
  /** The thinking levels a model offers, which is pi's own rule. */
  levels(model: PiModel): string[];
  /** What a new message would run on right now. */
  chosen(): { id: string; config: Record<string, unknown> } | undefined;
  /** Run the next turn on this model, and at this thinking level. */
  choose(id: string, config?: Record<string, unknown>): Promise<void>;
  /** Give the conversation a name pi will keep. */
  rename(title: string): void;
  /**
   * Move the leaf back to an entry, dropping what came after it.
   *
   * pi's sessions are append-only trees, so nothing is deleted: the leaf moves
   * and later messages form a new branch. The context is built leaf to root,
   * so the abandoned path stops being context, which is what the protocol
   * means by a truncation.
   */
  rewind(entryId: string): Promise<boolean>;
  /** Stop, and let go of what the session was holding. */
  close(): void;
}

/** How to build one. */
export interface BackendOptions {
  /** The directory the agent works in. */
  cwd: string;
  /** A conversation of pi's to continue, rather than starting a new one. */
  resume?: string;
  /** Where pi keeps its sessions; its own default when left out. */
  sessionDir?: string;
  /** Whether the project's own pi extensions, skills and prompts are loaded. */
  trustProject?: boolean;
}

/**
 * Open one.
 *
 * The session manager is made here rather than taken, because which one it is
 * decides whether this is a new conversation or one being continued, and that
 * is this function's whole job.
 */
export async function openPi(options: BackendOptions): Promise<PiBackend> {
  const trusted = options.trustProject !== false;
  /*
   * pi's SDK defaults `projectTrusted` to true and does not run the prompt the
   * `pi` command would, so the decision is passed in rather than left to a
   * default: a daemon has nobody to ask, and loading a checked-out
   * repository's extensions is running its code.
   */
  const settingsManager = SettingsManager.create(options.cwd, undefined, { projectTrusted: trusted });
  const sessionManager = resumeOrCreate(options);
  const services = await createAgentSessionServices({ cwd: options.cwd, settingsManager });
  const { session } = await createAgentSessionFromServices({ services, sessionManager });
  return wrap(session);
}

function resumeOrCreate(options: BackendOptions): SessionManager {
  if (options.resume !== undefined) {
    const found = SessionManager.findById(options.cwd, options.resume, options.sessionDir);
    // A session id nobody has is a new conversation rather than a failure: the
    // catalogue and the files can disagree after somebody tidied up, and
    // refusing would lose the prompt that was being sent.
    if (found !== undefined) return SessionManager.open(found, options.sessionDir, options.cwd);
  }
  return SessionManager.create(options.cwd, options.sessionDir);
}

/** The narrow surface, over the session pi built. */
function wrap(session: AgentSession): PiBackend {
  const models = async (): Promise<PiModel[]> => {
    const available = await session.modelRuntime.getAvailable();
    return available as unknown as PiModel[];
  };

  return {
    id: session.sessionId,
    file: session.sessionManager.getSessionFile(),
    subscribe: (listener) => session.subscribe(listener),
    prompt: (text) => session.prompt(text),
    steer: (text) => session.steer(text),
    abort: () => session.abort(),
    models,
    /*
     * Per model, not per session.
     *
     * `AgentSession.getAvailableThinkingLevels()` answers for the model the
     * session is on, which is the wrong question when a client is being
     * offered a list: every row needs its own levels, and a list built from
     * the current model's would offer a control the other rows do not have.
     */
    levels: (model) => getSupportedThinkingLevels(model as never) as string[],
    chosen: () => {
      const model = session.model as PiModel | undefined;
      return model === undefined
        ? undefined
        : { id: idOf(model), config: { [THINKING_KEY]: session.thinkingLevel } };
    },
    choose: async (id, config) => {
      const available = await models();
      const current = session.model as PiModel | undefined;
      const wanted = modelFor(available, id, current);
      /*
       * A pick this host cannot resolve runs on the model the session is
       * already on. It is a stale list in a client that has been open since
       * before a credential changed, and running the turn beats failing it
       * over the name of a model nobody can reach anyway.
       */
      if (wanted === undefined) return;
      if (current === undefined || current.id !== wanted.id || current.provider !== wanted.provider) {
        await session.setModel(wanted as never);
      }
      const level = config?.[THINKING_KEY];
      // Only a level this model actually has: the schema a client filled in
      // may be one it kept from a model with more of them.
      if (typeof level === 'string' && session.getAvailableThinkingLevels().includes(level as never)) {
        session.setThinkingLevel(level as never);
      }
    },
    rename: (title) => { session.setSessionName(title); },
    rewind: async (entryId) => {
      const moved = await session.navigateTree(entryId);
      return !moved.cancelled;
    },
    close: () => { session.dispose(); },
  };
}
