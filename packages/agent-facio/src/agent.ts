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
  /*
   * One store for the whole backend, built here rather than per session.
   *
   * `list()` and `transcript()` read what a session wrote, so the catalogue
   * and the conversation have to be looking at the same store. A store built
   * inside `create` answered a different database from the one the turns went
   * into, which is a catalogue that lists nothing it can open.
   */
  const store = storeOf(options);

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
     * `Start.forkAt` and `Start.rewindAt` are deliberately left unmapped.
     * facio has the slots a fork and a rewind would cut at - a run's
     * `inputMessageId` and `lastMessageId` - and turning one into a new
     * session or a truncation is a task of its own rather than a branch taken
     * silently through `resume()` here. Until then a request for either is
     * served as the plain continue it arrives beside.
     */
    create: (start) => facioSession(options, start, store),
  };
}
