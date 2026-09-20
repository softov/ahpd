/**
 * The facio agent runtime as an AHP backend.
 *
 * `@facio/agents` owns the loop, the conversation, the tools, the policy, the
 * pause and the store; `@facio/model-openai-compat` owns one transport. What
 * this package adds is the AHP half, so a model or an endpoint is a session
 * setting rather than a package of its own.
 *
 * This file holds the backend's identity: the provider, the schema a client
 * fills in, the defaults, the model factory and the store. The session that
 * runs a turn is `session.ts`, and the plugin entry is `plugin.ts`.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { createMemoryStore, textOf } from '@facio/agents';
import type { ModelAdapter, Policy, Store } from '@facio/agents';
import { openaiCompat } from '@facio/model-openai-compat';
import { createFileStore } from '@facio/store-file';
import type { Agent, Bag, Listed, Offered } from '@ahpd/sdk';
import { harnessConfig, splitModel } from './config.js';
import type { HarnessConfig, HarnessProvider } from './config.js';
import { facioSession } from './session.js';
import { turnsOf } from './transcript.js';

/** What an embedder, or a plugin's options, may set. */
export interface FacioOptions {
  /** The AHP provider id. Default `facio`. */
  provider?: string;
  /** What a client reads instead of the id. Default `Facio`. */
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
  /** Where the file store lives; absent means the tool's own data directory. */
  store?: string;
  /** Hold everything in memory instead of on disk; for a test. */
  memory?: boolean;
  /** A model adapter to use instead of `openaiCompat`; for a test or an embedder. */
  adapter?: ModelAdapter;
  /**
   * The run-level policy an approval decision comes from.
   *
   * Absent means facio's own default, which asks about a destructive tool and
   * allows the rest; this bridge carries a policy through rather than
   * inventing a second default beside it.
   */
  policy?: Partial<Policy>;
}

/**
 * Where a facio store lives when nothing named one.
 *
 * Data rather than configuration: sessions and runs are written by the daemon,
 * not edited by a person, and `XDG_DATA_HOME` is the variable for exactly that.
 */
export const defaultStoreRoot = (): string =>
  join(process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'), 'ahpd', 'facio');

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
export const FALLBACK_RESOURCE = 'https://ahpd.dev/agent-facio';

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
export const resourceOf = (options: FacioOptions = {}, harness: HarnessConfig = harnessConfig()): string => {
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
  options: FacioOptions,
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
interface Connection {
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
 * Resolve the connection a model setting names, without requiring that a model
 * was chosen: a probe lists what an endpoint serves before anybody picks.
 *
 * `strict` is the difference between asking and running. A call that builds an
 * adapter refuses a missing model and a reference naming a provider the file
 * does not carry; a call that only reads a catalogue falls back to the first
 * provider's endpoint and lists what it has.
 */
const connectionOf = (
  options: FacioOptions,
  settings: Record<string, unknown>,
  credentials: Record<string, string>,
  harness: HarnessConfig,
  strict: boolean,
): Connection => {
  const own = options.provider ?? 'facio';
  const reference = text(settings.model) ?? options.model ?? harness.model;
  const named = reference === undefined ? undefined : splitModel(reference);
  const provider = endpointOf(options, harness, reference);
  const explicitBase = text(settings.baseUrl) ?? options.baseUrl;
  // A reference under this backend's own id names the endpoint it was
  // configured with rather than a provider the harness file would have to hold.
  const ownRef = named !== undefined && named.provider === own;
  if (strict) {
    if (reference === undefined) {
      throw new Error(`${own}: no model was chosen, this backend has no default, and ${harness.path} names none`);
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
 * Every model the endpoint says it serves.
 *
 * An OpenAI-compatible `GET /models`, which is where OpenRouter publishes the
 * models it routes to and what LM Studio answers with what it has loaded. Each
 * id is offered as `<provider>/<model id>`, the spelling the harness itself
 * writes, because OpenRouter's ids contain slashes and a bare one would be read
 * as a provider reference.
 *
 * Anything that goes wrong - a refused connection, a wrong shape, a timeout - is
 * an empty list: an endpoint that cannot be asked offers the configured model
 * alone, rather than a picker with no rows.
 */
const listModels = async (connection: Connection): Promise<{ id: string; name: string }[]> => {
  try {
    // A key written as a function is asked here too, so a catalogue read after
    // a rotation is not sent the token the last one used.
    const key = typeof connection.apiKey === 'function' ? await connection.apiKey() : connection.apiKey;
    const response = await fetch(`${connection.baseUrl.replace(/\/+$/, '')}/models`, {
      headers: {
        accept: 'application/json',
        ...(key === undefined ? {} : { authorization: `Bearer ${key}` }),
        ...connection.headers,
      },
      signal: AbortSignal.timeout(CATALOGUE_TIMEOUT_MS),
    });
    if (!response.ok) return [];
    const body = await response.json() as { data?: unknown };
    if (!Array.isArray(body.data)) return [];
    const models: { id: string; name: string }[] = [];
    for (const raw of body.data) {
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) continue;
      const held = raw as Record<string, unknown>;
      const id = text(held.id);
      if (id === undefined) continue;
      models.push({ id: `${connection.prefix}/${id}`, name: text(held.name) ?? id });
    }
    return models;
  }
  catch {
    return [];
  }
};

/**
 * The model a session runs on.
 *
 * The settings a client sent win over the package's own, which win over the
 * harness configuration, and a caller-passed adapter wins over all three. A
 * model written `<provider>/<model>` selects that provider's endpoint and key
 * from the harness file, which is the whole point of reading it: a person who
 * has already pointed facio at a provider does not say it again here, and no
 * token has to be lent for the common case.
 *
 * The key is the one a client lent through `authenticate` for this backend's
 * protected resource, then the package's own, then the named provider's. It is
 * deliberately not a session setting: a credential in configuration is a
 * credential written to the session store and carried by every backup.
 */
export const modelOf = (
  options: FacioOptions = {},
  settings: Record<string, unknown> = {},
  credentials: Record<string, string> = {},
  harness: HarnessConfig = harnessConfig(),
): ModelAdapter => {
  if (options.adapter !== undefined) return options.adapter;
  const connection = connectionOf(options, settings, credentials, harness, true);
  // Strict resolution has answered that a model was chosen.
  return openaiCompat({
    baseUrl: connection.baseUrl,
    model: connection.model as string,
    ...(connection.apiKey === undefined ? {} : { apiKey: connection.apiKey }),
    ...(connection.headers === undefined ? {} : { headers: connection.headers }),
  });
};

/** The store this backend keeps its sessions and runs in. */
export const storeOf = (options: FacioOptions = {}): Store =>
  options.memory === true
    ? createMemoryStore()
    : createFileStore({ root: options.store ?? defaultStoreRoot() });

/**
 * One AHP backend over facio.
 *
 * The provider id is per registration rather than per package, so two of these
 * with two stores and two models are two backends, which is how the register
 * surface gets exercised with a harness behind it.
 */
export function facioAgent(options: FacioOptions = {}): Agent {
  const provider = options.provider ?? 'facio';
  const displayName = options.displayName ?? 'Facio';
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
   */
  const catalogues = new Map<string, { id: string; name: string }[]>();
  const cacheKey = (connection: Connection): string => `${connection.baseUrl}\n${connection.apiKey ?? ''}`;

  const catalogueOf = async (connection: Connection): Promise<{ id: string; name: string }[]> => {
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
  const knownCatalogue = (connection: Connection): { id: string; name: string }[] => {
    const held = catalogues.get(cacheKey(connection));
    if (held !== undefined) return held;
    void catalogueOf(connection);
    return [];
  };

  return {
    provider,
    displayName,
    ...(options.description !== undefined ? { description: options.description } : {}),
    /*
     * A chat can be forked from one of its turns.
     *
     * A fork copies the conversation through a turn into a facio session of
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
      const listed = options.adapter === undefined ? await catalogueOf(connection) : [];
      const models = connection.reference === undefined || listed.some((model) => model.id === connection.reference)
        ? listed
        : [{ id: connection.reference, name: connection.reference }, ...listed];
      return { models, customizations: [], commands: [] };
    },
    /*
     * The sessions this backend already has.
     *
     * No workspace is passed to the query: `list()` is asked before any
     * session exists, and the workspace is a per-session key facio already
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
     * The session runs a facio agent: a turn becomes `run()`'s event stream
     * and each event becomes the AHP action a client expects. The work is in
     * `session.ts`, `mapping.ts` and `tools.ts`.
     *
     * `Start.forkAt` and `Start.rewindAt` are the cut the session was asked
     * for: a fork copies the resumed conversation through that message into a
     * facio session of its own, and a rewind drops what followed it from the
     * resumed one, which is `Store.sessions.fork` and `Store.sessions.truncate`
     * doing the work before the first turn runs. `session.ts` refuses a turn if
     * the cut could not be made, rather than carrying on from the wrong place.
     */
    create: (start) => facioSession(options, start, store, harness, (settings, credentials) =>
      knownCatalogue(connectionOf(options, settings, credentials, harness, false))),
  };
}
