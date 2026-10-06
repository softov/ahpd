/**
 * The cofold agent runtime as an AHP backend.
 *
 * `@cofold/agents` owns the loop, the conversation, the tools, the policy, the
 * pause and the store; `@cofold/model-openai-compat` owns one transport. What
 * this package adds is the AHP half, so a model or an endpoint is a session
 * setting rather than a package of its own.
 *
 * This file holds the backend's identity: the provider, the schema a client
 * fills in, the defaults, the model factory and the store. The session that
 * runs a turn is `session.ts`, and the plugin entry is `plugin.ts`.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { createMemoryStore, textOf } from '@cofold/agents';
import type { ModelAdapter, ModelInfo, ModelProvider, Policy, ReasoningEffort, Store } from '@cofold/agents';
import { openaiCompat, openaiCompatProvider } from '@cofold/model-openai-compat';
import { createFileStore } from '@cofold/store-file';
import type { Agent, Bag, Listed, MachineNeed, Offered } from '@ahpd/sdk';
import { harnessConfig, harnessConfigPath, splitModel } from './config.js';
import type { HarnessConfig, HarnessProvider } from './config.js';
import type { ToolsConfig } from './capabilities.js';
import { cofoldSession } from './session.js';
import { turnsOf } from './transcript.js';

/** What an embedder, or a plugin's options, may set. */
export interface CofoldOptions {
  /** The AHP provider id. Default `cofold`. */
  provider?: string;
  /** What a client reads instead of the id. Default `Cofold`. */
  displayName?: string;
  /** One line about what this backend is. */
  description?: string;
  /** The endpoint a session that names none runs against. */
  baseUrl?: string;
  /** The key to send, or a function asked once per request so an expired one is not cached. */
  apiKey?: string | (() => string | Promise<string>);
  /**
   * The protected resource a client authenticates against.
   *
   * Defaults to the origin of `baseUrl` when that is an `https` URL, and to a
   * constant naming this backend otherwise. It is advertised on
   * `AgentInfo.protectedResources`, and the protocol only lets a client push a
   * token for a resource the host advertised.
   */
  resource?: string;
  /** The model id a session that names none runs on. */
  model?: string;
  /** The system prompt the agent is created with. */
  instructions?: string;
  /**
   * The configuration directory the harness reads *inside a machine*.
   *
   * The configuration is mounted there and `COFOLD_CONFIG` is pointed at the
   * file, so a cofold host in the machine finds the providers whatever user the
   * image runs as, and `XDG_CONFIG_HOME` is left as the image has it.
   * `false` says nothing at all and leaves the image's own.
   */
  computerConfigDir?: string | false;
  /** Where the file store lives; absent means the tool's own data directory. */
  store?: string;
  /** Hold everything in memory instead of on disk; for a test. */
  memory?: boolean;
  /**
   * Which of `@cofold/tools`' four capabilities a session runs.
   *
   * All four - files, shell, web and memory - are on when this is absent, and
   * `false` turns one off. `web` may also be an object, which is where
   * `web_search` gets its providers; without one the session has `web_fetch`
   * alone. The capabilities run in cofold's own process, so they act on the
   * machine the daemon runs on.
   */
  tools?: ToolsConfig;
  /** A model adapter to use instead of `openaiCompat`; for a test or an embedder. */
  adapter?: ModelAdapter;
  /**
   * The estimated history size at which a session folds itself into a summary.
   *
   * Never above 80% of the model's listed `contextTokens`, or of 32000 when the
   * list gave none, and that 80% is what an absent value means: a point at the
   * window itself would make the summary step ask for more than the model can
   * take.
   */
  autoCompactTokens?: number;
  /**
   * The run-level policy an approval decision comes from.
   *
   * Absent means cofold's own default, which asks about a destructive tool and
   * allows the rest; this bridge carries a policy through rather than
   * inventing a second default beside it.
   */
  policy?: Partial<Policy>;
}

/**
 * Where a cofold store lives when nothing named one.
 *
 * Data rather than configuration: sessions and runs are written by the daemon,
 * not edited by a person, and `XDG_DATA_HOME` is the variable for exactly that.
 */
export const defaultStoreRoot = (): string =>
  join(process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'), 'ahpd', 'cofold');

/** A short string, or nothing for a blank or missing one. */
const text = (value: unknown): string | undefined =>
  (typeof value === 'string' && value.trim() !== '' ? value : undefined);

/**
 * The line a catalogue row draws for a session.
 *
 * The store keeps no title of its own, so the first thing the person said is
 * the honest one; a session that has said nothing is titled by its id. The
 * whitespace is folded and the line bounded, because a title is one row and a
 * first message can be a pasted file.
 */
const titleOf = (said: string, fallback: string): string => {
  const line = said.replace(/\s+/g, ' ').trim();
  return line === '' ? fallback : line.slice(0, 200);
};

/** The resource a client authenticates against when nothing named one. */
export const FALLBACK_RESOURCE = 'https://ahpd.dev/agent-cofold';

/**
 * The approvals modes a session may be put in, in the window's own order.
 *
 * The same six the Claude backend advertises, because the labels are what a
 * person reads and the harness owns the meanings: `policyOf` in
 * `@cofold/agents` is what a mode becomes. `auto` is cofold's own default, so
 * that is what a session that chooses none starts on.
 */
export const PERMISSION_MODES = ['default', 'acceptEdits', 'plan', 'auto', 'bypassPermissions', 'dontAsk'] as const;

/** What each mode is called where a person reads it. */
export const PERMISSION_LABELS = [
  'Ask Before Edits',
  'Edit Automatically',
  'Plan Mode',
  'Auto Mode',
  'Bypass Permissions',
  "Don't Ask",
] as const;

/** One line about what each mode does, in this backend's words rather than the Claude SDK's. */
export const PERMISSION_DESCRIPTIONS = [
  'Asks before writing, going online or destroying anything.',
  'Writes inside the working directory without asking, and asks for other tools.',
  'Reads only: anything that writes or destroys is refused.',
  'Asks only when a tool says it is destructive.',
  'Runs every tool without asking.',
  'Refuses anything that would have needed approval, without asking.',
] as const;

/** The thinking levels a turn may be given, `off` first. */
export const EFFORT_LEVELS = ['off', 'low', 'medium', 'high'] as const;

/**
 * The reasoning effort a session's setting names.
 *
 * `off`, a missing value and anything unrecognised all send nothing: an
 * endpoint is not troubled with a field for a model that was not asked to
 * think, which is also the only form the adapter's `features.reasoning` lets
 * through until a level is actually chosen.
 */
export const effortOf = (value: unknown): ReasoningEffort | undefined =>
  value === 'low' || value === 'medium' || value === 'high' ? value : undefined;

/**
 * The protected resource a token for this backend belongs to.
 *
 * `resource` when it was named, the origin of an `https` endpoint when one is
 * known - the plugin's own `baseUrl`, or the endpoint the harness
 * configuration's model names - and a constant otherwise. RFC 9728 wants an
 * `https` URL with no fragment, which is why the endpoint's origin is used
 * rather than the whole URL: a token is for the service, not for one path
 * under it.
 */
export const resourceOf = (options: CofoldOptions = {}, harness: HarnessConfig = harnessConfig()): string => {
  if (options.resource !== undefined) return options.resource;
  const named = options.baseUrl ?? endpointOf(options, harness)?.baseUrl;
  if (named !== undefined) {
    try {
      const url = new URL(named);
      if (url.protocol === 'https:') return url.origin;
    }
    catch {
      // Not a URL at all, so there is nothing to name a resource after.
    }
  }
  return FALLBACK_RESOURCE;
};

/**
 * The configuration provider a model reference names, when it names one.
 *
 * A reference is `<provider>/<model>`; a plain model id, or one whose provider
 * the file does not carry, selects nothing and the caller falls back to the
 * explicit endpoint or the first provider.
 */
const endpointOf = (
  options: CofoldOptions,
  harness: HarnessConfig,
  ref?: string,
): HarnessProvider | undefined => {
  const model = ref ?? options.model ?? harness.model;
  if (model === undefined) return undefined;
  const named = splitModel(model);
  if (named === undefined) return undefined;
  return harness.providers.find((one) => one.id === named.provider);
};

/**
 * Where a model is asked for, and with what.
 *
 * One resolution for both the adapter a turn runs on and the catalogue a
 * picker draws, so the two cannot disagree about which endpoint is in force:
 * a model offered by the list is selected through the same provider, base URL,
 * key and headers the list was read from.
 */
export interface Connection {
  /** The model as it was spelled: a reference, or a bare id. */
  reference?: string;
  /** The model id the endpoint is asked for, without any provider prefix. */
  model?: string;
  baseUrl: string;
  apiKey?: string | (() => string | Promise<string>);
  headers?: Record<string, string>;
  /**
   * The prefix a model this endpoint serves is offered under.
   *
   * The harness provider that owns the endpoint, so a choice selects the same
   * provider back; this backend's own id when no entry owns it, which `modelOf`
   * accepts for the endpoint it was configured with.
   */
  prefix: string;
}

/** The endpoint a model is asked for when nothing named one; LM Studio's own port. */
const LOCAL_ENDPOINT = 'http://127.0.0.1:1234/v1';

/**
 * The model reference a turn runs on, where nothing here builds an adapter.
 *
 * One rule for the adapter and the reference both: the values in force name a
 * model, else the plugin option names one, else the harness file does.
 */
export const modelReferenceOf = (
  options: CofoldOptions,
  settings: Record<string, unknown>,
  harness: HarnessConfig,
): string | undefined => text(settings.model) ?? options.model ?? harness.model;

/**
 * Resolve the connection a model setting names, without requiring that a model
 * was chosen: a probe lists what an endpoint serves before anybody picks.
 *
 * `strict` is the difference between asking and running. A call that builds an
 * adapter refuses a missing model and a reference naming a provider the file
 * does not carry; a call that only reads a catalogue falls back to the first
 * provider's endpoint and lists what it has.
 */
const connectionOf = (
  options: CofoldOptions,
  settings: Record<string, unknown>,
  credentials: Record<string, string>,
  harness: HarnessConfig,
  strict: boolean,
): Connection => {
  const own = options.provider ?? 'cofold';
  const reference = modelReferenceOf(options, settings, harness);
  const named = reference === undefined ? undefined : splitModel(reference);
  const provider = endpointOf(options, harness, reference);
  const explicitBase = text(settings.baseUrl) ?? options.baseUrl;
  // A reference under this backend's own id names the endpoint it was
  // configured with rather than a provider the harness file would have to hold.
  const ownRef = named !== undefined && named.provider === own;
  if (strict) {
    if (reference === undefined) {
      throw new Error(`${own}: no model is configured and this backend has no default; add "model" (as "<provider>/<model>") to ${harness.path}`);
    }
    if (named !== undefined && provider === undefined && explicitBase === undefined && !ownRef) {
      const known = harness.providers.map((one) => one.id);
      throw new Error(`${own}: model "${reference}" names provider "${named.provider}", and ${harness.path} configures ${known.length === 0 ? 'none' : known.join(', ')}`);
    }
  }
  const model = reference === undefined ? undefined : (named === undefined ? reference : named.modelId);
  const baseUrl = explicitBase ?? provider?.baseUrl ?? harness.providers[0]?.baseUrl ?? LOCAL_ENDPOINT;
  const lent = credentials[resourceOf(options, harness)];
  const key = text(lent) ?? options.apiKey ?? provider?.apiKey ?? harness.providers[0]?.apiKey;
  return {
    ...(reference === undefined ? {} : { reference }),
    ...(model === undefined ? {} : { model }),
    baseUrl,
    ...(key === undefined ? {} : { apiKey: key }),
    ...(provider?.headers === undefined ? {} : { headers: provider.headers }),
    prefix: provider?.id ?? own,
  };
};

/** How long the endpoint is given to publish its catalogue before the configured model stands alone. */
const CATALOGUE_TIMEOUT_MS = 5000;

/**
 * One catalogue entry as a client is offered it.
 *
 * The id is already the reference the endpoint's own id was read into. The two
 * limits travel only when the endpoint published a positive number for them,
 * the way pi's offered rows do, so a model nothing is known about gets no
 * number rather than a made-up one and a client sizes the conversation against
 * what the endpoint actually said.
 *
 * Nothing else of `ModelInfo` travels: a row is what a picker draws, and the
 * catalogue's `features` and `pricing` are what a turn is built from.
 */
export const rowOf = (info: ModelInfo): Offered['models'][number] => ({
  id: info.id,
  name: info.name,
  ...(typeof info.contextTokens === 'number' && info.contextTokens > 0 ? { maxContextWindow: info.contextTokens } : {}),
  ...(typeof info.maxOutputTokens === 'number' && info.maxOutputTokens > 0 ? { maxOutputTokens: info.maxOutputTokens } : {}),
});

/**
 * What the backend already holds for a turn's model.
 *
 * A session `cofoldAgent` built is handed this, so its turn is built from the
 * transport the catalogue was read through and with the price that catalogue
 * listed for the model; a session built by a caller that named none has
 * nothing here, and `modelOf` builds an adapter of its own.
 */
export interface Held {
  /** The transport one endpoint is asked through, built once per endpoint and key. */
  providerOf(connection: Connection): ModelProvider;
  /** What the catalogue said about a model reference, read from the cache. */
  infoOf(reference: string | undefined): ModelInfo | undefined;
}

/**
 * The model a session runs on.
 *
 * The settings a client sent win over the package's own, which win over the
 * harness configuration, and a caller-passed adapter wins over all three. A
 * model written `<provider>/<model>` selects that provider's endpoint and key
 * from the harness file, which is the whole point of reading it: a person who
 * has already pointed cofold at a provider does not say it again here, and no
 * token has to be lent for the common case.
 *
 * `held` is how the backend's own catalogue reaches the turn: the model is
 * built through the provider that catalogue was read from, carrying the price
 * the list published, so a real endpoint's turn ends costing what its own
 * catalogue says (cofold decision 108, `pricing-on-adapter`). Nothing held
 * means a provider of this call's own, which is what an embedder that passed
 * neither an adapter nor a backend gets.
 *
 * The key is the one a client lent through `authenticate` for this backend's
 * protected resource, then the package's own, then the named provider's. It is
 * deliberately not a session setting: a credential in configuration is a
 * credential written to the session store and carried by every backup.
 */
export const modelOf = (
  options: CofoldOptions = {},
  settings: Record<string, unknown> = {},
  credentials: Record<string, string> = {},
  harness: HarnessConfig = harnessConfig(),
  held?: Held,
): ModelAdapter => {
  if (options.adapter !== undefined) return options.adapter;
  const connection = connectionOf(options, settings, credentials, harness, true);
  const effort = effortOf(settings.effortLevel);
  /*
   * A chosen level turns reasoning on for the request, because the adapter
   * sends nothing while `features.reasoning` is false - its default - and
   * off, missing or unrecognised sends nothing at all.
   */
  const chosen = effort === undefined ? {} : { params: { reasoning: { effort } }, features: { reasoning: true } };
  if (held !== undefined) {
    /*
     * The listed price, read from the cache and not waited for: the first turns
     * of a session run before the endpoint has answered, and a turn that waited
     * on a catalogue would be a turn that starts late.
     */
    const pricing = held.infoOf(connection.reference)?.pricing;
    // Strict resolution has answered that a model was chosen.
    return held.providerOf(connection).model({
      id: connection.model as string,
      ...(pricing === undefined ? {} : { pricing }),
      ...chosen,
    });
  }
  // Strict resolution has answered that a model was chosen.
  return openaiCompat({
    baseUrl: connection.baseUrl,
    model: connection.model as string,
    ...(connection.apiKey === undefined ? {} : { apiKey: connection.apiKey }),
    ...(connection.headers === undefined ? {} : { headers: connection.headers }),
    ...chosen,
  });
};

/** The store this backend keeps its sessions and runs in. */
export const storeOf = (options: CofoldOptions = {}): Store =>
  options.memory === true
    ? createMemoryStore()
    : createFileStore({ root: options.store ?? defaultStoreRoot() });

/**
 * One AHP backend over cofold.
 *
 * The provider id is per registration rather than per package, so two of these
 * with two stores and two models are two backends, which is how the register
 * surface gets exercised with a harness behind it.
 */
export function cofoldAgent(options: CofoldOptions = {}): Agent {
  const provider = options.provider ?? 'cofold';
  const displayName = options.displayName ?? 'Cofold';
  const configDir = options.computerConfigDir === undefined ? '/ahpd/cofold' : options.computerConfigDir;
  /*
   * One store for the whole backend, built here rather than per session.
   *
   * `list()` and `transcript()` read what a session wrote, so the catalogue
   * and the conversation have to be looking at the same store. A store built
   * inside `create` answered a different database from the one the turns went
   * into, which is a catalogue that lists nothing it can open.
   */
  const store = storeOf(options);
  /*
   * The harness configuration, read once for this backend.
   *
   * It is the same file the harness reads, so a person who has already chosen
   * a provider and a model does not say it again in the plugin's options, and
   * the backend's own defaults and advertised resource follow from it.
   */
  const harness = harnessConfig();

  /**
   * What a session may be told, and what the model is.
   *
   * `model` and `baseUrl` are configuration, which the protocol lets a client
   * change on a running session through `session/configChanged`. The key is
   * not here: a bearer token is a credential, and the protocol's path for one
   * is `authenticate` against a protected resource advertised below.
   *
   * The mode and the effort are the two controls a client draws beyond the
   * text fields, and each is offered only where this backend can honour it:
   * the mode when no run-level `policy` was configured, because that policy is
   * the authority and a picker that changed nothing would be a lie, and the
   * effort when this backend builds the request, because a caller-passed
   * adapter keeps its own list.
   */
  const schema = (): Bag => ({
    type: 'object',
    properties: {
      model: {
        type: 'string',
        title: 'Model',
        description: 'The model id the endpoint serves, e.g. deepseek-chat.',
        sessionMutable: true,
      },
      baseUrl: {
        type: 'string',
        title: 'Endpoint',
        description: 'An OpenAI-compatible base URL, e.g. https://api.deepseek.com/v1.',
      },
      instructions: {
        type: 'string',
        title: 'Instructions',
        description: 'The system prompt this agent runs with.',
      },
      /*
       * The approvals mode. The names and labels are the ones the window
       * already draws for Claude, so one session reads the same whichever
       * backend it is; the default is `auto`, which is cofold's own policy,
       * asking only about a tool that says it is destructive.
       */
      ...(options.policy === undefined
        ? {
            permissionMode: {
              scope: 'session',
              type: 'string',
              title: 'Approvals',
              description: 'How the agent handles tool approvals.',
              enum: [...PERMISSION_MODES],
              enumLabels: [...PERMISSION_LABELS],
              enumDescriptions: [...PERMISSION_DESCRIPTIONS],
              default: 'auto',
              sessionMutable: true,
            },
          }
        : {}),
      ...(options.adapter === undefined
        ? {
            effortLevel: {
              scope: 'chat',
              type: 'string',
              title: 'Effort',
              description: 'How hard it thinks before answering.',
              enum: [...EFFORT_LEVELS],
              enumLabels: ['Off', 'Low', 'Medium', 'High'],
              enumDescriptions: [
                'Answers without extra thinking.',
                'Thinks briefly.',
                'Thinks before answering.',
                'Thinks hard before answering.',
              ],
              default: 'off',
              sessionMutable: true,
            },
          }
        : {}),
    },
  });

  /**
   * What a session starts at: the package's own, under the harness file's.
   *
   * Only what was actually configured, because a default invented for a model
   * nobody can reach is a session that fails at the first call.
   */
  const defaults = (): Record<string, unknown> => ({
    ...(options.model !== undefined ? { model: options.model } : harness.model !== undefined ? { model: harness.model } : {}),
    ...(options.baseUrl !== undefined ? { baseUrl: options.baseUrl } : {}),
  });

  /**
   * What each endpoint answered, by the endpoint and the key it was asked with.
   *
   * One `GET /models` per backend rather than per session or per turn: a picker
   * is drawn from the root channel before any session exists, and every session
   * on the same endpoint and key would ask the same question. An empty answer is
   * not kept, so an endpoint that was down at startup is asked again rather than
   * remembered as one with no models.
   *
   * The whole entry is kept, and not only the row a picker draws: the price the
   * list published is what the turn's model is built with.
   */
  const catalogues = new Map<string, ModelInfo[]>();

  /**
   * The transport one endpoint is asked through, by the endpoint and the key.
   *
   * One per endpoint and key rather than one per turn: a turn's model is built
   * from the provider the catalogue was read from, so the two cannot disagree
   * about which endpoint is in force, and the price the list gave reaches
   * `.model()` by cofold's own route.
   */
  const providers = new Map<string, ModelProvider>();
  const cacheKey = (connection: Connection): string => `${connection.baseUrl}\n${connection.apiKey ?? ''}`;

  const providerOf = (connection: Connection): ModelProvider => {
    const key = cacheKey(connection);
    const held = providers.get(key);
    if (held !== undefined) return held;
    const built = openaiCompatProvider({
      baseUrl: connection.baseUrl,
      ...(connection.apiKey === undefined ? {} : { apiKey: connection.apiKey }),
      ...(connection.headers === undefined ? {} : { headers: connection.headers }),
    });
    providers.set(key, built);
    return built;
  };

  /**
   * Every model the endpoint says it serves, in this backend's spelling.
   *
   * cofold's own `GET /models`, which is where OpenRouter publishes the models
   * it routes to and what LM Studio answers with what it has loaded. Each id is
   * offered as `<provider>/<model id>`, the spelling the harness itself writes,
   * because OpenRouter's ids contain slashes and a bare one would be read as a
   * provider reference.
   *
   * Anything that goes wrong - a refused connection, a wrong shape, a timeout -
   * is an empty list: an endpoint that cannot be asked offers the configured
   * model alone, rather than a picker with no rows.
   */
  const listModels = async (connection: Connection): Promise<ModelInfo[]> => {
    try {
      const found = await providerOf(connection).listModels({ signal: AbortSignal.timeout(CATALOGUE_TIMEOUT_MS) });
      const models: ModelInfo[] = [];
      for (const info of found) {
        const id = text(info.id);
        if (id === undefined) continue;
        models.push({ ...info, id: `${connection.prefix}/${id}`, name: text(info.name) ?? id });
      }
      return models;
    }
    catch {
      return [];
    }
  };

  const catalogueOf = async (connection: Connection): Promise<ModelInfo[]> => {
    const key = cacheKey(connection);
    const held = catalogues.get(key);
    if (held !== undefined) return held;
    const listed = await listModels(connection);
    if (listed.length > 0) catalogues.set(key, listed);
    return listed;
  };

  /**
   * The catalogue as it is known right now.
   *
   * `models()` is synchronous and the fetch is not, so an endpoint not yet
   * asked answers nothing on this call and is asked in the background; the
   * configured model stands in until it lands.
   */
  const knownCatalogue = (connection: Connection): ModelInfo[] => {
    const held = catalogues.get(cacheKey(connection));
    if (held !== undefined) return held;
    void catalogueOf(connection);
    return [];
  };

  /**
   * The two maps above, as a turn reaches them.
   *
   * A turn's model is built through the provider its catalogue was read from,
   * with the price that catalogue listed, which is cofold's own route for a
   * cost rather than a second one invented here.
   */
  const held: Held = {
    providerOf,
    /*
     * Searched by reference rather than by endpoint, because the reference is
     * what a turn's settings name and the catalogue it came from is the one
     * whose ids were written that way. Read from the cache and not waited for:
     * the first turns of a session run before the endpoint has answered, and
     * waiting would be a turn that starts late rather than one that starts
     * unpriced.
     */
    infoOf: (reference) => {
      if (reference === undefined) return undefined;
      for (const listed of catalogues.values()) {
        const found = listed.find((one) => one.id === reference);
        if (found !== undefined) return found;
      }
      return undefined;
    },
  };

  return {
    provider,
    displayName,
    ...(options.description !== undefined ? { description: options.description } : {}),
    /*
     * A chat can be forked from one of its turns.
     *
     * A fork copies the conversation through a turn into a cofold session of
     * its own - `Store.sessions.fork` - and leaves the source whole, which is
     * what AHP's `source.kind: 'fork'` asks for. There is no side chat: that
     * is a fresh conversation told what a turn said, and this backend has no
     * way to hand a model context that is not a message in the session.
     */
    chats: { fork: true },
    /*
     * The resource a client may lend a token for.
     *
     * `required: false` because the daemon runs as whoever started it and
     * already holds its own key - its options or the harness file - so a
     * client's token is an override, not a precondition, and a backend that
     * refused every session until one arrived would be a backend nobody could
     * use from an automation.
     */
    protectedResources: [{ resource: resourceOf(options, harness), resource_name: displayName, required: false }],
    schema,
    defaults,
    /*
     * What a machine needs for this harness to find its providers.
     *
     * The harness configuration holds the provider keys, and it is mounted
     * read-only at a fixed target under `computerConfigDir`, with `COFOLD_CONFIG`
     * naming that file. The variable is this package's own, and it is a path to
     * one file rather than a directory, because `XDG_CONFIG_HOME` cannot be
     * moved for one program: it is the nested host's own folder as well, and a
     * machine's mount point is root-owned, so a cofold machine whose image runs
     * as anybody else would exit with EACCES creating its usage folder. Nothing
     * here touches `XDG_CONFIG_HOME`, so every other program in the machine
     * keeps its own.
     *
     * The target keeps the `cofold/config.json` shape the file has on a host, so
     * a person reading a mounted machine sees the same relative path they see
     * at `~/.config`.
     *
     * The source path is read here rather than at construction, so a profile
     * that points the variable elsewhere is followed.
     *
     * In a state volume, the default, `computerConfigDir` is the volume, seeded
     * with that file at the same relative path; the read-only mount of the
     * host's file is for a profile that keeps state on the host.
     *
     * The nested host this backend runs in is `ahpd` from the `ahpd` part,
     * which carries this plugin and puts `ahpd` on the machine's `PATH`, so the
     * image needs nothing installed.
     */
    machine: (): Record<string, MachineNeed> => {
      const ahpd: Record<string, MachineNeed> = {
        ahpdPart: {
          part: 'ahpd',
          required: true,
          description: 'ahpd with its plugins, which the nested host this backend runs in is started from.',
        },
      };
      if (configDir === false) return ahpd;
      const read = harnessConfigPath();
      return {
        cofoldState: {
          state: configDir,
          seed: [{ source: read, target: 'cofold/config.json' }],
          description: 'The cofold configuration, which holds the provider endpoints and their keys, kept in a volume.',
        },
        cofoldConfig: {
          file: read,
          target: `${configDir}/cofold/config.json`,
          readOnly: true,
          required: true,
          when: 'host',
          description: 'The cofold configuration, which holds the provider endpoints and their keys.',
        },
        cofoldConfigPath: {
          name: 'COFOLD_CONFIG',
          default: `${configDir}/cofold/config.json`,
          description: 'Where the harness looks for its configuration inside the machine.',
        },
        ...ahpd,
      };
    },
    /*
     * What the endpoint serves, as the root channel's model list.
     *
     * The configured `model` is the default a session starts on, not the only
     * model there is, so the endpoint's own catalogue is offered with it first
     * when the endpoint does not carry it. No call is made for a caller that
     * passed an adapter: an embedder's models are the adapter's, and the
     * endpoint in `options` is not necessarily one it wants asked.
     */
    probe: async (): Promise<Offered> => {
      const connection = connectionOf(options, {}, {}, harness, false);
      const listed = options.adapter === undefined ? (await catalogueOf(connection)).map(rowOf) : [];
      const models = connection.reference === undefined || listed.some((model) => model.id === connection.reference)
        ? listed
        : [{ id: connection.reference, name: connection.reference }, ...listed];
      return { models, customizations: [], commands: [] };
    },
    /*
     * The sessions this backend already has.
     *
     * No workspace is passed to the query: `list()` is asked before any
     * session exists, and the workspace is a per-session key cofold already
     * holds, so filtering by one here would hide every other conversation the
     * store has. Each row reports the directory its own session recorded.
     */
    list: async (): Promise<Listed[]> => {
      const records = await store.sessions.list({});
      const listed: Listed[] = [];
      for (const record of records) {
        const messages = await store.sessions.listMessages({ sessionId: record.sessionId });
        const first = messages.find((one) => one.role === 'user' && one.source === 'input');
        listed.push({
          id: record.sessionId,
          title: first === undefined ? record.sessionId : titleOf(textOf(first), record.sessionId),
          createdAt: record.createdAt,
          modifiedAt: record.updatedAt,
          workingDirectories: record.workspace === undefined ? [] : [`file://${record.workspace}`],
        });
      }
      return listed;
    },
    /*
     * The store's own delete: a session with its messages, runs, events,
     * steps and requests, which is every trace of it the store keeps.
     *
     * A session the store does not have is deleted - the store says so with
     * `not_found`, and a second delete of the same row has to be one the host
     * carries out rather than one it refuses, because the row is gone either
     * way. `writer_busy` is not that: a run is still writing, so the record is
     * there and would not go, and that is raised.
     *
     * The directory is not part of it. The store keys a session by its own id
     * and the row carries its own workspace, so there is nothing for it to
     * narrow - and a row listed with no workspace at all is deleted like any
     * other.
     */
    delete: async (id) => {
      try {
        await store.sessions.delete({ sessionId: id });
      }
      catch (error) {
        if ((error as { code?: unknown }).code === 'not_found') return;
        throw error;
      }
    },
    /*
     * One past conversation, read without starting anything.
     *
     * `undefined` is for a session the store does not know, which is what the
     * contract means by "this backend has no such session". A session it does
     * know with nothing said answers `[]` instead, and the two must not be
     * confused: an empty transcript is a row that opens on an empty chat, and
     * `undefined` is a row the host refuses.
     */
    transcript: async (id) => {
      const record = await store.sessions.get({ sessionId: id });
      if (record === undefined) return undefined;
      return await turnsOf(store, id);
    },
    /*
     * The session runs a cofold agent: a turn becomes `run()`'s event stream
     * and each event becomes the AHP action a client expects. The work is in
     * `session.ts`, `mapping.ts` and `tools.ts`.
     *
     * `Start.forkAt` and `Start.rewindAt` are the cut the session was asked
     * for: a fork copies the resumed conversation through that message into a
     * cofold session of its own, and a rewind drops what followed it from the
     * resumed one, which is `Store.sessions.fork` and `Store.sessions.truncate`
     * doing the work before the first turn runs. `session.ts` refuses a turn if
     * the cut could not be made, rather than carrying on from the wrong place.
     *
     * `runsNested` is the machine half. cofold's loop, tools and shell all run
     * in this process, so a session that names a computer cannot be served
     * here: the host starts a whole `ahpd` with this backend loaded inside the
     * machine and gives the session the SDK's proxy instead - decision
     * `a-cofold-session-in-a-computer-runs-in-a-nested-host`.
     */
    runsNested: true,
    create: (start) => {
      return cofoldSession(
        options,
        start,
        store,
        harness,
        (settings, credentials) => knownCatalogue(connectionOf(options, settings, credentials, harness, false)),
        held,
      );
    },
  };
}
