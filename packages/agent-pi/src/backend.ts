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
  InlineExtension,
  LoadExtensionsResult,
  PromptTemplate,
  ResourceDiagnostic,
  SessionEntry,
  SessionManager,
  Skill,
  ToolCallEvent,
  ToolCallEventResult,
  ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import type { ImageContent, Provider } from '@earendil-works/pi-ai';
import type { PiResources } from './customizations.js';
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
   * Hand the next turn words the model reads and nobody is shown: pi's own
   * custom message, delivered with that turn's run and kept out of its
   * transcript, which is pi's way for words beside a prompt.
   */
  sendCustomMessage(content: string): Promise<void>;
  /**
   * Keep data in the conversation's file that the model never reads: pi's own
   * custom entry, which is how pi keeps an extension's data with a session.
   */
  appendEntry(customType: string, data: unknown): void;
  /**
   * Put a message into the turn that is already running, answering with what
   * pi did with it: queued for the turn, or handled by an extension.
   */
  steer(text: string, images?: ImageContent[]): ReturnType<AgentSession['steer']>;
  /**
   * Let go of every steering message pi holds and has not read, which pi
   * says as its queue emptied.
   */
  clearSteering(): void;
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
  /**
   * What pi's loader found for this session, its skills, its prompt templates
   * and its extensions, the ones switched off among them.
   */
  resources(): PiResources;
  /**
   * The level pi starts a session on for a model, as its settings name it: the
   * model's own `modelThinkingLevels` entry, else `defaultThinkingLevel`.
   */
  startsOn(model: PiModel): string | undefined;
  /** The protocol's `ModelSelection` a new message would run on right now. */
  modelSelection(): { id: string; config: Record<string, unknown> } | undefined;
  /**
   * Whether the model the session is on takes an image, the spec's
   * `supportsVision`.
   *
   * pi takes one text and a list of images, so a picture the model will not
   * accept is a failed turn rather than a degraded one. The session asks this
   * before it decides whether a picture goes as bytes or by path.
   */
  supportsVision(): boolean;
  /**
   * Run the next turn on this model, and at this thinking level: pi's own
   * `setModel` and `setThinkingLevel`.
   *
   * Answers `false` for an id pi's runtime does not have, and the session stays
   * on the model it was already on, which the turn then runs on.
   */
  setModel(id: string, config?: Record<string, unknown>): Promise<boolean>;
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
   * means by a truncation and VS Code's agents call `truncate`.
   */
  truncate(entryId: string): Promise<boolean>;
  /**
   * Continue from a failed reply or a cut-off request, without a new message.
   * The promise spans the whole run.
   *
   * A failed reply, and an answer cut off while it asked for tools, stay in
   * pi's file and leave the model's context, the way pi's own retry leaves a
   * failed one: a context edit with `null` on its entry. pi then continues
   * from the message before it, so the calls the turn already ran are not run
   * again. A request cut off at its prompt or at a tool's result goes on from
   * there. Answers `false`, and runs nothing, where `resumePoint` finds
   * nothing to continue from.
   *
   * A conversation that ends at that edit, over the failed or cut-off answer,
   * is one an earlier resume left when its continue threw before pi wrote
   * anything. It still ends at that answer, and is continued again without a
   * second edit: the reference host marks a resume that failed resumable, so a
   * client may ask again.
   * https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentSideEffects.ts#L1850-L1873
   *
   * The run is outside pi's own loop, so pi raises no `agent_settled` for it
   * and retries nothing itself: what ends the turn is this promise settling.
   */
  resume(): Promise<boolean>;
  /** Stop, and let go of what the session was holding: pi's own `dispose`. */
  dispose(): void;
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
  /** The id a new conversation is saved under; pi picks one when left out or when its own check refuses this one. */
  id?: string;
  /** Where pi keeps its sessions; its own default when left out. */
  sessionDir?: string;
  /** The id the endpoint's provider is registered under; `pi` when left out. */
  provider?: string;
  /**
   * The OpenAI-compatible endpoint this session runs on, or nothing to run on
   * pi's own providers. Its models are read from `<baseUrl>/models`.
   */
  baseUrl?: string;
  /** The key the endpoint's requests carry, or nothing to send none. */
  apiKey?: string;
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
  /**
   * The files of the skills, prompt templates and extensions this session has
   * switched off, which pi's loader leaves out through its own overrides.
   */
  switchedOff?: ReadonlySet<string>;
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
  /*
   * What pi's loader found, kept whole, and what this session switched off
   * left out of what pi loads, through the loader's own overrides: each
   * override is handed the whole list and answers the list pi keeps.
   */
  const switchedOff = options.switchedOff ?? new Set<string>();
  const found: PiResources = { skills: [], prompts: [], extensions: [] };
  const endpoint = endpointOf(options);
  /*
   * This host's inline extensions: the tool-call policy, and for an endpoint
   * with no key, the handler that removes the placeholder key's header. pi
   * builds the header from the registered key, so `null` here is what keeps a
   * keyless endpoint's requests keyless.
   */
  const inlineExtensions: InlineExtension[] = [];
  if (onToolCall !== undefined) {
    inlineExtensions.push({
      name: 'ahpd',
      hidden: true,
      factory: (pi: ExtensionAPI): void => {
        pi.on('tool_call', (event) => onToolCall(event));
      },
    });
  }
  if (endpoint !== undefined && endpoint.apiKey === undefined) {
    inlineExtensions.push({
      name: 'ahpd-endpoint',
      hidden: true,
      factory: (pi: ExtensionAPI): void => {
        // Only the endpoint's own requests go keyless: a model of another
        // provider in the same session keeps the key its provider sends.
        pi.on('before_provider_headers', (event, ctx) => {
          if (ctx.model?.provider === endpoint.provider) event.headers.authorization = null;
        });
      },
    });
  }
  const loaderOptions = {
    ...(instructions.length > 0
      ? { appendSystemPromptOverride: (base: string[]) => [...base, ...instructions] }
      : {}),
    ...(inlineExtensions.length > 0 ? { extensionFactories: inlineExtensions } : {}),
    skillsOverride: (base: { skills: Skill[]; diagnostics: ResourceDiagnostic[] }) => {
      found.skills = base.skills;
      return { ...base, skills: base.skills.filter((one) => !switchedOff.has(one.filePath)) };
    },
    promptsOverride: (base: { prompts: PromptTemplate[]; diagnostics: ResourceDiagnostic[] }) => {
      found.prompts = base.prompts;
      return { ...base, prompts: base.prompts.filter((one) => !switchedOff.has(one.filePath)) };
    },
    extensionsOverride: (base: LoadExtensionsResult) => {
      found.extensions = base.extensions;
      return { ...base, extensions: base.extensions.filter((one) => !switchedOff.has(one.path)) };
    },
  };
  const services = await sdk.createAgentSessionServices({
    cwd: options.cwd,
    settingsManager,
    resourceLoaderOptions: loaderOptions,
  });
  const { session } = await sdk.createAgentSessionFromServices({
    services,
    sessionManager,
    ...(options.tools !== undefined && options.tools.length > 0 ? { customTools: options.tools } : {}),
  });
  if (endpoint !== undefined) await registerEndpoint(sdk, session.modelRuntime, endpoint);
  return wrap(sdk, session, found);
}

/** How long an endpoint's model list may take before it is read as none. */
const ENDPOINT_TIMEOUT_MS = 10_000;

/**
 * The key a keyless endpoint's provider is registered with.
 *
 * pi counts a provider as configured only when it has a key, and its
 * OpenAI-compatible adapter sends whatever key it is given as an
 * `Authorization` header. This placeholder is that key: the provider counts as
 * configured, and the session's own extension removes the header before the
 * request leaves, as `before_provider_headers` does with a `null`.
 */
const KEYLESS_API_KEY = 'ahpd-keyless';

/**
 * The endpoint a record runs on, as one provider of a runtime.
 *
 * The id is the record's own, so a model the endpoint lists is named
 * `<record id>/<model id>`, as pi spells a model of its configured providers.
 */
export interface EndpointOptions {
  /** The id the provider is registered under. */
  provider: string;
  /** The OpenAI-compatible endpoint, such as `https://api.example.com/v1`. */
  baseUrl: string;
  /** The key its requests carry, or nothing to send none. */
  apiKey?: string;
}

/** The runtime a provider is registered on, one per session and one per probe. */
type Runtime = ConstructorParameters<Pi['ModelRegistry']>[0];

/**
 * One model an OpenAI-compatible endpoint lists, as pi's provider takes it.
 *
 * The endpoint may know more than its `/models` answers, so the defaults are
 * pi's own for a model defined from a name alone: text in, no cost, pi's
 * context window and token ceiling.
 */
interface EndpointModel {
  id: string;
  name: string;
  reasoning: boolean;
  input: ('text' | 'image')[];
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
  contextWindow: number;
  maxTokens: number;
}

/** One model the endpoint listed, by its id. */
const endpointModel = (id: string): EndpointModel => ({
  id,
  name: id,
  reasoning: false,
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128_000,
  maxTokens: 16_384,
});

/**
 * The models an OpenAI-compatible endpoint lists, at `<baseUrl>/models`.
 *
 * Anything that goes wrong - a refused connection, a wrong shape, a timeout -
 * is an empty list: a record whose endpoint cannot answer still opens, and the
 * probe answers none of that endpoint's models rather than failing.
 */
export const endpointModels = async (baseUrl: string, apiKey: string | undefined): Promise<EndpointModel[]> => {
  try {
    const at = `${baseUrl.replace(/\/+$/u, '')}/models`;
    const answer = await fetch(at, {
      ...(apiKey === undefined ? {} : { headers: { authorization: `Bearer ${apiKey}` } }),
      signal: AbortSignal.timeout(ENDPOINT_TIMEOUT_MS),
    });
    if (!answer.ok) return [];
    const said = await answer.json() as { data?: unknown };
    if (!Array.isArray(said.data)) return [];
    return said.data.flatMap((one) => {
      const id = (one as { id?: unknown } | null)?.id;
      return typeof id === 'string' && id !== '' ? [endpointModel(id)] : [];
    });
  }
  catch {
    return [];
  }
};

/**
 * Give a runtime the record's OpenAI-compatible endpoint.
 *
 * `ModelRegistry` is a facade over one runtime, so the provider lives only
 * there: registered on a session's runtime after pi is built, it replaces a
 * provider of the same id for that session's turns and for no other session's;
 * registered on the probe's own runtime, it is in the list the probe reads.
 *
 * The provider's models are the endpoint's `/models` as the registration is
 * made, and `refreshModels` reads them again when pi asks for a refresh, as an
 * extension's provider does. A listing that fails is an empty list, so a
 * record whose endpoint cannot answer still opens and still probes.
 *
 * A record with no key registers the placeholder key, because pi counts a
 * provider configured only with one; both listings go to the endpoint with no
 * `Authorization` header, as the record asked.
 */
const registerEndpoint = async (sdk: Pi, runtime: Runtime, endpoint: EndpointOptions): Promise<void> => {
  const models = await endpointModels(endpoint.baseUrl, endpoint.apiKey);
  new sdk.ModelRegistry(runtime).registerProvider(endpoint.provider, {
    name: endpoint.provider,
    baseUrl: endpoint.baseUrl,
    apiKey: endpoint.apiKey ?? KEYLESS_API_KEY,
    api: 'openai-completions',
    models,
    refreshModels: () => endpointModels(endpoint.baseUrl, endpoint.apiKey),
  });
};

/** The endpoint a backend's options name, or nothing when they name none. */
const endpointOf = (options: BackendOptions): EndpointOptions | undefined =>
  options.baseUrl === undefined ? undefined : {
    provider: options.provider ?? 'pi',
    baseUrl: options.baseUrl,
    ...(options.apiKey === undefined ? {} : { apiKey: options.apiKey }),
  };

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
 * Where a resume continues a conversation from, or nothing when its last
 * request ended.
 *
 * A failed reply, and an answer cut off while it asked for tools, are what the
 * resume `drop`s from the model's context before it asks the model again. One
 * an earlier resume dropped already, with the context edit it wrote as the
 * last entry, is continued from with nothing more dropped: that resume's
 * continue threw before pi wrote anything. A request cut off at its prompt or
 * at a tool's result goes on from there, as pi's `Agent.continue` does from a
 * user message or a tool's result. The same reading `replay.ts` marks a turn
 * interrupted by.
 */
export function resumePoint(manager: Pick<SessionManager, 'getLeafEntry' | 'getEntry'>): { drop?: string } | undefined {
  const leaf = manager.getLeafEntry();
  const edited = leaf?.type === 'context_edit' && leaf.replacement === null && leaf.parentId === leaf.targetId;
  const entry = edited ? manager.getEntry(leaf.targetId) : leaf;
  const message = entry?.type === 'message' ? entry.message as { role?: string; stopReason?: string } : undefined;
  if (entry === undefined || message === undefined) return undefined;
  if (message.role === 'assistant') {
    if (message.stopReason !== 'error' && message.stopReason !== 'toolUse') return undefined;
    return edited ? {} : { drop: entry.id };
  }
  return !edited && (message.role === 'user' || message.role === 'toolResult') ? {} : undefined;
}

/**
 * The session manager a backend is built over.
 *
 * A fork cuts the conversation at the entry it was given and continues the
 * copy under pi's own new id. A resumed id with a file continues that file,
 * and a resumed id nobody has is a new conversation under that id, so a client
 * that lost its file keeps its name. Anything else is a new conversation under
 * `id`, or pi's own. An id is offered to pi as its `--session-id` takes one,
 * opened where it exists and created where it does not, and pi's own check
 * decides whether it is an id: one pi refuses (letters, numbers, '.', '_' and
 * '-', starting and ending with a letter or number) becomes pi's own instead.
 * https://www.npmjs.com/package/@earendil-works/pi-coding-agent (docs/cli.md, `--session-id`)
 */
export function resumeOrCreate(sdk: Pi, options: BackendOptions): SessionManager {
  const { SessionManager } = sdk;
  // Created under `id` where pi's own check takes it, and nothing otherwise.
  const createdAs = (id: string): SessionManager | undefined => {
    try {
      return SessionManager.create(options.cwd, options.sessionDir, { id });
    }
    catch {
      return undefined;
    }
  };
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
    const created = createdAs(options.resume);
    if (created !== undefined) return created;
  }
  return (options.id === undefined ? undefined : createdAs(options.id)) ?? SessionManager.create(options.cwd, options.sessionDir);
}

/**
 * How the models a runtime has are read, before any session exists, each with
 * the thinking levels pi's own rule gives it.
 *
 * The default reads pi's agent directory; a caller may pass its own, as a
 * session may pass its own `open`. A record's endpoint is given as well, so the
 * list is what a session of that record would report, its provider included.
 */
export type RuntimeModels = (
  endpoint?: EndpointOptions,
) => Promise<{ model: PiModel; levels: string[]; startsOn?: string }[]>;

/**
 * The models pi's runtime has for its agent directory.
 *
 * Built the way pi builds a session's runtime, from `auth.json` and
 * `models.json` in the agent directory, so the list is the one a session
 * opened anywhere would report, less what a project's own extensions add; the
 * level pi starts each on from the agent directory's own settings, no
 * project's. A record's endpoint is registered on that runtime first, so its
 * models are listed beside pi's own, and a provider of the same id is replaced
 * for this list as it is for the session's.
 */
export const runtimeModels: RuntimeModels = async (endpoint) => {
  const sdk = await loadPi();
  const agentDir = sdk.getAgentDir();
  const runtime = await sdk.ModelRuntime.create({
    authPath: join(agentDir, 'auth.json'),
    modelsPath: join(agentDir, 'models.json'),
  });
  if (endpoint !== undefined) await registerEndpoint(sdk, runtime, endpoint);
  const settings = sdk.SettingsManager.create(agentDir, agentDir, { projectTrusted: false });
  const available = await runtime.getAvailable();
  return (available as unknown as PiModel[]).map((model) => {
    const startsOn = settings.getModelThinkingLevel(model.provider, model.id) ?? settings.getDefaultThinkingLevel();
    return {
      model,
      levels: sdk.getSupportedThinkingLevels(model as never) as string[],
      ...(startsOn === undefined ? {} : { startsOn }),
    };
  });
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

/** The narrow surface, over the session pi built and what its loader found. */
function wrap(sdk: Pi, session: AgentSession, found: PiResources): PiBackend {
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
    sendCustomMessage: (content) => session.sendCustomMessage(
      { customType: 'ahpd.instructions', content, display: false },
      { deliverAs: 'nextTurn' },
    ),
    appendEntry: (customType, data) => { session.sessionManager.appendCustomEntry(customType, data); },
    clearSteering: () => { session.clearQueue(); },
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
    resources: () => found,
    startsOn: (model) => session.settingsManager.getModelThinkingLevel(model.provider, model.id) ?? session.settingsManager.getDefaultThinkingLevel(),
    // The model pi is on, with the level it is on in the config the model's
    // schema puts it in, wherever pi moved it.
    modelSelection: () => {
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
    supportsVision: () => (session.model as PiModel | undefined)?.input?.includes('image') === true,
    setModel: async (id, config) => {
      const available = await models();
      const current = session.model as PiModel | undefined;
      // Every provider pi has, not only the keyed ones `available` lists.
      const providers = new Set(session.modelRuntime.getProviders().map((provider) => provider.id));
      const wanted = modelFor(available, id, current, providers);
      /*
       * A pick this host cannot resolve is reported, and the session stays on
       * the model it was already on. It is usually a stale list in a client
       * open since before a credential changed, and the turn runs on the model
       * in force.
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
    truncate: async (entryId) => {
      const moved = await session.navigateTree(entryId);
      return !moved.cancelled;
    },
    resume: async () => {
      const point = resumePoint(session.sessionManager);
      if (point === undefined) return false;
      if (point.drop !== undefined) {
        session.sessionManager.appendContextEdit(point.drop, null);
        session.refreshContext();
      }
      await session.agent.continue();
      return true;
    },
    dispose: () => { session.dispose(); },
  };
}
