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
import { createMemoryStore } from '@facio/agents';
import type { ModelAdapter, Store } from '@facio/agents';
import { openaiCompat } from '@facio/model-openai-compat';
import { createFileStore } from '@facio/store-file';
import type { Agent, Bag, Offered } from '@ahpd/sdk';

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
 * The model a session runs on.
 *
 * The settings a client sent win over the package's own, a caller-passed
 * adapter wins over both, and a session that named no model on a backend that
 * ships no default is refused here rather than at the first call, because a
 * refusal that names the missing setting is one a person can act on.
 */
export const modelOf = (options: FacioOptions = {}, settings: Record<string, unknown> = {}): ModelAdapter => {
  if (options.adapter !== undefined) return options.adapter;
  const model = text(settings.model) ?? options.model;
  if (model === undefined) {
    throw new Error(`${options.provider ?? 'facio'}: no model was chosen and this backend has no default`);
  }
  const key = text(settings.apiKey) ?? options.apiKey;
  return openaiCompat({
    baseUrl: text(settings.baseUrl) ?? options.baseUrl ?? 'http://127.0.0.1:1234/v1',
    model,
    ...(key === undefined ? {} : { apiKey: key }),
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

  /**
   * What a session may be told, and what the model is.
   *
   * `baseUrl` and `apiKey` are session settings because a client may point a
   * session at a different endpoint; the key is one the client sends, and the
   * docs say to keep a long-lived one in the daemon's environment instead.
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
      apiKey: {
        type: 'string',
        title: 'API key',
        description: 'Sent as a bearer token. A long-lived key belongs in the daemon environment, not here.',
        sessionMutable: true,
      },
      instructions: {
        type: 'string',
        title: 'Instructions',
        description: 'The system prompt this agent runs with.',
      },
    },
  });

  /** Only what the package was actually given: no default is invented for a model it cannot reach. */
  const defaults = (): Record<string, unknown> => ({
    ...(options.model !== undefined ? { model: options.model } : {}),
    ...(options.baseUrl !== undefined ? { baseUrl: options.baseUrl } : {}),
  });

  return {
    provider,
    displayName,
    ...(options.description !== undefined ? { description: options.description } : {}),
    schema,
    defaults,
    probe: async (): Promise<Offered> => ({
      models: options.model === undefined ? [] : [{ id: options.model, name: options.model }],
      customizations: [],
      commands: [],
    }),
    /*
     * Task 02 replaces this with the session that runs a facio agent. It is a
     * refusal and not an empty session on purpose: a backend that answered a
     * turn with nothing would be a session a client cannot tell from a model
     * that said nothing.
     */
    create: () => { throw new Error(`${provider}: the facio session is not built yet`); },
  };
}
