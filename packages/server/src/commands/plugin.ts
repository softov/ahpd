/**
 * `ahpd plugin`: what a run would load, and installing one.
 *
 * The listing reads the same flags a run does, through the same declaration, so
 * `--plugin` and `--no-plugins` mean here what they mean there. A plugin is
 * imported only to read its id, and nothing below applies one or builds a host. Installing, updating and removing
 * are about the machine rather than a run, so they take only their own flags.
 */

import { check, output } from '@cofold/commands';
import type { Command, CommandContext, JsonSchema, Output, Registry } from '@cofold/commands';
import { scopeOf, secretRef } from '@ahpd/sdk';
import { configDir, configPath } from '../config.js';
import { running } from '../daemon.js';
import { API_PREFIX } from '../http.js';
import {
  NpmFailure, installPlugins, oneAtATime, pluginEntry, removePlugins, run as runProgram, setPluginEnabled, setPluginOption, specsIn, updatePlugins,
} from '../install.js';
import type { Moved } from '../install.js';
import { describePlugin, sourceOf, optionsSchemaOf, pluginIdOf, pluginIdsOf, pluginLine } from '../plugins.js';
import { version } from '../version.js';
import { keyed, maskOption, schemasFor, withoutSpecSecrets, withoutUserinfoIn } from './config.js';
import { namedOptionsFrom, pluginWriteFields, flagFields, serverFields, servedPluginWriteFields, splitPluginOption, stop, typedValue } from './options.js';
import { reachable } from './paths.js';
import type { ServedFacts } from './served.js';

/** What a change to the plugins says when only a restart loads it: a plugin with a port, or no daemon to ask. */
const RESTART = 'Restart the daemon to load the change: ahpd restart';

/**
 * How long the terminal waits for the daemon it asks to load a change.
 *
 * The same wait `commands/paths.ts` gives the same daemon for the same reason:
 * a plugin applies in memory, and one that has not answered by now is not one a
 * person should be left holding a terminal for.
 */
const APPLY_WAIT_MS = 10_000;

/**
 * The token a recorded daemon's connect URL carries, read as `commands/paths.ts`
 * reads it. A record an older daemon wrote has none, and the call is made
 * without one: the refusal is then the daemon's own.
 */
const tokenIn = (connectUrl: string): string | undefined => {
  try {
    return new URL(connectUrl).searchParams.get('tkn') ?? undefined;
  }
  catch {
    return undefined;
  }
};

/**
 * What a set says when the running daemon's recorded line already sets that
 * option: a restart starts that line again, so the flag wins over the file.
 *
 * The flag is named up to its `=`, as every refusal about one is: an option is
 * a credential more often than not, and this line is printed on a terminal and
 * carried by a served answer, so what the flag holds is not said.
 */
const overridden = (plugin: string, key: string): string =>
  `--plugin-option ${plugin}.${key}, recorded for this daemon, overrides it on ahpd restart.`;

/**
 * Whether a recorded line sets one key of one plugin with `--plugin-option`.
 *
 * The line is a list of words, so the flag is read as one: `--plugin-option X`
 * and `--plugin-option=X` are both what a start forwards, whichever the person
 * typed. Only a flag that sets the key itself and nothing deeper counts, since
 * one that sets a path under the key leaves the rest of what the file set in
 * place.
 */
const recordedOverride = (argv: readonly string[], plugin: readonly string[], key: string): boolean => {
  for (let index = 0; index < argv.length; index += 1) {
    const word = argv[index] as string;
    const typed = word === '--plugin-option' ? argv[index + 1]
      : word.startsWith('--plugin-option=') ? word.slice('--plugin-option='.length)
      : undefined;
    if (typed === undefined) continue;
    const split = splitPluginOption(typed, plugin);
    if (split !== undefined && split.path.length === 1 && split.path[0] === key) return true;
  }
  return false;
};

export const declarePlugin = (registry: Registry<object>, served?: ServedFacts): Command[] => {
  const list = registry.action({
    id: 'plugin.list',
    summary: 'What the configuration names, and what a run would load',
    description: 'Resolves every spec, reads its manifest, and imports it to read its id, without applying any of it.',
    surfaces: { cli: { pattern: ['plugin', 'list'] }, http: { method: 'GET', path: '/plugin/list' } },
    // No key: this is the listing, and each row carries the `spec` the other
    // verbs here take a name from.
    effect: 'read',
    resource: { kind: 'plugin' },
    scopes: ['plugin:list'],
    // Served, the list is the daemon's own, so no field could name another.
    ...(served === undefined ? { input: flagFields } : {}),
    run: async (context) => {
      const options = served === undefined
        ? await namedOptionsFrom(context.input as Readonly<Record<string, unknown>>)
        : served.options;
      if (options.plugins.length === 0) return output([], 'plugins: none named\n');
      // Served, a row is read by anyone holding `config:read`, so every option
      // the plugin's schema marks `writeOnly` or `secret` is answered as `<set>`
      // and every string that may quote a spec URL has that URL's userinfo
      // replaced; the terminal's listing is the owner reading their own
      // configuration.
      // A daemon named its plugins as it loaded them; the terminal names them here.
      if (served === undefined) await pluginIdsOf(options.plugins, { configDir: configDir(), cwd: process.cwd() });
      const keys = keyed(options.plugins);
      const schemas = served === undefined ? undefined : await schemasFor(options.plugins);
      const rows = [];
      for (const { key, spec } of keys) {
        // The catalogs translate the plugins channel's rows; the listing prints the row as written.
        const { i18n: _catalogs, ...row } = await describePlugin(spec, { configDir: configDir(), cwd: process.cwd() });
        rows.push(served === undefined ? row : {
          ...row,
          spec: withoutSpecSecrets(row.spec, schemas?.get(key)),
          // `name` is the spec read as a name, so a spec that is a URL carries
          // that URL's userinfo here exactly as it does in `spec`.
          name: withoutUserinfoIn(row.name),
          ...(row.module === undefined ? {} : { module: withoutUserinfoIn(row.module) }),
          ...(row.url === undefined ? {} : { url: withoutUserinfoIn(row.url) }),
          ...(row.path === undefined ? {} : { path: withoutUserinfoIn(row.path) }),
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

  /**
   * Ask the daemon that is up to load what the file now names, and answer
   * whether it must restart for the change to take.
   *
   * Served, the daemon answering is the one whose set changes: its own `apply`
   * answers, and its answer is the truth about the plugin that was changed.
   *
   * At the terminal the command has already written the file, and only a daemon
   * on this machine reading that same file has anything to load, so the request
   * goes to the recorded daemon's API. Nothing when no daemon is recorded or the
   * one recorded did not answer: the caller then says what a restart does.
   *
   * `reload` names the plugins to import again, and goes to the reload endpoint
   * instead: the file did not change, so a load that read it would find nothing
   * to do.
   */
  const askToApply = async (reload?: string[]): Promise<boolean | undefined> => {
    if (served !== undefined) return (await served.apply?.(reload))?.restart;
    const held = running();
    if (held?.api === undefined) return undefined;
    const token = tokenIn(held.connectUrl);
    const at = reload === undefined ? 'apply' : 'reload';
    let answer: Response;
    try {
      answer = await fetch(`${reachable(held.api)}${API_PREFIX}/plugin/${at}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
        },
        body: reload === undefined ? '{}' : JSON.stringify({ name: reload }),
        signal: AbortSignal.timeout(APPLY_WAIT_MS),
      });
    }
    catch {
      // Nothing listening, or nothing answering in time: the file holds the
      // change and nothing has loaded it, which is what the restart line says.
      return true;
    }
    const body: unknown = await answer.json().catch(() => undefined);
    const said = body as { restart?: unknown } | undefined;
    // A refusal is the daemon's, and the file is already written: either way
    // nothing has loaded the change.
    if (!answer.ok) return true;
    return said?.restart === true;
  };

  /**
   * Whether a change just written needs a restart, and say so when it does.
   *
   * The daemon's own answer when it gave one; a restart when one is recorded and
   * did not answer; and none when no daemon runs, because the next start loads
   * what the file says. A command given another `--config-file` does not ask:
   * the running daemon reads its own file.
   */
  const saidSo = async (say: (line: string) => void, named?: string): Promise<boolean> => {
    const answered = named === undefined ? await askToApply() : undefined;
    const restart = answered ?? (served !== undefined || running() !== undefined);
    if (restart) say(RESTART);
    return restart;
  };

  /**
   * Whether importing the named plugins again needs a restart, and say so when
   * it does.
   *
   * The same answer `saidSo` gives for a change to the file, asked the other
   * way: the file is as it was, and the code it names moved.
   */
  const saidToReload = async (say: (line: string) => void, names: string[]): Promise<boolean> => {
    const answered = await askToApply(names);
    const restart = answered ?? (served !== undefined || running() !== undefined);
    if (restart) say(RESTART);
    return restart;
  };

  const write = (sub: 'install' | 'remove') => registry.action({
    id: `plugin.${sub}`,
    summary: sub === 'install'
      ? 'Install a backend or another plugin into the configuration directory'
      : 'Take a plugin out of the configuration, and uninstall it unless --keep',
    surfaces: { cli: { pattern: ['plugin', sub, ':name...'] }, http: { method: 'POST', path: `/plugin/${sub}` } },
    // An install adds an entry this names; a remove takes the named ones out.
    effect: sub === 'install' ? 'add' : 'remove',
    resource: { kind: 'plugin', ...(sub === 'install' ? {} : { key: 'name' }) },
    input: {
      ...(served === undefined ? pluginWriteFields : servedPluginWriteFields),
      name: {
        type: 'array',
        items: { type: 'string' },
        description: sub === 'install'
          ? 'A package name, a path, a tarball URL, github:owner/repo or a git+ssh: spec. One or more.'
          : 'A package name. One or more.',
      },
    },
    // Installing or removing a plugin runs code with the daemon's permissions,
    // so it is an operation of its own: `plugin:write` does not hold it, and
    // only a grant naming `plugin:install`, `plugin:*` or `*:*` does.
    scopes: ['plugin:install'],
    run: (context) => oneAtATime(async () => {
      const names = context.list<string>('name');
      // Served, the file edited is the daemon's, whatever the request names.
      const namedFile = served === undefined ? context.optional<string>('configFile') : undefined;
      const configFile = served === undefined ? namedFile : served.configFile;
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
       * The daemon that is up loads the change before this answers, unless it
       * is one that cannot: a plugin with a port or a URI scheme, or a daemon
       * that did not answer at all.
       */
      const restart = await saidSo(say, namedFile);
      return output({ plugins: names, ...(restart ? { restart: true } : {}) }, '');
    }),
  });

  const update = registry.action({
    id: 'plugin.update',
    summary: 'Move the plugins named, or every installed one with all, to the version that fits this daemon',
    description: 'Every registry package in the configuration directory to the newest of its own versions whose @ahpd/sdk range admits this daemon, in one npm call, or one call per package with --force; a package with no such version stops the update before npm runs, or with --force is named and left as it is; a package from a path, link, git or URL is left as installed.',
    surfaces: { cli: { pattern: ['plugin', 'update', ':name...'] }, http: { method: 'POST', path: '/plugin/update' } },
    // What moves is the installed package the name points at, not a row.
    effect: 'change',
    resource: { kind: 'plugin', key: 'name' },
    input: {
      name: { type: 'array', items: { type: 'string' }, description: 'all, or a package name. One or more.' },
      force: { type: 'boolean', description: 'Install each package on its own, so one npm cannot install does not stop the others.' },
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
          configDir: configDir(), version: version(), run: runProgram, fetch, say, force: context.flag('force'),
        });
      }
      catch (error) {
        stop(failure(error));
      }
      /*
       * An update moves a package's code, not the entry that points at it, so
       * each package that moved is imported again. The file is as it was, and
       * reading it would find nothing to do.
       */
      const restart = moved.length > 0 ? await saidToReload(say, moved.map((one) => one.name)) : false;
      return output({ plugins: moved, ...(restart ? { restart: true } : {}) }, '');
    }),
  });

  /*
   * `plugin apply`: load what the configuration file now names.
   *
   * Served, this is the daemon that loads, and it is what every other command
   * here asks after it writes. At the terminal the same request goes to the
   * recorded daemon, which is how a file edited by hand is loaded without a
   * restart.
   */
  const apply = registry.action({
    id: 'plugin.apply',
    summary: 'Load what the plugin configuration now names',
    description: 'Loads, unloads or reconfigures the plugins to match the file. Answers `restart: true` only when a plugin with a port or a URI scheme is in the way. With no daemon running there is nothing to load: the next start reads the file.',
    surfaces: { cli: { pattern: ['plugin', 'apply'] }, http: { method: 'POST', path: '/plugin/apply' } },
    // The plugins the file names are loaded or unloaded; the file is not written.
    effect: 'change',
    resource: { kind: 'plugin' },
    scopes: ['config:write'],
    run: (context) => oneAtATime(async () => {
      const payload = context.globals['json'] === true || context.globals['quiet'] === true;
      const say = (line: string): void => {
        if (payload) context.error(line);
        else context.write(`${line}\n`);
      };
      const restart = await askToApply();
      if (restart === undefined) {
        // Served, the daemon is this one and it has no set yet; at the terminal
        // there is no daemon reading the file this command was given.
        if (served !== undefined) {
          say(RESTART);
          return output({ restart: true }, '');
        }
        stop('No daemon is answering to load the change; ahpd start loads what the file names.');
      }
      if (restart) say(RESTART);
      else say('Loaded what the file names.');
      return output({ restart }, '');
    }),
  });

  /*
   * `plugin reload`: import a plugin again, because the code it points at moved.
   *
   * The file is not touched, and reading it would find nothing to do: the entry
   * and its options are as they were. This names the plugin whose module
   * changed, so the daemon runs the code that is on disk now.
   */
  const reload = registry.action({
    id: 'plugin.reload',
    summary: 'Import a plugin again, because the code it points at changed',
    description: 'Runs the plugin\'s closers, then loads it from its module as it is now. Nothing in the configuration changed, so the file is not read for a difference. A plugin with a port or a URI scheme answers `restart: true`, because the host cannot take a new one while it runs.',
    surfaces: { cli: { pattern: ['plugin', 'reload', ':name...'] }, http: { method: 'POST', path: '/plugin/reload' } },
    // One module is read again; what the file names does not move.
    effect: 'change',
    resource: { kind: 'plugin', key: 'name' },
    input: { name: { type: 'array', items: { type: 'string' }, description: 'The plugin, by its id or as plugins names it. One or more.' } },
    scopes: ['plugin:reload'],
    run: (context) => oneAtATime(async () => {
      const names = context.list<string>('name');
      const payload = context.globals['json'] === true || context.globals['quiet'] === true;
      const say = (line: string): void => {
        if (payload) context.error(line);
        else context.write(`${line}\n`);
      };
      const restart = await askToApply(names);
      if (restart === undefined) {
        if (served !== undefined) {
          say(RESTART);
          return output({ plugins: names, restart: true }, '');
        }
        stop('No daemon is answering to import the plugin again; ahpd start loads the code as it is now.');
      }
      if (restart) say(RESTART);
      else say('Imported the plugin again.');
      return output({ plugins: names, ...(restart ? { restart: true } : {}) }, '');
    }),
  });

  /** The file a command edits: the daemon's own when served, whatever the request names. */
  const fileOf = (named: string | undefined): string => (served === undefined ? named : served.configFile) ?? configPath();

  /*
   * `plugin config` shows a plugin's options, `plugin config set` writes one
   * and `plugin config unset` takes one away. Three declarations rather than
   * one carrying a flag, because what a command does is read off its
   * declaration: a read and a removal cannot be the same action, and a pattern
   * holds no slot after an optional one. All three run the body below, which
   * reads whichever fields its declaration has.
   */
  const configFields = {
    ...(served === undefined ? { configFile: serverFields.configFile } : {}),
    name: { type: 'string', description: 'The plugin, by its id or as plugins names it.' },
  } as const;
  const keyField = { type: 'string', description: 'One option.' } as const;
  const configure = (doing: 'show' | 'set' | 'unset') => (context: CommandContext): Promise<Output> => oneAtATime(async () => {
    const name = context.optional<string>('name');
    if (name === undefined) stop('Say which plugin: ahpd plugin config <name>.');
    const key = context.optional<string>('key');
    const typed = doing === 'set' ? context.value<string>('value') : undefined;
    const namedFile = served === undefined ? context.optional<string>('configFile') : undefined;
    const file = fileOf(namedFile);
    const payload = context.globals['json'] === true || context.globals['quiet'] === true;
    const say = (line: string): void => {
      if (payload) context.error(line);
      else context.write(`${line}\n`);
    };
    if (served === undefined) await pluginIdsOf(specsIn(file), { configDir: configDir(), cwd: process.cwd() });
    const entry = pluginEntry(file, name);
    if (entry === undefined) stop(`${name} is not in plugins in ${file}.`);
    const id = pluginIdOf(entry);

    /*
     * The plugin's schema, from the module a load would import. Needed to
     * check a value, and served to know which values are write-only; a module
     * that cannot be imported is `undefined` with the reason beside it. A
     * plugin switched off is not checked, since it is not loaded.
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

    if (doing === 'show') {
      const rows = Object.entries(options).map(([option, value]) => [option, shown(option, value)] as const);
      const text = rows.length === 0
        ? `${name}\n  (no options set)\n`
        : `${name}\n${rows.map(([option, value]) => `  ${option}: ${JSON.stringify(value)}`).join('\n')}\n`;
      return output({ name, options: Object.fromEntries(rows) }, text);
    }

    const option = key as string;
    if (doing === 'unset') {
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
          if (ref === undefined) check(value, known[option] as JsonSchema, `plugins.${id}.options.${option}`);
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
    /*
     * The record of the daemon that is up, read once: the line a restart would
     * start again. A daemon that recorded no line, such as one an older ahpd
     * started or one run in the foreground, has no flag to override anything
     * with.
     */
    const record = running();
    const override = record?.argv !== undefined && recordedOverride(record.argv, [sourceOf(entry), id], option);
    if (override) say(overridden(name, option));
    const restart = await saidSo(say, namedFile);
    return output({
      name,
      key: option,
      ...(doing === 'unset' ? {} : { value: shown(option, typedValue(typed as string)) }),
      ...(restart ? { restart: true } : {}),
      ...(override ? { overriddenBy: `--plugin-option ${name}.${option}`, words: overridden(name, option) } : {}),
    }, '');
  });
  const config = registry.action({
    id: 'plugin.config',
    summary: "Show a plugin's options",
    description: 'Every option the configuration sets for it, with a value the plugin\'s schema marks write-only answered as set. One option is written by `plugin config <name> <key> <value>` and taken away by `plugin config unset`.',
    surfaces: { cli: { pattern: ['plugin', 'config', ':name'] }, http: { method: 'POST', path: '/plugin/config' } },
    // The entry's own options, read by the name that keys it.
    effect: 'read',
    resource: { kind: 'plugin', key: 'name' },
    input: configFields,
    required: ['name'],
    scopes: ['plugin:options'],
    run: configure('show'),
  });
  const set = registry.action({
    id: 'plugin.config.set',
    summary: 'Set one of a plugin\'s options',
    description: 'The value is read as JSON when it parses and as text otherwise, and checked against the plugin\'s options schema when the plugin can be imported.',
    surfaces: {
      cli: { pattern: ['plugin', 'config', ':name', ':key', ':value'] },
      http: { method: 'POST', path: '/plugin/config/set' },
    },
    // One option of the entry the name keys is written; the entry stays.
    effect: 'change',
    resource: { kind: 'plugin', key: 'name' },
    input: {
      ...configFields,
      key: keyField,
      value: { type: 'string', description: 'The value: JSON when it parses, otherwise text.' },
    },
    required: ['name', 'key', 'value'],
    scopes: ['plugin:options'],
    run: configure('set'),
  });
  const unset = registry.action({
    id: 'plugin.config.unset',
    summary: 'Remove one of a plugin\'s options',
    description: 'The option is taken out of the entry, so `plugin config <name>` no longer shows it. A running daemon applies it at once, unless the plugin holds a port or a URI scheme.',
    surfaces: {
      cli: { pattern: ['plugin', 'config', 'unset', ':name', ':key'] },
      http: { method: 'POST', path: '/plugin/config/unset' },
    },
    // One option of the entry the name keys is taken out; the entry stays, and
    // the removal is of a key inside it rather than of the plugin.
    effect: 'change',
    resource: { kind: 'plugin', key: 'name' },
    input: {
      ...configFields,
      key: keyField,
    },
    required: ['name', 'key'],
    scopes: ['plugin:options'],
    run: configure('unset'),
  });

  const toggle = (sub: 'enable' | 'disable') => registry.action({
    id: `plugin.${sub}`,
    summary: sub === 'enable' ? 'Turn a configured plugin on' : 'Turn a configured plugin off, keeping its entry and options',
    surfaces: { cli: { pattern: ['plugin', sub, ':name'] }, http: { method: 'POST', path: `/plugin/${sub}` } },
    // The entry the name keys is turned on or off; nothing is added or taken out.
    effect: 'change',
    resource: { kind: 'plugin', key: 'name' },
    input: {
      ...(served === undefined ? { configFile: serverFields.configFile } : {}),
      name: { type: 'string', description: 'The plugin, by its id or as plugins names it.' },
    },
    scopes: [`plugin:${sub}`],
    run: (context) => oneAtATime(async () => {
      const name = context.optional<string>('name');
      if (name === undefined) stop(`Say which plugin: ahpd plugin ${sub} <name>.`);
      const namedFile = served === undefined ? context.optional<string>('configFile') : undefined;
      const file = fileOf(namedFile);
      if (served === undefined) await pluginIdsOf(specsIn(file), { configDir: configDir(), cwd: process.cwd() });
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
      const restart = await saidSo(say, namedFile);
      return output({ name, enabled: sub === 'enable', ...(restart ? { restart: true } : {}) }, '');
    }),
  });

  return [list, write('install'), write('remove'), update, apply, reload, config, set, unset, toggle('enable'), toggle('disable')];
};
