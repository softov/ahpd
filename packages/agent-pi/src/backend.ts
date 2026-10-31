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
  SessionEntry,
  SessionManager,
  ToolCallEvent,
  ToolCallEventResult,
  ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import type { ImageContent, Provider } from '@earendil-works/pi-ai';
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
  prompt(text: string, images?: ImageContent[]): Promise<void>;
  /**
   * Put a message into the turn that is already running, answering with what
   * pi did with it: queued for the turn, or handled by an extension.
   */
  steer(text: string, images?: ImageContent[]): ReturnType<AgentSession['steer']>;
  /** Stop the running turn. */
  abort(): Promise<void>;
  /** The models this session could run on. */
  models(): Promise<PiModel[]>;
  /** The entry the conversation currently ends at, which pi calls its leaf. */
  leaf(): string | undefined;
  /**
   * The first user message pi wrote after an entry, on the path to the leaf:
   * the prompt of a turn that began there, and the entry `replay.ts` names
   * that turn by. Nothing when the entry is not on the path.
   */
  promptAfter(entryId: string | undefined): string | undefined;
  /** The thinking levels a model offers, which is pi's own rule. */
  levels(model: PiModel): string[];
  /** What a new message would run on right now. */
  chosen(): { id: string; config: Record<string, unknown> } | undefined;
  /**
   * Whether the model the session is on takes an image.
   *
   * pi takes one text and a list of images, so a picture the model will not
   * accept is a failed turn rather than a degraded one. The session asks this
   * before it decides whether a picture goes as bytes or by path.
   */
  takesImages(): boolean;
  /**
   * Run the next turn on this model, and at this thinking level.
   *
   * Answers `false` for an id pi's runtime does not have, and the session stays
   * on the model it was already on. What a caller does about that is its own:
   * a turn fails the turn rather than run on another model.
   */
  choose(id: string, config?: Record<string, unknown>): Promise<boolean>;
  /** Give the conversation a name pi will keep. */
  rename(title: string): void;
  /**
   * Put a record's variables on pi's own runtime, before a turn runs.
   *
   * pi resolves a provider's key when a request is prepared, from its stored
   * credential and the process environment, and it has no way to be handed a
   * session's own environment. The runtime's key override is the seam it does
   * have: a key set here beats `auth.json` and is what the model availability
   * list is built from, so a record's own key makes its provider available and
   * is what its requests carry. What the variables do not name is left as it
   * was, which is the daemon's own pi.
   */
  useEnv(env: Record<string, string>): Promise<void>;
  /**
   * Move the leaf back to an entry, dropping what came after it.
   *
   * pi's sessions are append-only trees, so nothing is deleted: the leaf moves
   * and later messages form a new branch. The context is built leaf to root,
   * so the abandoned path stops being context, which is what the protocol
   * means by a truncation.
   */
  rewind(entryId: string): Promise<boolean>;
  /**
   * Continue from a failed reply, without a new message. The promise spans the
   * whole run.
   *
   * The failed reply stays in pi's file and leaves the model's context, the
   * way pi's own retry leaves it: a context edit with `null` on its entry. pi
   * then continues from the message before it, so the calls the turn already
   * ran are not run again. Answers `false`, and runs nothing, when the
   * conversation does not end at a failed reply.
   *
   * The run is outside pi's own loop, so pi raises no `agent_settled` for it
   * and retries nothing itself: what ends the turn is this promise settling.
   */
  resume(): Promise<boolean>;
  /** Stop, and let go of what the session was holding. */
  close(): void;
}

/** How to build one. */
export interface BackendOptions {
  /** The directory the agent works in. */
  cwd: string;
  /** A conversation of pi's to continue, rather than starting a new one. */
  resume?: string;
  /**
   * The entry a fork of `resume` cuts at, copied into a new conversation under
   * a fresh id.
   *
   * AHP means a fork by the conversation through the turn it names, its answer
   * included, with the source left whole.
   */
  forkAt?: string;
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
 * The first user message on a branch after an entry, from its root when there
 * is no entry, and nothing when the entry is not on the branch.
 *
 * The same test `replay.ts` opens a turn on, so the id answered here is the id
 * a turn read back from the file has.
 */
export function promptOf(branch: readonly SessionEntry[], after: string | undefined): string | undefined {
  const at = after === undefined ? -1 : branch.findIndex((entry) => entry.id === after);
  if (after !== undefined && at < 0) return undefined;
  return branch.slice(at + 1).find((entry) => entry.type === 'message' && entry.message.role === 'user')?.id;
}

/**
 * The session manager a backend is built over.
 *
 * A fork cuts the conversation at the entry it was given and continues the
 * copy under pi's own new id. A resumed id with a file continues that file,
 * and a resumed id nobody has is a new conversation under that id, so a client
 * that lost its file keeps its name. Anything else is a new conversation under
 * `id`, or pi's own. Only a UUID is passed to pi, so an id pi would refuse
 * becomes pi's own instead.
 */
export function resumeOrCreate(sdk: Pi, options: BackendOptions): SessionManager {
  const { SessionManager } = sdk;
  if (options.forkAt !== undefined) {
    /*
     * Refused rather than continued empty.
     *
     * A fork with no source, or with a source pi has no file for, would
     * otherwise start a conversation that is not a fork of anything, and a
     * client asking for one would be told it had it.
     */
    if (options.resume === undefined) throw new Error('a fork needs the conversation it copies');
    const from = SessionManager.findById(options.cwd, options.resume, options.sessionDir);
    if (from === undefined) throw new Error(`no pi session to fork from under the id ${options.resume}`);
    const branched = SessionManager.open(from, options.sessionDir, options.cwd);
    /*
     * pi's own branch, which writes the root-to-leaf path under a new id and a
     * new file and points the manager at them. So the backend's id is the
     * fork's and the source file is never appended to. A `leafId` pi does not
     * know throws out of here rather than branching from the whole file.
     */
    branched.createBranchedSession(options.forkAt);
    return branched;
  }
  if (options.resume !== undefined) {
    const found = SessionManager.findById(options.cwd, options.resume, options.sessionDir);
    if (found !== undefined) return SessionManager.open(found, options.sessionDir, options.cwd);
    // A session id nobody has is a new conversation rather than a failure: the
    // catalogue and the files can disagree after somebody tidied up, and
    // refusing would lose the prompt that was being sent. It keeps the id, so
    // the client's name for it still answers.
    if (isUuid(options.resume)) return SessionManager.create(options.cwd, options.sessionDir, { id: options.resume });
  }
  const id = options.id;
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

/**
 * A signal that never aborts.
 *
 * A provider's `resolve` takes one, and the answer here is wanted whatever else
 * a turn is doing: the variables are this session's own, and a turn's stop has
 * no reason to cancel a lookup that already happened.
 */
const STILL = new AbortController().signal;

/** The narrow surface, over the session pi built. */
function wrap(sdk: Pi, session: AgentSession): PiBackend {
  const models = async (): Promise<PiModel[]> => {
    const available = await session.modelRuntime.getAvailable();
    return available as unknown as PiModel[];
  };

  /*
   * The keys this backend has put on pi's runtime, by provider.
   *
   * Held so a turn whose record did not change costs nothing: setting a key
   * makes pi recompose the provider and refresh its whole availability list,
   * which is the right price once and the wrong one on every turn.
   */
  const keyed = new Map<string, string>();

  /**
   * The key pi's own provider takes from a set of variables, or nothing.
   *
   * The provider's `resolve` is the question pi asks itself, asked here against
   * a context that has these variables and no file of the daemon's, so a
   * provider that answers needs nothing else and one that does is left to its
   * own configuration. A resolve that throws answers nothing, for the same
   * reason: it is a provider this record says nothing usable about.
   */
  const keyOf = async (provider: Provider, env: Record<string, string>): Promise<string | undefined> => {
    const resolve = provider.auth.apiKey?.resolve;
    if (resolve === undefined) return undefined;
    try {
      const auth = await resolve({
        ctx: { env: async (name: string) => env[name], fileExists: async () => false },
        signal: STILL,
      });
      return auth?.auth.apiKey;
    }
    catch {
      return undefined;
    }
  };

  return {
    id: session.sessionId,
    file: session.sessionManager.getSessionFile(),
    subscribe: (listener) => session.subscribe(listener),
    prompt: (text, images) => session.prompt(text, {
      source: INPUT_SOURCE,
      ...(images !== undefined && images.length > 0 ? { images } : {}),
    }),
    steer: (text, images) => session.steer(text, images, { source: INPUT_SOURCE }),
    abort: () => session.abort(),
    models,
    leaf: () => session.sessionManager.getLeafId() ?? undefined,
    promptAfter: (entryId) => promptOf(session.sessionManager.getBranch(), entryId),
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
    /*
     * Read off the model the session is on, which is the one the next turn
     * runs on. A session with no model yet answers false, and the picture is
     * named by its path rather than risking a turn the provider refuses.
     */
    takesImages: () => (session.model as PiModel | undefined)?.input?.includes('image') === true,
    choose: async (id, config) => {
      const available = await models();
      const current = session.model as PiModel | undefined;
      const wanted = modelFor(available, id, current);
      /*
       * A pick this host cannot resolve is reported rather than taken, and the
       * session stays on the model it was already on. It is usually a stale
       * list in a client open since before a credential changed, and what that
       * costs is for the caller to decide.
       */
      if (wanted === undefined) return false;
      if (current === undefined || current.id !== wanted.id || current.provider !== wanted.provider) {
        await session.setModel(wanted as never);
      }
      const level = config?.[THINKING_KEY];
      // Only a level this model actually has: the schema a client filled in
      // may be one it kept from a model with more of them.
      if (typeof level === 'string' && session.getAvailableThinkingLevels().includes(level as never)) {
        session.setThinkingLevel(level as never);
      }
      return true;
    },
    rename: (title) => { session.setSessionName(title); },
    /*
     * A record's variables, as pi's runtime takes them.
     *
     * Not `process.env`: the daemon serves several agents at once, and a
     * variable written there would reach every one of them, every child process
     * they start, and outlive the turn. The runtime's own overrides are per
     * session and are never written to disk.
     *
     * A provider whose key the variables no longer name is put back to what
     * pi's own configuration says, so an edit that dropped a key drops it here
     * too rather than leaving the turn before's key in place.
     */
    useEnv: async (env) => {
      const wanted = new Map<string, string>();
      for (const provider of session.modelRuntime.getProviders()) {
        const key = await keyOf(provider, env);
        if (key !== undefined && key !== '') wanted.set(provider.id, key);
      }
      for (const [id, key] of wanted) {
        if (keyed.get(id) === key) continue;
        await session.modelRuntime.setRuntimeApiKey(id, key);
        keyed.set(id, key);
      }
      for (const id of [...keyed.keys()]) {
        if (wanted.has(id)) continue;
        await session.modelRuntime.removeRuntimeApiKey(id);
        keyed.delete(id);
      }
    },
    rewind: async (entryId) => {
      const moved = await session.navigateTree(entryId);
      return !moved.cancelled;
    },
    resume: async () => {
      const entry = session.sessionManager.getLeafEntry();
      const message = entry?.type === 'message' ? entry.message as { role?: string; stopReason?: string } : undefined;
      if (entry === undefined || message?.role !== 'assistant' || message.stopReason !== 'error') return false;
      session.sessionManager.appendContextEdit(entry.id, null);
      session.refreshContext();
      await session.agent.continue();
      return true;
    },
    close: () => { session.dispose(); },
  };
}
