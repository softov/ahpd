/**
 * The providers this proxy calls, and the model names that point at them.
 *
 * A provider is an endpoint and the APIs it answers in. A model name is
 * `<maker>/<name>` and lists the providers that serve it, each under that
 * provider's own model id - decision
 * `a-model-is-named-by-its-maker-and-runs-on-a-provider`. Three are built in
 * and are there without any configuration, and the file may add one or replace
 * one, because an endpoint that moves upstream is a default rather than a fact.
 *
 * A key is named by the environment variable holding it and is never written in
 * the file, so the file can be read, printed and committed. A dialect is the API
 * a provider speaks: a call goes out in the dialect the caller used and nothing
 * is translated yet.
 */

import { check, type JsonSchema } from '@cofold/commands';
import { isRecord } from '@ahpd/sdk';

/** The APIs a provider can be called in, as the name the file writes. */
export const DIALECTS = ['anthropic-messages', 'openai-chat'] as const;

/** One of those APIs. */
export type Dialect = (typeof DIALECTS)[number];

/** Where a provider's key is read from. The key itself is never in the file. */
export interface ProviderKey {
  /** The name of the environment variable that holds it. */
  env: string;
}

/** One provider, as the configuration holds it. */
export interface ProxyProvider {
  /** Where its API answers, such as `https://api.anthropic.com`. */
  endpoint: string;
  /** The APIs it is called in. A call passes through in one of them. */
  accepts: Dialect[];
  /** The key it is called with, named by the variable that holds it. */
  key?: ProviderKey;
}

/** What a model costs on one provider. */
export interface ModelPrice {
  /** Dollars per million tokens fed to the model. */
  input?: number;
  /** Dollars per million tokens the model writes. */
  output?: number;
}

/** One provider's serving of a model name. */
export interface ModelEntry {
  /** The provider that serves it, as `providers` names that one. */
  provider: string;
  /** The model id on that provider, which is that provider's own spelling. */
  id: string;
  /** What it costs there, when the price is known. */
  price?: ModelPrice;
}

/** What the `proxy` key holds. */
export interface ProxySetting {
  /** The providers, by the id a model entry names. Over the built-in ones. */
  providers?: Record<string, ProxyProvider>;
  /** The model names, by `<maker>/<name>`, and the entries that serve each. */
  models?: Record<string, ModelEntry[]>;
  /**
   * Whether a call made with a session's own token is policy-checked and
   * recorded by the proxy: `record` does both, `skip` does neither. The session
   * meter records the same turn, so `record` can count its tokens twice.
   */
  sessionCalls?: SessionCalls;
}

/** What `proxy.sessionCalls` may say. */
export const SESSION_CALLS = ['record', 'skip'] as const;

/** One of those. */
export type SessionCalls = (typeof SESSION_CALLS)[number];

/** What `proxy` reads as once the file is over the built-ins. */
export interface ProxyConfiguration {
  /** Every provider, the built-ins with the file's over them. */
  providers: Record<string, ProxyProvider>;
  /** Every model name, and the entries that serve it. */
  models: Record<string, ModelEntry[]>;
  /** Whether a session's own call is checked and recorded; `record` when the file says nothing. */
  sessionCalls: SessionCalls;
}

/**
 * The providers that are there without any configuration.
 *
 * The endpoints are what those makers answer on today, and the keys are the
 * variables each of them documents. They are defaults in every sense: a file
 * entry of the same id replaces one whole rather than patching it, so pointing
 * a provider at a gateway is one entry rather than a merge rule.
 */
export const BUILT_IN_PROVIDERS: Readonly<Record<string, ProxyProvider>> = {
  openrouter: {
    endpoint: 'https://openrouter.ai/api/v1',
    accepts: ['openai-chat'],
    key: { env: 'OPENROUTER_API_KEY' },
  },
  anthropic: {
    endpoint: 'https://api.anthropic.com',
    accepts: ['anthropic-messages'],
    key: { env: 'ANTHROPIC_API_KEY' },
  },
  openai: {
    endpoint: 'https://api.openai.com/v1',
    accepts: ['openai-chat'],
    key: { env: 'OPENAI_API_KEY' },
  },
};

/**
 * What `proxy` reads as: every provider, and every model name.
 *
 * The file's providers are over the built-in ones, entry by entry, and a model
 * name is kept as it was written. Absent is the three built-ins and no names,
 * which is a proxy with nothing to route rather than a failure.
 */
export const proxyConfiguration = (setting?: ProxySetting): ProxyConfiguration => ({
  providers: { ...BUILT_IN_PROVIDERS, ...setting?.providers },
  models: { ...setting?.models },
  sessionCalls: setting?.sessionCalls ?? 'record',
});

/** One provider as the file writes it. */
export const providerSchema: JsonSchema = {
  type: 'object',
  properties: {
    endpoint: { type: 'string', minLength: 1 },
    accepts: { type: 'array', items: { type: 'string', enum: DIALECTS }, minItems: 1 },
    key: {
      type: 'object',
      properties: { env: { type: 'string', minLength: 1 } },
      required: ['env'],
    },
  },
  required: ['endpoint', 'accepts'],
};

/** One entry of a model name, as the file writes it. */
export const modelEntrySchema: JsonSchema = {
  type: 'object',
  properties: {
    provider: { type: 'string', minLength: 1 },
    id: { type: 'string', minLength: 1 },
    price: {
      type: 'object',
      properties: { input: { type: 'number', minimum: 0 }, output: { type: 'number', minimum: 0 } },
    },
  },
  required: ['provider', 'id'],
};

/**
 * What `proxy` holds.
 *
 * The entries under `providers` and `models` are not described here, because
 * the JSON Schema this family checks has no way of saying that an object is a
 * map: every key would have to be written out. `proxyProblems` checks them.
 */
export const proxySchema: JsonSchema = {
  type: 'object',
  properties: {
    providers: { type: 'object' },
    models: { type: 'object' },
    sessionCalls: { type: 'string', enum: SESSION_CALLS },
  },
};

/** A model name as one rule: a maker and a name, each holding no slash. */
const MODEL_NAME = /^[^/\s]+\/[^/\s]+$/u;

/** One value held to a schema, its sentence kept rather than thrown. */
const held = (value: unknown, schema: JsonSchema, label: string, into: string[]): void => {
  try { check(value, schema, label); }
  catch (error) { into.push(error instanceof Error ? error.message : String(error)); }
};

/**
 * What is wrong with `proxy`, as the sentences a person is shown.
 *
 * Two rules are not the schema's: a model name is `<maker>/<name>`, and the
 * provider an entry names is one that exists once the file's providers are over
 * the built-ins. The rest is checked against the schema, so a bad value here is
 * named the way one on any other key is.
 *
 * Every problem is collected rather than the first, because somebody who
 * mistyped two providers should be told about both.
 */
export const proxyProblems = (setting: unknown): string[] => {
  const problems: string[] = [];
  if (setting === undefined) return problems;
  held(setting, proxySchema, 'proxy', problems);

  const given = isRecord(setting) && isRecord(setting['providers']) ? setting['providers'] : {};
  const named = isRecord(setting) && isRecord(setting['models']) ? setting['models'] : {};
  for (const [id, provider] of Object.entries(given)) {
    held(provider, providerSchema, `proxy.providers.${id}`, problems);
  }
  const served = new Map<string, ModelEntry[]>();
  for (const [name, entries] of Object.entries(named)) {
    held(entries, { type: 'array' }, `proxy.models.${name}`, problems);
    if (!Array.isArray(entries)) continue;
    // Each entry is held on its own, so the sentence names which one it was.
    entries.forEach((entry, index) => { held(entry, modelEntrySchema, `proxy.models.${name}[${String(index)}]`, problems); });
    served.set(name, entries as ModelEntry[]);
  }
  // A shape the schema has already refused is not read further: a rule that
  // reads it would report on a value that is already wrong in another way.
  if (problems.length > 0) return problems;

  const known = { ...BUILT_IN_PROVIDERS, ...given };
  for (const [name, entries] of served) {
    if (!MODEL_NAME.test(name)) problems.push(`proxy.models.${name} is not a model name: write it as <maker>/<name>`);
    for (const entry of entries) {
      if (!Object.hasOwn(known, entry.provider)) {
        problems.push(`proxy.models.${name} names ${entry.provider}, which is not a provider`);
      }
    }
  }
  return problems;
};
