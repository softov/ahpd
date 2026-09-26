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
 * The process boundary is `Runner`, so a test fakes npm. Nothing here reaches
 * for the network, the clock or the environment: a caller passes the
 * directory, the file and the version to pin to.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import type { PluginSpec } from '@ahpd/sdk';
import { asSpec } from './config.js';
import { hasScheme, nameOf } from './plugins.js';

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
 * The child inherits this process's streams, so npm's progress bar and its
 * prompts are the person's to watch. Replaced in tests, which is the only
 * reason this is a value at all.
 */
export type Runner = (program: string, argv: readonly string[]) => Ran;

/** The default runner: the program on PATH, waited for. */
export const run: Runner = (program, argv) => {
  const done = spawnSync(program, [...argv], { stdio: 'inherit', encoding: 'utf8' });
  if (done.error !== undefined) return { code: -1, stdout: '', stderr: done.error.message };
  return { code: done.status ?? -1, stdout: done.stdout ?? '', stderr: done.stderr ?? '' };
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
const readEntry = (path: string): Record<string, unknown> => {
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
const writeEntry = (path: string, held: Record<string, unknown>): void => {
  writeFileSync(path, `${JSON.stringify(held, null, 2)}\n`, { mode: 0o600 });
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

/** What `plugin install` was given and where it looks. */
export interface InstallOptions {
  /** The configuration directory npm installs into, which is where a bare name is resolved from. */
  configDir: string;
  /** The configuration file `plugins` is edited in. */
  configFile: string;
  /** The daemon's own version, which an `@ahpd/` name without one is pinned to. */
  version: string;
  /** Whether to name the packages in `plugins`; false is `--no-enable`. */
  enable: boolean;
  /** How npm is run. */
  run: Runner;
  /** One line of this command's own output. */
  say(line: string): void;
}

/**
 * Install each package into the configuration directory, and name it.
 *
 * npm does the install, in the configuration directory, because that is the
 * directory a bare name resolves from and a global install is invisible to
 * it. Nothing is loaded and nothing is validated here: whether the package is
 * a plugin at all is what the next `ahpd plugin list` or the next run says.
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
export function installPlugins(names: readonly string[], options: InstallOptions): void {
  for (const name of names) {
    if (!isPackageName(name)) {
      throw new Error(`${name} is not a package name. install takes package names only; a path or a URL is used as written where it is named.`);
    }
  }
  const wanted = names.map((name) => pinned(name, options.version));
  mkdirSync(options.configDir, { recursive: true });
  const done = options.run('npm', ['install', '--prefix', options.configDir, ...wanted]);
  if (done.code !== 0) {
    const why = done.stderr.trim();
    throw new Error(`npm could not install ${names.join(', ')}: ${why === '' ? `exit ${String(done.code)}` : why}`);
  }
  options.say(`Installed ${wanted.join(', ')} into ${options.configDir}.`);
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

/** What `plugin remove` was given and where it looks. */
export interface RemoveOptions {
  /** The configuration directory npm uninstalls from. */
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
export function removePlugins(names: readonly string[], options: RemoveOptions): void {
  const packages = names.map(packageOf);
  const dropped = disableNames(options.configFile, packages);
  options.say(dropped.length === 0
    ? `${options.configFile} did not name ${packages.join(', ')}.`
    : `plugins -= ${dropped.join(', ')} in ${options.configFile}.`);
  if (!options.uninstall) return;
  const done = options.run('npm', ['uninstall', '--prefix', options.configDir, ...packages]);
  if (done.code !== 0) {
    const why = done.stderr.trim();
    throw new Error(`npm could not uninstall ${packages.join(', ')}: ${why === '' ? `exit ${String(done.code)}` : why}`);
  }
  options.say(`Uninstalled ${packages.join(', ')} from ${options.configDir}.`);
}
