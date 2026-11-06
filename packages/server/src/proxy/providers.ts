/**
 * The model names this proxy serves, and the entries that serve each.
 *
 * A model name is `<maker>/<name>` and lists the connectors that serve it, each
 * under that connector's own model id. A provider is a connector, so this file
 * holds no endpoint and no key: a connector is opened from the connectors
 * store, and the proxy finds it by the entry's `provider`.
 *
 * The file holds three things: the names, whether a session's own call is
 * checked and recorded, and nothing else. A file that still writes `providers`
 * is refused, because a provider is a connector now.
 */

import { check, type JsonSchema } from '@cofold/commands';
import { isRecord, MODEL_DIALECTS, type ModelDialect } from '@ahpd/sdk';
import type { MapSchema } from '../commands/options.js';

/** The APIs a provider can be called in, as the name the connector writes. */
export const DIALECTS = MODEL_DIALECTS;

/** One of those APIs. */
export type Dialect = ModelDialect;

/** What a model costs on one provider. */
export interface ModelPrice {
  /** Dollars per million tokens fed to the model. */
  input?: number;
  /** Dollars per million tokens the model writes. */
  output?: number;
  /** Dollars per million characters of a speech input. */
  characters?: number;
  /** Dollars per minute of audio transcribed. */
  minutes?: number;
}

/** One provider's serving of a model name. */
export interface ModelEntry {
  /** The connector that serves it: an adapter's name, or one connector's id. */
  provider: string;
  /** The model id on that provider, which is that provider's own spelling. */
  id: string;
  /** What it costs there, when the price is known. */
  price?: ModelPrice;
}

/** What the `proxy` key holds. */
export interface ProxySetting {
  /** The model names, by `<maker>/<name>`, and the entries that serve each. */
  models?: Record<string, ModelEntry[]>;
  /**
   * Whether a call made with a session's own token is policy-checked and
   * recorded by the proxy: `record` does both, `skip` does neither. The session
   * meter records the same turn, so `record` can count its tokens twice.
   */
  sessionCalls?: SessionCalls;
  /**
   * What the caller is answered when a provider refuses this host's key with a
   * 401 or a 403: `hostError`, this host's own 502 naming the model and the
   * provider, or `passthrough`, the provider's status and error as it sent
   * them, as VS Code's Claude proxy re-emits an upstream error verbatim
   * (src/vs/platform/agentHost/node/claude/anthropicErrors.ts L16-L18, L48-L61
   * at 6b68d3fe).
   */
  keyRefusal?: KeyRefusal;
}

/** What `modelProxy.sessionCalls` may say. */
export const SESSION_CALLS = ['record', 'skip'] as const;

/** One of those. */
export type SessionCalls = (typeof SESSION_CALLS)[number];

/** What `modelProxy.keyRefusal` may say. */
export const KEY_REFUSALS = ['hostError', 'passthrough'] as const;

/** One of those. */
export type KeyRefusal = (typeof KEY_REFUSALS)[number];

/** What `modelProxy` reads as. */
export interface ProxyConfiguration {
  /** Every model name, and the entries that serve it. */
  models: Record<string, ModelEntry[]>;
  /** Whether a session's own call is checked and recorded; `record` when the file says nothing. */
  sessionCalls: SessionCalls;
  /** What a provider's refusal of this host's key answers; `hostError` when the file says nothing. */
  keyRefusal: KeyRefusal;
}

/**
 * What `proxy` reads as: every model name, and how a session's call is treated.
 *
 * Absent is no names, which is a proxy with nothing to route rather than a
 * failure.
 */
export const proxyConfiguration = (setting?: ProxySetting): ProxyConfiguration => ({
  models: { ...setting?.models },
  sessionCalls: setting?.sessionCalls ?? 'record',
  keyRefusal: setting?.keyRefusal ?? 'hostError',
});

/** One entry of a model name, as the file writes it. */
export const modelEntrySchema: JsonSchema = {
  type: 'object',
  properties: {
    provider: { type: 'string', minLength: 1 },
    id: { type: 'string', minLength: 1 },
    price: {
      type: 'object',
      properties: {
        input: { type: 'number', minimum: 0 },
        output: { type: 'number', minimum: 0 },
        characters: { type: 'number', minimum: 0 },
        minutes: { type: 'number', minimum: 0 },
      },
    },
  },
  required: ['provider', 'id'],
};

/**
 * What `proxy` holds.
 *
 * `models` carries the schema of one model name's entries, which is what a
 * client draws a row from. `check` copies a map value without holding it, so
 * `proxyProblems` checks each entry itself and a bad one is named rather than
 * refusing the whole file.
 */
export const proxySchema: JsonSchema = {
  type: 'object',
  properties: {
    models: {
      type: 'object',
      additionalProperties: { type: 'array', items: modelEntrySchema },
    } as MapSchema as JsonSchema,
    sessionCalls: { type: 'string', enum: SESSION_CALLS },
    keyRefusal: { type: 'string', enum: KEY_REFUSALS },
  },
};

/** What a file that still writes `providers` is told. */
export const PROVIDERS_GONE = 'modelProxy.providers is no longer read: add each provider as a connector, see docs/server/PROXY.md';

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
 * Three rules are not the schema's: `providers` is refused whole, a model name
 * is `<maker>/<name>`, and each entry names a provider. The rest is checked
 * against the schema, so a bad value here is named the way one on any other key
 * is.
 *
 * Every problem is collected rather than the first, because somebody who
 * mistyped two entries should be told about both.
 */
export const proxyProblems = (setting: unknown): string[] => {
  const problems: string[] = [];
  if (setting === undefined) return problems;
  if (isRecord(setting) && Object.hasOwn(setting, 'providers')) problems.push(PROVIDERS_GONE);
  held(setting, proxySchema, 'modelProxy', problems);

  const named = isRecord(setting) && isRecord(setting['models']) ? setting['models'] : {};
  const served = new Map<string, ModelEntry[]>();
  for (const [name, entries] of Object.entries(named)) {
    held(entries, { type: 'array' }, `modelProxy.models.${name}`, problems);
    if (!Array.isArray(entries)) continue;
    // Each entry is held on its own, so the sentence names which one it was.
    entries.forEach((entry, index) => { held(entry, modelEntrySchema, `modelProxy.models.${name}[${String(index)}]`, problems); });
    served.set(name, entries as ModelEntry[]);
  }
  // A shape the schema has already refused is not read further: a rule that
  // reads it would report on a value that is already wrong in another way.
  if (problems.length > 0) return problems;

  for (const name of served.keys()) {
    if (!MODEL_NAME.test(name)) problems.push(`modelProxy.models.${name} is not a model name: write it as <maker>/<name>`);
  }
  return problems;
};
