/**
 * The plugin entry: what the daemon imports when the package is named.
 *
 * `index.ts` re-exports `name`, `apply` and `title` from here, so the module
 * the manifest names is the plugin. There is deliberately no default export:
 * the loader refuses a module without a named `apply` rather than guessing
 * which export is the plugin.
 *
 * The options schema is in this package's package.json, at `ahpd.optionsSchema`,
 * and is read from there rather than exported: the daemon reads it without
 * importing the module, so a plugin switched off still has a form.
 *
 * The daemon has no backend of its own - decision
 * `the-daemon-bundles-no-agent-and-starts-without-one` - so this is how Claude
 * Code reaches a host: one entry in `plugins`, with nothing under `options` in
 * the ordinary install.
 */

import { SUPPORTED_PROTOCOL_VERSIONS } from '@microsoft/agent-host-protocol';
import type { ModelEntry, ModelSource } from './models.js';
import type { Engine, Plugin, PluginHost, PluginPeer } from '@ahpd/sdk';
import { reason } from '@ahpd/sdk';
import { loginAdapter } from './adapter.js';
import { claude } from './claude.js';
import type { ClaudeOptions } from './claude.js';
import { sharedCatalogue as oneListing } from './catalog.js';
import { OpenLogins } from './logins.js';
import { kindSchema } from './options.js';

/** The plugin's id, unique among the plugins one daemon loads. */
export const name = 'agent-claude';

/**
 * What a listing prints for this package.
 *
 * The manifest's `ahpd.title` carries the same string to `ahpd plugin list`,
 * which must not import the module to read it; this export is for an embedder
 * that imports the entry directly.
 */
export const title = 'Agent Claude';

/**
 * The options `apply` receives, as a JSON Schema the daemon checks them against
 * before `apply` runs.
 *
 * The schema is written in this package's package.json, at `ahpd.optionsSchema`,
 * so a listing reads it without importing this module and a plugin switched off
 * still has a form a client draws. These are the plugin's own answers for every
 * record of the engine. What one agent runs on - its directories, models and
 * options - is the record's, and the engine's schema is where that is written.
 */

/**
 * The options every agent of one load shares, and the directories it serves.
 *
 * `paths` defaults to the host's, which is the whole configuration in the
 * ordinary install: the directories the daemon was started on are the ones
 * this backend lists. A deployment that wants the catalogue narrower than the
 * host names its own.
 *
 * These are the plugin's own options rather than any one agent's, and a record
 * takes them as they are: what a record may override is what the engine's schema
 * declares, and none of these is in it.
 */
const defaultsOf = (host: PluginHost, values: Record<string, unknown>) => {
  const said = values as Partial<ClaudeOptions>;
  const paths = said.paths ?? host.paths;
  const shared = {
    log: (line: string) => host.log(line),
    // One listing for all of them, and one load's worth of it: every record
    // below reads the same `paths` out of the same configuration directory, so
    // there is one pass over the projects directory for the lot.
    sharedCatalogue: oneListing(paths),
    ...(said.computerExecutable === undefined ? {} : { computerExecutable: said.computerExecutable }),
    ...(said.computerConfigDir === undefined ? {} : { computerConfigDir: said.computerConfigDir }),
    ...(said.computerCli === undefined ? {} : { computerCli: said.computerCli }),
    ...(said.computerCliFallback === undefined ? {} : { computerCliFallback: said.computerCliFallback }),
    ...(said.handshakeTimeoutMs === undefined ? {} : { handshakeTimeoutMs: said.handshakeTimeoutMs }),
  };
  return { paths, shared };
};

/**
 * The `claude` engine: the form a record of it fills in, and the backend each
 * record opens.
 *
 * The template is the built-in agent with nothing set, which is what a new
 * record starts from. `extraArgs` is host-only, because an argument is where a
 * command would come from; the two credential variables are key fields, so a
 * team's or a person's record may carry its own key while every other variable
 * stays the host's to set. The record is read live, so an edit reaches the
 * session at its next turn.
 */
/**
 * A record's `models`, each entry an id.
 *
 * The start's migration writes every entry as `{ id }`, and a bare id written
 * by hand later is read the same way. An entry with no id is left out.
 */
const modelsOf = (value: unknown): ModelEntry[] => (Array.isArray(value) ? value : []).flatMap((one: unknown) => {
  if (typeof one === 'string') return one === '' ? [] : [{ id: one }];
  if (typeof one !== 'object' || one === null || typeof (one as { id?: unknown }).id !== 'string') return [];
  return [one as ModelEntry];
});

/** A record's `modelSources`, each entry one with a `fetch`. */
const sourcesOf = (value: unknown): ModelSource[] => (Array.isArray(value) ? value : []).filter((one: unknown): one is ModelSource =>
  typeof one === 'object' && one !== null && typeof (one as { fetch?: unknown }).fetch === 'string');

/** The plugin's own options, as every agent of one load is built with them. */
type Shared = ReturnType<typeof defaultsOf>['shared'];

const engineOf = (paths: string[], shared: Shared, logins: OpenLogins): Engine => ({
  name: 'claude',
  title: 'Claude Code',
  description: 'Claude Code, with one record per agent: its own directories, models and options.',
  schema: kindSchema(),
  templates: [{
    // A record's name is its agent's, and VS Code's Claude agent is shown as `Claude`.
    // https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeAgent.ts#L738
    name: 'Claude',
    description: 'Claude Code as this host runs it, on the directories the plugin serves.',
    config: {},
  }],
  hostOnly: ['extraArgs'],
  keyVariables: ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'],
  open: (record) => claude({
    ...shared,
    paths,
    provider: record.id,
    displayName: record.name,
    ...(Array.isArray(record.config['models']) ? { models: modelsOf(record.config['models']) } : {}),
    ...(Array.isArray(record.config['modelSources']) ? { modelSources: sourcesOf(record.config['modelSources']) } : {}),
    ...(typeof record.config['keepCliModels'] === 'boolean' ? { keepCliModels: record.config['keepCliModels'] } : {}),
    presetOf: () => ({ ...record.config }),
    logins: { open: logins, owner: () => record.owner },
  }),
});

/** The client name this plugin's own connection to its host gives. */
const CLIENT = 'agent-claude';

/**
 * Log each failure of a login, and have the host keep each call of a login in
 * the connector's health, so its row shows it.
 *
 * The model proxy logs each failed attempt and notes its outcome on the
 * connector's health, in `packages/server/src/proxy/listener.ts`, and runs no
 * check. A plugin notes through the connectors channel's own command, as a
 * client does: the host keeps a call `x-ahpd/connectors/note` names, and sends
 * every reader the row. The connection is opened by the first note, as the
 * bot plugin opens its own by the first message, offering every version the
 * protocol package speaks, as ahpd's own nested client offers them, and one
 * that failed is dropped so the next one tries again.
 *
 * The connection carries the grants the plugin's configuration gives it, as
 * `docs/plugins/PLUGINS.md` says under *A plugin is a client of its own host*.
 * A note of a host login takes `connector:put` and `connector:host`, and a
 * person's login is never a plugin's to note, as `ownerAllows` in
 * `packages/sdk/src/channels/owners.ts` holds. A command the host refuses is
 * one line in the log.
 */
const throughHost = (host: PluginHost): Pick<OpenLogins, 'onFailure' | 'onCall' | 'onLimits'> => {
  let opened: Promise<PluginPeer> | undefined;
  const connection = (): Promise<PluginPeer> => {
    opened ??= (async () => {
      const conn = host.connect();
      await conn.request('initialize', { clientId: CLIENT, protocolVersions: [...SUPPORTED_PROTOCOL_VERSIONS] });
      return conn;
    })();
    const failed = (): void => { opened = undefined; };
    opened.catch(failed);
    return opened;
  };
  return {
    onFailure: (id, why) => {
      host.log(`${name}: login ${id} failed: ${why}`);
    },
    onCall: (id, outcome) => {
      void connection()
        .then((conn) => conn.request('x-ahpd/connectors/note', { id, ...outcome }))
        .catch((error: unknown) => { host.log(`${name}: the host did not note a call of login ${id}: ${reason(error)}`); });
    },
    onLimits: (id, quotaSnapshots) => {
      void connection()
        .then((conn) => conn.request('x-ahpd/connectors/note', { id, quotaSnapshots }))
        .catch((error: unknown) => { host.log(`${name}: the host did not note the plan limits of login ${id}: ${reason(error)}`); });
    },
  };
};

/**
 * Register the `claude` engine, and the `claude-login` adapter.
 *
 * The agents are records of it: one load serves every Claude Code variant, and
 * each record says which one it runs. The logins are connectors of the
 * adapter, kept open for the load by the one `OpenLogins` both are built over.
 */
export const apply: Plugin['apply'] = (host, options) => {
  const { paths, shared } = defaultsOf(host, options);
  const logins = new OpenLogins();
  Object.assign(logins, throughHost(host));
  host.registerAdapter(loginAdapter(logins));
  host.registerEngine(engineOf(paths, shared, logins));
};
