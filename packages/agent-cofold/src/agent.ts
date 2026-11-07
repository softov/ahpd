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
import { EFFORT_LEVELS, PERMISSION_MODES, PERMISSION_MODE_DESCRIPTIONS, createMemoryStore, effortOf, textOf } from '@cofold/agents';
import type { ModelAdapter, ModelInfo, ModelProvider, Policy, SessionRecord, Store } from '@cofold/agents';
import { openaiCompat, openaiCompatProvider, splitModel } from '@cofold/model-openai-compat';
import type { OpenAICompatOptions, OpenAICompatProviderOptions, ProviderConfig } from '@cofold/model-openai-compat';
import { createFileStore, resolveHome } from '@cofold/store-file';
import { getReasoningEffortDescription, getReasoningEffortLabel, ReasoningEffortConfigKey, titleFrom, uriOf } from '@ahpd/sdk';
import type { Agent, Bag, Listed, MachineNeed, Offered, Session, Start } from '@ahpd/sdk';
import { harnessConfig, harnessConfigPath } from './config.js';
import type { HarnessConfig } from './config.js';
import type { ToolsConfig } from './capabilities.js';
import { cofoldSession } from './session.js';
import { turnsOf } from './transcript.js';
import { commandsOf } from './turnagent.js';

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
  /**
   * What the operator says of `baseUrl`'s models, each by its id on that
   * endpoint: the thinking levels it accepts, as VS Code's Custom Endpoint
   * models declare `supportsReasoningEffort`.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/extensions/copilot/package.json#L2043-L2049
   */
  models?: { id: string; supportsReasoningEffort?: string[] }[];
  /** The system prompt the agent is created with. */
  instructions?: string;
  /**
   * The configuration directory the harness reads *inside a machine*.
   *
   * The configuration is mounted there and `PAPO_CONFIG` is pointed at the
   * file, so a cofold host in the machine finds the providers whatever user the
   * image runs as, and `XDG_CONFIG_HOME` is left as the image has it.
   * `false` says nothing at all and leaves the image's own.
   */
  computerConfigDir?: string | false;
  /** Where the file store lives; absent means cofold's own home. */
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
  /**
   * What the agent's record says now, for a backend opened from one.
   *
   * A session calls this at the start of each turn and puts what changed on
   * the options it runs on, so an edit to a record lands on the next turn
   * rather than on a backend nobody rebuilds. Absent for a backend an embedder
   * built from its own options.
   */
  recordOf?: () => CofoldOptions;
}

/**
 * Where a cofold store lives when nothing named one: cofold's own home,
 * `$COFOLD_HOME` or `~/.cofold`, where cofold's file store keeps its sessions,
 * so the sessions this backend lists are the ones cofold keeps, as ahpd's
 * Claude lists the CLI's own store.
 * https://www.npmjs.com/package/@cofold/store-file
 */
export const defaultStoreRoot = (): string => resolveHome({ name: 'cofold' });

/** A short string, or nothing for a blank or missing one. */
const text = (value: unknown): string | undefined =>
  (typeof value === 'string' && value.trim() !== '' ? value : undefined);

/**
 * The session control that sets how much every turn has the model reason:
 * cofold's own session-wide setting, papo's `reasoning`, under the agent's
 * provider id, as VS Code names Codex's `codex.modelReasoningEffort`.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/codexSessionConfigKeys.ts#L15-L25
 */
export const reasoningKeyOf = (options: CofoldOptions): string => `${options.provider ?? 'cofold'}.reasoning`;

/**
 * The level the person's harness sets, else papo's own default, `off`.
 * https://github.com/softov/cofold/blob/ee4819644696b88e83e63c56ed7bdf426d32cfb9/packages/papo/src/config.ts#L76-L81
 */
const harnessReasoningOf = (harness: HarnessConfig): string =>
  (EFFORT_LEVELS as readonly string[]).includes(harness.reasoning ?? '') ? harness.reasoning as string : 'off';

/**
 * The approvals modes a session may be put in, in the harness's own order.
 *
 * The list and the meanings are cofold's: `policyOf` in `@cofold/agents` is
 * what a mode becomes, and the six words are the ones every host that offers a
 * mode offers. `auto` is cofold's own default, so that is what a session that
 * chooses none starts on. ahpd keeps only the labels, which are what a person
 * reads.
 */
export { PERMISSION_MODES, EFFORT_LEVELS, effortOf };

/** What each mode is called where a person reads it. */
export const PERMISSION_LABELS = [
  'Ask Before Edits',
  'Edit Automatically',
  'Plan Mode',
  'Auto Mode',
  'Bypass Permissions',
  "Don't Ask",
] as const;

/** One line about what each mode does, in cofold's words, in cofold's order. */
export const PERMISSION_DESCRIPTIONS: readonly string[] =
  PERMISSION_MODES.map((mode) => PERMISSION_MODE_DESCRIPTIONS[mode]);

/**
 * The protected resource a token for this backend belongs to, or none.
 *
 * `resource` when it was named, and otherwise the origin of an `https`
 * endpoint when one is known - the plugin's own `baseUrl`, or the endpoint the
 * harness configuration's model names - as VS Code's agents advertise the API
 * a token is for. RFC 9728 names a resource by its own `https` URL with no
 * fragment, which is why the endpoint's origin is the resource: a token is for
 * the service, and one path under it is the same service. An endpoint with no
 * `https` origin names no resource, and none is advertised.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agent.ts#L647-L648
 * https://www.rfc-editor.org/rfc/rfc9728#section-2
 */
export const resourceOf = (options: CofoldOptions = {}, harness: HarnessConfig = harnessConfig()): string | undefined => {
  if (options.resource !== undefined) return options.resource;
  const named = options.baseUrl ?? endpointOf(options, harness)?.baseUrl;
  if (named === undefined) return undefined;
  try {
    const url = new URL(named);
    return url.protocol === 'https:' ? url.origin : undefined;
  }
  catch {
    // Not a URL at all, so there is nothing to name a resource after.
    return undefined;
  }
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
): ProviderConfig | undefined => {
  const model = ref ?? options.model ?? harness.model;
  if (model === undefined) return undefined;
  const named = splitModel(model);
  if (named === undefined) return undefined;
  return harness.providers.find((one) => one.id === named.provider);
};

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

/** Whether two URLs name the same origin, so a key lent for one is not sent to another. */
const sameOrigin = (one: string, other: string): boolean => {
  try {
    return new URL(one).origin === new URL(other).origin;
  }
  catch {
    return false;
  }
};

/**
 * The key one endpoint is asked with, and no other endpoint's.
 *
 * A file provider's own key belongs to the endpoint the file names it for. A
 * token a client lent belongs to the resource this backend advertises -
 * `resourceOf` - and is sent only where that resource's origin is the
 * endpoint's. The plugin's own key belongs to `options.baseUrl`, or, when no
 * endpoint was given, to the provider the configured model names; it does not
 * follow `resourceOf`, because an http endpoint advertises no resource and the
 * key still belongs to it. Listing every provider would otherwise carry one
 * provider's key to all of them.
 */
const keyOf = (
  baseUrl: string,
  options: CofoldOptions,
  credentials: Record<string, string>,
  harness: HarnessConfig,
  owner?: ProviderConfig,
): OpenAICompatProviderOptions['apiKey'] => {
  const own = owner !== undefined && owner.baseUrl === baseUrl
    ? owner.apiKey
    : harness.providers.find((one) => one.baseUrl === baseUrl)?.apiKey;
  const resource = resourceOf(options, harness);
  const lent = resource !== undefined && sameOrigin(baseUrl, resource) ? text(credentials[resource]) : undefined;
  const option = options.baseUrl !== undefined
    ? sameOrigin(baseUrl, options.baseUrl)
    : endpointOf(options, harness)?.baseUrl === baseUrl;
  return lent ?? (option ? options.apiKey : undefined) ?? own;
};

/**
 * The options a turn's model is built with: cofold's options for one model on
 * one endpoint, their `name` the provider id a reference names the model by,
 * with the reference as it was spelled.
 *
 * One resolution for the adapter a turn runs on and the endpoints a picker
 * lists, so the two cannot disagree about which endpoint is in force: a model
 * the list offered is selected through the provider, base URL, key and headers
 * the list was read from. A turn refuses a missing model and a reference naming
 * a provider the file does not carry; `providerOptionsOf` lists endpoints with
 * no model chosen.
 * https://github.com/softov/cofold/blob/ee4819644696b88e83e63c56ed7bdf426d32cfb9/packages/model-openai-compat/src/types/options.ts#L3-L26
 */
const adapterOptionsOf = (
  options: CofoldOptions,
  settings: Record<string, unknown>,
  credentials: Record<string, string>,
  harness: HarnessConfig,
): OpenAICompatOptions & { reference: string } => {
  const own = options.provider ?? 'cofold';
  const reference = modelReferenceOf(options, settings, harness);
  if (reference === undefined) {
    throw new Error(`${own}: no model is configured and this backend has no default; add "model" (as "<provider>/<model>") to ${harness.path}`);
  }
  const named = splitModel(reference);
  const provider = endpointOf(options, harness, reference);
  /*
   * This backend's own id is not a provider the file has to carry: it names
   * the endpoint given outright, and any other reference has to match a file
   * provider.
   */
  if (named !== undefined && provider === undefined && options.baseUrl === undefined) {
    const known = harness.providers.map((one) => one.id);
    if (known.length > 0 || named.provider !== own) {
      throw new Error(`${own}: model "${reference}" names provider "${named.provider}", and ${harness.path} configures ${known.length === 0 ? 'none' : known.join(', ')}`);
    }
  }
  const baseUrl = options.baseUrl ?? provider?.baseUrl ?? harness.providers[0]?.baseUrl;
  /*
   * A turn with no endpoint is refused as a turn with no model is: nothing
   * named one, and cofold's model adapter takes its target server from
   * configuration alone.
   * https://www.npmjs.com/package/@cofold/model-openai-compat
   */
  if (baseUrl === undefined) {
    throw new Error(`${own}: no endpoint is configured and this backend has no default; add a provider with its "baseUrl" to ${harness.path}`);
  }
  const key = keyOf(baseUrl, options, credentials, harness, provider);
  return {
    reference,
    model: named === undefined ? reference : named.modelId,
    baseUrl,
    ...(key === undefined ? {} : { apiKey: key }),
    ...(provider?.headers === undefined ? {} : { headers: provider.headers }),
    name: provider?.id ?? own,
  };
};

/**
 * Every endpoint a catalogue is read from, as the options cofold's provider
 * takes, each named by the provider id a model it serves is offered under, as
 * cofold's `providersOf` names each provider of a configuration by its id.
 *
 * Without an explicit endpoint, the harness configuration's providers are
 * asked one by one, each under its own id and with its own key, so every
 * provider a person wrote in the file is listed, and a file with no provider
 * names nothing to list. An explicit `baseUrl` is listed under the id of the
 * provider the configured model names, else this backend's own.
 * https://github.com/softov/cofold/blob/ee4819644696b88e83e63c56ed7bdf426d32cfb9/packages/model-openai-compat/src/config.ts#L20-L30
 */
const providerOptionsOf = (
  options: CofoldOptions,
  settings: Record<string, unknown>,
  credentials: Record<string, string>,
  harness: HarnessConfig,
): OpenAICompatProviderOptions[] => {
  if (options.baseUrl !== undefined) {
    const provider = endpointOf(options, harness, modelReferenceOf(options, settings, harness));
    const key = keyOf(options.baseUrl, options, credentials, harness, provider);
    return [{
      name: provider?.id ?? options.provider ?? 'cofold',
      baseUrl: options.baseUrl,
      ...(key === undefined ? {} : { apiKey: key }),
      ...(provider?.headers === undefined ? {} : { headers: provider.headers }),
    }];
  }
  return harness.providers.map((provider) => {
    const key = keyOf(provider.baseUrl, options, credentials, harness, provider);
    return {
      name: provider.id,
      baseUrl: provider.baseUrl,
      ...(key === undefined ? {} : { apiKey: key }),
      ...(provider.headers === undefined ? {} : { headers: provider.headers }),
    };
  });
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
 * How hard a model can be told to think is its own `configSchema`, the
 * model-specific options AHP's model info carries, under `thinkingLevel`, the
 * key the reference client's picker writes for its models: the levels the
 * agent's configuration declares for a model of its endpoint, those of
 * cofold's four it names, else cofold's four where the catalogue published
 * reasoning among the model's parameters. A model neither names takes none,
 * as cofold's own default says it cannot reason and as VS Code shows no picker
 * for a model that declares no levels; a caller's adapter builds its own
 * requests, so its models take none. The property is the one VS Code's agent
 * host draws, its words and each level's label and description from VS Code's
 * shared helpers, and `off`, cofold's own default, is the default where it is
 * offered.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/AGENTS.md#L858
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/extensions/copilot/src/extension/byok/vscode-node/byokModelInfo.ts#L14-L32
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/copilot/copilotAgent.ts#L4536-L4553
 *
 * Nothing else of `ModelInfo` travels: a row is what a picker draws, and the
 * catalogue's `features` and `pricing` are what a turn is built from.
 */
export const rowOf = (
  options: CofoldOptions,
  info: Pick<ModelInfo, 'id' | 'name'> & Partial<ModelInfo>,
): Offered['models'][number] => {
  const own = options.provider ?? 'cofold';
  // The model's id on the agent's own endpoint, which a declaration names.
  const onEndpoint = options.baseUrl === undefined ? undefined : info.id.startsWith(`${own}/`) ? info.id.slice(own.length + 1) : info.id;
  const declared = options.models?.find((one) => one.id === onEndpoint)?.supportsReasoningEffort;
  const levels = options.adapter !== undefined
    ? []
    : EFFORT_LEVELS.filter((level) => (declared === undefined ? info.features?.reasoning === true : declared.includes(level)));
  return {
    id: info.id,
    name: info.name,
    ...(typeof info.contextTokens === 'number' && info.contextTokens > 0 ? { maxContextWindow: info.contextTokens } : {}),
    ...(typeof info.maxOutputTokens === 'number' && info.maxOutputTokens > 0 ? { maxOutputTokens: info.maxOutputTokens } : {}),
    ...(levels.length === 0 ? {} : {
      configSchema: {
        type: 'object',
        properties: {
          [ReasoningEffortConfigKey]: {
            type: 'string',
            title: 'Effort Level',
            description: 'Controls how much reasoning effort the model uses.',
            enum: levels,
            enumLabels: levels.map(getReasoningEffortLabel),
            enumDescriptions: levels.map((level) => getReasoningEffortDescription(level) ?? ''),
            ...(levels.includes('off') ? { default: 'off' } : {}),
          },
        },
      },
    }),
  };
};

/**
 * What the backend already holds for a turn's model.
 *
 * A session `cofoldAgent` built is handed this, so its turn is built from the
 * transport the catalogue was read through and with the price that catalogue
 * listed for the model; a session built by a caller that named none has
 * nothing here, and `modelOf` builds an adapter of its own.
 */
export interface Held {
  /** The transport one endpoint is asked through, built once per endpoint, name and key. */
  providerOf(endpoint: OpenAICompatProviderOptions): ModelProvider;
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
  const { reference, ...adapter } = adapterOptionsOf(options, settings, credentials, harness);
  /*
   * The level the turn's model selection carries, its `configSchema`'s answer,
   * winning over the session's own `<provider>.reasoning`, which wins over the
   * person's harness, as VS Code resolves a Codex turn's effort.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/codex/codexAgent.ts#L1953-L1960
   */
  const effort = effortOf(settings[ReasoningEffortConfigKey] ?? settings[reasoningKeyOf(options)] ?? harnessReasoningOf(harness));
  /*
   * A chosen level is a request param and nothing more. The adapter turns
   * reasoning on from it, so a host that also set the feature would be saying
   * the same thing twice - and `features: { reasoning: false }` is the one way
   * to say a model cannot think, which the param must not overrule.
   */
  const chosen = effort === undefined ? {} : { params: { reasoning: { effort } } };
  if (held !== undefined) {
    /*
     * The listed price, read from the cache and not waited for: the first turns
     * of a session run before the endpoint has answered, and a turn that waited
     * on a catalogue would be a turn that starts late.
     */
    const pricing = held.infoOf(reference)?.pricing;
    return held.providerOf(adapter).model({
      id: adapter.model,
      ...(pricing === undefined ? {} : { pricing }),
      ...chosen,
    });
  }
  return openaiCompat({ ...adapter, ...chosen });
};

/** The store this backend keeps its sessions and runs in. */
export const storeOf = (options: CofoldOptions = {}): Store =>
  options.memory === true
    ? createMemoryStore()
    : createFileStore({ root: options.store ?? defaultStoreRoot() });

/**
 * A cofold backend: a session asked for no fork and no truncation is answered
 * at once, and one asked for either once the store has made it.
 */
export interface CofoldAgent extends Agent {
  create(start: Start & { forkAt?: undefined; rewindAt?: undefined }): Session;
  create(start: Start): Session | Promise<Session>;
}

/**
 * One AHP backend over cofold.
 *
 * The provider id is per registration rather than per package, so two of these
 * with two stores and two models are two backends, which is how the register
 * surface gets exercised with a harness behind it.
 */
export function cofoldAgent(options: CofoldOptions = {}): CofoldAgent {
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
   * Where each turn of a conversation ended, as the last read of it named it,
   * by the conversation's id.
   *
   * A session names the end of a turn it watched from the run that wrote it,
   * and the turns a resumed session opens with were written by runs it never
   * watched. The host reads the conversation before it resumes it, so the read
   * names them and the session that resumes it starts from them, as the Claude
   * backend's sessions start from what its read of a transcript named. Each
   * read of a conversation replaces what an earlier one named.
   */
  const readEnds = new Map<string, ReadonlyMap<string, string>>();
  /*
   * The harness configuration as the backend reads it, outside any session's
   * folder.
   *
   * It is what the harness reads, so a person who has already chosen a
   * provider and a model does not say it again in the plugin's options, and
   * the backend's own defaults, its catalogue and its advertised resource
   * follow from it. A session with a folder reads its own (`create`).
   */
  const harness = harnessConfig();
  /** The protected resource this backend advertises, where its endpoint names one. */
  const advertised = resourceOf(options, harness);

  /**
   * What a session may be told.
   *
   * The endpoint is the agent's configuration, as VS Code keeps a provider's
   * settings in the host's root configuration.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentConfigurationService.ts#L1319-L1338
   * The model belongs to the turn, and the list reaches a client through
   * `Session.models` and the agent's `models`. The key is a credential, and the
   * protocol's path for one is `authenticate` against a protected resource
   * advertised below.
   *
   * The mode is the control a client draws beyond the text fields, offered
   * only where this backend can honour it: when no run-level `policy` was
   * configured, because that policy is the authority and a picker that changed
   * nothing would be a lie. How hard a model thinks is that model's own
   * `configSchema` (`rowOf`), and the session's own reasoning control stands
   * for a turn whose model selection names no level.
   */
  const schema = (): Bag => ({
    type: 'object',
    properties: {
      instructions: {
        type: 'string',
        title: 'Instructions',
        description: 'The system prompt this agent runs with.',
      },
      /*
       * cofold's own session-wide reasoning, papo's `reasoning` setting, as VS
       * Code keeps Codex's `codex.modelReasoningEffort` as a session control
       * beside each model's picker: cofold's levels, the shared helpers' words,
       * and the person's harness level for its default, else papo's `off`.
       * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/codex/codexAgent.ts#L465-L475
       */
      [reasoningKeyOf(options)]: {
        type: 'string',
        title: 'Reasoning Effort',
        description: `Controls how much reasoning effort ${displayName} uses.`,
        enum: [...EFFORT_LEVELS],
        enumLabels: EFFORT_LEVELS.map(getReasoningEffortLabel),
        enumDescriptions: EFFORT_LEVELS.map((level) => getReasoningEffortDescription(level) ?? ''),
        default: harnessReasoningOf(harness),
        sessionMutable: true,
        chatMutable: true,
      },
      /*
       * The approvals mode. The names and labels are the ones the window
       * already draws for Claude, so one session reads the same whichever
       * backend it is; the default is `auto`, which is cofold's own policy,
       * asking only about a tool that says it is destructive. Each chat keeps
       * its own, as VS Code's Claude agent marks its mode `chatMutable`: every
       * chat of a cofold session is a cofold session of its own.
       * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeAgent.ts#L2283-L2305
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
              chatMutable: true,
            },
          }
        : {}),
    },
  });

  /**
   * What a session starts at: each key at its schema's own default.
   *
   * The endpoint and the key are the agent's configuration, and the model is
   * the turn's: a turn that names none falls back to the plugin option or the
   * harness file through `modelReferenceOf`.
   */
  const defaults = (): Record<string, unknown> => ({});

  /**
   * What each endpoint answered, by the endpoint, the provider id it is listed
   * under and the key it was asked with.
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
   * The transport one endpoint is asked through, by the endpoint, its provider
   * id and the key.
   *
   * One per endpoint, which every turn on it shares: a turn's model is built
   * from the provider the catalogue was read from, so the two cannot disagree
   * about which endpoint is in force, and the price the list gave reaches
   * `.model()` by cofold's own route. Built as cofold's `providersOf` builds a
   * configuration's provider, named by its provider id.
   * https://github.com/softov/cofold/blob/ee4819644696b88e83e63c56ed7bdf426d32cfb9/packages/model-openai-compat/src/config.ts#L20-L30
   */
  const providers = new Map<string, ModelProvider>();
  const cacheKey = (endpoint: OpenAICompatProviderOptions): string =>
    `${endpoint.name ?? ''}\n${endpoint.baseUrl}\n${endpoint.apiKey ?? ''}`;

  const providerOf = (endpoint: OpenAICompatProviderOptions): ModelProvider => {
    const key = cacheKey(endpoint);
    const held = providers.get(key);
    if (held !== undefined) return held;
    const built = openaiCompatProvider({
      ...(endpoint.name === undefined ? {} : { name: endpoint.name }),
      baseUrl: endpoint.baseUrl,
      ...(endpoint.apiKey === undefined ? {} : { apiKey: endpoint.apiKey }),
      ...(endpoint.headers === undefined ? {} : { headers: endpoint.headers }),
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
   * provider reference. The provider id is the endpoint's `name`, and the URL's
   * host for an endpoint given none, as cofold's provider defaults its own.
   *
   * Anything that goes wrong - a refused connection, a wrong shape, a timeout -
   * is an empty list, which `catalogueOf` answers with the last good one: an
   * endpoint never listed offers the configured model alone.
   */
  const listModels = async (endpoint: OpenAICompatProviderOptions): Promise<ModelInfo[]> => {
    try {
      const found = await providerOf(endpoint).listModels({ signal: AbortSignal.timeout(CATALOGUE_TIMEOUT_MS) });
      const named = endpoint.name ?? new URL(endpoint.baseUrl).host;
      const models: ModelInfo[] = [];
      for (const info of found) {
        const id = text(info.id);
        if (id === undefined) continue;
        models.push({ ...info, id: `${named}/${id}`, name: text(info.name) ?? id });
      }
      return models;
    }
    catch {
      return [];
    }
  };

  /**
   * One endpoint's catalogue, listed again.
   *
   * Every call asks the endpoint, so a probe the host makes is a refresh, as
   * VS Code's agents list their models again whenever their host refreshes a
   * catalogue; a listing that fails or comes back empty answers the last good
   * list, as VS Code's Claude agent keeps its last known-good catalogue so a
   * failed refresh never wipes the picker.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentModelRefreshScheduler.ts#L106-L125
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeAgent.ts#L918-L924
   */
  const catalogueOf = async (endpoint: OpenAICompatProviderOptions): Promise<ModelInfo[]> => {
    const key = cacheKey(endpoint);
    const listed = await listModels(endpoint);
    if (listed.length > 0) catalogues.set(key, listed);
    return catalogues.get(key) ?? [];
  };

  /**
   * The catalogue as it is known right now.
   *
   * `models()` is synchronous and the fetch is not, so an endpoint not yet
   * asked answers nothing on this call and is asked in the background; the
   * configured model stands in until it lands.
   */
  const knownCatalogue = (endpoint: OpenAICompatProviderOptions): ModelInfo[] => {
    const held = catalogues.get(cacheKey(endpoint));
    if (held !== undefined) return held;
    void catalogueOf(endpoint);
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

  /**
   * One store record as a catalogue row.
   *
   * `list` maps every record through this and `find` maps the one record it
   * read through it, so the two cannot answer different rows for the same
   * session: a row that comes back changed is a client sent a
   * `root/sessionSummaryChanged` for a session that did not move. The store
   * keeps no title of its own, so the first thing the person said is the
   * honest one, and a session nobody said anything in is listed with an empty
   * title, which a client draws as an untitled session, as VS Code lists a
   * session that has no summary.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L6140-L6146
   *
   * The messages are read per record, because the store has no call that
   * answers the first user message alone - which is why `find` reads one
   * record's messages rather than the store.
   */
  const recordRow = async (record: SessionRecord): Promise<Listed> => {
    const messages = await store.sessions.listMessages({ sessionId: record.sessionId });
    const first = messages.find((one) => one.role === 'user' && one.source === 'input');
    return {
      id: record.sessionId,
      title: first === undefined ? '' : titleFrom(textOf(first), ''),
      createdAt: record.createdAt,
      modifiedAt: record.updatedAt,
      workingDirectories: record.workspace === undefined ? [] : [uriOf(record.workspace)],
    };
  };

  /*
   * A session, answered at once; or for a fork or a truncation, once the
   * store has made it, as VS Code's agent provisions a fork inside the
   * `createChat` that asked for it, so one the store cannot make fails the
   * request that asked.
   *
   * `Start.forkAt` copies the resumed conversation through that message into a
   * cofold session of its own, `Store.sessions.fork`, and `Start.rewindAt` drops
   * what followed it from the resumed one, `Store.sessions.truncate`. Either
   * way the session is then the conversation as the store holds it, resumed.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L7132-L7132
   */
  function create(start: Start & { forkAt?: undefined; rewindAt?: undefined }): Session;
  function create(start: Start): Session | Promise<Session>;
  function create(start: Start): Session | Promise<Session> {
    const opened = (resumed: Start): Session => {
      /*
       * The harness configuration as papo reads it in the session's own
       * workspace, that workspace's `.papo.json` among its layers; a session
       * given no folder has no project of its own and reads the backend's.
       * https://github.com/softov/cofold/blob/ee4819644696b88e83e63c56ed7bdf426d32cfb9/packages/papo/src/config.ts#L92-L94
       */
      const read = resumed.workingDirectory === undefined ? harness : harnessConfig(process.env, homedir(), resumed.workingDirectory);
      return cofoldSession(
        options,
        resumed,
        store,
        read,
        (settings, credentials) => providerOptionsOf(options, settings, credentials, read)
          .flatMap((endpoint) => knownCatalogue(endpoint)),
        held,
        // Where the turns it opens with ended, for a session that carries a
        // conversation on, a fork's copy included: a fork keeps the message ids
        // it copies.
        start.resume === undefined ? undefined : readEnds.get(start.resume),
      );
    };
    const { forkAt, rewindAt, ...resumed } = start;
    if (forkAt === undefined && rewindAt === undefined) return opened(start);
    return (async (): Promise<Session> => {
      if (forkAt !== undefined && rewindAt !== undefined) throw new Error(`${provider}: a session cannot fork and rewind at once`);
      if (start.resume === undefined) {
        throw new Error(`${provider}: a ${forkAt !== undefined ? 'fork needs the conversation it copies' : 'rewind needs the conversation it cuts'}`);
      }
      if (forkAt !== undefined) {
        const sessionId = crypto.randomUUID();
        await store.sessions.fork({ fromSessionId: start.resume, throughMessageId: forkAt, sessionId });
        return opened({ ...resumed, resume: sessionId });
      }
      await store.sessions.truncate({ sessionId: start.resume, throughMessageId: String(rewindAt) });
      return opened(resumed);
    })();
  }

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
     * The resource a client may lend a token for, where the endpoint names one.
     *
     * `required: false` because the daemon runs as whoever started it and
     * already holds its own key - its options or the harness file - so a
     * client's token is an override, not a precondition, and a backend that
     * refused every session until one arrived would be a backend nobody could
     * use from an automation.
     */
    protectedResources: advertised === undefined ? [] : [{ resource: advertised, resource_name: displayName, required: false }],
    schema,
    defaults,
    /*
     * What a machine needs for this harness to find its providers.
     *
     * The harness configuration holds the provider keys, and it is mounted
     * read-only at a fixed target under `computerConfigDir`, with `PAPO_CONFIG`
     * naming that file, the layer papo's resolver reads from the variable. It
     * is a path to one file rather than a directory, because `XDG_CONFIG_HOME`
     * cannot be moved for one program: it is the nested host's own folder as
     * well, and a machine's mount point is root-owned, so a cofold machine whose
     * image runs as anybody else would exit with EACCES creating its usage
     * folder. Nothing here touches `XDG_CONFIG_HOME`, so every other program in
     * the machine keeps its own.
     *
     * The target keeps the `papo/config.json` shape the file has on a host, so
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
     * A provider may instead come from `COFOLD_BASE_URL`, `COFOLD_API_KEY` and
     * `COFOLD_MODEL`, which have no default: a profile names them, the key as a
     * vault secret, so a machine on another box gets a key with no file
     * holding it.
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
          seed: [{ source: read, target: 'papo/config.json' }],
          credential: true,
          description: 'The harness configuration, which holds the provider endpoints and their keys, kept in a volume.',
        },
        cofoldConfig: {
          file: read,
          target: `${configDir}/papo/config.json`,
          readOnly: true,
          required: true,
          when: 'host',
          credential: true,
          description: 'The harness configuration, which holds the provider endpoints and their keys.',
        },
        cofoldConfigPath: {
          name: 'PAPO_CONFIG',
          default: `${configDir}/papo/config.json`,
          description: 'Where the harness looks for its configuration inside the machine.',
        },
        cofoldBaseUrl: {
          name: 'COFOLD_BASE_URL',
          description: 'The endpoint of a provider called default, read on top of the configuration.',
        },
        cofoldApiKey: {
          name: 'COFOLD_API_KEY',
          credential: true,
          description: 'The key for the default provider, best named from the vault.',
        },
        cofoldModel: {
          name: 'COFOLD_MODEL',
          description: 'The model to run on, as provider/model or a model of default.',
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
      /*
       * Every provider is asked in parallel, and the rows are merged in the
       * file's order. A provider that fails answers an empty list, so its rows
       * are absent and the others are still offered.
       */
      const endpoints = providerOptionsOf(options, {}, {}, harness);
      const listed = options.adapter === undefined
        ? (await Promise.all(endpoints.map((endpoint) => catalogueOf(endpoint)))).flat().map((info) => rowOf(options, info))
        : [];
      const reference = modelReferenceOf(options, {}, harness);
      const models = reference === undefined || listed.some((model) => model.id === reference)
        ? listed
        : [rowOf(options, { id: reference, name: reference }), ...listed];
      return { models, customizations: [], commands: await commandsOf(options) };
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
      for (const record of records) listed.push(await recordRow(record));
      return listed;
    },
    /*
     * One session's own row, read from its one record rather than by listing
     * the store.
     *
     * What a client opening a row the host does not hold costs without this: a
     * link from another machine, a session written to disk after the last
     * listing - `list` reads every record in the store and every record's
     * messages for one id. `undefined` is a real answer, the same one
     * `transcript` gives: the store does not have this session. A store error
     * is raised, since a store that would not answer is not a session that is
     * absent - and the host reads a throwing `find` as nothing to say.
     */
    find: async (id): Promise<Listed | undefined> => {
      const record = await store.sessions.get({ sessionId: id });
      return record === undefined ? undefined : await recordRow(record);
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
      const ends = new Map<string, string>();
      const turns = await turnsOf(store, id, ends);
      readEnds.set(id, ends);
      return turns;
    },
    /*
     * The session runs a cofold agent: a turn becomes `run()`'s event stream
     * and each event becomes the AHP action a client expects. The work is in
     * `session.ts`, `mapping.ts` and `tools.ts`.
     *
     * `runsNested` is the machine half. cofold's loop, tools and shell all run
     * in this process, so a session that names a computer cannot be served
     * here: the host starts a whole `ahpd` with this backend loaded inside the
     * machine and gives the session the SDK's proxy instead.
     */
    runsNested: true,
    create,
  };
}
