/**
 * The daemon's own settings, as the keys root config carries.
 *
 * `config.json` is the source: `values` reads it and `write` edits it in place,
 * beside every entry nothing here touches. The host is handed this as a port
 * rather than given the file, because the host is the protocol and a daemon's
 * settings are not its own - decision
 * `plugin-configuration-travels-in-root-config`.
 *
 * A write is checked before the file is touched, so a value this daemon would
 * refuse at the next start never reaches it - and is said in one message naming
 * the key, which is the `rejectionReason` the client that pushed it is given.
 */

import type { Field, JsonSchema } from '@cofold/commands';
import { check } from '@cofold/commands';
import type { PluginSpec, RootConfigPort } from '@ahpd/sdk';
import { asSpec, configPath } from './config.js';
import { SET, keyed, maskValue } from './commands/config.js';
import { checkConfig, configSchema, mcpServerSchema, mcpServers, serverFields, type ConfigKey, type Options } from './commands/options.js';
import { oneAtATime, readEntry, writeEntry } from './install.js';
import { nameOf, optionsSchemaLoaded } from './plugins.js';

/**
 * The keys a client may edit.
 *
 * Not every key a run takes. The ones that are how this daemon was started or
 * who may reach it - `stdio`, `configFile`, the connection token, `users` - are
 * left out on purpose: a form that could change them would be a form that could
 * take the door off its hinges and leave nothing behind that would open it.
 */
const DAEMON_KEYS = ['paths', 'port', 'host', 'http', 'updateCheck', 'advancedTools', 'wire', 'mcpServers'] as const;

/**
 * The keys this daemon can apply while it runs.
 *
 * Every other key is written to the file and answered `restartNeeded`, which is
 * the notice in root state that a setting is not in force yet - decision
 * `a-configuration-change-applies-live-or-on-ahpd-restart`.
 */
const LIVE = new Set<string>(['advancedTools', 'wire', 'mcpServers']);

/** A flag as a person types it: `--port`, and `--path` where the field says so. */
const flagOf = (key: ConfigKey): string => {
  const cli = (serverFields[key] as Field).cli;
  return typeof cli?.flag === 'string'
    ? cli.flag
    : `--${key.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`)}`;
};

/** Whether two values would be written the same way, which is all this asks. */
const same = (one: unknown, other: unknown): boolean => JSON.stringify(one) === JSON.stringify(other);

/**
 * The values a client asked for, with every `<set>` at any depth taken out.
 *
 * `<set>` is what the mask answers for a credential, so a form that sends the
 * whole object back is saying the secret is left as it is; writing it would
 * replace every one of them with the word. An object left holding nothing asked
 * for goes with them, so a client that changed nothing at all says nothing.
 */
const askedOf = (value: unknown): unknown => {
  if (value === SET) return undefined;
  if (Array.isArray(value)) return value.map(askedOf).filter((one) => one !== undefined);
  if (typeof value !== 'object' || value === null) return value;
  const held = Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, one]) => [key, askedOf(one)]).filter(([, one]) => one !== undefined),
  );
  return Object.keys(held).length === 0 ? undefined : held;
};

/**
 * `asked` over what the entry holds, so an option the client did not name is
 * not one it decided to remove.
 *
 * A `null` takes a key back, wherever it is, and an object is merged rather than
 * replaced, which is what lets a client send back one nested credential beside
 * the ordinary value it changed and leave the rest of the object alone.
 */
const mergedWith = (held: unknown, asked: unknown): unknown => {
  if (asked === null) return undefined;
  if (typeof asked !== 'object' || asked === null || Array.isArray(asked)) return asked;
  const stored = typeof held === 'object' && held !== null && !Array.isArray(held) ? held as Record<string, unknown> : {};
  const out: Record<string, unknown> = { ...stored };
  for (const [key, one] of Object.entries(asked as Record<string, unknown>)) {
    const merged = mergedWith(stored[key], one);
    if (merged === undefined) delete out[key];
    else out[key] = merged;
  }
  return out;
};

/**
 * The servers a client asked for, over the ones the file holds.
 *
 * Entry by entry, and merged only where the two agree on a `type`: a server
 * that changes shape is another server, and merging one into the other leaves
 * it holding the `command` of the stdio it was beside the `url` of the http one
 * it has become, or an env and a header both. An entry sent back whole with its
 * credentials as `<set>` is merged as everywhere else, so saying leave a secret
 * as it is does not take it away.
 */
const mergedServers = (held: unknown, asked: unknown): unknown => {
  const stored = typeof held === 'object' && held !== null && !Array.isArray(held) ? held as Record<string, unknown> : {};
  if (typeof asked !== 'object' || asked === null || Array.isArray(asked)) return asked;
  const out: Record<string, unknown> = { ...stored };
  const both = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);
  for (const [name, one] of Object.entries(asked as Record<string, unknown>)) {
    const before = stored[name];
    const merged = one === null
      ? undefined
      : both(before) && both(one) && before['type'] === one['type'] ? mergedWith(before, one) : one;
    if (merged === undefined) delete out[name];
    else out[name] = merged;
  }
  return out;
};

/**
 * The port a run hands the host, for the file `options` was folded from, the
 * flags `typed` was started with, and the capture `openWire` moves.
 *
 * The file is what a form edits, so a value a start flag overrode is said in
 * that key's description rather than shown in place of it: a client that saved
 * the value it was given has written what the daemon will read next time, and
 * one that was not told would think the running daemon had changed.
 */
export function daemonRootConfig(
  options: Options,
  typed: Readonly<Record<string, unknown>> = {},
  openWire: (at: string | undefined) => void = () => {},
  holdMcpServers: (servers: unknown) => void = () => {},
): RootConfigPort {
  const file = options.configFile ?? configPath();

  /**
   * What one daemon key answers, which is the file's own value for every key
   * but the MCP servers.
   *
   * An env entry or a header on a server is a credential wherever it is, so
   * those answer as set and the rest of the server is answered as it was
   * written - the same mask a plugin's own options go through.
   */
  const answered = (key: string, value: unknown): unknown =>
    key === 'mcpServers' ? maskValue({ type: 'object', additionalProperties: mcpServerSchema }, value) : value;

  /** Every `plugins` entry the file holds, with the key it is carried under. */
  const entries = (held: Record<string, unknown>): { key: string; name: string; spec: PluginSpec }[] => {
    if (!Array.isArray(held.plugins)) return [];
    const specs = held.plugins.map(asSpec).filter((one): one is PluginSpec => one !== undefined);
    return keyed(specs).map(({ key, spec }) => ({ key, name: nameOf(spec), spec }));
  };
  /** One plugin key, as a schema and a value. */
  const pluginKey = (name: string, spec: PluginSpec) => {
    const off = typeof spec !== 'string' && spec.enabled === false;
    // A plugin switched off was never imported, so nothing marks a credential
    // in it and every value it holds answers `<set>`, the same as one whose
    // module does not import at all.
    const schema = off ? undefined : optionsSchemaLoaded(name);
    const options = (typeof spec === 'string' ? {} : spec.options) ?? {};
    return {
      schema: {
        type: 'object',
        title: name,
        description: 'Whether this plugin is loaded at the next start, and the options it is loaded with.',
        properties: {
          enabled: { type: 'boolean', title: 'Enabled', description: `Load ${name} at the next start.` },
          // No schema for a plugin that did not load: its own is in a module
          // that was never imported, and a form that guessed one would refuse
          // values the plugin would have taken.
          options: schema ?? {},
        },
      },
      // The same mask every served answer uses: a credential is never sent
      // back, only whether it is set, wherever in the plugin's options it is.
      value: { enabled: !off, options: maskValue(schema, options) },
    };
  };

  return {
    schema: () => {
      const held = readEntry(file);
      return {
        type: 'object',
        properties: {
          ...Object.fromEntries(DAEMON_KEYS.map((key) => {
            const said = serverFields[key].description;
            const overrode = typed[key] !== undefined && !same(typed[key], held[key]);
            return [key, {
              ...(configSchema.properties[key] as Record<string, unknown>),
              description: overrode
                ? `${said} This run was started with ${flagOf(key)}, so what is here is not what this daemon is using.`
                : said,
            }];
          })),
          ...Object.fromEntries(entries(held).map(({ key, name, spec }) => [key, pluginKey(name, spec).schema])),
        },
      };
    },
    /** What the file holds, and no key the file does not hold. */
    values: () => {
      const held = readEntry(file);
      return {
        ...Object.fromEntries(DAEMON_KEYS.filter((key) => Object.hasOwn(held, key)).map((key) => [key, answered(key, held[key])])),
        ...Object.fromEntries(entries(held).map(({ key, name, spec }) => [key, pluginKey(name, spec).value])),
      };
    },
    /**
     * Held to the same check a start is, in place, before anything is written.
     *
     * Inside `oneAtATime`, so an edit arriving while `plugin install` is
     * rewriting the file cannot read the half it wrote.
     */
    write: (values) => oneAtATime(async () => {
      const held = readEntry(file);
      let restartNeeded = false;
      for (const [key, value] of Object.entries(values)) {
        if (!key.startsWith('plugins.')) {
          restartNeeded = restartNeeded || !LIVE.has(key);
          // `null` is how a client says a key is taken back, as it is everywhere
          // else on the root channel.
          if (value === null || value === undefined) {
            delete held[key];
            continue;
          }
          /*
           * The servers are merged rather than replaced, because an env entry
           * or a header on one is answered as `<set>`: a client that sends the
           * map back is saying the credentials are left as they are, and
           * writing what it was shown would put the word over every one of them.
           */
          if (key === 'mcpServers') {
            const merged = mergedServers(held[key], askedOf(value));
            if (merged === undefined || Object.keys(merged as Record<string, unknown>).length === 0) delete held[key];
            else held[key] = merged;
            continue;
          }
          held[key] = value;
          continue;
        }
        // A plugin's contributions are folded in when the host is built, so
        // there is no key of this one that applies while the daemon runs.
        restartNeeded = true;
        const list = Array.isArray(held.plugins) ? [...held.plugins] : [];
        const at = entries(held).findIndex((one) => one.key === key);
        if (at === -1) throw new Error(`${key} is not in plugins in ${file}.`);
        const spec = asSpec(list[at]) as PluginSpec;
        // A string entry is a name and nothing else, so it becomes an object
        // entry here for the first time it says anything else.
        const entry: Record<string, unknown> = typeof spec === 'string'
          ? { name: spec }
          : { ...list[at] as Record<string, unknown>, name: spec.name };
        const asked = (typeof value === 'object' && value !== null ? value : {}) as { enabled?: unknown; options?: unknown };
        // A string entry is already on and holds nothing else, so asking for
        // that is asking for no change: the name stays a name, as
        // `plugin enable` leaves it.
        if (typeof spec === 'string' && asked.enabled !== false && asked.options === undefined) continue;
        const known = optionsSchemaLoaded(nameOf(spec))?.['properties'];
        const given = (askedOf(asked.options) ?? {}) as Record<string, unknown>;
        for (const [option, one] of Object.entries(given)) {
          // A null takes the option back, as it does everywhere else here, and
          // there is nothing left of it to check.
          if (one === null) continue;
          // Only an option the schema names is checked: the defaults a plugin
          // merges under its own are not in the file, so holding the whole
          // object to `required` would refuse what the plugin itself accepts.
          if (known === undefined || typeof known !== 'object' || known === null) continue;
          if (!Object.hasOwn(known, option)) continue;
          check(one, (known as Record<string, JsonSchema>)[option] as JsonSchema, `${key}.options.${option}`);
        }
        // A string entry is already on, so switching one on leaves the file as
        // it was, the way `plugin enable` does.
        if (asked.enabled !== undefined && !(typeof spec === 'string' && asked.enabled === true)) {
          entry.enabled = asked.enabled === true;
        }
        if (asked.options !== undefined) {
          // Over what the entry holds rather than instead of it: a client that
          // was never shown a credential sends it back as `<set>`, and an
          // option it did not name is not one it decided to remove.
          const merged = mergedWith(entry.options, given);
          if (merged === undefined || Object.keys(merged as Record<string, unknown>).length === 0) delete entry.options;
          else entry.options = merged;
        }
        list[at] = entry;
        held.plugins = list;
      }
      checkConfig(held, () => file);
      writeEntry(file, held);
      // The capture follows the file, and only once the file is what it says.
      if ('wire' in values) openWire(typeof values['wire'] === 'string' ? values['wire'] : undefined);
      /*
       * The servers as the file now holds them, credentials included, for the
       * next session, and through the same check a start applies: an entry the
       * file holds but a server cannot be built from is left in the file, where
       * the next start says what is wrong with it, rather than handed to a
       * session that would fail on it.
       */
      if ('mcpServers' in values) holdMcpServers(mcpServers(held['mcpServers'], () => file).servers);
      return { restartNeeded };
    }),
  };
}