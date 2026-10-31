/**
 * `x-ahpd-plugins`: the plugins the configuration names, and the commands that
 * change them.
 *
 * A row is one configured plugin, described without running it - `describePlugin`
 * resolves the spec, reads the manifest and imports nothing - with the manifest
 * the daemon loaded when it started. The row's id is the plugin's id, which is
 * what each command here takes and what root config keys the entry by.
 *
 * A change writes the same file the command line writes, through the same writer
 * and the same one-at-a-time turn, so a person at a terminal and a client are
 * never two writers reading the file and then writing it back. A change that
 * writes also applies: the daemon loads, unloads or reapplies what the file now
 * says, and only a plugin with a port or a URI scheme answers `restart`.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { check } from '@cofold/commands';
import type { JsonSchema } from '@cofold/commands';
import { formIn, HOST_CATALOGS, isRecordSlug, RECORD_SLUG, recordsChannel, RpcError, scopeOf, secretRef, translated } from '@ahpd/sdk';
import type { Alert, Bag, Catalogs, Grant, Loaded, PluginMethod, PluginSpec, PluginView, RecordsChannel, RecordsSource } from '@ahpd/sdk';
import type { Applied } from './applyplugins.js';
import { maskOption, SET, withoutSpecSecrets, withoutUserinfoIn } from './commands/config.js';
import {
  enableNames, installPlugins, oneAtATime, packageOf, pluginRoot, removePlugins, run as runProgram, setPluginEnabled, setPluginOption, specsIn,
  updatePlugins,
} from './install.js';
import type { Moved, Runner } from './install.js';
import { describePlugin, sourceOf, optionsSchemaLoaded, optionsSchemaOf, pluginIdOf, schemaOf } from './plugins.js';
import type { Fetch } from './update.js';
import { version } from './version.js';

/** The channel, and the domain its commands are named after. */
const SCHEME = 'x-ahpd-plugins';
const DOMAIN = 'x-ahpd/plugins';

/** The code a wrong param is refused with, which the protocol calls `INVALID_PARAMS`. */
const INVALID_PARAMS = -32602;

/** The message of a throw, whatever was thrown. */
const reason = (error: unknown): string => error instanceof Error ? error.message : String(error);

/** A value that is one object, or `undefined` for anything else. */
const object = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

/**
 * The values among a spec's options that its schema marks `writeOnly` or `secret`.
 *
 * A plugin's own error can quote what it was handed, and an option marked
 * either way is a credential. Each such value is collected here so a served
 * load problem can take it out: a reference is a name rather than a value, so
 * it is not one.
 */
const secretsOf = (schema: Record<string, unknown> | undefined, value: unknown, found: string[]): void => {
  if (schema === undefined || secretRef(value) !== undefined) return;
  if (Array.isArray(value)) {
    const items = object(schema['items']);
    for (const one of value) secretsOf(items, one, found);
    return;
  }
  const held = object(value);
  if (held !== undefined) {
    for (const [key, one] of Object.entries(held)) secretsOf(schemaOf(schema, key), one, found);
    return;
  }
  const marked = schema['writeOnly'] === true || schema['secret'] === true;
  if (marked && typeof value === 'string' && value !== '') found.push(value);
};

/**
 * An alert text as a client may read it.
 *
 * Masked as every other answer is: the userinfo of any URL in the sentence, and
 * each write-only option value the plugin's own error quoted.
 */
const loadProblemOf = (line: string, spec: PluginSpec, schema: Record<string, unknown> | undefined): string => {
  const found: string[] = [];
  if (typeof spec !== 'string') secretsOf(schema, spec.options, found);
  let text = line;
  for (const secret of found) text = text.split(secret).join(SET);
  return withoutUserinfoIn(text);
};

/**
 * The views of one row, in a reader's locale.
 *
 * Only the words a person reads are translated: a Text's `text` and a Link's
 * `label`. Each is read at `views.<surface>.<componentId>.<prop>`, so a catalog
 * names the component it translates. The rest of a view is data, and it is
 * copied as it is.
 */
const shownIn = (
  views: unknown,
  text: (path: string[], english: string) => string,
): Record<string, unknown> => {
  const surfaces: Record<string, unknown> = object(views) ?? {};
  const out: Record<string, unknown> = {};
  for (const [surface, view] of Object.entries(surfaces)) {
    const held = object(view);
    const components = held === undefined ? undefined : object(held['components']);
    if (held === undefined || components === undefined) {
      out[surface] = view;
      continue;
    }
    const each: Record<string, unknown> = {};
    for (const [id, one] of Object.entries(components)) {
      const component = object(one);
      if (component === undefined) {
        each[id] = one;
        continue;
      }
      const drawn: Record<string, unknown> = { ...component };
      const prop = component['component'] === 'Text' ? 'text' : component['component'] === 'Link' ? 'label' : undefined;
      const english = prop === undefined ? undefined : component[prop];
      if (prop !== undefined && typeof english === 'string') drawn[prop] = text(['views', surface, id, prop], english);
      each[id] = drawn;
    }
    out[surface] = { ...held, components: each };
  }
  return out;
};

/** What the channel and its commands are built from. */
export interface PluginsChannelOptions {
  /** The configuration file whose `plugins` are listed and edited. */
  configFile: string;
  /** What a spec is resolved against, as `describePlugin` takes it. */
  where: { configDir: string; cwd: string };
  /**
   * The plugins the daemon loaded, once it has.
   *
   * The channel is built before `loadPlugins` runs, because the host is built
   * over the channels and the fold is built over the host, so what loaded is
   * read through this on each listing rather than handed in.
   */
  loaded(): Loaded[];
  /**
   * The alerts each plugin's row carries, by id, once it has.
   *
   * A plugin with no entry has nothing to show: a row that loaded cleanly says
   * nothing, and one that did not says why as an `error` alert.
   */
  alerts(): Record<string, Alert[]>;
  /**
   * The views each plugin's row carries, by id and then by surface, once it has.
   *
   * A plugin with no entry has nothing to draw. A view is read when the row is
   * built rather than handed in, because a plugin may show a new one while the
   * daemon runs.
   */
  views(): Record<string, Record<string, PluginView>>;
  /**
   * Load, unload or reconfigure what the file now says, in the daemon behind
   * this channel.
   *
   * Called after a command writes and inside the same turn, so what it applies
   * is exactly what the file now holds and no second writer can get between
   * the two. It answers whether the change needed a restart, and it sends the
   * rows, adapters and connectors it changed itself.
   *
   * Absent when a channel is built with no daemon behind it: a write then
   * refreshes the rows and answers `restart: true`, as every write did before
   * a change could apply while the daemon ran.
   *
   * A reload names the plugins to import again. Their entries did not change,
   * so the apply reads them here instead of finding them by comparing specs.
   */
  apply?(reload?: string[]): Promise<Applied>;
  /**
   * Mark that the running host is behind the file a command just wrote.
   *
   * Called after a command writes, and never when it is refused: a refusal
   * changed nothing, so there is nothing for a restart to apply.
   */
  restartNeeded(): void;
  /** Where a listing or an edit that could not be read or written is said. */
  onProblem?(message: string): void;
  /** How npm is run for `install`, `remove` and `write`; absent runs it, as the command line does. */
  run?: Runner;
  /** How the registry is asked about a registry name before npm runs; absent is the global `fetch`. */
  fetch?: Fetch;
  /** The daemon's own version, which an installed plugin's `@ahpd/sdk` is pinned to; absent is this package's. */
  version?(): string;
}

/** The plugin channel and its commands, as the daemon hands them to `servedRecords`. */
export interface PluginsChannel {
  /** `x-ahpd-plugins`. */
  channel: RecordsChannel;
  /** `x-ahpd/plugins/install`, `remove`, `write`, `source`, `enable`, `disable`, `options`, `apply`, `reload` and `update`, by name. */
  methods: Record<string, PluginMethod>;
  /** Refresh the channel. */
  refresh(): Promise<void>;
}

/**
 * The configured plugins as a channel, and the commands that change them.
 *
 * Reading needs `plugin:list`. Each command needs its own grant: `install`,
 * `remove`, `write` and `source` need `plugin:install`, which no group holds,
 * and the rest need the grant named after what they change. Every one is run
 * one at a time with the command line's writers.
 */
export const pluginsChannel = (options: PluginsChannelOptions): PluginsChannel => {
  const { configFile, where } = options;

  /** npm, as the install path runs it: the caller's, or the one this process runs. */
  const npm: Runner = options.run ?? runProgram;
  /** The registry, as the install path asks it about a name. */
  const registryFetch: Fetch = options.fetch ?? globalThis.fetch;
  /** The daemon's own version, which a registry install pins the sdk to. */
  const daemonVersion = (): string => options.version?.() ?? version();

  /**
   * Nothing the install and remove paths say reaches the channel's log.
   *
   * `installPlugins` and `removePlugins` say what they are about to do, because
   * a person waiting at a terminal has nothing else moving; a client waiting on
   * this channel has the answer. None of it is a problem, and `onProblem` is
   * the daemon's log - on a `--stdio` daemon stdout is the wire, so a line that
   * is not a frame there breaks the client reading it.
   */
  const say = (_line: string): void => {};

  /**
   * The folder a plugin written in a client keeps its files in, if one was.
   *
   * Found by the id first, because a write names its folder after it, and
   * then by the spec the file holds: a written plugin's id is the one its
   * module exports, which an admin may have written differently from the id
   * the write was given.
   */
  const writtenAt = (id: string): string | undefined => {
    const here = join(pluginRoot(where.configDir), 'plugins');
    const folderOf = (name: string): string | undefined => {
      if (!isRecordSlug(name)) return undefined;
      const folder = join(here, name);
      return existsSync(join(folder, 'index.ts')) ? folder : undefined;
    };
    const byId = folderOf(id);
    if (byId !== undefined) return byId;
    const spec = specOf(id);
    const at = spec === undefined ? undefined : sourceOf(spec);
    return at !== undefined && dirname(at) === here && existsSync(join(at, 'index.ts')) ? at : undefined;
  };

  /** The specs the file names, in its order. */
  const specs = (): PluginSpec[] => specsIn(configFile);

  /**
   * The schema a plugin's options are masked and checked by.
   *
   * The copy the daemon loaded comes first, because it is the plugin that is
   * running; otherwise the manifest is read with no import, so a plugin that
   * did not load - or is switched off - still has a form a client draws and
   * values the daemon can refuse. A spec that does not resolve, or a manifest
   * that declares no schema, answers `undefined`, which marks every value.
   */
  const schemaFor = async (spec: PluginSpec, id: string): Promise<Record<string, unknown> | undefined> => {
    const held = optionsSchemaLoaded(id);
    if (held !== undefined) return held;
    try {
      return await optionsSchemaOf(spec, where);
    }
    catch {
      return undefined;
    }
  };

  /**
   * Each row's catalogs, by the row's id, kept beside the record and never in it.
   *
   * The record is what a diff compares, so it stays in English; a reader's
   * copy is translated on the way out.
   */
  const catalogsByName = new Map<string, Catalogs>();

  /** One configured plugin, as a client lists it. */
  const rowOf = async (spec: PluginSpec): Promise<{ id: string; record: Record<string, unknown> }> => {
    // The id read before the row, because the schema the options are masked
    // with is the one the daemon holds under that id.
    const id = pluginIdOf(spec, where);
    const schema = await schemaFor(spec, id);
    const row = await describePlugin(spec, where);
    const loaded = options.loaded().find((one) => one.name === row.name);
    // The copy the daemon loaded is what is running; a plugin that did not load,
    // or is switched off, is described from the manifest read without importing.
    const manifest = loaded?.manifest ?? row.manifest;
    // What this plugin's row carries, masked as every other answer is.
    const alerts = options.alerts()[row.name] ?? [];
    // Only a plugin the daemon runs can show a view, so one that did not load
    // has none to draw even if its id still held one while it went.
    const views = loaded === undefined ? undefined : options.views()[row.name];
    const catalogs = loaded?.i18n ?? row.i18n;
    if (catalogs === undefined) catalogsByName.delete(withoutUserinfoIn(row.name));
    else catalogsByName.set(withoutUserinfoIn(row.name), catalogs);
    return {
      id: withoutUserinfoIn(row.name),
      record: {
        // Both places a spec can hold a credential: the userinfo of a URL it
        // installs from, and an option its schema marks `writeOnly` or `secret`.
        spec: withoutSpecSecrets(row.spec, schema),
        name: withoutUserinfoIn(row.name),
        state: row.state,
        ...(row.version === undefined ? {} : { version: withoutUserinfoIn(row.version) }),
        ...(row.module === undefined ? {} : { module: withoutUserinfoIn(row.module) }),
        ...(row.url === undefined ? {} : { url: withoutUserinfoIn(row.url) }),
        ...(row.path === undefined ? {} : { path: withoutUserinfoIn(row.path) }),
        ...(row.title === undefined ? {} : { title: withoutUserinfoIn(row.title) }),
        ...(row.problem === undefined ? {} : { problem: withoutUserinfoIn(row.problem) }),
        // What the running daemon did, which the state does not say: a plugin
        // may be configured and yet not be running.
        loaded: loaded !== undefined,
        alerts: alerts.map((alert) => ({
          level: alert.level,
          text: loadProblemOf(alert.text, row.spec, schema),
          ...(alert.ref === undefined ? {} : { ref: withoutUserinfoIn(alert.ref) }),
        })),
        // The view a client draws on the plugin's page, by surface. It is the
        // plugin's own object as it sent it, which the sdk checked first.
        ...(views === undefined ? {} : { views }),
        // The form a client draws, from the daemon's copy or the module it
        // would import; absent for one switched off, which is never imported.
        ...(schema === undefined ? {} : { optionsSchema: schema }),
        ...(manifest === undefined ? {} : { manifest }),
        // A plugin with no contracts is listed all the same, and said to be
        // undeclared: it is the listing's only way to tell the two apart.
        ...(loaded !== undefined && manifest?.contracts === undefined ? { undeclared: true } : {}),
      },
    };
  };

  /**
   * The id a spec is listed under, which is the one the spec is keyed by.
   *
   * A spec that does not resolve is its own id, so the userinfo of a URL it
   * names is masked here as it is in the row.
   */
  const idOf = (spec: PluginSpec): string => withoutUserinfoIn(pluginIdOf(spec, where));

  /** The entry a command names, by its id or by the spec as written. */
  const specOf = (id: string): PluginSpec | undefined => specs().find((one) => idOf(one) === id || sourceOf(one) === id);

  const source: RecordsSource = {
    ids: async () => {
      const seen = new Set<string>();
      for (const spec of specs()) {
        const id = idOf(spec);
        if (seen.has(id)) {
          // A plugin configured twice is one row: the loader refuses the second
          // entry, so listing it twice would list one row the daemon does not
          // have. The first entry is the one kept, as the loader keeps it.
          options.onProblem?.(`plugins: ${id} is configured twice; its first entry is listed`);
          continue;
        }
        seen.add(id);
      }
      return [...seen];
    },
    find: async (id) => {
      const spec = specOf(id);
      return spec === undefined ? undefined : (await rowOf(spec)).record;
    },
  };

  /**
   * One row in a reader's locale: its title, its manifest's description and
   * both copies of its options form. The plugin's own catalogs come first,
   * then the host's; the name, spec, state, version, problem and alerts are
   * left as they are.
   */
  const translate = (record: Record<string, unknown>, locale: string): Record<string, unknown> => {
    const catalogs = typeof record.name === 'string' ? catalogsByName.get(record.name) : undefined;
    const text = (path: string[], english: string): string => translated(path, english, locale, catalogs, HOST_CATALOGS);
    const form = (schema: unknown): unknown => {
      const properties = object(object(schema)?.['properties']);
      return properties === undefined ? schema : { ...object(schema), properties: formIn(properties as Bag, 'options', locale, () => [catalogs, HOST_CATALOGS]) };
    };
    const out: Record<string, unknown> = { ...record };
    if (typeof record.title === 'string') out.title = text(['meta', 'title'], record.title);
    if (record.optionsSchema !== undefined) out.optionsSchema = form(record.optionsSchema);
    if (record.views !== undefined) out.views = shownIn(record.views, text);
    const manifest = object(record.manifest);
    if (manifest !== undefined) {
      const copy: Record<string, unknown> = { ...manifest };
      if (typeof manifest.description === 'string') copy.description = text(['meta', 'description'], manifest.description);
      if (manifest.optionsSchema !== undefined) copy.optionsSchema = form(manifest.optionsSchema);
      out.manifest = copy;
    }
    return out;
  };

  const channel = recordsChannel(SCHEME, source, {
    grant: 'plugin:list' as Grant,
    translate,
    describe: () => ({ title: 'Plugins', description: 'What the configuration names, and what a run would load.' }),
    ...(options.onProblem === undefined ? {} : { onProblem: options.onProblem }),
  });

  /** The id one command was given, or the refusal that says what it needs. */
  const idParam = (command: string, params: Record<string, unknown>): string => {
    const id = params.id;
    if (typeof id !== 'string' || id === '' || /[/?]/u.test(id)) {
      throw new RpcError(INVALID_PARAMS, `${command} needs id, the plugin's id as a row answers it, with no / or ?`);
    }
    return id;
  };

  /**
   * One turn at the configuration file and the daemon that serves it.
   *
   * The write and the load are one turn, so a second command cannot write
   * between them and a plugin is never applied over a file that moved under
   * it. With no daemon behind this channel, the write refreshes the rows here
   * and answers the restart every write used to mean.
   *
   * `reload` names the plugins the apply must import again, and is passed on
   * as given; every other change finds what moved by comparing the file. It may
   * be a thunk, which is read inside this turn: whether a write replaced a
   * plugin this daemon already ran is not known until the write has looked.
   */
  const changed = async (
    work: () => Promise<Record<string, unknown>>,
    reload?: string[] | (() => string[] | undefined),
  ): Promise<Record<string, unknown>> => oneAtATime(async () => {
    const answer = await work();
    if (options.apply === undefined) {
      await channel.refresh();
      options.restartNeeded();
      return { ...answer, restart: true };
    }
    const applied = await options.apply(typeof reload === 'function' ? reload() : reload);
    if (applied.restart) options.restartNeeded();
    return { ...answer, restart: applied.restart };
  });

  const toggle = (enabled: boolean): PluginMethod => ({
    grant: `plugin:${enabled ? 'enable' : 'disable'}` as Grant,
    describe: () => ({
      title: `${enabled ? 'Enable' : 'Disable'} a plugin`,
      description: `Turns a configured plugin ${enabled ? 'on' : 'off'}, keeping its entry and its options. The daemon loads or unloads it at once, unless it holds a port or a URI scheme.`,
    }),
    handle: (params) => changed(async () => {
      const id = idParam(`${DOMAIN}/${enabled ? 'enable' : 'disable'}`, params);
      try {
        setPluginEnabled(configFile, id, enabled);
      }
      catch (error) {
        throw new RpcError(INVALID_PARAMS, reason(error));
      }
      /*
       * The daemon loads or unloads it before this answers, and `changed` fills
       * in whether that needed a restart, so a plugin with a port is the only
       * one a client is told to restart for.
       */
      return { id, enabled, restart: true };
    }),
  });

  /**
   * Install one source, through the command line's own install path.
   *
   * The grant is `plugin:install` and no group holds it: what is installed
   * runs with the daemon's permissions, so a role that may toggle a plugin may
   * not add one. The install runs in the same one-at-a-time turn as the apply
   * that follows it, so no other command writes the file between npm and the
   * load, and the answer says `restart` only when a plugin with a port or a
   * URI scheme is in the way.
   */
  const installMethod: PluginMethod = {
    grant: 'plugin:install' as Grant,
    describe: () => ({
      title: 'Install a plugin',
      description: 'Takes `source`, a package name, a path, a tarball URL, `github:<owner>/<repo>` or a `git+ssh:` spec, installs it with npm in the plugin root, names it in `plugins` and loads it. Answers `{ id }`, the id of the row it added, and `restart: true` when a plugin with a port or a URI scheme is in the way.',
    }),
    handle: (params) => {
      const name = `${DOMAIN}/install`;
      const source = params.source;
      if (typeof source !== 'string' || source.trim() === '') {
        throw new RpcError(INVALID_PARAMS, `${name} needs source, a package name, a path, a URL or a git spec`);
      }
      // What npm installed, which is the name written into `plugins`; the
      // source may be a URL or a git spec that no row carries.
      let packages: string[] = [];
      return changed(async () => {
        try {
          packages = await installPlugins([source], {
            configDir: where.configDir,
            configFile,
            version: daemonVersion(),
            enable: true,
            run: npm,
            fetch: registryFetch,
            say,
          });
        }
        catch (error) {
          throw new RpcError(INVALID_PARAMS, withoutUserinfoIn(reason(error)));
        }
        return {};
      }).then((answer) => {
        /*
         * The id is read once the apply has run: a module names itself, so the
         * id the new row is listed under is known only after the daemon has
         * imported it. A package name is what npm wrote, not what the row says.
         */
        return { ...answer, id: withoutUserinfoIn(pluginIdOf(packages[0] ?? source, where)) };
      });
    },
  };

  /**
   * Remove one configured plugin, through the command line's own remove path.
   *
   * `keep` leaves the package installed, as `--keep` does, and a plugin that
   * was written in a client leaves its folder instead. Without it the package
   * is uninstalled, or the written folder is deleted.
   */
  const removeMethod: PluginMethod = {
    grant: 'plugin:install' as Grant,
    describe: () => ({
      title: 'Remove a plugin',
      description: 'Takes `id`, the plugin as a row answers it, and an optional `keep`. Takes its entry out of `plugins` and uninstalls the package, or with `keep: true` leaves the package installed; a plugin written in a client loses its folder unless it is kept. Answers `{ id }` and whether a restart is needed.',
    }),
    handle: (params) => {
      const id = idParam(`${DOMAIN}/remove`, params);
      const keep = params.keep === true;
      return changed(async () => {
        const folder = writtenAt(id);
        try {
          await removePlugins([folder ?? id], {
            configDir: where.configDir,
            configFile,
            // A written plugin is a folder, not a package npm installed.
            uninstall: folder === undefined && !keep,
            run: npm,
            say,
          });
          if (folder !== undefined && !keep) rmSync(folder, { recursive: true, force: true });
        }
        catch (error) {
          throw new RpcError(INVALID_PARAMS, withoutUserinfoIn(reason(error)));
        }
        return { id };
      });
    },
  };

  /** The folder a plugin written in a client keeps its files in. */
  const folderIn = (id: string): string => join(pluginRoot(where.configDir), 'plugins', id);

  /**
   * Where a write builds its plugin before it replaces the folder `plugins` names.
   *
   * A dot name, so a listing that reads the directory does not take it for a
   * plugin, and beside the folder it replaces, so both are on one filesystem
   * and moving one over the other is a rename.
   */
  const stagedIn = (id: string): string => join(pluginRoot(where.configDir), 'plugins', `.${id}.new`);

  /**
   * The `package.json` a write is given, as the object written beside `index.ts`.
   *
   * A client may send the text or the object. The document is written as the
   * admin wrote it, with two additions: a `name` when it has none, so npm and
   * the listing have one, and an `ahpd.entry` when nothing in it names an
   * entry, because the folder holds `index.ts` and the loader reads
   * `ahpd.entry`, `exports["."]` and `main`.
   */
  const packageWritten = (id: string, value: unknown): Record<string, unknown> => {
    const name = `${DOMAIN}/write`;
    let parsed = value;
    if (typeof value === 'string') {
      try {
        parsed = JSON.parse(value) as unknown;
      }
      catch {
        throw new RpcError(INVALID_PARAMS, `${name} needs packageJson as a JSON object; what it was given is not JSON`);
      }
    }
    const held = object(parsed);
    if (held === undefined) throw new RpcError(INVALID_PARAMS, `${name} needs packageJson as a JSON object`);
    const ahpd = object(held['ahpd']);
    const exported = held['exports'];
    const dot = object(exported)?.['.'];
    const namesEntry = (ahpd !== undefined && typeof ahpd['entry'] === 'string')
      || typeof exported === 'string'
      || typeof dot === 'string'
      || (object(dot) !== undefined && typeof (object(dot) as Record<string, unknown>)['default'] === 'string')
      || typeof held['main'] === 'string';
    const named = { ...held, ...(typeof held['name'] === 'string' ? {} : { name: id }) };
    return namesEntry ? named : { ...named, ahpd: { ...(ahpd ?? {}), entry: './index.ts' } };
  };

  /**
   * Write a plugin in the client, as one TypeScript file and its package.json.
   *
   * The folder is `<plugin root>/plugins/<id>/`, outside `node_modules`, because
   * Node refuses to strip the types of a file under one. The file is as the
   * admin wrote it and the `package.json` is theirs to edit; npm then installs
   * what it names, in the folder, so a plugin may import a package that is not
   * part of ahpd. The folder path is what `plugins` names, and it is added when
   * the file does not already hold it.
   *
   * The files are written into `<plugin root>/plugins/.<id>.new/` and npm runs
   * there, so a rewrite whose npm fails leaves the folder the daemon is running
   * untouched: the old `index.ts` and `package.json` are never replaced before
   * npm has succeeded. On success the old folder is moved aside, the staged one
   * is moved into place, and the old one is deleted; on failure only the staged
   * folder is deleted. A write over an id that is already written imports the
   * folder again, so the new text runs at once, and whether it was already
   * written is read inside the turn rather than before it.
   */
  const writeMethod: PluginMethod = {
    grant: 'plugin:install' as Grant,
    describe: () => ({
      title: 'Write a plugin',
      description: 'Takes `id`, a slug; `source`, the TypeScript file\'s text; and `packageJson`, the package as an object or as its text. Writes both into `<plugin root>/plugins/.<id>.new/`, runs `npm install` there, and only when npm succeeds swaps the folder into `<plugin root>/plugins/<id>/`, names it in `plugins` and loads it. Writing the same id again replaces the files and imports the new code at once, or leaves the running code when npm fails. Answers `{ id }`.',
    }),
    handle: (params) => {
      const name = `${DOMAIN}/write`;
      const id = params.id;
      if (typeof id !== 'string' || !isRecordSlug(id)) {
        throw new RpcError(INVALID_PARAMS, `${name} needs id, a plugin slug: ${RECORD_SLUG}`);
      }
      const text = params.source;
      if (typeof text !== 'string' || text.trim() === '') {
        throw new RpcError(INVALID_PARAMS, `${name} needs source, the text of the plugin's TypeScript file`);
      }
      const held = packageWritten(id, params.packageJson);
      const folder = folderIn(id);
      const staged = stagedIn(id);
      // Whether the file already names the folder: a write over a plugin this
      // daemon runs, which is imported again rather than loaded as a new one.
      let again = false;
      return changed(async () => {
        again = specsIn(configFile).some((spec) => sourceOf(spec) === folder);
        rmSync(staged, { recursive: true, force: true });
        mkdirSync(staged, { recursive: true });
        writeFileSync(join(staged, 'index.ts'), text);
        writeFileSync(join(staged, 'package.json'), `${JSON.stringify(held, null, 2)}\n`);
        const done = await npm('npm', ['install', '--prefix', staged]);
        if (done.code !== 0) {
          // Only what this write made is taken out: the folder the daemon runs,
          // and the files in it, are as they were before the write arrived.
          rmSync(staged, { recursive: true, force: true });
          const said = done.stderr.trim();
          throw new RpcError(INVALID_PARAMS, withoutUserinfoIn(
            `npm could not install ${id} in ${folder}: ${said === '' ? `it ended with code ${String(done.code)}` : said}`,
          ));
        }
        /*
         * The staged folder replaces the old one in two renames, so the folder
         * `plugins` names is always a whole plugin. The old one is moved aside
         * rather than deleted first, and put back if the move fails.
         */
        const old = join(dirname(folder), `.${id}.old`);
        rmSync(old, { recursive: true, force: true });
        const had = existsSync(folder);
        if (had) renameSync(folder, old);
        try {
          renameSync(staged, folder);
        }
        catch (error) {
          if (had) renameSync(old, folder);
          throw error;
        }
        rmSync(old, { recursive: true, force: true });
        enableNames(configFile, [folder]);
        return { id };
      }, () => (again ? [folder] : undefined));
    },
  };

  /**
   * The text of a plugin written in a client: its `index.ts` and its `package.json`.
   *
   * Only a plugin with a folder the write made answers this. Any other plugin
   * is a package or a path someone put there, and its text is not the daemon's
   * to hand out. Reading needs `plugin:install`, the grant that writes one.
   */
  const sourceMethod: PluginMethod = {
    grant: 'plugin:install' as Grant,
    describe: () => ({
      title: 'Read a plugin written in a client',
      description: 'Takes `id`, the plugin as a row answers it, and answers the text of its `index.ts` and its `package.json`. Refuses a plugin that was not written with `x-ahpd/plugins/write`.',
    }),
    handle: (params) => {
      const id = idParam(`${DOMAIN}/source`, params);
      const folder = writtenAt(id);
      if (folder === undefined) {
        throw new RpcError(INVALID_PARAMS, `${id} was not written in a client; ${DOMAIN}/source reads a plugin written with ${DOMAIN}/write`);
      }
      return {
        id,
        source: readFileSync(join(folder, 'index.ts'), 'utf8'),
        packageJson: readFileSync(join(folder, 'package.json'), 'utf8'),
      };
    },
  };

  const optionsMethod: PluginMethod = {
    grant: 'plugin:options' as Grant,
    describe: () => ({
      title: "Write one of a plugin's options",
      description: 'Takes `id`, `key` and a `value` checked against the plugin\'s own schema, and writes it as `ahpd plugin config set` does. The daemon applies it at once, unless the plugin holds a port or a URI scheme. A `value` left out takes the option out, as `unset` does.',
    }),
    handle: (params) => changed(async () => {
      const name = `${DOMAIN}/options`;
      const id = idParam(name, params);
      const key = params.key;
      if (typeof key !== 'string' || key === '') {
        throw new RpcError(INVALID_PARAMS, `${name} needs key, the name of one of the plugin's options`);
      }
      const spec = specOf(id);
      if (spec === undefined) throw new RpcError(INVALID_PARAMS, `${id} is not in plugins in ${configFile}.`);
      const value = params.value;

      if (value !== undefined) {
        /*
         * The same check `plugin config set` runs: a value the plugin's schema
         * refuses is not written, and a reference is held to the name rule
         * rather than to the option's schema, since what it resolves to is the
         * plugin's business. The schema is the manifest's, which is read with no
         * import, so a plugin switched off and one whose module does not import
         * are checked all the same; a plugin whose manifest declares no schema
         * has nothing to check it against.
         */
        const schema = await schemaFor(spec, id);
        const properties = schema?.['properties'];
        const known = typeof properties === 'object' && properties !== null && !Array.isArray(properties)
          ? properties as Record<string, unknown>
          : undefined;
        if (known !== undefined && Object.hasOwn(known, key)) {
          try {
            const ref = secretRef(value);
            if (ref === undefined) check(value, known[key] as JsonSchema, `plugins.${id}.options.${key}`);
            else scopeOf(ref);
          }
          catch (error) {
            throw new RpcError(INVALID_PARAMS, reason(error));
          }
        }
      }

      let written: boolean;
      try {
        written = setPluginOption(configFile, id, key, value);
      }
      catch (error) {
        throw new RpcError(INVALID_PARAMS, reason(error));
      }
      // Nothing written is nothing for the daemon to apply; `changed` sends the
      // rows either way and answers what the apply said.
      /*
       * `<set>` for a value the schema marks, as every answer about an option
       * says: a write is not the place a secret is handed back.
       */
      const masked = written && value !== undefined ? maskOption(await schemaFor(spec, id), key, value) : undefined;
      return {
        id,
        key,
        ...(value === undefined || !written ? {} : { value: masked }),
        restart: true,
      };
    }),
  };

  /**
   * Load what the file now names, without writing anything to it.
   *
   * This is the method the command line asks for after it writes the file
   * itself - `plugin install`, `remove` and `update` run npm or a filesystem
   * change and write the entry, then ask the daemon that serves this channel to
   * load what it wrote. A client that edits the file over root config or over
   * `enable` and `disable` does not need it: those apply as they write.
   */
  const applyMethod: PluginMethod = {
    grant: 'plugin:apply' as Grant,
    describe: () => ({
      title: 'Load what the configuration file now names',
      description: 'Loads, unloads or reconfigures the plugins to match the file, and answers `restart: true` only when a plugin with a port or a URI scheme is in the way.',
    }),
    handle: () => changed(async () => ({})),
  };

  /**
   * Import a plugin again, because the code it points at moved.
   *
   * Nothing in the file says so: the entry and its options are as they were,
   * and only the module behind them changed. The apply does the unload and the
   * load; this method is the way to say which plugin, since comparing specs
   * would find nothing to do. A plugin with a port or a URI scheme cannot be
   * swapped, and answers `restart: true` as the other changes do.
   */
  const reloadMethod: PluginMethod = {
    grant: 'plugin:reload' as Grant,
    describe: () => ({
      title: 'Import a plugin again',
      description: 'Takes `id`, the plugin whose code changed, and loads it from its module as it is now. Its closers run first, so what it opened is closed before the new code applies. A plugin with a port or a URI scheme answers `restart: true`.',
    }),
    handle: (params) => {
      const name = `${DOMAIN}/reload`;
      const id = idParam(name, params);
      return changed(async () => ({ id }), [id]);
    },
  };

  /**
   * Move one installed plugin to the version that fits this daemon, as
   * `ahpd plugin update <name>` does, and load it again.
   *
   * The way a client fixes a plugin an update of the daemon left behind. The
   * grant is `plugin:install`, because the new version is code the daemon runs.
   * A plugin the configuration names by its path is refused, because npm did
   * not install it; one npm installed from git or a URL is left as installed.
   */
  const updateMethod: PluginMethod = {
    grant: 'plugin:install' as Grant,
    describe: () => ({
      title: 'Update a plugin',
      description: 'Takes `id`, the plugin as a row answers it, moves its package to the newest version whose `@ahpd/sdk` range admits this daemon, and loads it again. Answers `{ id, from, to }`, or `{ id }` when nothing moved, and `restart: true` when the plugin holds a port or a URI scheme.',
    }),
    handle: (params) => {
      const name = `${DOMAIN}/update`;
      const id = idParam(name, params);
      const spec = specOf(id);
      if (spec === undefined) throw new RpcError(INVALID_PARAMS, `${name}: no plugin ${id} is configured`);
      const packageName = packageOf(sourceOf(spec));
      let moved: Moved | undefined;
      return changed(async () => {
        try {
          const all = await updatePlugins([packageName], {
            configDir: where.configDir,
            version: daemonVersion(),
            run: npm,
            fetch: registryFetch,
            say,
          });
          moved = all.find((one) => one.name === packageName);
        }
        catch (error) {
          throw new RpcError(INVALID_PARAMS, withoutUserinfoIn(reason(error)));
        }
        return moved === undefined ? { id } : { id, ...(moved.from === undefined ? {} : { from: moved.from }), ...(moved.to === undefined ? {} : { to: moved.to }) };
      }, () => (moved === undefined ? undefined : [id]));
    },
  };

  return {
    channel,
    methods: {
      [`${DOMAIN}/install`]: installMethod,
      [`${DOMAIN}/remove`]: removeMethod,
      [`${DOMAIN}/write`]: writeMethod,
      [`${DOMAIN}/source`]: sourceMethod,
      [`${DOMAIN}/enable`]: toggle(true),
      [`${DOMAIN}/disable`]: toggle(false),
      [`${DOMAIN}/options`]: optionsMethod,
      [`${DOMAIN}/apply`]: applyMethod,
      [`${DOMAIN}/reload`]: reloadMethod,
      [`${DOMAIN}/update`]: updateMethod,
    },
    refresh: channel.refresh,
  };
};
