/**
 * The plugin entry: what the daemon imports when the package is named.
 *
 * `index.ts` re-exports `name`, `apply` and `optionsSchema` from here, so the
 * module the manifest names is the plugin. There is deliberately no default
 * export: the loader refuses a module without a named `apply` rather than
 * guessing which export is the plugin.
 *
 * One spec is one ACP server. The command is what tells two of them apart, so
 * two specs with two commands and two providers are two backends rather than a
 * collision - which is how one package serves Copilot and Codex at once.
 */

import type { PluginHost } from '@ahpd/sdk';
import { acpAgent } from './agent.js';
import type { AcpOptions } from './types.js';

/** The plugin's id, unique among the plugins one daemon loads. */
export const name = '@ahpd/agent-acp';

/**
 * What a listing prints for this package.
 *
 * The manifest's `ahpd.title` carries the same string to `ahpd plugin list`,
 * which must not import the module to read it; this export is for an embedder
 * that imports the entry directly.
 */
export const title = 'ACP';

/**
 * The options `apply` receives, as a JSON Schema the daemon checks them against
 * before `apply` runs. `command` is required: a backend with nothing to spawn
 * cannot run at all.
 */
export const optionsSchema = {
  type: 'object',
  properties: {
    command: { type: 'string', description: 'The program to spawn as the ACP server.' },
    args: { type: 'array', items: { type: 'string' }, description: 'The arguments to give it.' },
    env: { type: 'object', additionalProperties: { type: 'string', writeOnly: true }, description: 'Environment variables merged over process.env for the child. A variable is a credential wherever the server keeps one, so each answers <set>.' },
    cwd: { type: 'string', description: "The directory the server runs in; the session's working directory when absent." },
    provider: { type: 'string', description: 'The AHP provider id, default acp.' },
    displayName: { type: 'string', description: 'What a client reads instead of the id, default ACP.' },
    description: { type: 'string', description: 'One line about what this backend is.' },
    model: { type: 'string', description: 'The model a session that names none runs on.' },
    hostTools: { type: 'boolean', description: 'Offer the host\'s own tools to each session as an MCP server, on by default.' },
    authenticate: {
      type: 'object',
      properties: { methodId: { type: 'string' } },
      required: ['methodId'],
      description: 'The sign-in to send after the handshake, as the methodId of a method the server lists in authMethods. A value naming one it does not offer fails the turn that opened.',
    },
  },
  required: ['command'],
};

/**
 * The package's own options, out of values `optionsSchema` has checked.
 *
 * `authenticate` is the one option whose inside the schema does not reach: it
 * says this key is an object, and the id inside it is required there rather
 * than here, so an object carrying no id is refused here rather than turned
 * into a sign-in to no method.
 */
const optionsOf = (host: PluginHost, values: Record<string, unknown>): AcpOptions => {
  const signIn = values.authenticate;
  if (signIn !== undefined) {
    const held = (typeof signIn === 'object' && signIn !== null ? signIn : {}) as { methodId?: unknown };
    if (typeof held.methodId !== 'string' || held.methodId === '') {
      throw new Error(`plugins.${name}.options.authenticate.methodId is required`);
    }
  }
  // The log is the daemon's own - the same line `agent-claude` writes its
  // warnings to. `hostTools` keeps whatever it says: on unless a deployment
  // says `false`, which is decided where the option is read rather than here.
  return { ...(values as unknown as AcpOptions), log: (line) => host.log(line) };
};

/**
 * Register one ACP backend from the plugin's own options.
 *
 * The provider is per registration rather than per package, so two specs with
 * two commands and two providers are two backends that do not collide.
 */
export function apply(host: PluginHost, options: Record<string, unknown>): void {
  host.registerAgent(acpAgent(optionsOf(host, options)));
}
