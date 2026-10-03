/**
 * The plugin entry: what the daemon imports when the package is named.
 *
 * `index.ts` re-exports `name`, `apply` and `optionsSchema` from here, so the
 * module the manifest names is the plugin. There is deliberately no default
 * export: the loader refuses a module without a named `apply` rather than
 * guessing which export is the plugin, and a silent guess is worse than a
 * refusal.
 *
 * The model adapter is not a configuration option in practice. A configuration
 * file is JSON and cannot carry a function or an object with methods, so the
 * only caller that puts one in `options` is an embedder or a test; the real
 * path is the OpenAI-compatible endpoint the session config selects, and the
 * API key for it belongs in the daemon's environment rather than in a setting
 * a client sends.
 */

import type { PluginHost } from '@ahpd/sdk';
import { cofoldAgent } from './agent.js';
import type { CofoldOptions } from './agent.js';

/** The plugin's id, unique among the plugins one daemon loads. */
export const name = '@ahpd/agent-cofold';

/**
 * What a listing prints for this package.
 *
 * The manifest's `ahpd.title` carries the same string to `ahpd plugin list`,
 * which must not import the module to read it; this export is for an embedder
 * that imports the entry directly.
 */
export const title = 'Cofold';

/**
 * A search provider that takes a key.
 *
 * `writeOnly` as the daemon's own is, so a client is told the key is set and
 * never what it is. The mask answers a plugin's own option keys, so this one is
 * marked because it is a credential, not because the daemon hides it.
 */
const keyed = { type: 'object', properties: { apiKey: { type: 'string', writeOnly: true } }, required: ['apiKey'] };

/**
 * The options `apply` receives, as a JSON Schema the daemon checks them against
 * before `apply` runs.
 *
 * `apiKey`, `adapter` and `policy` are also what an embedder calling `apply`
 * passes: a key function and a model adapter are things JSON cannot carry, so
 * the schema describes the configuration file's spelling of them.
 */
export const optionsSchema = {
  type: 'object',
  properties: {
    provider: { type: 'string', description: 'The id a client names in createSession. cofold by default.' },
    displayName: { type: 'string', description: 'What a person reads instead of the id. Cofold by default.' },
    description: { type: 'string', description: 'One line about this backend.' },
    model: { type: 'string', description: 'The model id a session that names none runs on.' },
    baseUrl: { type: 'string', description: 'The OpenAI-compatible endpoint a session that names none uses.' },
    instructions: { type: 'string', description: 'The system prompt the agent is created with.' },
    computerConfigDir: {
      anyOf: [{ type: 'string' }, { const: false }],
      description: 'The configuration directory the harness reads inside a machine. /ahpd/cofold by default; false leaves the image\'s own.',
    },
    store: { type: 'string', description: 'Where the cofold file store lives.' },
    memory: { type: 'boolean', description: 'true to hold the store in memory, for a test.' },
    tools: {
      type: 'object',
      properties: {
        files: { type: 'boolean' },
        shell: { type: 'boolean' },
        memory: { type: 'boolean' },
        web: {
          type: ['boolean', 'object'],
          properties: {
            search: {
              type: 'object',
              properties: { brave: keyed, tavily: keyed, duckduckgo: { type: 'boolean' } },
            },
          },
        },
      },
      description: 'Which capabilities a session runs, and where web_search gets its providers.',
    },
    apiKey: { type: 'string', writeOnly: true, description: "The daemon's own key." },
    resource: { type: 'string', description: 'The protected resource a client authenticates against.' },
    adapter: { type: 'object', description: 'A cofold ModelAdapter used instead of the HTTP one.' },
    policy: { type: 'object', description: 'The run-level policy a pause comes from.' },
  },
};

/** The package's own options, out of values `optionsSchema` has checked. */
const optionsOf = (values: Record<string, unknown>): CofoldOptions => values as CofoldOptions;

/**
 * Register provider `cofold` from the plugin's own options.
 *
 * The provider is per registration rather than per package, so two specs with
 * two providers and two stores are two backends that do not collide, which is
 * how one package serves several endpoints at once.
 */
export function apply(host: PluginHost, options: Record<string, unknown>): void {
  host.registerAgent(cofoldAgent(optionsOf(options)));
}
