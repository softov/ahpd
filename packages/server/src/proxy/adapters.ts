/**
 * The four provider adapters the host ships.
 *
 * A model provider is a connector, so the host registers these beside the
 * adapters a plugin brings, with no plugin entry of its own. Each one is a
 * form, a `provider` that tells the proxy where and how to call it, a `models`
 * that reads the provider's own list, a check that proves its key, and an icon.
 *
 * The key is a secret: a schema marks it `writeOnly`, so the host keeps its
 * value in the vault and hands the adapter the value back when it opens the
 * connector. A host connector may name `{ "fromEnv": "<NAME>" }` instead, which
 * the channel reads from the daemon's own environment.
 *
 * The four checks are one `GET` that needs the key, so a wrong key is refused
 * rather than answered. Nothing here reads a key from the environment itself.
 */

import { fileURLToPath } from 'node:url';
import {
  type Adapter, type Capability, type CheckResult, type Connector, MODEL_DIALECTS, type ModelDialect, type ModelProvider,
  type ProviderModel,
} from '@ahpd/sdk';
import type { Icon } from '@ahpd/sdk';
import { resolveIcons, type IconProblem } from '../icons.js';

/** The endpoint OpenRouter answers on, until a connector says otherwise. */
const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1';

/** The endpoint Anthropic answers on, until a connector says otherwise. */
const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com';

/** The endpoint OpenAI answers on, until a connector says otherwise. */
const OPENAI_ENDPOINT = 'https://api.openai.com/v1';

/** How long one check may take. The channel gives it ten, so this ends first. */
const CHECK_TIMEOUT_MS = 8_000;

/** The version Anthropic's models endpoint asks for, so a check is about the key and not the header. */
const ANTHROPIC_VERSION = '2023-06-01';

/** The folder a relative icon is read from: the server package, in `src/` and in `dist/`. */
const SERVER_PACKAGE = fileURLToPath(new URL('../..', import.meta.url)).replace(/[\\/]+$/u, '');

/** What the host's adapters are built with. */
export interface HostAdapterOptions {
  /** The `fetch` each check goes out through. The global one when absent. */
  fetch?: typeof fetch;
  /** One line for an icon that could not be read, as `resolveIcons` says it. */
  onProblem?: IconProblem;
}

/**
 * What a connector of a provider adapter does, as a client lists it.
 *
 * The name tells a client that a connector of this adapter can be called by the
 * model proxy; the member that says how is `Adapter.provider`, which only the
 * host reads.
 */
const MODELS: Capability = {
  type: 'models',
  name: 'models',
  title: 'Serves models',
  description: 'The model proxy may call this connector for a model that names its adapter.',
};

/** The field every vendor provider needs: the API key, kept in the vault. */
const KEY: Record<string, unknown> = {
  type: 'string',
  minLength: 1,
  writeOnly: true,
  title: 'Key',
  description: 'The API key. It is kept in the vault, never in the connector.',
};

/** An endpoint field, with the default the vendor answers on today. */
const endpointField = (fallback: string, description: string): Record<string, unknown> => ({
  type: 'string',
  minLength: 1,
  default: fallback,
  title: 'Endpoint',
  description,
});

/** The dialects an OpenAI-compatible endpoint takes unless it says otherwise. */
const COMPATIBLE_ACCEPTS: Record<string, unknown> = {
  type: 'array',
  items: { type: 'string', enum: MODEL_DIALECTS },
  minItems: 1,
  default: ['openai-chat'],
  title: 'Accepts',
  description: 'The APIs the endpoint is called in.',
};

/** An endpoint field with no default: an OpenAI-compatible server is wherever its owner runs it. */
const ANY_ENDPOINT: Record<string, unknown> = {
  type: 'string',
  minLength: 1,
  title: 'Endpoint',
  description: 'Where the endpoint answers, such as http://127.0.0.1:1234/v1.',
};

/** A config value as a non-empty string, or nothing when it is absent. */
const text = (value: unknown): string | undefined =>
  (typeof value === 'string' && value !== '' ? value : undefined);

/** A config value the form requires, refused when a record written by hand does not hold one. */
const required = (connector: Connector, field: string): string => {
  const value = text(connector.config[field]);
  if (value === undefined) throw new Error(`${connector.id} names no ${field}`);
  return value;
};

/** The endpoint a connector names, or the vendor's own when it names none. */
const endpointOf = (connector: Connector, fallback: string): string =>
  (text(connector.config['endpoint']) ?? fallback).replace(/\/+$/u, '');

/** One dialect, when a value names one. */
const isDialect = (value: unknown): value is ModelDialect => MODEL_DIALECTS.some((one) => one === value);

/** The dialects an OpenAI-compatible connector accepts, defaulting to the chat one. */
const acceptsOf = (connector: Connector): ModelDialect[] => {
  const named = connector.config['accepts'];
  if (!Array.isArray(named)) return ['openai-chat'];
  const kept = named.filter(isDialect);
  return kept.length === 0 ? ['openai-chat'] : kept;
};

/**
 * One check: a `GET` with the key, mapped to the four outcomes.
 *
 * A call that does not connect, a timeout included, is `unreachable`. A 2xx is
 * `ok`, a 401 or 403 is `denied`, and any other answer is `failed` with its
 * status. The body is cancelled rather than read: only the status says whether
 * the key works, and a provider's sentence may quote it.
 */
const probe = async (url: string, headers: Record<string, string>, fetcher: typeof fetch): Promise<CheckResult> => {
  let answer: Response;
  try {
    answer = await fetcher(url, { headers, redirect: 'error', signal: AbortSignal.timeout(CHECK_TIMEOUT_MS) });
  } catch {
    return { result: 'unreachable' };
  }
  await answer.body?.cancel().catch(() => undefined);
  if (answer.ok) return { result: 'ok' };
  const message = `HTTP ${String(answer.status)}`;
  if (answer.status === 401 || answer.status === 403) return { result: 'denied', message };
  return { result: 'failed', message };
};

/** A JSON object, when a value is one. */
const plain = (value: unknown): Record<string, unknown> | undefined =>
  (typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined);

/** The entries of a list answer, which every vendor keeps under `data`. */
const listOf = (value: unknown): Record<string, unknown>[] => {
  const data = plain(value)?.['data'];
  return Array.isArray(data)
    ? data.map(plain).filter((one): one is Record<string, unknown> => one !== undefined)
    : [];
};

/** A count a list entry gives, when it gives one. */
const count = (value: unknown): number | undefined =>
  (typeof value === 'number' && Number.isFinite(value) ? value : undefined);

/**
 * The models of a list answer, through one adapter's reading.
 *
 * An entry without an id names nothing a caller could ask for, so it is left
 * out rather than listed with an empty name.
 */
const modelsOf = (
  value: unknown,
  read: (entry: Record<string, unknown>) => ProviderModel | undefined,
): ProviderModel[] => listOf(value).map(read).filter((one): one is ProviderModel => one !== undefined);

/**
 * One `GET` of a provider's model list, read as JSON.
 *
 * The answer is refused with its status when it is not 2xx, so the host's log
 * says what the provider said. The time limit is the check's, because both are
 * one call of the same kind.
 */
const listed = async (url: string, headers: Record<string, string>, fetcher: typeof fetch): Promise<unknown> => {
  const answer = await fetcher(url, { headers, redirect: 'error', signal: AbortSignal.timeout(CHECK_TIMEOUT_MS) });
  if (!answer.ok) {
    await answer.body?.cancel().catch(() => undefined);
    throw new Error(`HTTP ${String(answer.status)}`);
  }
  return answer.json() as Promise<unknown>;
};

/** One OpenRouter entry, with the fields its list carries that a caller sees. */
const openRouterModel = (entry: Record<string, unknown>): ProviderModel | undefined => {
  const id = text(entry['id']);
  if (id === undefined) return undefined;
  const name = text(entry['name']);
  const context = count(entry['context_length']);
  const pricing = plain(entry['pricing']);
  const prompt = text(pricing?.['prompt']);
  const completion = text(pricing?.['completion']);
  return {
    id,
    ...(name === undefined ? {} : { name }),
    ...(context === undefined ? {} : { context_length: context }),
    ...(prompt === undefined && completion === undefined ? {} : {
      pricing: { ...(prompt === undefined ? {} : { prompt }), ...(completion === undefined ? {} : { completion }) },
    }),
  };
};

/** One OpenAI entry: the list is ids alone. */
const openAiModel = (entry: Record<string, unknown>): ProviderModel | undefined => {
  const id = text(entry['id']);
  return id === undefined ? undefined : { id };
};

/** One Anthropic entry, which spells the name and the window its own way. */
const anthropicModel = (entry: Record<string, unknown>): ProviderModel | undefined => {
  const id = text(entry['id']);
  if (id === undefined) return undefined;
  const name = text(entry['display_name']);
  const context = count(entry['max_input_tokens']);
  return {
    id,
    ...(name === undefined ? {} : { name }),
    ...(context === undefined ? {} : { context_length: context }),
  };
};

/** One entry of an OpenAI-compatible server's list, which may carry a name and a window. */
const compatibleModel = (entry: Record<string, unknown>): ProviderModel | undefined => {
  const id = text(entry['id']);
  if (id === undefined) return undefined;
  const name = text(entry['name']);
  const context = count(entry['context_length']);
  return {
    id,
    ...(name === undefined ? {} : { name }),
    ...(context === undefined ? {} : { context_length: context }),
  };
};

/** How many models to ask Anthropic for in one page. */
const ANTHROPIC_PAGE = 1_000;

/** Anthropic's whole list, one page after another while it says there is more. */
const anthropicModels = async (connector: Connector, fetcher: typeof fetch): Promise<ProviderModel[]> => {
  const endpoint = endpointOf(connector, ANTHROPIC_ENDPOINT);
  const headers = { 'x-api-key': required(connector, 'key'), 'anthropic-version': ANTHROPIC_VERSION };
  const models: ProviderModel[] = [];
  const pages = new Set<string>();
  let after: string | undefined;
  for (;;) {
    const more = after === undefined ? '' : `&after_id=${encodeURIComponent(after)}`;
    const page = plain(await listed(`${endpoint}/v1/models?limit=${String(ANTHROPIC_PAGE)}${more}`, headers, fetcher));
    models.push(...modelsOf(page, anthropicModel));
    const last = text(page?.['last_id']);
    if (page?.['has_more'] !== true || last === undefined || pages.has(last)) return models;
    pages.add(last);
    after = last;
  }
};

/** The icon of each host adapter, read once and kept: the files do not change while the daemon runs. */
let iconsRead: Record<string, Icon[]> | undefined;

/** Read each icon against the server package, once, and say a file that cannot be read. */
const iconsOf = (problem: IconProblem): Record<string, Icon[]> => {
  if (iconsRead !== undefined) return iconsRead;
  const read = (name: string): Icon[] =>
    resolveIcons([{ src: `./icons/${name}.svg` }], SERVER_PACKAGE, 'the host proxy adapters', problem);
  iconsRead = {
    openrouter: resolveIcons(
      [{ src: './icons/openrouter.svg', theme: 'light' }, { src: './icons/openrouter-dark.svg', theme: 'dark' }],
      SERVER_PACKAGE, 'the host proxy adapters', problem,
    ),
    anthropic: read('anthropic'),
    openai: read('openai'),
    'openai-compatible': read('openai-compatible'),
  };
  return iconsRead;
};

/**
 * The four adapters, keyed by name.
 *
 * `fetch` and `onProblem` are parameters so a test can answer without a
 * network and read the lines an icon would say, and so the daemon can send a
 * bad icon to its log. Every other rule is fixed here.
 */
export function hostAdapters(options: HostAdapterOptions = {}): Record<string, Adapter> {
  const fetcher = options.fetch ?? globalThis.fetch;
  const icons = iconsOf(options.onProblem ?? (() => {}));
  const icon = (name: string): { icons?: Icon[] } => {
    const list = icons[name];
    return list === undefined || list.length === 0 ? {} : { icons: list };
  };
  /** A host adapter answers the proxy's calls itself, so it has nothing to start. */
  const open = (): void => undefined;

  const openrouter: Adapter = {
    name: 'openrouter',
    title: 'OpenRouter',
    description: 'An OpenRouter account, called in the OpenAI chat dialect.',
    schema: {
      type: 'object',
      properties: {
        key: KEY,
        endpoint: endpointField(OPENROUTER_ENDPOINT, 'Where OpenRouter answers. Leave it for the public endpoint.'),
      },
      required: ['key'],
    },
    capabilities: [MODELS],
    open,
    provider: (connector: Connector): ModelProvider => ({
      endpoint: endpointOf(connector, OPENROUTER_ENDPOINT),
      accepts: ['openai-chat'],
      key: required(connector, 'key'),
    }),
    check: async (connector: Connector) => probe(
      `${endpointOf(connector, OPENROUTER_ENDPOINT)}/key`,
      { authorization: `Bearer ${required(connector, 'key')}` },
      fetcher,
    ),
    models: async (connector: Connector) => modelsOf(await listed(
      `${endpointOf(connector, OPENROUTER_ENDPOINT)}/models`,
      { authorization: `Bearer ${required(connector, 'key')}` },
      fetcher,
    ), openRouterModel),
    ...icon('openrouter'),
  };

  const anthropic: Adapter = {
    name: 'anthropic',
    title: 'Anthropic',
    description: 'An Anthropic account, called at Anthropic\'s own API.',
    schema: {
      type: 'object',
      properties: {
        key: KEY,
        endpoint: endpointField(ANTHROPIC_ENDPOINT, 'Where Anthropic answers. Leave it for the public endpoint.'),
      },
      required: ['key'],
    },
    capabilities: [MODELS],
    open,
    provider: (connector: Connector): ModelProvider => ({
      endpoint: endpointOf(connector, ANTHROPIC_ENDPOINT),
      accepts: ['anthropic-messages'],
      key: required(connector, 'key'),
    }),
    check: async (connector: Connector) => probe(
      `${endpointOf(connector, ANTHROPIC_ENDPOINT)}/v1/models`,
      { 'x-api-key': required(connector, 'key'), 'anthropic-version': ANTHROPIC_VERSION },
      fetcher,
    ),
    models: async (connector: Connector) => anthropicModels(connector, fetcher),
    ...icon('anthropic'),
  };

  const openai: Adapter = {
    name: 'openai',
    title: 'OpenAI',
    description: 'An OpenAI account, called in the OpenAI chat dialect.',
    schema: {
      type: 'object',
      properties: {
        key: KEY,
        endpoint: endpointField(OPENAI_ENDPOINT, 'Where OpenAI answers. Leave it for the public endpoint.'),
      },
      required: ['key'],
    },
    capabilities: [MODELS],
    open,
    provider: (connector: Connector): ModelProvider => ({
      endpoint: endpointOf(connector, OPENAI_ENDPOINT),
      accepts: ['openai-chat'],
      key: required(connector, 'key'),
    }),
    check: async (connector: Connector) => probe(
      `${endpointOf(connector, OPENAI_ENDPOINT)}/models`,
      { authorization: `Bearer ${required(connector, 'key')}` },
      fetcher,
    ),
    models: async (connector: Connector) => modelsOf(await listed(
      `${endpointOf(connector, OPENAI_ENDPOINT)}/models`,
      { authorization: `Bearer ${required(connector, 'key')}` },
      fetcher,
    ), openAiModel),
    ...icon('openai'),
  };

  const compatible: Adapter = {
    name: 'openai-compatible',
    title: 'OpenAI-compatible endpoint',
    description: 'A server that speaks the OpenAI chat API, such as a local model or a gateway.',
    schema: {
      type: 'object',
      properties: {
        endpoint: ANY_ENDPOINT,
        key: { ...KEY, description: 'The API key, when the endpoint needs one. It is kept in the vault, never in the connector.' },
        accepts: COMPATIBLE_ACCEPTS,
      },
      required: ['endpoint'],
    },
    capabilities: [MODELS],
    open,
    provider: (connector: Connector): ModelProvider => {
      const key = text(connector.config['key']);
      return {
        endpoint: required(connector, 'endpoint').replace(/\/+$/u, ''),
        accepts: acceptsOf(connector),
        prefix: connector.id,
        ...(key === undefined ? {} : { key }),
      };
    },
    check: async (connector: Connector) => {
      const key = text(connector.config['key']);
      return probe(
        `${required(connector, 'endpoint').replace(/\/+$/u, '')}/models`,
        key === undefined ? {} : { authorization: `Bearer ${key}` },
        fetcher,
      );
    },
    models: async (connector: Connector) => {
      const key = text(connector.config['key']);
      return modelsOf(await listed(
        `${required(connector, 'endpoint').replace(/\/+$/u, '')}/models`,
        key === undefined ? {} : { authorization: `Bearer ${key}` },
        fetcher,
      ), compatibleModel);
    },
    ...icon('openai-compatible'),
  };

  return Object.fromEntries([openrouter, anthropic, openai, compatible].map((adapter) => [adapter.name, adapter]));
}
