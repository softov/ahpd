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
 * the actions - works against this interface rather than against pi, so a
 * session can be driven without a model provider.
 */

import { join } from 'node:path';
import type {
  AgentSession,
  AgentSessionEvent,
  ExtensionAPI,
  SessionManager,
  ToolCallEvent,
  ToolCallEventResult,
  ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import type { PiModel } from './models.js';
import { idOf, modelFor, THINKING_KEY } from './models.js';
import { loadPi } from './pi.js';
import type { Pi } from './pi.js';

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
  /** The entry the conversation currently ends at, which pi calls its leaf. */
  leaf(): string | undefined;
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
  /** Whether `resume` is copied into a new conversation under a fresh id, leaving the source as it was. */
  fork?: boolean;
  /** The id a new conversation is saved under; pi picks one when left out. */
  id?: string;
  /** Where pi keeps its sessions; its own default when left out. */
  sessionDir?: string;
  /** Whether the project's own pi extensions, skills and prompts are loaded. */
  trustProject?: boolean;
  /** The custom tools pi offers the model, on top of its own. */
  tools?: ToolDefinition[];
  /**
   * What the host wants the model told, appended to pi's own system prompt.
   *
   * Each entry is added after what pi discovered itself, so a project's or a
   * user's `APPEND_SYSTEM.md` keeps its place.
   */
  instructions?: string[];
  /**
   * Asked before pi runs a tool.
   *
   * Returns nothing to let the call run, or a pi result to block it. The
   * session answers from its permission policy, and waits for a person when
   * the policy says to ask.
   */
  onToolCall?: (event: ToolCallEvent) => Promise<ToolCallEventResult | undefined>;
}

/**
 * Open one.
 *
 * The session manager is made here rather than taken, because which one it is
 * decides whether this is a new conversation or one being continued, and that
 * is this function's whole job.
 */
export async function openPi(options: BackendOptions): Promise<PiBackend> {
  const sdk = await loadPi();
  const trusted = options.trustProject !== false;
  /*
   * pi's SDK defaults `projectTrusted` to true and does not run the prompt the
   * `pi` command would, so the decision is passed in rather than left to a
   * default: a daemon has nobody to ask, and loading a checked-out
   * repository's extensions is running its code.
   */
  const settingsManager = sdk.SettingsManager.create(options.cwd, undefined, { projectTrusted: trusted });
  const sessionManager = resumeOrCreate(sdk, options);
  const instructions = options.instructions ?? [];
  const onToolCall = options.onToolCall;
  /*
   * Through the override rather than `appendSystemPrompt`, which replaces what
   * pi discovered - a project's or a user's `APPEND_SYSTEM.md` would stop
   * reaching the prompt. pi joins the list it gets back itself.
   *
   * The inline extension is this host's, not the project's, so it is passed
   * whatever the project trust says; it is loaded after the file extensions,
   * so its `tool_call` handler sees the input the others left.
   */
  const loaderOptions = {
    ...(instructions.length > 0
      ? { appendSystemPromptOverride: (base: string[]) => [...base, ...instructions] }
      : {}),
    ...(onToolCall !== undefined
      ? {
          extensionFactories: [{
            name: 'ahpd',
            hidden: true,
            factory: (pi: ExtensionAPI): void => {
              pi.on('tool_call', (event) => onToolCall(event));
            },
          }],
        }
      : {}),
  };
  const services = await sdk.createAgentSessionServices({
    cwd: options.cwd,
    settingsManager,
    ...(Object.keys(loaderOptions).length > 0 ? { resourceLoaderOptions: loaderOptions } : {}),
  });
  const { session } = await sdk.createAgentSessionFromServices({
    services,
    sessionManager,
    ...(options.tools !== undefined && options.tools.length > 0 ? { customTools: options.tools } : {}),
  });
  return wrap(sdk, session);
}

/** A UUID, the only form of id a session is saved under that pi did not pick itself. */
export const isUuid = (id: string): boolean => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

/**
 * The session manager a backend is built over.
 *
 * A resumed id with a file continues that file, or copies it under a fresh id
 * when `fork` is set. A resumed id nobody has is a new conversation under that
 * id, and anything else is a new conversation under `id`, or pi's own. Only a
 * UUID is passed to pi, so an id pi would refuse becomes pi's own instead.
 */
export function resumeOrCreate(sdk: Pi, options: BackendOptions): SessionManager {
  const { SessionManager } = sdk;
  if (options.resume !== undefined) {
    const found = SessionManager.findById(options.cwd, options.resume, options.sessionDir);
    if (found !== undefined && options.fork === true) return SessionManager.forkFrom(found, options.cwd, options.sessionDir);
    if (found !== undefined) return SessionManager.open(found, options.sessionDir, options.cwd);
    // A session id nobody has is a new conversation rather than a failure: the
    // catalogue and the files can disagree after somebody tidied up, and
    // refusing would lose the prompt that was being sent. It keeps the id, so
    // the client's name for it still answers.
    if (options.fork !== true && isUuid(options.resume)) return SessionManager.create(options.cwd, options.sessionDir, { id: options.resume });
  }
  const id = options.fork === true ? undefined : options.id;
  return SessionManager.create(options.cwd, options.sessionDir, id !== undefined && isUuid(id) ? { id } : undefined);
}

/**
 * How the models pi's own runtime has are read, before any session exists.
 *
 * The default reads pi's agent directory; a caller may pass its own, as a
 * session may pass its own `open`.
 */
export type RuntimeModels = () => Promise<PiModel[]>;

/**
 * The models pi's runtime has for its agent directory.
 *
 * Built the way pi builds a session's runtime, from `auth.json` and
 * `models.json` in the agent directory, so the list is the one a session
 * opened anywhere would report, less what a project's own extensions add.
 */
export const runtimeModels: RuntimeModels = async () => {
  const sdk = await loadPi();
  const agentDir = sdk.getAgentDir();
  const runtime = await sdk.ModelRuntime.create({
    authPath: join(agentDir, 'auth.json'),
    modelsPath: join(agentDir, 'models.json'),
  });
  const available = await runtime.getAvailable();
  return available as unknown as PiModel[];
};

/**
 * What pi is told about where a message came from.
 *
 * `rpc` is pi's own name for input from a program driving it, which is what
 * this host is; the value pi defaults to is `interactive`, which would tell an
 * extension's `input` handler that a person typed at pi's own terminal.
 */
const INPUT_SOURCE = 'rpc' as const;

/** The narrow surface, over the session pi built. */
function wrap(sdk: Pi, session: AgentSession): PiBackend {
  const models = async (): Promise<PiModel[]> => {
    const available = await session.modelRuntime.getAvailable();
    return available as unknown as PiModel[];
  };

  return {
    id: session.sessionId,
    file: session.sessionManager.getSessionFile(),
    subscribe: (listener) => session.subscribe(listener),
    prompt: (text) => session.prompt(text, { source: INPUT_SOURCE }),
    steer: (text) => session.steer(text, undefined, { source: INPUT_SOURCE }),
    abort: () => session.abort(),
    models,
    leaf: () => session.sessionManager.getLeafId() ?? undefined,
    /*
     * Per model, not per session.
     *
     * `AgentSession.getAvailableThinkingLevels()` answers for the model the
     * session is on, which is the wrong question when a client is being
     * offered a list: every row needs its own levels, and a list built from
     * the current model's would offer a control the other rows do not have.
     */
    levels: (model) => sdk.getSupportedThinkingLevels(model as never) as string[],
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
