/**
 * Installing a plugin, which is one npm call and one edit of `config.json`.
 *
 * A plugin is an installed package: a bare name is resolved from the
 * configuration directory's own `node_modules`, so installing one is `npm
 * install` *there* and enabling it is naming it in `plugins`. This file is the
 * whole of that, kept apart from `main.ts` so the argument list, the pinning
 * and the edit can be tested without a terminal, a registry or a daemon.
 *
 * The configuration file is read and written as the object it is rather than
 * through `loadConfig`, because this is the first thing in this daemon that
 * writes a file a person edits: every other key, the order they were in and
 * the entries this command did not touch have to survive being rewritten.
 *
 * The process boundary is `Runner` and the registry's is `Fetch`, so a test
 * fakes npm and the registry. Nothing here reaches for the clock or the
 * environment: a caller passes the directory, the file and the version to pin
 * to.
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import type { PluginSpec } from '@ahpd/sdk';
import { asSpec } from './config.js';
import { hasScheme, nameOf } from './plugins.js';
import { askRegistry } from './update.js';
import type { Fetch } from './update.js';

/** What one run of a program left behind. */
export interface Ran {
  /** Its exit status, or `-1` when it could not be started. */
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * How one program is run.
 *
 * Standard input is this process's, so a prompt is the person's to answer.
 * Standard output is this process's standard error, so the command's own stdout
 * stays its payload: `plugin install --json` writes nothing there but its JSON.
 * Standard error is written through as it arrives and kept in full for the
 * caller's reason, because that is where npm explains a failure and a reason
 * read only at the end is one nobody saw while it was happening. The promise
 * settles when the program is gone, so a caller answers whoever it serves
 * meanwhile. Replaced in tests, which is the only reason this is a value at all.
 */
export type Runner = (program: string, argv: readonly string[]) => Promise<Ran>;

/** The default runner: the program on PATH, its standard error passed through as it comes. */
export const run: Runner = (program, argv) => new Promise((done) => {
  const child = spawn(program, [...argv], { stdio: ['inherit', 2, 'pipe'] });
  let stderr = '';
  let settled = false;
  const finish = (answer: Ran): void => {
    if (settled) return;
    settled = true;
    done(answer);
  };
  child.stderr?.on('data', (chunk: Buffer) => {
    const text = String(chunk);
    stderr += text;
    process.stderr.write(text);
  });
  // A program that cannot be started has no words of its own, so the failure
  // to start is what the caller is told.
  child.once('error', (error: Error) => { finish({ code: -1, stdout: '', stderr: error.message }); });
  child.once('close', (code: number | null) => { finish({ code: code ?? -1, stdout: '', stderr }); });
});

/**
 * A failed npm call.
 *
 * `message` carries npm's own reason, for a caller that did not see npm run;
 * `failed` is only what failed, for a caller whose terminal the runner has
 * already written npm's error to.
 */
export class NpmFailure extends Error {
  /** What failed, without npm's reason. */
  readonly failed: string;
  constructor(failed: string, reason: string) {
    super(reason === '' ? failed : `${failed}: ${reason}`);
    this.failed = failed;
  }
}

/** The failure of one npm call, with its standard error as the reason, or its exit code when it said nothing. */
const npmFailed = (failed: string, done: Ran): NpmFailure => {
  const why = done.stderr.trim();
  return new NpmFailure(failed, why === '' ? `exit ${String(done.code)}` : why);
};

/**
 * Whether a spec is a package name npm can install.
 *
 * The same test `resolvePlugin` uses to tell a bare name from a path, plus the
 * scheme check: a path is already usable as written, and a `npm:` or `https:`
 * spec is the runtime's to resolve, so neither is something this command has
 * an install to run for.
 */
export const isPackageName = (spec: PluginSpec): boolean => {
  const name = nameOf(spec);
  return !hasScheme(name) && !isAbsolute(name) && !name.startsWith('.');
};

/**
 * One name as npm should be given it.
 *
 * A plugin of this project's own is pinned to the daemon's version, because a
 * `@ahpd/*` package published later is a different protocol and the loader's
 * peer range would refuse it after the install had already happened. Any other
 * name, and a name that already carries a version or a tag, is passed as it
 * was written.
 */
export const pinned = (name: string, daemonVersion: string): string => {
  if (!name.startsWith('@ahpd/') || daemonVersion === 'unknown') return name;
  // A second `@` is the version or tag the writer chose, and scoped names
  // start with one, so the search starts after the first character.
  return name.indexOf('@', 1) === -1 ? `${name}@${daemonVersion}` : name;
};

/**
 * A spec without the version or tag it was written with.
 *
 * What `plugins` names and what a bare name resolves as: `@ahpd/agent-acp@0.7.0`
 * is installed by npm as `@ahpd/agent-acp`, and the loader asked for the first
 * reports it missing.
 */
export const packageOf = (name: string): string => {
  const at = name.indexOf('@', 1);
  return at === -1 ? name : name.slice(0, at);
};

/** The object a configuration file holds, refusing one that is not an object. */
export const readEntry = (path: string): Record<string, unknown> => {
  if (!existsSync(path)) return {};
  let held: unknown;
  try {
    held = JSON.parse(readFileSync(path, 'utf8'));
  }
  catch (error) {
    throw new Error(`${path} could not be read: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (typeof held !== 'object' || held === null || Array.isArray(held)) {
    throw new Error(`${path} is not a JSON object.`);
  }
  return held as Record<string, unknown>;
};

/**
 * Write it back the way every other writer here does.
 *
 * Two-space JSON with a trailing newline, owner-only when it is created,
 * because this is a file that may hold a connection token and the daemon is
 * the one writing it now.
 */
export const writeEntry = (path: string, held: Record<string, unknown>): void => {
  writeFileSync(path, `${JSON.stringify(held, null, 2)}\n`, { mode: 0o600 });
};

/*
 * The writes, one at a time: an install, an update or a remove starts once the
 * one before it has settled, failure or not, so two served requests never run
 * npm in the same directory together or edit the configuration file between
 * each other's steps. A client's edit of the same file goes here too, for the
 * same reason - two writers each reading the file and then writing it back
 * would lose whichever wrote first.
 */
let settled: Promise<unknown> = Promise.resolve();
export const oneAtATime = <T>(work: () => Promise<T>): Promise<T> => {
  const turn = settled.then(work);
  settled = turn.catch(() => undefined);
  return turn;
};

/** Every name `plugins` already holds, whether an entry is a string or an object. */
const namedIn = (list: unknown): Set<string> => {
  if (!Array.isArray(list)) return new Set();
  const names = new Set<string>();
  for (const entry of list) {
    const spec = asSpec(entry);
    if (spec !== undefined) names.add(nameOf(spec));
  }
  return names;
};

/**
 * Add each name that is not already in `plugins`, and say which were added.
 *
 * Matched by `nameOf`, so naming a package that is configured as an object
 * with options does not replace the options with a bare string. Nothing is
 * written when nothing was added, so a second install of the same package
 * leaves the file's own formatting alone.
 */
export const enableNames = (path: string, names: readonly string[]): string[] => {
  const held = readEntry(path);
  const list = Array.isArray(held.plugins) ? [...held.plugins] : [];
  const already = namedIn(list);
  const added: string[] = [];
  for (const name of names) {
    if (already.has(name)) continue;
    already.add(name);
    list.push(name);
    added.push(name);
  }
  if (added.length === 0) return [];
  held.plugins = list;
  writeEntry(path, held);
  return added;
};

/**
 * Drop every entry whose name matches, string or object, and say which went.
 *
 * Only `plugins` changes: an entry that is not a spec at all is left where it
 * is, because a command whose job is to remove one name is not the place to
 * delete something nobody explained.
 */
export const disableNames = (path: string, names: readonly string[]): string[] => {
  const held = readEntry(path);
  if (!Array.isArray(held.plugins)) return [];
  const wanted = new Set(names);
  const dropped: string[] = [];
  const list = held.plugins.filter((entry) => {
    const spec = asSpec(entry);
    if (spec === undefined) return true;
    const name = nameOf(spec);
    if (!wanted.has(name)) return true;
    dropped.push(name);
    return false;
  });
  if (dropped.length === 0) return [];
  held.plugins = list;
  writeEntry(path, held);
  return dropped;
};

/** The entry `plugins` holds under that name, string or object, or nothing. */
export const pluginEntry = (path: string, name: string): PluginSpec | undefined => {
  const list = readEntry(path).plugins;
  if (!Array.isArray(list)) return undefined;
  for (const entry of list) {
    const spec = asSpec(entry);
    if (spec !== undefined && nameOf(spec) === name) return spec;
  }
  return undefined;
};

/**
 * Rewrite the entry named, as an object, and write the file.
 *
 * Refused naming the plugin when the file does not configure it, because a
 * setting for a plugin that is not loaded is one nobody would see take effect.
 */
const editEntry = (
  path: string,
  name: string,
  change: (entry: { name: string; options?: Record<string, unknown>; enabled?: boolean }) => void,
): void => {
  const held = readEntry(path);
  const list = Array.isArray(held.plugins) ? [...held.plugins] : [];
  const at = list.findIndex((entry) => {
    const spec = asSpec(entry);
    return spec !== undefined && nameOf(spec) === name;
  });
  if (at === -1) throw new Error(`${name} is not in plugins in ${path}.`);
  const spec = asSpec(list[at]) as PluginSpec;
  const entry = typeof spec === 'string' ? { name: spec } : { ...list[at] as Record<string, unknown>, name: spec.name };
  change(entry);
  list[at] = entry;
  held.plugins = list;
  writeEntry(path, held);
};

/**
 * Set one option of the entry named, or remove it when `value` is undefined,
 * and answer whether the file changed.
 *
 * An entry left with no options loses the key, so an unset leaves no `{}`. An
 * unset of an option the entry does not set leaves the file as it was, a
 * string entry included.
 */
export const setPluginOption = (path: string, name: string, key: string, value: unknown): boolean => {
  if (value === undefined) {
    const spec = pluginEntry(path, name);
    if (spec !== undefined && (typeof spec === 'string' || spec.options === undefined || !Object.hasOwn(spec.options, key))) return false;
  }
  editEntry(path, name, (entry) => {
    const options = { ...entry.options };
    if (value === undefined) delete options[key];
    else options[key] = value;
    if (Object.keys(options).length === 0) delete entry.options;
    else entry.options = options;
  });
  return true;
};

/**
 * Turn the entry named on or off.
 *
 * A string entry is already on, so turning it on leaves the file alone; turning
 * it off makes it an object that says so.
 */
export const setPluginEnabled = (path: string, name: string, enabled: boolean): void => {
  const spec = pluginEntry(path, name);
  if (enabled && typeof spec === 'string') return;
  editEntry(path, name, (entry) => { entry.enabled = enabled; });
};

/**
 * The directory plugins are installed into: `AHPD_PLUGIN_ROOT` when it is set,
 * else the configuration directory.
 *
 * The launcher of the ahpd part sets the variable, where the configuration
 * directory is not writable and a plugin installed there would go nowhere a
 * run would look for it. Everywhere else it is unset and the configuration
 * directory is the root, which is what the daemon loads a bare name from.
 * An empty value is a variable nobody set, as `rootsOf` reads it.
 */
export const pluginRoot = (configDir: string): string => {
  const root = process.env.AHPD_PLUGIN_ROOT;
  return root === undefined || root === '' ? configDir : root;
};

/** The plugin root's `package.json` `dependencies`, name to spec, in the order it lists them. */
const dependenciesIn = (root: string): [string, string][] => {
  const dependencies = readEntry(join(root, 'package.json')).dependencies;
  if (typeof dependencies !== 'object' || dependencies === null || Array.isArray(dependencies)) return [];
  return Object.entries(dependencies as Record<string, unknown>).map(([name, spec]) => [name, String(spec)]);
};

/**
 * Whether a dependency's spec names a package from the npm registry.
 *
 * A path, a `file:` or `link:` spec, a git spec and an http(s) URL are
 * somewhere a person chose, which no registry version replaces.
 */
const fromRegistry = (spec: string): boolean =>
  !/^(?:\.|\/|~|file:|link:|git\+|git:|github:|https?:)/.test(spec);

/** The version of a package installed in the plugin root, or `undefined` when it has none. */
const installedVersion = (root: string, name: string): string | undefined => {
  const path = join(root, 'node_modules', name, 'package.json');
  try {
    const version = readEntry(path).version;
    return typeof version === 'string' ? version : undefined;
  }
  catch {
    return undefined;
  }
};

/** The package every plugin peers, which ahpd installs itself at the daemon's version. */
const SDK = '@ahpd/sdk';

/** Why `@ahpd/sdk` is refused when it is named to install or update. */
const SDK_IS_NOT_A_PLUGIN = `${SDK} is not a plugin: ahpd installs it at the daemon's version with every install and update.`;

/**
 * The npm arguments that put `@ahpd/sdk` at the daemon's version beside the
 * packages being installed, with no peer checked.
 *
 * Every plugin declares `@ahpd/sdk` as a peer, and the configuration directory
 * is one npm project, so npm would otherwise want one sdk that satisfies every
 * installed plugin: a plugin on one minor would block installing or updating
 * another on the next. Whether a plugin fits is the loader's question, asked
 * of each plugin against the daemon when it loads. `pinned` leaves the sdk
 * unpinned when the daemon's version is `unknown`.
 */
const daemonsSdk = (daemonVersion: string): string[] => ['--legacy-peer-deps', pinned(SDK, daemonVersion)];

/** What `plugin install` was given and where it looks. */
export interface InstallOptions {
  /** The configuration directory, which is the plugin root when `AHPD_PLUGIN_ROOT` is unset. */
  configDir: string;
  /** The configuration file `plugins` is edited in. */
  configFile: string;
  /** The daemon's own version, which an `@ahpd/` name without one is pinned to. */
  version: string;
  /** Whether to name the packages in `plugins`; false is `--no-enable`. */
  enable: boolean;
  /** How npm is run. */
  run: Runner;
  /** How the registry is asked for a manifest. */
  fetch: Fetch;
  /** One line of this command's own output. */
  say(line: string): void;
}

/** A package name as the registry has it, which a path, a URL and git's `owner/repo` are not. */
const REGISTRY_NAME = /^(?:@[a-z0-9~-][a-z0-9._~-]*\/)?[a-z0-9~-][a-z0-9._~-]*$/i;

/**
 * Refuse a registry package whose manifest has no `ahpd` field, at the version
 * `install` would ask npm for: an `@ahpd/` name at the daemon's version, any
 * other at the version or tag written, or `latest`.
 *
 * A registry that does not answer, or has no such version, is npm's to report.
 * Every name is asked at once, so three names are three requests and not one
 * request three times over.
 */
const refuseNonPlugins = async (names: readonly string[], options: InstallOptions): Promise<void> => {
  await Promise.all(names.map(async (name) => {
    const bare = packageOf(name);
    if (!REGISTRY_NAME.test(bare)) return;
    const target = pinned(name, options.version);
    const tag = target === bare ? 'latest' : target.slice(bare.length + 1);
    const manifest = await askRegistry(`${bare.replace('/', '%2f')}/${encodeURIComponent(tag)}`, { fetch: options.fetch });
    if (manifest === undefined) return;
    if (typeof manifest !== 'object' || manifest === null || !('ahpd' in manifest)) {
      throw new Error(`${bare} is not an ahpd plugin: its package.json has no "ahpd" field.`);
    }
  }));
};

/**
 * Install each package into the configuration directory, and name it.
 *
 * npm does the install, in the configuration directory, because that is the
 * directory a bare name resolves from and a global install is invisible to
 * it. A registry package is refused first when its manifest has no `ahpd`
 * field; nothing is loaded here, so whether the plugin works is what the next
 * `ahpd plugin list` or the next run says.
 *
 * No `--allow-scripts` here, and that is a finding rather than an omission:
 * npm 12 refuses that flag on a project-scoped install (`--prefix`) and tells
 * the caller to put it in the project's `package.json` or `.npmrc` instead.
 * The one native package a config-directory install may reach is the SDK's
 * optional `node-pty`, whose terminal binding the daemon gets from its own
 * global install, where the docs do pass the flag. A plugin with a build
 * script of its own therefore installs its files and skips that script, which
 * npm reports and carries on from.
 */
export async function installPlugins(names: readonly string[], options: InstallOptions): Promise<void> {
  for (const name of names) {
    if (!isPackageName(name)) {
      throw new Error(`${name} is not a package name. install takes package names only; a path or a URL is used as written where it is named.`);
    }
    if (packageOf(name) === SDK) throw new Error(SDK_IS_NOT_A_PLUGIN);
  }
  await refuseNonPlugins(names, options);
  const wanted = names.map((name) => pinned(name, options.version));
  const root = pluginRoot(options.configDir);
  // The config dir is made either way: the packages may go elsewhere, but
  // `--enable` still writes the daemon's own configuration there.
  mkdirSync(options.configDir, { recursive: true });
  mkdirSync(root, { recursive: true });
  const done = await options.run('npm', ['install', '--prefix', root, ...daemonsSdk(options.version), ...wanted]);
  if (done.code !== 0) {
    throw npmFailed(`npm could not install ${names.join(', ')}`, done);
  }
  options.say(`Installed ${wanted.join(', ')} into ${root}.`);
  if (!options.enable) {
    options.say('--no-enable, so the configuration was not changed.');
    return;
  }
  const packages = names.map(packageOf);
  const added = enableNames(options.configFile, packages);
  options.say(added.length === 0
    ? `${options.configFile} already names ${packages.join(', ')}.`
    : `plugins += ${added.join(', ')} in ${options.configFile}.`);
}

/** What `plugin update` was given and where it looks. */
export interface UpdateOptions {
  /** The configuration directory, which is the plugin root when `AHPD_PLUGIN_ROOT` is unset. */
  configDir: string;
  /** The daemon's own version, which every `@ahpd/` package is moved to. */
  version: string;
  /** How npm is run. */
  run: Runner;
  /** One line of this command's own output. */
  say(line: string): void;
}

/** A package `plugin update` moved, with its version on disk before and after npm; absent is not installed. */
export interface Moved {
  name: string;
  from?: string;
  to?: string;
}

/**
 * Move the packages installed in the plugin root, in one npm call: every one
 * for `all`, or only those named, each of which must be installed there.
 *
 * An `@ahpd/` package goes to the daemon's version, as `pinned` pins it; any
 * other goes to `latest`, and a name that carries a version or a tag is passed
 * as written. A package installed from outside the registry is left as it is.
 * `config.json` is not touched. Says each package whose installed version
 * changed, from the version before npm to the one npm left, or `Nothing to
 * update.` when none did, and answers those packages. The sdk is installed
 * beside them by every call, so a version of it that changed is answered as
 * moved too, though it is no plugin to name.
 */
export async function updatePlugins(names: 'all' | readonly string[], options: UpdateOptions): Promise<Moved[]> {
  const root = pluginRoot(options.configDir);
  const dependencies = dependenciesIn(root);
  const specs = new Map(dependencies);
  if (names !== 'all') {
    for (const name of names) {
      if (packageOf(name) === SDK) throw new Error(SDK_IS_NOT_A_PLUGIN);
      if (!specs.has(packageOf(name))) throw new Error(`${packageOf(name)} is not installed in ${root}.`);
    }
  }
  // The sdk is in `dependencies` because ahpd installs it, and moves with every
  // call below; it is not a plugin to move or to name.
  const asked = names === 'all' ? dependencies.map(([name]) => name).filter((name) => name !== SDK) : names;
  if (asked.length === 0) {
    options.say(`No plugin is installed in ${root}.`);
    return [];
  }
  const moving: string[] = [];
  for (const name of asked) {
    const spec = specs.get(packageOf(name)) ?? '';
    if (fromRegistry(spec)) moving.push(name);
    else options.say(`${packageOf(name)}: ${spec}, left as installed`);
  }
  if (moving.length === 0) {
    options.say('Nothing to update.');
    return [];
  }
  const targets = moving.map((name) => {
    if (name !== packageOf(name)) return name;
    return name.startsWith('@ahpd/') ? pinned(name, options.version) : `${name}@latest`;
  });
  const from = moving.map((name) => installedVersion(root, packageOf(name)));
  const sdkFrom = installedVersion(root, SDK);
  const done = await options.run('npm', ['install', '--prefix', root, ...daemonsSdk(options.version), ...targets]);
  if (done.code !== 0) {
    throw npmFailed(`npm could not update ${moving.map(packageOf).join(', ')}`, done);
  }
  const moved: Moved[] = [];
  moving.forEach((name, at) => {
    const to = installedVersion(root, packageOf(name));
    if (to === from[at]) return;
    moved.push({ name: packageOf(name), ...(from[at] === undefined ? {} : { from: from[at] }), ...(to === undefined ? {} : { to }) });
    options.say(`${packageOf(name)}: ${from[at] ?? 'not installed'} to ${to ?? 'not installed'}`);
  });
  const sdkTo = installedVersion(root, SDK);
  if (sdkTo !== sdkFrom) {
    moved.push({ name: SDK, ...(sdkFrom === undefined ? {} : { from: sdkFrom }), ...(sdkTo === undefined ? {} : { to: sdkTo }) });
    options.say(`${SDK}: ${sdkFrom ?? 'not installed'} to ${sdkTo ?? 'not installed'}`);
  }
  if (moved.length === 0) options.say('Nothing to update.');
  return moved;
}

/** What `plugin remove` was given and where it looks. */
export interface RemoveOptions {
  /** The configuration directory, which is the plugin root when `AHPD_PLUGIN_ROOT` is unset. */
  configDir: string;
  /** The configuration file `plugins` is edited in. */
  configFile: string;
  /** Whether to uninstall the packages; false is `--keep`. */
  uninstall: boolean;
  /** How npm is run. */
  run: Runner;
  /** One line of this command's own output. */
  say(line: string): void;
}

/**
 * Take each name out of `plugins`, and uninstall it unless asked not to.
 *
 * The configuration is edited first, so a `remove --keep` that only wanted the
 * run to stop loading a plugin leaves the package where it is. An uninstall
 * that fails is reported after the list has already changed, which is the
 * order a person can act on: the plugin is off, and npm's reason is on screen.
 */
export async function removePlugins(names: readonly string[], options: RemoveOptions): Promise<void> {
  const root = pluginRoot(options.configDir);
  const packages = names.map(packageOf);
  const dropped = disableNames(options.configFile, packages);
  options.say(dropped.length === 0
    ? `${options.configFile} did not name ${packages.join(', ')}.`
    : `plugins -= ${dropped.join(', ')} in ${options.configFile}.`);
  if (!options.uninstall) return;
  // The sdk is the daemon's, installed beside every plugin, and stays.
  const uninstalled = packages.filter((name) => name !== SDK);
  if (uninstalled.length === 0) return;
  const done = await options.run('npm', ['uninstall', '--prefix', root, ...uninstalled]);
  if (done.code !== 0) {
    throw npmFailed(`npm could not uninstall ${uninstalled.join(', ')}`, done);
  }
  options.say(`Uninstalled ${uninstalled.join(', ')} from ${root}.`);
}
