/**
 * `ahpd plugin`: what a run would load, and installing one.
 *
 * The listing reads the same flags a run does, through the same declaration, so
 * `--plugin` and `--no-plugins` mean here what they mean there, and nothing
 * below imports a plugin or builds a host. Installing, updating and removing
 * are about the machine rather than a run, so they take only their own flags.
 */

import { check, output } from '@cofold/commands';
import type { Command, CommandContext, JsonSchema, Output, Registry } from '@cofold/commands';
import { scopeOf, secretRef } from '@ahpd/sdk';
import { configDir, configPath } from '../config.js';
import { running } from '../daemon.js';
import {
  NpmFailure, installPlugins, oneAtATime, pluginEntry, removePlugins, run as runProgram, setPluginEnabled, setPluginOption, updatePlugins,
} from '../install.js';
import type { Moved } from '../install.js';
import { describePlugin, optionsSchemaOf, pluginLine } from '../plugins.js';
import { version } from '../version.js';
import { keyed, maskOption, schemasFor, withoutSpecSecrets, withoutUserinfoIn } from './config.js';
import { optionsFrom, pluginWriteFields, flagFields, serverFields, servedPluginWriteFields, stop, typedValue } from './options.js';
import type { ServedFacts } from './served.js';

/** What a change to the plugins says, since only a restart loads it. */
const RESTART = 'Restart the daemon to load the change: ahpd restart';

export const declarePlugin = (registry: Registry<object>, served?: ServedFacts): Command[] => {
  const list = registry.action({
    id: 'plugin.list',
    summary: 'What the configuration names, and what a run would load',
    description: 'Resolves every spec and reads its manifest, without importing any of it.',
    surfaces: { cli: { pattern: ['plugin', 'list'] }, http: { method: 'GET', path: '/plugin/list' } },
    scopes: ['config:read'],
    // Served, the list is the daemon's own, so no field could name another.
    ...(served === undefined ? { input: flagFields } : {}),
    run: async (context) => {
      const options = served === undefined
        ? optionsFrom(context.input as Readonly<Record<string, unknown>>)
        : served.options;
      if (options.noPlugins) return output([], 'plugins: --no-plugins, so nothing is listed\n');
      if (options.plugins.length === 0) return output([], 'plugins: none named\n');
      // Served, a row is read by anyone holding `config:read`, so every option
      // the plugin's schema marks `writeOnly` is answered as `<set>` and every
      // string that may quote a spec URL has that URL's userinfo replaced; the
      // terminal's listing is the owner reading their own configuration.
      const keys = keyed(options.plugins);
      const schemas = served === undefined ? undefined : await schemasFor(options.plugins);
      const rows = [];
      for (const { key, spec } of keys) {
        const row = await describePlugin(spec, { configDir: configDir(), cwd: process.cwd() });
        rows.push(served === undefined ? row : {
          ...row,
          spec: withoutSpecSecrets(row.spec, schemas?.get(key)),
          ...(row.url === undefined ? {} : { url: withoutUserinfoIn(row.url) }),
          ...(row.path === undefined ? {} : { path: withoutUserinfoIn(row.path) }),
          ...(row.name === undefined ? {} : { name: withoutUserinfoIn(row.name) }),
          ...(row.title === undefined ? {} : { title: withoutUserinfoIn(row.title) }),
          ...(row.problem === undefined ? {} : { problem: withoutUserinfoIn(row.problem) }),
        });
      }
      return output(rows, `${rows.map(pluginLine).join('\n')}\n`);
    },
  });

  /*
   * What a failed write says. At the terminal npm's error has already been
   * written there as npm ran, so only what failed is said; served, nothing
   * reached the caller, so npm's reason goes with it.
   */
  const failure = (error: unknown): string => {
    if (error instanceof NpmFailure && served === undefined) return error.failed;
    return error instanceof Error ? error.message : String(error);
  };

  const write = (sub: 'install' | 'remove') => registry.action({
    id: `plugin.${sub}`,
    summary: sub === 'install'
      ? 'Install a backend or another plugin into the configuration directory'
      : 'Take a plugin out of the configuration, and uninstall it unless --keep',
    surfaces: { cli: { pattern: ['plugin', sub, ':name...'] }, http: { method: 'POST', path: `/plugin/${sub}` } },
    input: {
      ...(served === undefined ? pluginWriteFields : servedPluginWriteFields),
      name: { type: 'array', items: { type: 'string' }, description: 'A package name. One or more.' },
    },
    scopes: ['config:write'],
    // Installing or removing a plugin runs code in this process, so over HTTP
    // it is the deployment's own token and never a person.
    meta: { deploymentTokenOnly: 'install or remove a plugin' },
    run: (context) => oneAtATime(async () => {
      const names = context.list<string>('name');
      // Served, the file edited is the daemon's, whatever the request names.
      const configFile = served === undefined ? context.optional<string>('configFile') : served.configFile;
      /*
       * Each line is written when it is said, so a step that throws has still
       * shown what it did. With a payload asked for, the lines are diagnostics
       * and go to stderr, because stdout is the JSON.
       */
      const payload = context.globals['json'] === true || context.globals['quiet'] === true;
      const say = (line: string): void => {
        if (payload) context.error(line);
        else context.write(`${line}\n`);
      };
      try {
        if (sub === 'install') {
          await installPlugins(names, {
            configDir: configDir(), configFile: configFile ?? configPath(),
            version: version(), enable: !context.flag('noEnable'), run: runProgram, fetch, say,
          });
        }
        else {
          await removePlugins(names, {
            configDir: configDir(), configFile: configFile ?? configPath(),
            uninstall: !context.flag('keep'), run: runProgram, say,
          });
        }
      }
      catch (error) {
        stop(failure(error));
      }
      /*
       * The list a running daemon serves is the one it started with, and a
       * served install is that same daemon's own file, so the change is loaded
       * only by a restart. At the terminal a record is what says one is up.
       */
      const restart = served !== undefined || running() !== undefined;
      if (restart) say(RESTART);
      return output({ plugins: names, ...(restart ? { restart: true } : {}) }, '');
    }),
  });

  const update = registry.action({
    id: 'plugin.update',
    summary: 'Move every installed plugin, or the ones named, to the version that matches this daemon',
    description: 'One npm call in the configuration directory: every @ahpd package at the daemon\'s version, any other from the registry at latest, and one from a path, link, git or URL left as installed.',
    surfaces: { cli: { pattern: ['plugin', 'update', ':name...'] }, http: { method: 'POST', path: '/plugin/update' } },
    input: {
      name: { type: 'array', items: { type: 'string' }, description: 'all, or a package name. One or more.' },
    },
    scopes: ['config:write'],
    // An update runs code in this process as an install does, so over HTTP it
    // is the deployment's own token and never a person.
    meta: { deploymentTokenOnly: 'update a plugin' },
    run: (context) => oneAtATime(async () => {
      const payload = context.globals['json'] === true || context.globals['quiet'] === true;
      const say = (line: string): void => {
        if (payload) context.error(line);
        else context.write(`${line}\n`);
      };
      const asked = context.list<string>('name');
      // `all` is a word of its own, so it is never one name among others.
      if (asked.includes('all') && asked.length > 1) {
        stop('Say which plugins to update: ahpd plugin update all, or ahpd plugin update <name>...');
      }
      let moved: Moved[] = [];
      try {
        moved = await updatePlugins(asked.length === 1 && asked[0] === 'all' ? 'all' : asked, {
          configDir: configDir(), version: version(), run: runProgram, say,
        });
      }
      catch (error) {
        stop(failure(error));
      }
      const restart = moved.length > 0 && (served !== undefined || running() !== undefined);
      if (restart) say(RESTART);
      return output({ plugins: moved, ...(restart ? { restart: true } : {}) }, '');
    }),
  });

  /** The file a command edits: the daemon's own when served, whatever the request names. */
  const fileOf = (named: string | undefined): string => (served === undefined ? named : served.configFile) ?? configPath();

  /** Whether a change is said to need a restart: always served, and at the terminal when a record says one is up. */
  const restarting = (): boolean => served !== undefined || running() !== undefined;

  /*
   * `plugin config` reads and writes a plugin's options. It is two
   * declarations because a pattern holds no slot after an optional one: the
   * first shows, or with --unset removes, and the second sets. Both run the
   * body below, which reads whichever fields its declaration has.
   */
  const configFields = {
    ...(served === undefined ? { configFile: serverFields.configFile } : {}),
    name: { type: 'string', description: 'The plugin, as plugins names it.' },
    key: { type: 'string', description: 'One option.' },
  } as const;
  const configure = (context: CommandContext): Promise<Output> => oneAtATime(async () => {
    const name = context.optional<string>('name');
    if (name === undefined) stop('Say which plugin: ahpd plugin config <name>.');
    const key = context.optional<string>('key');
    const typed = context.optional<string>('value');
    const unset = context.flag('unset');
    const file = fileOf(context.optional<string>('configFile'));
    const payload = context.globals['json'] === true || context.globals['quiet'] === true;
    const say = (line: string): void => {
      if (payload) context.error(line);
      else context.write(`${line}\n`);
    };
    const entry = pluginEntry(file, name);
    if (entry === undefined) stop(`${name} is not in plugins in ${file}.`);
    if (unset && (key === undefined || typed !== undefined)) stop('--unset takes a key and no value: ahpd plugin config <name> <key> --unset.');

    /*
     * The plugin's schema, from the module a load would import. Needed to
     * check a value, and served to know which values are write-only; a module
     * that cannot be imported is `undefined` with the reason beside it. A
     * plugin switched off is never imported, since importing runs its code.
     */
    const disabled = typeof entry !== 'string' && entry.enabled === false;
    const schemaNeeded = !disabled && (served !== undefined || typed !== undefined);
    let schema: Record<string, unknown> | undefined;
    let unreadable: string | undefined;
    if (schemaNeeded) {
      try {
        schema = await optionsSchemaOf(entry, { configDir: configDir(), cwd: process.cwd() });
      }
      catch (error) {
        unreadable = error instanceof Error ? error.message : String(error);
      }
    }
    /*
     * What a served answer carries for a value: `<set>` for anything the
     * plugin's schema marks write-only, and for every value of a plugin whose
     * schema was not read, because it could not be or because the plugin is
     * switched off, since nothing says which of them is a credential. The
     * terminal is the owner reading their own file and carries every value.
     */
    const mask = disabled || unreadable !== undefined ? undefined : schema;
    const shown = (option: string, value: unknown): unknown =>
      served === undefined ? value : maskOption(mask, option, value);
    const options = typeof entry === 'string' ? {} : entry.options ?? {};

    if (typed === undefined && !unset) {
      if (key === undefined) {
        const rows = Object.entries(options).map(([option, value]) => [option, shown(option, value)] as const);
        const text = rows.length === 0
          ? `${name}\n  (no options set)\n`
          : `${name}\n${rows.map(([option, value]) => `  ${option}: ${JSON.stringify(value)}`).join('\n')}\n`;
        return output({ name, options: Object.fromEntries(rows) }, text);
      }
      if (!Object.hasOwn(options, key)) stop(`${name} sets no ${key} in ${file}.`);
      const value = shown(key, options[key]);
      return output({ name, key, value }, `${JSON.stringify(value)}\n`);
    }

    const option = key as string;
    if (unset) {
      if (!setPluginOption(file, name, option, undefined)) {
        say(`${name} sets no ${option} in ${file}.`);
        return output({ name, key: option }, '');
      }
      say(`Unset ${name} ${option}.`);
    }
    else {
      const value = typedValue(typed as string);
      const properties = schema?.['properties'];
      const known = typeof properties === 'object' && properties !== null ? properties as Record<string, unknown> : undefined;
      if (disabled) say(`${name} is switched off, so ${option} is written unchecked; it is checked when the plugin is enabled and loads.`);
      else if (unreadable !== undefined) say(`Could not import ${name} to check it (${unreadable}); it is checked at the next start.`);
      else if (known !== undefined && Object.hasOwn(known, option)) {
        try {
          // A reference is held to the name rule rather than to the option's
          // schema: what it will resolve to is the plugin's business, read
          // through `host.secret` once it loads.
          const ref = secretRef(value);
          if (ref === undefined) check(value, known[option] as JsonSchema, `plugins.${name}.options.${option}`);
          else scopeOf(ref);
        }
        catch (error) {
          stop(error instanceof Error ? error.message : String(error));
        }
      }
      else if (schema !== undefined) say(`${option} is not an option ${name} knows; written anyway.`);
      setPluginOption(file, name, option, value);
      say(`Set ${name} ${option}.`);
    }
    const restart = restarting();
    if (restart) say(RESTART);
    return output({
      name,
      key: option,
      ...(unset ? {} : { value: shown(option, typedValue(typed as string)) }),
      ...(restart ? { restart: true } : {}),
    }, '');
  });
  const config = registry.action({
    id: 'plugin.config',
    summary: "Show a plugin's options, or remove one",
    description: 'With a name, every option the configuration sets for it; with a key, that one; --unset removes it.',
    surfaces: { cli: { pattern: ['plugin', 'config', ':name', ':key?'] }, http: { method: 'POST', path: '/plugin/config' } },
    input: {
      ...configFields,
      unset: { type: 'boolean', description: 'Remove the option.' },
    },
    scopes: ['config:write'],
    // A plugin's options change what its code does in this process, so over
    // HTTP this is the deployment's own token, as an install is.
    meta: { deploymentTokenOnly: "change a plugin's options" },
    run: configure,
  });
  const set = registry.action({
    id: 'plugin.config.set',
    summary: 'Set one of a plugin\'s options',
    description: 'The value is read as JSON when it parses and as text otherwise, and checked against the plugin\'s options schema when the plugin can be imported.',
    surfaces: {
      cli: { pattern: ['plugin', 'config', ':name', ':key', ':value'] },
      http: { method: 'POST', path: '/plugin/config/set' },
    },
    input: {
      ...configFields,
      value: { type: 'string', description: 'The value: JSON when it parses, otherwise text.' },
    },
    scopes: ['config:write'],
    meta: { deploymentTokenOnly: "change a plugin's options" },
    run: configure,
  });

  const toggle = (sub: 'enable' | 'disable') => registry.action({
    id: `plugin.${sub}`,
    summary: sub === 'enable' ? 'Turn a configured plugin on' : 'Turn a configured plugin off, keeping its entry and options',
    surfaces: { cli: { pattern: ['plugin', sub, ':name'] }, http: { method: 'POST', path: `/plugin/${sub}` } },
    input: {
      ...(served === undefined ? { configFile: serverFields.configFile } : {}),
      name: { type: 'string', description: 'The plugin, as plugins names it.' },
    },
    scopes: ['config:write'],
    // Turning a plugin on runs its code in this process, as an install does.
    meta: { deploymentTokenOnly: 'enable or disable a plugin' },
    run: (context) => oneAtATime(async () => {
      const name = context.optional<string>('name');
      if (name === undefined) stop(`Say which plugin: ahpd plugin ${sub} <name>.`);
      const file = fileOf(context.optional<string>('configFile'));
      const payload = context.globals['json'] === true || context.globals['quiet'] === true;
      const say = (line: string): void => {
        if (payload) context.error(line);
        else context.write(`${line}\n`);
      };
      try {
        setPluginEnabled(file, name, sub === 'enable');
      }
      catch (error) {
        stop(error instanceof Error ? error.message : String(error));
      }
      say(`${sub === 'enable' ? 'Enabled' : 'Disabled'} ${name}.`);
      const restart = restarting();
      if (restart) say(RESTART);
      return output({ name, enabled: sub === 'enable', ...(restart ? { restart: true } : {}) }, '');
    }),
  });

  return [list, write('install'), write('remove'), update, config, set, toggle('enable'), toggle('disable')];
};
