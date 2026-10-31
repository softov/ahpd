/**
 * Turning what a person wrote into something importable, and then into a host.
 *
 * A plugin is named in the configuration file or on the command line as a
 * module specifier, a path, or a package installed in the configuration
 * directory. This file is the half of the plugin mechanism that touches the
 * machine - the filesystem, the module resolver and `import()` - and it is
 * split so that resolving stops short of running anything: a listing can ask
 * what a spec means before it imports the module for its id, and a load and a
 * listing agree.
 *
 * A bare name is resolved through the configuration directory's own
 * `node_modules`, which is what makes `npm i` there the install rather than a
 * flag somewhere. A path is tried against the working directory and then the
 * configuration directory, because a relative path means the person's shell
 * decides what runs and that has to be said rather than guessed.
 *
 * A plugin that fails to resolve, to manifest, to import or to apply is
 * reported and skipped, because a daemon that dies on a bad plugin is a daemon
 * a bad plugin can take down. The one thing this file refuses rather than
 * reports is a duplicate `provider`, which the fold turns into a problem the
 * caller refuses over: two backends a client cannot tell apart is worse than
 * no backend at all.
 */

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, extname, isAbsolute, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { check, type JsonSchema } from '@cofold/commands';
import { parseYaml, stringifyYaml } from '@cofold/yaml';
import { checkIcons, foldHostOptions, frozenCopy, gapLine, grantProblem, isRecord, isRecordSlug, pluginHost, readSecret, reason, RECORD_SLUG, runtime, schemaGaps, sdkVersion, secretRef } from '@ahpd/sdk';
import type { Agent, AgentOwner, Alert, Catalogs, InstallAnswer, Contribution, FoldedOptions, Grant, HostOptions, Icon, Loaded, NodeRegistry, Plugin, PluginContext, PluginContracts, PluginHost, PluginLink, PluginManifest, PluginSpec, PluginView, RecordStore, Route, SessionStore, Usage, Vault, ViewSurface } from '@ahpd/sdk';
import { fetchIcons, resolveIcons } from './icons.js';
import { readCatalogs } from './i18n.js';
import { satisfies } from './compat.js';
import { run as runProgram } from './install.js';
import type { Runner } from './install.js';

/** One spec, turned into a URL to import. */
export interface Resolved {
  /** What was named, as it was named. */
  spec: PluginSpec;
  /** The URL `import()` is given. */
  url: string;
  /**
   * The file the URL names, when there is one.
   *
   * Absent for a spec with a scheme of its own - `npm:`, `https:`, `data:` -
   * where the writer decided what to import and this daemon has no path to
   * report or validate.
   */
  path?: string;
  /**
   * The package directory a manifest was read from, when one was.
   *
   * Present when the spec resolved through a manifest: a directory named
   * directly, or an installed package found through `createRequire`. A bare
   * file leaves it absent and the loader walks up to the nearest manifest, the
   * way `version.ts` does.
   */
  packageDir?: string;
  /**
   * The `plugin.json` a standalone spec named, when it named one.
   *
   * A standalone plugin has no package around it, so its manifest is the file
   * the spec points at; `path` is already the module that file's `main` names.
   */
  manifestPath?: string;
}

/**
 * The module a spec names, whether it was written as a string or an object.
 *
 * `source` is the name. An entry written before `source` named its module with
 * `name`, and that form still answers here.
 */
export const sourceOf = (spec: PluginSpec): string => typeof spec === 'string' ? spec : spec.source ?? spec.name;

/**
 * Each plugin's id, by its spec as written: the name its module exports, then
 * its manifest's, then its file's, then the spec. Filled by `loadPlugins` and
 * `pluginIdsOf`, which import a module to read it.
 */
const ids = new Map<string, string>();

/**
 * The id of the plugin a spec loads: the one this process read, or, for a spec
 * no import has named, its manifest's name, its file's name or the spec.
 */
export const pluginIdOf = (spec: PluginSpec, where?: { configDir: string; cwd: string }): string =>
  ids.get(sourceOf(spec)) ?? (where === undefined ? sourceOf(spec) : unimportedId(spec, where));

/** Whether a name a person typed names this spec: its id, or the spec as written. */
export const isNamed = (spec: PluginSpec, name: string): boolean => sourceOf(spec) === name || pluginIdOf(spec) === name;

/** A spec's id read without an import, from what resolving it and its manifest say. */
const unimportedId = (spec: PluginSpec, where: { configDir: string; cwd: string }): string => {
  try {
    const found = locate(resolvePlugin(spec, where), sdkVersion());
    return 'refused' in found ? sourceOf(spec) : provisionalOf(spec, found);
  }
  catch {
    // A spec that does not resolve is called what it was written as.
    return sourceOf(spec);
  }
};

/** A fallback id with its scope joined by a dash: `@scope/name` is `scope-name`. */
const unscoped = (id: string): string => {
  const scoped = /^@([^/]+)\/([^/]+)$/.exec(id);
  return scoped === null ? id : `${scoped[1]}-${scoped[2]}`;
};

/**
 * How many alerts one plugin's row holds.
 *
 * A plugin that alerts from a watch that keeps firing must not grow the row
 * without end, so the oldest goes first once there are more than this.
 */
export const MAX_ALERTS = 50;

/** What a located plugin is called until its module says. */
const provisionalOf = (spec: PluginSpec, found: Located): string =>
  unscoped(found.manifest?.name ?? (found.manifest === undefined && found.target !== undefined ? fileNameOf(found.target) : sourceOf(spec)));

/**
 * Whether the spec carries a scheme of its own, which this daemon does not second-guess.
 *
 * A scheme is two characters or more: one letter and a colon is a Windows drive,
 * as in `C:\plugins\mine.js`, and no runtime imports a one-letter scheme.
 */
export const hasScheme = (spec: string): boolean => /^[a-zA-Z][a-zA-Z0-9+.-]+:/.test(spec);

/** Why a bare name cannot be resolved on Deno, and what to write instead. */
export const denoMessage = (name: string, configDir: string): string =>
  `Plugin ${name} is a bare name, and Deno has no createRequire to resolve one against ${configDir}; write it as npm:${name}.`;

/** The nearest directory above `from` holding a `package.json`, or nothing when there is none. */
const enclosingPackage = (from: string): string | undefined => {
  let at = dirname(from);
  for (;;) {
    if (existsSync(join(at, 'package.json'))) return at;
    const up = dirname(at);
    if (up === at) return undefined;
    at = up;
  }
};

/**
 * The directory of the plugin package a file spec sits in, or nothing when it
 * sits in none.
 *
 * The nearest `package.json` above the file, only when it has an `ahpd` field:
 * a file inside another package, such as a fixture under this server's own
 * tree, is a plugin of its own and is held to no other package's range or
 * entry.
 */
const nearestManifest = (from: string): string | undefined => {
  const at = enclosingPackage(from);
  return at === undefined || parseManifest(at)?.['ahpd'] === undefined ? undefined : at;
};

/**
 * What a plugin file with no manifest is called until its module says: the
 * file's name without its extension, or its directory's for an `index` file.
 */
const fileNameOf = (path: string): string => {
  const name = basename(path, extname(path));
  return name === 'index' ? basename(dirname(path)) : name;
};

/** What a `package.json` says about its plugin, read without judging it. */
const parseManifest = (dir: string): Record<string, unknown> | undefined => {
  try {
    const found: unknown = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    return typeof found === 'object' && found !== null ? found as Record<string, unknown> : undefined;
  }
  catch {
    // A manifest that is not there or does not parse is not this function's
    // to complain about: `entryOf` still has `index.js` to fall back to, and
    // the loader's manifest check is what names a broken file to a person.
    return undefined;
  }
};

/** The userinfo of any URL in a line, which is where a spec's credential is. */
const USERINFO = /([a-zA-Z][\w+.-]*:\/\/)[^/@\s]+@/gu;

/** One line with every URL's userinfo replaced, so no answer carries a credential. */
const withoutUserinfo = (text: string): string => text.replace(USERINFO, '$1<set>@');

/** The last line npm wrote to its standard error, which is where it says why it stopped. */
const lastLineOf = (text: string): string | undefined =>
  text.split('\n').map((one) => one.trim()).filter((one) => one !== '').at(-1);

/**
 * What a spec may hold: a package name, and a version or tag after `@`.
 *
 * A spec that starts with `-` is a flag to npm, and a later flag wins over the
 * `--ignore-scripts` before it. Whitespace, quotes and `%` change what the
 * Windows shell hands npm. So a spec is only the characters a name, a version,
 * a range or a tag is written with.
 */
const SPEC = /^[A-Za-z0-9@][\w@/.~^*+:=-]*$/u;

/**
 * The package a spec names, with a version written after `@` taken off.
 *
 * npm takes a version after the name, as in `@scope/name@1.2.3` or `name@next`,
 * and the package's own `package.json` is found under the name alone. A spec
 * that names no package, such as a URL or a path, answers nothing.
 */
const packageNameOf = (spec: string): string | undefined => {
  const scoped = /^(@[^/@\s]+\/[^/@\s]+)(?:@[^@\s]*)?$/.exec(spec);
  if (scoped !== null) return scoped[1];
  const plain = /^([^/@\s][^/@\s]*?)(?:@[^@\s]*)?$/.exec(spec);
  return plain?.[1];
};

/** The version npm left in a plugin's `installed/` folder for one spec, or nothing. */
const installedVersionOf = (folder: string, spec: string): string | undefined => {
  const name = packageNameOf(spec);
  if (name === undefined) return undefined;
  const manifest = parseManifest(join(folder, 'node_modules', ...name.split('/')));
  return typeof manifest?.['version'] === 'string' ? manifest['version'] : undefined;
};

/**
 * One install at a time for one plugin.
 *
 * Two npm runs in one folder race on its `package.json` and `package-lock.json`,
 * so the second waits for the first. A failed install does not stop the next
 * one, because the queue is about the folder and not about what npm answered.
 */
const installing = new Map<string, Promise<unknown>>();
const oneInstallAtATime = <T>(plugin: string, work: () => Promise<T>): Promise<T> => {
  const before = installing.get(plugin) ?? Promise.resolve();
  const next = before.then(work, work);
  installing.set(plugin, next);
  const forget = (): void => { if (installing.get(plugin) === next) installing.delete(plugin); };
  next.then(forget, forget);
  return next;
};

/**
 * Install one package into a plugin's own `installed/` folder.
 *
 * The folder gets a `package.json` of its own before the first install, so npm
 * writes there rather than into the plugin's own manifest or `node_modules`. A
 * source plugin is in the pnpm workspace, and its `node_modules` is not npm's
 * to change.
 *
 * npm runs with `--ignore-scripts`, `--no-audit` and `--no-fund`: this install
 * is one package a person asked for, so no package's install script runs and
 * the registry is not asked anything else. The answer is the version npm left
 * in `node_modules`, or the last line npm wrote to its standard error.
 */
const installInto = async (plugin: string, folder: string, spec: string, npm: Runner): Promise<InstallAnswer> =>
  oneInstallAtATime(plugin, async () => {
    if (!SPEC.test(spec)) return { error: `${withoutUserinfo(spec)} is not a package npm can install` };
    mkdirSync(folder, { recursive: true });
    const manifest = join(folder, 'package.json');
    if (!existsSync(manifest)) writeFileSync(manifest, '{\n  "name": "ahpd-installed",\n  "private": true\n}\n');
    const done = await npm('npm', ['install', '--prefix', folder, '--ignore-scripts', '--no-audit', '--no-fund', spec]);
    if (done.code !== 0) {
      const said = lastLineOf(done.stderr);
      return { error: said === undefined ? `npm ended with code ${String(done.code)}` : withoutUserinfo(said) };
    }
    const version = installedVersionOf(folder, spec);
    return version === undefined
      ? { error: `npm installed ${withoutUserinfo(spec)}, but its package.json answers no version` }
      : { version };
  });

/**
 * The entry a directory's own manifest names, in the order it is looked for.
 *
 * `ahpd.entry` first, because that is the field added for exactly this; then
 * the package's own `exports["."]`; then `main`; then the conventional
 * `index.js`. An entry that resolves outside the directory is refused rather
 * than followed, so a manifest cannot point its own package at somebody
 * else's code.
 */
export const entryOf = (dir: string): string => {
  const manifest = parseManifest(dir);
  const ahpd = manifest?.ahpd;
  const ahpdEntry = typeof ahpd === 'object' && ahpd !== null && typeof (ahpd as Record<string, unknown>).entry === 'string'
    ? (ahpd as Record<string, unknown>).entry as string
    : undefined;

  const exported = manifest?.exports;
  let exportsEntry: string | undefined;
  if (typeof exported === 'string') exportsEntry = exported;
  else if (typeof exported === 'object' && exported !== null) {
    const dot = (exported as Record<string, unknown>)['.'];
    if (typeof dot === 'string') exportsEntry = dot;
    else if (typeof dot === 'object' && dot !== null && typeof (dot as Record<string, unknown>).default === 'string') {
      exportsEntry = (dot as Record<string, unknown>).default as string;
    }
  }

  const main = typeof manifest?.main === 'string' ? manifest.main : undefined;
  const named = ahpdEntry ?? exportsEntry ?? main;

  if (named !== undefined) {
    const at = resolve(dir, named);
    if (at !== dir && !at.startsWith(dir + sep)) {
      throw new Error(`${dir} has an ahpd entry ${named} that points outside the package, at ${at}.`);
    }
    if (existsSync(at)) return at;
  }

  const conventional = join(dir, 'index.js');
  if (existsSync(conventional)) return conventional;

  throw new Error(`${dir} has no plugin entry: looked for ahpd.entry, exports["."], main and index.js in ${join(dir, 'package.json')}.`);
};

/**
 * What an operator runs when a refused plugin is an older release of one that
 * has moved on, which is the ordinary way to meet a refusal below: the daemon
 * was updated by npm, and the plugins it loads were not.
 */
const OLDER_RELEASE = 'if it is an older release, run ahpd plugin update all, or update it from a client';

/**
 * The roots a bare name is resolved from, in the order they are looked in.
 *
 * `AHPD_PLUGIN_ROOT`, when it is set, is where `ahpd plugin install` and
 * `ahpd plugin update` write, so it comes first: the copy an update moved is
 * the one that loads, and an older copy left in the configuration directory
 * by an earlier release does not hide it. The configuration directory is
 * still looked in after it, for a plugin installed there by hand.
 */
function rootsOf(configDir: string): string[] {
  const root = process.env.AHPD_PLUGIN_ROOT;
  if (root === undefined || root === '') return [configDir];
  return [join(root, 'node_modules'), configDir];
}

/**
 * Resolve one spec to something importable, without importing it.
 *
 * A scheme of the spec's own is passed through untouched, a path is tried
 * against the working directory and then the configuration directory, and a
 * bare name is resolved from the configuration directory. Nothing here is
 * awaited, nothing here touches the network, and nothing here runs plugin code.
 */
export function resolvePlugin(spec: PluginSpec, options: { configDir: string; cwd: string }): Resolved {
  const name = sourceOf(spec);
  const { configDir, cwd } = options;

  // `file:`, `npm:`, `jsr:`, `https:` and `data:` are the writer's decision:
  // what an import of one means is the runtime's business, and pretending to
  // resolve it here would be a second opinion nobody asked for.
  if (hasScheme(name)) return { spec, url: name };

  if (isAbsolute(name) || name.startsWith('.')) {
    const candidates = [resolve(cwd, name), resolve(configDir, name)];
    const found = candidates.find((candidate) => existsSync(candidate));
    if (found === undefined) {
      throw new Error(`Plugin ${name} is not there: tried ${candidates.join(' and ')}.`);
    }
    if (statSync(found).isDirectory()) {
      const entry = entryOf(found);
      return { spec, url: pathToFileURL(entry).href, path: entry, packageDir: found };
    }
    /*
     * A standalone plugin names its `plugin.json`, and the `main` in it names
     * the module to run. The file is read here rather than imported: it is the
     * one thing a standalone plugin says about itself that a listing needs
     * before anything runs.
     */
    if (basename(found) === 'plugin.json') {
      const manifest = readStandalone(found);
      if (manifest.problem !== undefined) throw new Error(manifest.problem);
      const main = manifest.entry;
      if (main === undefined) {
        throw new Error(`${found} has no main; a plugin.json names the module it runs.`);
      }
      const folder = dirname(found);
      const at = resolve(folder, main);
      if (at !== folder && !at.startsWith(folder + sep)) {
        throw new Error(`${found} names a main ${main} that points outside its folder, at ${at}.`);
      }
      return { spec, url: pathToFileURL(at).href, path: at, manifestPath: found };
    }
    /*
     * A bare file that sits in no plugin package declares its manifest the
     * only way a standalone plugin can: a `plugin.json` beside it. Reading it
     * here makes naming the file and naming its manifest one plugin, and one
     * with no manifest is refused by `locate` before anything runs.
     *
     * The manifest describes the file the spec named, so one whose `main`
     * points elsewhere is refused rather than followed: replacing the module a
     * person named with another one is not this lookup's to do.
     */
    if (nearestManifest(found) === undefined) {
      const beside = join(dirname(found), 'plugin.json');
      if (existsSync(beside)) {
        const manifest = readStandalone(beside);
        if (manifest.problem !== undefined) throw new Error(manifest.problem);
        const folder = dirname(beside);
        const main = manifest.entry ?? basename(found);
        const at = resolve(folder, main);
        if (at !== folder && !at.startsWith(folder + sep)) {
          throw new Error(`${beside} names a main ${main} that points outside its folder, at ${at}.`);
        }
        if (at !== found) {
          throw new Error(`${beside} names ${main}, but ${basename(found)} was named; name the plugin.json, or write one whose main is ${basename(found)}.`);
        }
        return { spec, url: pathToFileURL(found).href, path: found, manifestPath: beside };
      }
    }
    return { spec, url: pathToFileURL(found).href, path: found };
  }

  if (runtime() === 'deno') throw new Error(denoMessage(name, configDir));

  const roots = rootsOf(configDir);
  let file: string | undefined;
  for (const root of roots) {
    try {
      file = createRequire(join(root, 'package.json')).resolve(name);
      break;
    }
    catch {
      // The next root is the next place it may be, and only the last one is a
      // refusal.
    }
  }
  if (file === undefined) {
    throw new Error(`Plugin ${name} is not installed in ${roots.join(' or ')}; run npm install there, or name a path.`);
  }
  const packageDir = enclosingPackage(file);
  return {
    spec,
    url: pathToFileURL(file).href,
    path: file,
    ...(packageDir === undefined ? {} : { packageDir }),
  };
}

/** What a plugin's own `package.json` says, read without judging it. */
export interface Manifest {
  /** The `package.json` it was read from, for every message about it. */
  path: string;
  /**
   * The package name, or a standalone manifest's `id`.
   *
   * Both are what the plugin is called until its module says otherwise, so the
   * loader reads one field for the two.
   */
  name?: string;
  /** `ahpd.title`, or a standalone manifest's display `name`. */
  title?: string;
  /** The package's `version`, or the standalone manifest's own. */
  version?: string;
  /** `ahpd.entry`, or a standalone manifest's `main`. */
  entry?: string;
  /** Set when the manifest came from a `plugin.json` or a configuration entry. */
  standalone?: true;
  /** `ahpd.description`, one sentence on what the plugin does. */
  description?: string;
  /** `ahpd.categories`, the groups a client files the plugin under. */
  categories?: string[];
  /** `ahpd.links`, where a person reads more. */
  links?: PluginLink[];
  /** `ahpd.contracts`, the names each kind of registration may use. */
  contracts?: PluginContracts;
  /** `ahpd.icons`, read and encoded as a client draws them. */
  icons?: Icon[];
  /**
   * `ahpd.optionsSchema`, or a standalone manifest's `optionsSchema`.
   *
   * A JSON Schema the options are checked against. Read here rather than from
   * the module, so a plugin that is switched off or failed to load still has a
   * form a client draws and values the daemon can refuse.
   */
  optionsSchema?: Record<string, unknown>;
  /** One line for each `ahpd.icons` entry that could not be read. */
  iconProblems?: string[];
  /** `ahpd.i18n`, the catalogs read from that folder, by locale. */
  i18n?: Catalogs;
  /** One line for each `ahpd.i18n` catalog or folder that could not be read. */
  i18nProblems?: string[];
  /** `peerDependencies["@ahpd/sdk"]`, the range compatibility is checked against. */
  sdkRange?: string;
  /** Set when the file could not be read or parsed, so nothing else is trustworthy. */
  problem?: string;
  /** The raw `ahpd` value, so the shape check can refuse one that is not an object. */
  ahpd?: unknown;
  /** The raw `peerDependencies["@ahpd/sdk"]` value, so the shape check can refuse a non-string. */
  peer?: unknown;
}

/**
 * Read one package's manifest once.
 *
 * Both checks that follow use this parse rather than reading the file again,
 * and neither is done here: this answers what the file says, and a file it
 * cannot read is a `problem` rather than a throw, because the caller decides
 * what to do about a package that cannot describe itself.
 */
export const readManifest = (packageDir: string): Manifest => {
  const path = join(packageDir, 'package.json');
  let value: Record<string, unknown>;
  try {
    const found: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (typeof found !== 'object' || found === null || Array.isArray(found)) {
      return { path, problem: `${path} is not a JSON object.` };
    }
    value = found as Record<string, unknown>;
  }
  catch (error) {
    return { path, problem: `${path} could not be read: ${reason(error)}` };
  }

  const ahpd = value.ahpd;
  const peers = typeof value.peerDependencies === 'object' && value.peerDependencies !== null && !Array.isArray(value.peerDependencies)
    ? value.peerDependencies as Record<string, unknown>
    : undefined;
  const peer = peers?.['@ahpd/sdk'];
  const inside = typeof ahpd === 'object' && ahpd !== null && !Array.isArray(ahpd) ? ahpd as Record<string, unknown> : undefined;

  const manifest: Manifest = { path, ahpd, peer };
  if (typeof value.name === 'string') manifest.name = value.name;
  if (typeof value.version === 'string') manifest.version = value.version;
  if (typeof inside?.title === 'string') manifest.title = inside.title;
  if (typeof inside?.entry === 'string') manifest.entry = inside.entry;
  if (typeof inside?.description === 'string') manifest.description = inside.description;
  if (Array.isArray(inside?.categories) && inside.categories.every((one) => typeof one === 'string')) {
    manifest.categories = [...inside.categories];
  }
  if (isLinks(inside?.links)) manifest.links = inside.links.map((one) => ({ title: one.title, url: one.url }));
  if (areContracts(inside?.contracts)) manifest.contracts = inside.contracts;
  if (isRecord(inside?.optionsSchema)) manifest.optionsSchema = inside.optionsSchema;
  /*
   * An icon is read here rather than at each subscription, and a file that is
   * missing or too large costs the icon and not the manifest: the line is kept
   * for the loader to say beside its own.
   */
  if (Array.isArray(inside?.icons)) {
    const iconProblems: string[] = [];
    manifest.icons = resolveIcons(inside.icons, packageDir, `plugin ${typeof value.name === 'string' ? value.name : packageDir}`, (line) => iconProblems.push(line));
    if (iconProblems.length > 0) manifest.iconProblems = iconProblems;
  }
  readI18n(manifest, inside?.i18n, packageDir, `plugin ${typeof value.name === 'string' ? value.name : packageDir}`);
  if (typeof peer === 'string') manifest.sdkRange = peer;
  return manifest;
};

/**
 * Read a standalone plugin's manifest from the `plugin.json` a spec named.
 *
 * The fields are a package's `ahpd` field with this file's top level in their
 * place, plus `id`, `name` and `version`: the three a package.json carries
 * outside its `ahpd`. `main` names the module to run and is kept as the entry.
 */
export const readStandalone = (path: string): Manifest => {
  let value: Record<string, unknown>;
  try {
    const found: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (typeof found !== 'object' || found === null || Array.isArray(found)) {
      return { path, problem: `${path} is not a JSON object.` };
    }
    value = found as Record<string, unknown>;
  }
  catch (error) {
    return { path, problem: `${path} could not be read: ${reason(error)}` };
  }
  return standaloneOf(value, path, dirname(path));
};

/**
 * A standalone manifest from the object that declares it.
 *
 * Shared by a `plugin.json` and by a configuration entry that carries its own
 * manifest, so one shape is read one way wherever it was written. `base` is the
 * folder a relative icon is read from, or nothing where the entry has no folder
 * of its own.
 */
const standaloneOf = (inside: Record<string, unknown>, path: string, base: string | undefined): Manifest => {
  const manifest: Manifest = { path, standalone: true, ahpd: inside };
  // The id is what a standalone plugin is called; `name` is what a listing prints.
  if (typeof inside.id === 'string') manifest.name = inside.id;
  if (typeof inside.name === 'string') manifest.title = inside.name;
  if (typeof inside.version === 'string') manifest.version = inside.version;
  if (typeof inside.main === 'string') manifest.entry = inside.main;
  if (typeof inside.description === 'string') manifest.description = inside.description;
  if (Array.isArray(inside.categories) && inside.categories.every((one) => typeof one === 'string')) {
    manifest.categories = [...inside.categories];
  }
  if (isLinks(inside.links)) manifest.links = inside.links.map((one) => ({ title: one.title, url: one.url }));
  if (areContracts(inside.contracts)) manifest.contracts = inside.contracts;
  if (isRecord(inside.optionsSchema)) manifest.optionsSchema = inside.optionsSchema;
  if (Array.isArray(inside.icons) && base !== undefined) {
    const iconProblems: string[] = [];
    manifest.icons = resolveIcons(inside.icons, base, `plugin ${typeof inside.id === 'string' ? inside.id : path}`, (line) => iconProblems.push(line));
    if (iconProblems.length > 0) manifest.iconProblems = iconProblems;
  }
  if (base !== undefined) readI18n(manifest, inside.i18n, base, `plugin ${typeof inside.id === 'string' ? inside.id : path}`);
  return manifest;
};

/**
 * Reads the catalogs `ahpd.i18n` names into `manifest.i18n`.
 *
 * A value that is not a string is the shape check's to refuse, and is read
 * as nothing here. A catalog that could not be read is dropped and said, as
 * an icon is.
 */
const readI18n = (manifest: Manifest, folder: unknown, base: string, by: string): void => {
  if (typeof folder !== 'string') return;
  const i18nProblems: string[] = [];
  const catalogs = readCatalogs(folder, base, by, (line) => i18nProblems.push(line));
  if (catalogs !== undefined) manifest.i18n = catalogs;
  if (i18nProblems.length > 0) manifest.i18nProblems = i18nProblems;
};

/**
 * The manifest an entry carries itself, or `undefined` for one that carries none.
 *
 * An entry declares a manifest by declaring its `id`: without one it is an
 * entry naming a module, and the module's file is the plugin's.
 */
const inlineManifestOf = (spec: PluginSpec, base: string | undefined): Manifest | undefined => {
  if (typeof spec === 'string' || spec.id === undefined) return undefined;
  const inside = spec as unknown as Record<string, unknown>;
  const at = `the entry for ${sourceOf(spec)}`;
  return standaloneOf(inside, at, base);
};

/**
 * Whether a standalone manifest is a shape anything can read.
 *
 * The same field checks `checkManifest` makes, on the file's own top level: an
 * `id` to load under, and a description, categories, links, contracts and
 * icons of the kinds a client draws. A `plugin.json` that does not parse is the
 * reader's own `problem` and is returned as it stands.
 */
export const checkStandalone = (manifest: Manifest): string | undefined => {
  if (manifest.problem !== undefined) return manifest.problem;
  const inside = manifest.ahpd as Record<string, unknown>;
  if (typeof inside.id !== 'string' || inside.id.trim() === '') {
    return `${manifest.path} has no id; a standalone plugin declares the id it loads under.`;
  }
  if (inside.name !== undefined && typeof inside.name !== 'string') return `${manifest.path} has a name that is not a string.`;
  if (inside.version !== undefined && typeof inside.version !== 'string') return `${manifest.path} has a version that is not a string.`;
  if (inside.main !== undefined && typeof inside.main !== 'string') return `${manifest.path} has a main that is not a string.`;
  if (inside.optionsSchema !== undefined && !isRecord(inside.optionsSchema)) {
    return `${manifest.path} has an optionsSchema that is not an object.`;
  }
  return checkFields(inside, (field) => `${manifest.path} has a ${field} that`);
};

/** Whether a value is a list of `{ title, url }`, the shape a link is. */
const isLinks = (value: unknown): value is PluginLink[] =>
  Array.isArray(value) && value.every((one) => isRecord(one) && typeof one['title'] === 'string' && typeof one['url'] === 'string');

/** Whether a value is a record of kind names to lists of strings, the shape contracts are. */
const areContracts = (value: unknown): value is PluginContracts =>
  isRecord(value) && Object.values(value).every((one) => Array.isArray(one) && one.every((name) => typeof name === 'string'));

/**
 * Why one manifest field is not the shape a client draws, or `undefined`.
 *
 * Shared by the package.json reader and the loader's read of a module's
 * `manifest` export, so the two sources a manifest is read from are held to
 * one rule. `named` says how the field was written where it was found - the
 * file and the key - so the refusal names the thing the author typed.
 */
const checkField = (field: string, value: unknown, named: string): string | undefined => {
  if (value === undefined) return undefined;
  if (field === 'description' && typeof value !== 'string') return `${named} is not a string.`;
  if (field === 'categories' && (!Array.isArray(value) || value.some((one) => typeof one !== 'string'))) {
    return `${named} is not a list of strings.`;
  }
  if (field === 'links' && !isLinks(value)) return `${named} is not a list of links, each with a title and a url.`;
  if (field === 'contracts' && !areContracts(value)) return `${named} is not an object of lists of names.`;
  if (field === 'i18n' && typeof value !== 'string') return `${named} is not a string naming a folder in the package.`;
  if (field === 'icons') {
    // The shape is the SDK's to say, so the two sources a manifest comes from
    // are held to one rule; here it is turned into the one line a reader of the
    // package.json gets.
    try {
      checkIcons(value, named);
    }
    catch {
      return `${named} is not a list of icons, each an object with a string src and an optional contentType, sizes and theme.`;
    }
  }
  return undefined;
};

/**
 * Why a manifest's fields are not the shape a client draws, or `undefined`.
 *
 * `named` builds the label for one field, so a package.json's refusal can name
 * `ahpd.links` and a module's can name `manifest.links`. The fields are
 * optional; one that is present is held to its kind, because a client draws the
 * form from them and a value of the wrong kind would be drawn as nothing.
 */
const checkFields = (inside: Record<string, unknown>, named: (field: string) => string): string | undefined => {
  for (const field of ['description', 'categories', 'links', 'contracts', 'icons', 'i18n']) {
    const wrong = checkField(field, inside[field], named(field));
    if (wrong !== undefined) return wrong;
  }
  return undefined;
};

/**
 * The manifest a package.json declares, when it declares any of the manifest
 * fields, or `undefined`.
 *
 * A package whose `ahpd` holds only an `entry` and a `title` has no manifest a
 * client can draw, which is what makes a module's own export the fallback for
 * a plugin that has both.
 */
const manifestFields = (manifest: Manifest): PluginManifest | undefined => {
  const fields: PluginManifest = {
    // A standalone manifest is the plugin's whole description, so its id, name
    // and version are part of what a client draws. A package's are the
    // package's, and are the row's fields instead.
    ...(manifest.standalone !== true || manifest.name === undefined ? {} : { id: manifest.name }),
    ...(manifest.standalone !== true || manifest.title === undefined ? {} : { name: manifest.title }),
    ...(manifest.standalone !== true || manifest.version === undefined ? {} : { version: manifest.version }),
    ...(manifest.description === undefined ? {} : { description: manifest.description }),
    ...(manifest.categories === undefined ? {} : { categories: manifest.categories }),
    ...(manifest.links === undefined ? {} : { links: manifest.links }),
    ...(manifest.contracts === undefined ? {} : { contracts: manifest.contracts }),
    ...(manifest.icons === undefined ? {} : { icons: manifest.icons }),
    ...(manifest.optionsSchema === undefined ? {} : { optionsSchema: manifest.optionsSchema }),
  };
  return Object.keys(fields).length === 0 ? undefined : fields;
};

/**
 * Whether a manifest is a shape anything can read.
 *
 * The one place names: an `ahpd`
 * that is not an object, an `ahpd.entry` that is not a string or that points
 * outside its own package, one of the manifest fields that is not the
 * kind a client draws, and a `@ahpd/sdk` peer that is not a string. A
 * `package.json` that does not parse is the reader's own `problem` and is
 * returned as it stands.
 */
export const checkManifest = (manifest: Manifest, packageDir: string): string | undefined => {
  if (manifest.problem !== undefined) return manifest.problem;
  if (manifest.ahpd !== undefined && (typeof manifest.ahpd !== 'object' || manifest.ahpd === null || Array.isArray(manifest.ahpd))) {
    return `${manifest.path} has an ahpd key that is not an object.`;
  }
  const inside = manifest.ahpd as Record<string, unknown> | undefined;
  if (inside !== undefined && inside.entry !== undefined && typeof inside.entry !== 'string') {
    return `${manifest.path} has an ahpd.entry that is not a string.`;
  }
  /*
   * The old per-option `ahpd.options` flags are refused rather than ignored,
   * so their author is told where the same thing is written now instead of
   * editing a key nothing reads.
   */
  if (inside !== undefined && inside.options !== undefined) {
    return `${manifest.path} has an ahpd.options entry, which the daemon no longer reads; ${OLDER_RELEASE}, or write the options schema in ahpd.optionsSchema`;
  }
  if (inside !== undefined && inside.optionsSchema !== undefined && !isRecord(inside.optionsSchema)) {
    return `${manifest.path} has an ahpd.optionsSchema that is not an object.`;
  }
  if (inside !== undefined) {
    const wrong = checkFields(inside, (field) => `${manifest.path} has an ahpd.${field} that`);
    if (wrong !== undefined) return wrong;
  }
  if (manifest.entry !== undefined) {
    const at = resolve(packageDir, manifest.entry);
    if (at !== packageDir && !at.startsWith(packageDir + sep)) {
      return `${manifest.path} names an ahpd.entry ${manifest.entry} that points outside the package.`;
    }
  }
  if (manifest.peer !== undefined && typeof manifest.peer !== 'string') {
    return `${manifest.path} has a peerDependencies["@ahpd/sdk"] that is not a string.`;
  }
  return undefined;
};

/**
 * Whether an imported module is a plugin at all.
 *
 * `apply` is a named export and a default export is deliberately not
 * consulted, because a module that exports one thing under `default` cannot
 * say whether it is a plugin, a function or a piece of configuration, and a
 * silent guess is worse than a refusal that names the URL.
 */
export const checkShape = (module: unknown, url: string): string | undefined => {
  if (typeof module !== 'object' || module === null || typeof (module as Record<string, unknown>).apply !== 'function') {
    return `${url} does not export an apply function`;
  }
  return undefined;
};

/** What one plugin is loaded with. */
export interface LoadOneOptions {
  /** The first directory the host serves, which a plugin reads as its `path`. */
  path: string;
  /** Every directory the host serves. */
  paths: string[];
  /** The `@ahpd/sdk` version a peer range is checked against. */
  version: string;
  /**
   * The daemon's own configuration directory, where a plugin keeps a record it
   * has to outlive its process.
   *
   * Required rather than defaulted, because the only thing that knows the
   * folder is the daemon, and a plugin handed one it made up would keep its
   * record somewhere nothing else looks.
   */
  configDir: string;
  /** One line per notable thing, for the daemon's log. */
  log(message: string): void;
  /**
   * One line in what the daemon announces about itself, for a plugin that
   * made the host reachable somewhere the daemon's own lines do not say.
   *
   * Optional here and required on `PluginContext`, because only the daemon has
   * an announcement: a loader running in a test has nothing to add a line to,
   * and the default drops what it is given rather than making every caller
   * invent a sink.
   */
  say?(line: string): void;
  /**
   * Every agent this host knows, read when a plugin asks for one's needs.
   *
   * A function rather than a list because the list grows as plugins load: the
   * plugin that registers an agent may load after the one that makes machines,
   * and a machine is made long after both have applied.
   */
  agents?: () => Agent[];
  /**
   * Whose each stored agent is, read when a plugin asks.
   *
   * Handed through from the host's options, because a plugin that keeps a
   * record naming an agent - a bot's `preset` - asks who may use it.
   */
  agentOwners?: () => ReadonlyMap<string, AgentOwner | undefined>;
  /**
   * What this host is called, for the work a plugin charges to `root:<host>`.
   *
   * Optional here and defaulted on `PluginContext`, because only the daemon
   * knows the machine's hostname, and `root:host` is what the host itself
   * records when nobody named one.
   */
  hostName?: string;
  /**
   * What this daemon is, as one id that is the same across its restarts.
   *
   * Optional here and on `PluginContext`, because only the daemon has a
   * configuration folder to keep it in and a loader in a test has none.
   */
  hostId?: string;
  /**
   * Whether the host verifies people, read from the base's `users` port.
   *
   * A fact about the host rather than about the plugin, and one the loader
   * knows before anything applies: a plugin narrows what it does on a host more
   * than one person uses, where it would ask nothing of a host with one person
   * on it - decision `dev-containers-need-allowed-folders-on-a-host-with-users`.
   */
  users?: boolean;
  /**
   * Where a plugin's usage records go, read when one is written.
   *
   * A function for the reason `agents` is one: the port belongs to the host and
   * is not complete while any one plugin is applying.
   */
  usage?: () => Usage | undefined;
  /**
   * Where a plugin's secrets are, read when one is resolved.
   *
   * A function for the reason `agents` is one: a plugin that registers a vault
   * is listed before the plugins whose options are read against it, and one
   * listed after them has not been folded in yet.
   */
  vault?: () => Vault | undefined;
  /**
   * The hosts that joined this daemon, handed to every plugin as `host.nodes`.
   *
   * A value rather than a function: the registry belongs to the daemon and is
   * one object for its whole life, and a node joining or leaving is an event of
   * its own rather than a port that is folded in after the plugins apply.
   * Absent on a daemon started without a users file, which has no nodes.
   */
  nodes?: NodeRegistry;
  /**
   * The sessions this daemon keeps, read when a plugin asks whether it keeps one.
   *
   * A function for the reason `agents` is one, and it may answer late: a
   * machine records the session it was made for, and a daemon adopting a
   * leftover asks that question while it is applying, before the fold has
   * named the store. So the daemon's own hands over a promise that settles when
   * the fold has run, rather than a value that is `undefined` until then - which
   * would make a slow plugin decide what this daemon adopts.
   */
  sessions?: () => SessionStore | undefined | Promise<SessionStore | undefined>;
  /**
   * Where a plugin's collections are, read when a collection is first used.
   *
   * A function that may answer late, for the reason `sessions` may: a plugin
   * opens a collection while it is applying, before the fold has named the
   * store, and its first call waits for the fold.
   */
  records?: () => RecordStore | undefined | Promise<RecordStore | undefined>;
  /**
   * Which plugin opened each collection, by name, shared by every plugin a
   * loader applies so that no two open the same one.
   */
  collections?: Map<string, string>;
  /**
   * How many times this daemon has imported the plugin again since it started.
   *
   * Above zero the import names a URL of its own, so the runtime hands back the
   * code as it is now rather than the module it already holds.
   */
  reload?: number;
  /**
   * Where an alert this plugin raises goes, while it applies and after.
   *
   * The set keeps it on the plugin's row, and a callback given here outlives the
   * load: a plugin that keeps its host and raises one from a watch is the same
   * call as one raised while `apply` ran.
   */
  alert?: (alert: Alert) => void;
  /** Where `clearAlert` removes one of those alerts, by `ref`. */
  clearAlert?: (ref: string) => void;
  /**
   * Where a view this plugin shows goes, by surface, while it applies and after.
   *
   * Held the same way an alert is, and for the same reason: a plugin that keeps
   * its host draws a new view from a watch long after `apply` returned.
   */
  showView?: (surface: ViewSurface, view: PluginView) => void;
  /** Where `clearView` takes one of those views away, by surface. */
  clearView?: (surface: ViewSurface) => void;
  /**
   * What reaches the network for an `https:` icon, when the host loads one.
   *
   * A parameter rather than the global `fetch` so a test answers without a
   * network, and the same argument `fetch` takes otherwise.
   */
  fetcher?: typeof fetch;
  /**
   * How npm is run for a package a plugin installs, which is plan 64's runner.
   *
   * A parameter rather than the global process so a test fakes npm, and absent
   * is the daemon's own runner.
   */
  run?: Runner;
}

/** What one `loadOne` managed: a plugin, or the reasons it is not one. */
export interface OneResult {
  /** Set when the module imported, applied and contributed. */
  loaded?: Loaded;
  /** What it registered, for the fold. */
  contribution?: Contribution;
  /** Everything that went wrong, in the order it was found. */
  problems: string[];
}

/** Where a resolved spec's module is, once its manifest has been read and held to this SDK. */
interface Located {
  manifest?: Manifest;
  /** The file a load imports, when there is one. */
  target?: string;
  /** The URL a load imports. */
  url: string;
  /** What is worth saying but does not stop the import. */
  problems: string[];
}

/**
 * Whether a resolved spec is a standalone plugin: a spec with a scheme, or a
 * file that sits in no package with an `ahpd` field.
 *
 * The two have no package.json to declare a manifest, which is why their
 * manifest must come from a `plugin.json` or from their own configuration
 * entry, and why one that declares neither is refused rather than loaded under
 * a guessed name.
 */
const standaloneSpec = (resolved: Resolved): boolean =>
  resolved.packageDir === undefined && (resolved.path === undefined || nearestManifest(resolved.path) === undefined);

/** A spec as a message names it, shortened so a `data:` URI does not drown the sentence. */
const shownSpec = (name: string): string => name.length <= 72 ? name : `${name.slice(0, 69)}...`;

/**
 * Why a standalone plugin with no manifest is refused, as the one line a load
 * and a listing both say.
 *
 * A standalone plugin has no package.json to describe it, so its manifest is a
 * `plugin.json` or the config entry itself. With neither, nothing can say what
 * it is before its module runs, and the answer is this refusal rather than a
 * name guessed from its file.
 */
const noManifestProblem = (resolved: Resolved): string =>
  `${shownSpec(sourceOf(resolved.spec))} has no manifest: a standalone plugin writes one in a plugin.json, with an id and a main, or in its config entry, which carries one when it has an id.`;

/**
 * Read and check the manifest of a resolved spec, and find the module a load
 * imports; or the one problem that stops it being imported at all.
 */
function locate(resolved: Resolved, version: string): Located | { refused: string } {
  const problems: string[] = [];
  const said = sourceOf(resolved.spec);
  let manifest: Manifest | undefined;

  /*
   * A `plugin.json` the spec named is a standalone plugin's manifest, and it
   * wins over any package around it: the spec said which file describes it.
   */
  if (resolved.manifestPath !== undefined) {
    manifest = readStandalone(resolved.manifestPath);
    const bad = checkStandalone(manifest);
    if (bad !== undefined) return { refused: bad };
  }

  const manifestDir = resolved.packageDir ?? (resolved.path === undefined ? undefined : nearestManifest(resolved.path));
  if (manifest === undefined && manifestDir !== undefined) {
    manifest = readManifest(manifestDir);
    const bad = checkManifest(manifest, manifestDir);
    if (bad !== undefined) return { refused: bad };
    if (manifest.sdkRange !== undefined) {
      let satisfied = false;
      let why = '';
      try {
        satisfied = satisfies(version, manifest.sdkRange);
      }
      catch (error) {
        // An unreadable range is refused rather than passed, which is the
        // difference between a plugin that must be spelled differently and one
        // that loads unchecked.
        why = ` (${reason(error)})`;
      }
      if (!satisfied) {
        return { refused: `plugin ${manifest.name ?? said} needs @ahpd/sdk ${manifest.sdkRange}, this is ${version}${why}` };
      }
    }
  }

  /*
   * An entry that carries an `id` carries its manifest too, since a plugin with
   * no package has nowhere else to write it. Read last, so a package's own
   * manifest is what a package plugin is described by.
   */
  if (manifest === undefined) {
    manifest = inlineManifestOf(resolved.spec, resolved.path === undefined ? undefined : dirname(resolved.path));
    if (manifest !== undefined) {
      const bad = checkStandalone(manifest);
      if (bad !== undefined) return { refused: bad };
    }
  }

  // A standalone plugin declares its manifest, and one with none is refused
  // before its module is reached.
  if (manifest === undefined && standaloneSpec(resolved)) return { refused: noManifestProblem(resolved) };

  /*
   * Where the module actually is.
   *
   * The manifest wins for resolution only when the caller resolved the
   * *package* rather than a file.
   * A spec that named a file is served as that file even when a manifest
   * walked up from it names a build beside it, because the caller said which
   * file to run and the walk only found the package the file lives in. So the
   * override and the drift it reports belong to `resolved.packageDir`; the
   * walked-up directory above stays in use for reading and checking the
   * manifest.
   */
  let target = resolved.path;
  let url = resolved.url;
  if (resolved.packageDir !== undefined && manifest?.entry !== undefined) {
    target = resolve(resolved.packageDir, manifest.entry);
    if (resolved.path !== undefined && target !== resolved.path) {
      problems.push(`${manifest.path} names ${manifest.entry}, but ${said} resolved to ${resolved.path}`);
    }
    url = pathToFileURL(target).href;
  }
  return { ...(manifest === undefined ? {} : { manifest }), ...(target === undefined ? {} : { target }), url, problems };
}

/**
 * The options schema the manifest of the spec names declares, or nothing when
 * it declares none.
 *
 * Read with no import, so the answer is the same whether the plugin is running
 * or not: a switched-off plugin has a form, and a plugin that would throw on
 * import still answers one. Throws the problem when the spec does not resolve
 * or its manifest is refused, so a caller can say it could not check rather
 * than guess.
 */
export async function optionsSchemaOf(
  spec: PluginSpec,
  options: { configDir: string; cwd: string },
): Promise<Record<string, unknown> | undefined> {
  const found = locate(resolvePlugin(spec, options), sdkVersion());
  if ('refused' in found) throw new Error(found.refused);
  return found.manifest?.optionsSchema;
}

/**
 * The schema one property of an object is held to, by name.
 *
 * `properties` first, then `patternProperties`, then `additionalProperties`, so
 * the loader and the mask find the same node for a key whichever of the three
 * declares it: which option is a `secretAtUse` one, and which is a `writeOnly`
 * or `secret` one, are two questions about one declaration.
 */
export const schemaOf = (schema: Record<string, unknown>, key: string): Record<string, unknown> => {
  const properties = isRecord(schema['properties']) ? schema['properties'] : {};
  if (isRecord(properties[key])) return properties[key] as Record<string, unknown>;
  const patterns = isRecord(schema['patternProperties']) ? schema['patternProperties'] : {};
  for (const [pattern, one] of Object.entries(patterns)) {
    if (new RegExp(pattern, 'u').test(key)) return isRecord(one) ? one : {};
  }
  return isRecord(schema['additionalProperties']) ? schema['additionalProperties'] : {};
};

/**
 * What one value carries, and what it is checked against.
 *
 * The two are one value everywhere except where a schema node says
 * `secretAtUse`: there the plugin is handed what was written, references and all,
 * and the check is run against the names they hold, so an option declared
 * `type: string` still passes without the plugin having to declare a type it
 * never sees.
 */
interface Unwrapped {
  forApply: unknown;
  forCheck: unknown;
  /** Whether any reference was found, which is what makes a vault plugin's own options a refusal. */
  named: boolean;
}

/**
 * What a `secretAtUse` node's references say to the schema check: their names.
 *
 * Nothing is read here, because a node marked `secretAtUse` is one the plugin
 * reads later and itself. Each `{ "$secret": "<name>" }` beneath it becomes the
 * name, so an option declared `type: string` or `items: { type: 'string' }` is
 * checked against something of the shape it declared.
 */
const asNames = (value: unknown): { forCheck: unknown; named: boolean } => {
  const ref = secretRef(value);
  if (ref !== undefined) return { forCheck: ref, named: true };
  if (Array.isArray(value)) {
    const each = value.map(asNames);
    return { forCheck: each.map((one) => one.forCheck), named: each.some((one) => one.named) };
  }
  if (!isRecord(value)) return { forCheck: value, named: false };
  const forCheck: Record<string, unknown> = {};
  let named = false;
  for (const [key, one] of Object.entries(value)) {
    const inner = asNames(one);
    forCheck[key] = inner.forCheck;
    named = named || inner.named;
  }
  return { forCheck, named };
};

/**
 * Every `{ "$secret": "<name>" }` in one value, read and replaced.
 *
 * Nothing owns a plugin's load, so a reference resolved here may only name a
 * `host:` secret: a `team:` or `user:` name is refused by `readSecret` as out of
 * scope, which is the rule settled rather than a second
 * check here.
 */
const resolveSecrets = async (
  schema: Record<string, unknown>,
  value: unknown,
  vault: Vault | undefined,
  path: string,
  label: string,
): Promise<Unwrapped> => {
  const ref = secretRef(value);
  // A node the schema marked is left whole, whatever shape it is: what is under
  // it is the plugin's to read, at the moment it asks rather than at load.
  if (schema['secretAtUse'] === true) {
    const inner = ref === undefined ? asNames(value) : { forCheck: ref, named: true };
    /*
     * A copy, like every other node, even though this one is handed on whole:
     * what is under it is the plugin's own to read, and a plugin that wrote to
     * it would be changing the options this daemon is configured with rather
     * than a value of its own.
     */
    return { forApply: frozenCopy(value), forCheck: inner.forCheck, named: inner.named };
  }
  if (ref !== undefined) {
    if (vault === undefined) throw new Error(`${label}.${path} names ${ref}: ${ref} cannot be read: this host has no vault`);
    let secret: string;
    try {
      secret = await readSecret(vault, ref, {});
    }
    catch (error) {
      throw new Error(`${label}.${path} names ${ref}: ${reason(error)}`);
    }
    // What is checked is what the plugin is given, so a value the schema
    // refuses is refused here rather than reaching `apply`.
    return { forApply: secret, forCheck: secret, named: true };
  }
  const items = isRecord(schema['items']) ? schema['items'] : {};
  if (Array.isArray(value)) {
    const each = await Promise.all(value.map(async (one, at) =>
      resolveSecrets(items, one, vault, `${path}[${String(at)}]`, label)));
    return {
      forApply: each.map((one) => one.forApply),
      forCheck: each.map((one) => one.forCheck),
      named: each.some((one) => one.named),
    };
  }
  if (!isRecord(value)) return { forApply: value, forCheck: value, named: false };
  const forApply: Record<string, unknown> = {};
  const forCheck: Record<string, unknown> = {};
  let named = false;
  for (const [key, one] of Object.entries(value)) {
    const resolved = await resolveSecrets(schemaOf(schema, key), one, vault, path === '' ? key : `${path}.${key}`, label);
    forApply[key] = resolved.forApply;
    forCheck[key] = resolved.forCheck;
    named = named || resolved.named;
  }
  return { forApply, forCheck, named };
};

/** A plugin imported and named, or the one problem that kept it from being imported. */
export type Named = { refused: string } | {
  found: Located;
  /** The id: the module's `name` export, or what it was called before the import. */
  id: string;
  /** What it was called before the import. */
  provisional: string;
  /** The module, when it imported. */
  module?: unknown;
  /** Why the import failed, when it did. */
  failed?: string;
  /** How long the import took, in milliseconds. */
  took: number;
};

/**
 * Import one plugin and read its id, without calling `apply`.
 *
 * The manifest is read and the range checked first, as for a load, so a
 * plugin this SDK refuses is never imported.
 *
 * `reload` is how many times this daemon has imported the plugin again since it
 * started. Above zero the import names a URL of its own, `<url>?reload=<count>`,
 * because a second `import()` of one URL answers the module the runtime already
 * holds. The old module stays in memory until the daemon restarts: the runtime
 * never lets go of an imported URL, which is the price of loading new code with
 * no restart - and the docs say so.
 *
 * The parameter is not `v`: a test runner that sits on Vite reads `?v=` as its
 * own cache hash for an optimised dependency and drops it, which would hand
 * back the module it already had. Any other word is a URL of its own to both.
 */
export async function namePlugin(resolved: Resolved, version: string, reload = 0): Promise<Named> {
  const found = locate(resolved, version);
  if ('refused' in found) return found;
  const provisional = provisionalOf(resolved.spec, found);
  const started = Date.now();
  const at = reload === 0 ? found.url : `${found.url}${found.url.includes('?') ? '&' : '?'}reload=${String(reload)}`;
  try {
    const module: unknown = await import(at);
    const declared = typeof module === 'object' && module !== null ? (module as Record<string, unknown>).name : undefined;
    /*
     * A standalone plugin's id is the one its manifest declares, so its module
     * cannot rename it: a `name` export that differs is refused at load, and
     * answering it here would make the listing and the load disagree.
     */
    const id = found.manifest?.standalone === true
      ? provisional
      : typeof declared === 'string' && declared.trim() !== '' ? declared : provisional;
    return { found, id, provisional, module, took: Date.now() - started };
  }
  catch (error) {
    return { found, id: provisional, provisional, failed: reason(error), took: Date.now() - started };
  }
}

/**
 * Import and name every spec, enabled or not, and remember each id for
 * `pluginIdOf`. A disabled plugin is imported too, because its id is the name
 * its module exports and the id is what a configuration entry is keyed by, so
 * the name cannot be read from the file. For a command that runs without a
 * daemon: a daemon names its plugins as it loads them.
 */
export async function pluginIdsOf(specs: readonly PluginSpec[], where: { configDir: string; cwd: string }): Promise<void> {
  for (const spec of specs) {
    let resolved: Resolved;
    try {
      resolved = resolvePlugin(spec, where);
    }
    catch {
      // A spec that does not resolve keeps the name it was written as.
      continue;
    }
    const named = await namePlugin(resolved, sdkVersion());
    if (!('refused' in named)) ids.set(sourceOf(spec), named.id);
  }
}

/**
 * Resolve, validate, import and apply one plugin.
 *
 * The order is the point: the manifest is read and the range checked before
 * `import()` is reached, so an incompatible or malformed plugin is never
 * executed. Everything after that - the import, the shape of the module, its
 * options held to the `optionsSchema` its manifest declares, and `apply`
 * itself - is caught and turned into a problem line, because a plugin that
 * throws must cost a line in the log rather than the daemon.
 */
export async function loadOne(resolved: Resolved, options: LoadOneOptions, imported?: Named): Promise<OneResult> {
  const spec = resolved.spec;
  const said = sourceOf(spec);
  const ready = imported ?? await namePlugin(resolved, options.version, options.reload ?? 0);
  if ('refused' in ready) return { problems: [ready.refused] };
  const { manifest, target, url } = ready.found;
  const problems = [...ready.found.problems];
  // What a relative icon is resolved against: the package, or the folder of a
  // single-file plugin, which is what it has in place of one. A spec that names
  // a file inside a package still resolves against that package, as its
  // manifest's own icons do.
  const base = resolved.packageDir ?? (target === undefined ? undefined : (nearestManifest(target) ?? dirname(target)));
  // Where a package this plugin installs is kept: `installed/` inside its own
  // folder. A plugin with no folder has nowhere to install and nothing to tell
  // the child about.
  const installed = base === undefined ? undefined : join(base, 'installed');
  const npm = options.run ?? runProgram;
  // A manifest icon that could not be read was dropped and said, and the load
  // says the same line beside its own.
  if (manifest?.iconProblems !== undefined) problems.push(...manifest.iconProblems);
  if (manifest?.i18nProblems !== undefined) problems.push(...manifest.i18nProblems);

  const provisional = ready.provisional;
  options.log(`plugin ${provisional} loading`);
  // When the start line was logged, less the import already behind it.
  const started = Date.now() - ready.took;
  // How long since the start line, as the ` in <n> ms` a later line carries.
  const took = (): string => ` in ${Date.now() - started} ms`;
  if (ready.failed !== undefined) {
    return { problems: [...problems, `plugin ${provisional} could not be imported from ${target ?? url}${took()}: ${ready.failed}`] };
  }
  const module = ready.module;

  const wrong = checkShape(module, target ?? url);
  if (wrong !== undefined) return { problems: [...problems, wrong] };

  const held = module as Record<string, unknown>;
  // The module wins for shape; a standalone plugin's id is the one its
  // manifest declares, and the spec is the last resort.
  const name = ready.id;
  /*
   * A standalone plugin's id is declared rather than exported, so a module that
   * names itself something else would be listed under one id and keyed by
   * another. Both names are in the line, because the author wrote both.
   */
  if (manifest?.standalone === true && typeof held.name === 'string' && held.name !== manifest.name) {
    return { problems: [...problems, `plugin ${name} skipped: ${target ?? url} exports the name ${held.name}, but its manifest declares the id ${name}; a standalone plugin's id is its manifest's id`] };
  }
  // An id is a slug, whether the module exports it or it is the fallback.
  if (!isRecordSlug(name)) {
    return { problems: [...problems, `plugin ${ready.id} skipped: its name is not a slug: ${RECORD_SLUG}`] };
  }
  const apply = held.apply as Plugin['apply'];
  /*
   * The manifest a client draws is the declared one: a package.json's fields,
   * or a standalone plugin's `plugin.json` or entry. A module that still
   * exports one is refused rather than ignored, so its author is told where the
   * manifest moved instead of editing a field nothing reads.
   */
  let declared = manifest === undefined ? undefined : manifestFields(manifest);
  if (held.manifest !== undefined) {
    return { problems: [...problems, `plugin ${name} skipped: ${target ?? url} exports a manifest, which the daemon no longer reads; ${OLDER_RELEASE}, or write it in the ahpd field of package.json, or in a plugin.json for a standalone plugin`] };
  }
  const title = typeof held.title === 'string' ? held.title : manifest?.title;
  const defaults = typeof held.defaults === 'object' && held.defaults !== null && !Array.isArray(held.defaults)
    ? held.defaults as Record<string, unknown>
    : undefined;
  const named = typeof spec === 'object' && spec !== null ? spec.options : undefined;
  const written: Record<string, unknown> = { ...(defaults ?? {}), ...(named ?? {}) };
  const optionsSchema = manifest?.optionsSchema;
  /*
   * The schema is a manifest field now, so a module that still exports one is
   * refused rather than ignored: its author is told where it moved instead of
   * editing an export nothing reads.
   */
  if (held.optionsSchema !== undefined) {
    return { problems: [...problems, `plugin ${name} skipped: ${target ?? url} exports an optionsSchema, which the daemon no longer reads; ${OLDER_RELEASE}, or write it in ahpd.optionsSchema of package.json, or as optionsSchema in a plugin.json for a standalone plugin`] };
  }
  /*
   * Every `{ "$secret": "<name>" }` in the options is read here, before the
   * schema is asked whether the values are of the declared types: a secret is a
   * string once read and an object while written, so the two orders cannot both
   * be right and this is the one that lets an option declared `type: string` be
   * written as a reference.
   */
  const label = `plugins.${name}.options`;
  let unwrapped: Unwrapped;
  try {
    unwrapped = await resolveSecrets(optionsSchema ?? {}, written, options.vault?.(), '', label);
  }
  catch (error) {
    return { problems: [...problems, `plugin ${name} skipped: ${reason(error)}`] };
  }
  const values = unwrapped.forApply as Record<string, unknown>;
  if (optionsSchema !== undefined) {
    try {
      check(unwrapped.forCheck, optionsSchema as JsonSchema, label);
    }
    catch (error) {
      return { problems: [...problems, `plugin ${name} skipped: ${reason(error)}`] };
    }
    const known = isRecord(optionsSchema.properties) ? optionsSchema.properties : {};
    for (const key of Object.keys(named ?? {})) {
      if (!Object.hasOwn(known, key)) problems.push(`plugin ${name}: ${label}.${key} is not an option ${name} knows; passed through`);
    }
  }
  /*
   * What this plugin's own connection may do, as its entry wrote it.
   *
   * One grant of the wrong shape is dropped rather than the plugin refused: it
   * is one line of a list, and the rest of the list is what the person meant -
   * the same reading a role written through the people provider gets. The line
   * naming it is this loader's rather than the plugin's, because the entry it
   * was read from is the loader's: a plugin never sees what it was configured
   * with.
   *
   * `asSpec` has already refused an entry whose `grants` is not a list of
   * strings, so the guard below is for the spec this loader was handed rather
   * than for the file: a string read as a list would report one line per
   * character.
   */
  const listed = typeof spec === 'object' && spec !== null ? spec.grants : undefined;
  const grants: Grant[] = [];
  for (const one of Array.isArray(listed) ? listed : []) {
    const why = grantProblem(one);
    if (why === undefined) grants.push(one as Grant);
    else problems.push(`plugin ${name}: plugins.${name}.grants: ${why}`);
  }
  const plugin: Plugin = {
    name,
    apply,
    ...(title === undefined ? {} : { title }),
    ...(defaults === undefined ? {} : { defaults }),
  };

  /*
   * What this plugin is told about the host, frozen, and every plugin gets its
   * own.
   *
   * The listing of directories is the daemon's own array, shared by every
   * plugin and by the status line, so each plugin is handed a frozen copy of it
   * rather than the daemon's: a plugin that pushed to it would be adding a
   * directory the daemon does not serve, to a line that says which ones it
   * does. The object is frozen too, so the rest of the context cannot be
   * rewritten under the plugin that was handed it.
   */
  const context: PluginContext = Object.freeze({
    path: options.path,
    paths: frozenCopy(options.paths),
    version: options.version,
    hostName: options.hostName ?? 'host',
    configDir: options.configDir,
    ...(options.users === true ? { hasUsers: true } : {}),
    ...(options.hostId === undefined ? {} : { hostId: options.hostId }),
    log: options.log,
    say: options.say ?? (() => {}),
    // The host's own YAML subset, so a plugin needs no YAML dependency of its own.
    parseYaml: (text: string) => parseYaml(text),
    stringifyYaml,
  });

  const { host, contribution, seal } = pluginHost(name, context, {
    ...(options.agents === undefined ? {} : { agents: options.agents }),
    ...(options.agentOwners === undefined ? {} : { agentOwners: options.agentOwners }),
    ...(options.usage === undefined ? {} : { usage: options.usage }),
    ...(options.vault === undefined ? {} : { vault: options.vault }),
    ...(options.nodes === undefined ? {} : { nodes: options.nodes }),
    ...(options.alert === undefined ? {} : { alert: options.alert }),
    ...(options.clearAlert === undefined ? {} : { clearAlert: options.clearAlert }),
    ...(options.showView === undefined ? {} : { showView: options.showView }),
    ...(options.clearView === undefined ? {} : { clearView: options.clearView }),
    ...(grants.length === 0 ? {} : { grants }),
    ...(declared?.contracts === undefined ? {} : { contracts: declared.contracts }),
    ...(manifest?.i18n === undefined ? {} : { i18n: manifest.i18n }),
    ...(options.sessions === undefined ? {} : { sessions: options.sessions }),
    ...(options.records === undefined ? {} : { records: options.records }),
    ...(options.collections === undefined ? {} : { collections: options.collections }),
    // A plugin with a folder of its own can install a package into it; one
    // without answers an error from the sdk's own default.
    ...(installed === undefined ? {} : { installed }),
    ...(installed === undefined ? {} : { install: (spec: string) => installInto(name, installed, spec, npm) }),
    // As configuration wrote it, which is what a host inside a machine loads.
    spec: said,
  });
  /*
   * What the plugin itself dropped on the way, said through `problem`.
   *
   * A line the plugin said is a line this loader tells on its behalf, so the
   * person who started the daemon reads it beside the ones the loader found.
   * The same line is a `warning` alert on the plugin's row, because the host
   * raises one for every `problem` it is given; the set knows it has arrived
   * twice and keeps it once.
   *
   * This list is read exactly once, by the answer returned below. A line said
   * after that is a line nothing would read again, so past `answered` it is
   * written to the log instead: the plugin's row is where it now shows.
   *
   * The host `apply` is handed is a frozen copy with this one method replaced.
   * Every other method is the same function, and the seal taken below is the
   * `pluginHost` one, which does not move with the copy.
   */
  const told: string[] = [];
  let answered = false;
  const saying: PluginHost = Object.freeze({
    ...host,
    problem: (line: string) => {
      if (answered) options.log(line);
      else told.push(line);
      host.problem(line);
    },
  });
  try {
    await apply.call(plugin, saying, values);
  }
  catch (error) {
    // One failure path: whatever the registration check or the plugin itself
    // threw, the whole contribution is discarded and the plugin costs a line.
    answered = true;
    return { problems: [...problems, ...told, `plugin ${name} failed${took()}: ${reason(error)}`] };
  }
  /*
   * Registration is over: the fold takes the host's own copies of what this
   * plugin contributed and reads those from here on, so a `register*` it makes
   * after returning would land somewhere nothing reads again. Refused instead,
   * in the plugin's own name.
   */
  seal();
  /*
   * An icon that names an `https:` URL is fetched here, at load, and sent on as
   * a `data:` URI: a client draws an icon and never contacts the server a
   * plugin names. A fetch that fails, answers something too large or something
   * that is not an image costs the icon and one line, as a bad file does.
   */
  if (declared?.icons !== undefined && declared.icons.length > 0) {
    declared = { ...declared, icons: await fetchIcons(declared.icons, `plugin ${name}`, (line) => problems.push(line), options.fetcher) };
  }
  /*
   * An adapter's icon is relative to the package of the plugin that registered
   * it, not to the daemon's working folder, so it is read here where that
   * package is known rather than where the channel reads the adapters.
   */
  for (const adapter of Object.values(contribution.adapters)) {
    if (adapter.icons === undefined) continue;
    const read = resolveIcons(adapter.icons, base, `plugin ${name}`, (line) => problems.push(line));
    const icons = await fetchIcons(read, `plugin ${name}`, (line) => problems.push(line), options.fetcher);
    if (icons.length === 0) delete adapter.icons;
    else adapter.icons = icons;
  }
  /*
   * An engine's template icon is read the same way, and resolved into `icons`:
   * a template names its mark once, and a client reads the `data:` form the
   * host sends rather than the `mark:` or path the plugin wrote.
   */
  for (const engine of Object.values(contribution.engines ?? {})) {
    for (const template of engine.templates ?? []) {
      if (template.icon === undefined) continue;
      const read = resolveIcons([template.icon], base, `plugin ${name}`, (line) => problems.push(line));
      const icons = await fetchIcons(read, `plugin ${name}`, (line) => problems.push(line), options.fetcher);
      if (icons.length > 0) template.icons = icons;
    }
  }
  /*
   * A vault that read a secret out of its own options is a vault that decided
   * where its own secrets come from, which is the one thing it cannot be asked
   * to answer: it would be reading the store it is, or the one it took over.
   */
  if (unwrapped.named && contribution.ports.vault !== undefined) {
    answered = true;
    return { problems: [...problems, ...told, `plugin ${name} skipped: a vault plugin's own options cannot name a secret`] };
  }

  // The absolute path is logged, so what ran is in the log even when a spec
  // was relative or a bare name resolved somewhere nobody expected.
  options.log(`plugin ${name} from ${target ?? url}${took()}`);
  const loaded: Loaded = {
    spec,
    url,
    path: target ?? url,
    name,
    options: values,
    plugin,
    ...(title === undefined ? {} : { title }),
    ...(declared === undefined ? {} : { manifest: declared }),
    ...(manifest?.i18n === undefined ? {} : { i18n: manifest.i18n }),
  };
  answered = true;
  return { loaded, contribution, problems: [...problems, ...told] };
}

/*
 * What each plugin that loaded declares its options are, kept for the root
 * config port.
 *
 * The only other copy of one is inside a module that has just been imported, and
 * importing it again to ask would run a plugin's code a second time. Keyed by
 * the plugin's id, which is the name the key a client edits is spelled with. A plugin that did not load has no entry here, which is what
 * leaves its options free rather than wrongly bounded.
 */
const schemas = new Map<string, Record<string, unknown>>();

/**
 * The options schema of a plugin this daemon loaded, by its id, or `undefined`
 * for one that did not load.
 */
export const optionsSchemaLoaded = (name: string): Record<string, unknown> | undefined => schemas.get(name);

/** What `loadPlugins` is given besides the specs. */
export interface LoadOptions {
  /** The options the daemon already built, which every contribution folds into. */
  base: HostOptions;
  /** The directory a bare spec resolves from, and where `npm i` is the install. */
  configDir: string;
  /** The directory a relative path is tried against first. */
  cwd: string;
  /** One line per notable thing. */
  log(message: string): void;
  /** One line in the daemon's announcement; dropped when the caller has none. */
  say?(line: string): void;
  /** Every directory the host serves; defaults to the base's one. */
  paths?: string[];
  /** The SDK version a peer range is checked against; defaults to this one. */
  version?: string;
  /**
   * What this daemon is, as one id that is the same across its restarts.
   *
   * `config.hostId()`, read once here and handed to every plugin. Absent where
   * the caller keeps no id, which is a loader in a test: a plugin then labels
   * nothing with a daemon and matches every daemon that also labels nothing.
   */
  hostId?: string;
  /**
   * The set to load into, when the caller keeps one to change later.
   *
   * A daemon keeps the set it started with, so a plugin enabled while it runs
   * loads into the same agent list and the same vault the first load used. A
   * caller with nothing to change afterwards leaves this out and gets a set of
   * its own.
   */
  set?: PluginSet;
  /**
   * One or more alerts changed after a load answered.
   *
   * A plugin that keeps its host may raise or clear one long after `apply`
   * returned, and a client reading the plugin rows has to be sent them again.
   * The load itself needs no call: the caller refreshes the rows once it has the
   * answer.
   */
  alertsChanged?(): void;
  /**
   * One or more views changed after a load answered.
   *
   * A plugin that keeps its host may show or clear a view long after `apply`
   * returned, and a client reading the plugin rows has to be sent them again.
   * The load itself needs no call: the caller refreshes the rows once it has the
   * answer.
   */
  viewsChanged?(): void;
  /** What reaches the network for an `https:` icon; the global `fetch` otherwise. */
  fetcher?: typeof fetch;
  /** How npm is run for a package a plugin installs; the daemon's own runner otherwise. */
  run?: Runner;
}

/** One host's worth of options, and what happened on the way to them. */
export interface LoadedPlugins {
  /** The base with every accepted contribution folded in. */
  options: HostOptions;
  /** What each plugin that applied contributed, in load order. */
  contributions: Contribution[];
  /** Everything that went wrong, the fold's collisions included. */
  problems: string[];
  /** The plugins that loaded and applied, in load order. */
  loaded: Loaded[];
  /**
   * The alerts each plugin's row carries, by id.
   *
   * Every line a plugin or its loader said about it is here, as an `error` for
   * the line that says it did not load and a `warning` for the rest, so a client
   * reads the row without searching the daemon's log. A plugin with no alerts
   * has no entry.
   */
  alerts: Record<string, Alert[]>;
  /**
   * Every plugin's route, by plugin name, for the listener to serve.
   *
   * Answered beside the options rather than among them: a route is not
   * something `createHost` is built over but a handler the daemon's own
   * listener mounts, under `/plugins/<name>/`.
   */
  routes: Record<string, Route>;
}

/** One spec resolved and named, before it is applied. */
export interface Planned {
  /** The spec as the configuration named it. */
  spec: PluginSpec;
  /** The id the module and the manifest agree on, or the spec as written. */
  id: string;
  /** Where the module is, when the spec resolved. */
  resolved?: Resolved;
  /** The module and its id, when it was imported. */
  named?: Named;
  /** Why it never became a plugin, when it did not resolve. */
  unresolved?: string;
  /** Whether the entry itself says it is switched off. */
  disabled: boolean;
}

/** One plugin this daemon holds, as a later change reads it. */
export interface HeldPlugin {
  /** The plugin that loaded, as a listing shows it. */
  loaded: Loaded;
  /** What it registered, for the fold. */
  contribution: Contribution;
}

/** What one plugin's load produced. */
export interface StagedPlugin {
  /** The id it is held under. */
  id: string;
  /** Set when the module imported, applied and contributed. */
  loaded?: Loaded;
  /** What it registered, for the fold. */
  contribution?: Contribution;
  /** Everything that went wrong, in the order it was found. */
  problems: string[];
}

/** One plugin held, with what a reload of it needs. */
interface Kept extends HeldPlugin {
  /** The spec as resolved when it loaded, which a reload imports again. */
  resolved: Resolved;
  /** The module and its id, before `apply` ran. */
  named: Named;
}

/**
 * The plugins one daemon holds, and the operations that change them.
 *
 * One set lives as long as the host does: the agent list a plugin asks about,
 * the vault its options resolve against and the collection each plugin opened
 * are all facts about the plugins loaded together, so a plugin loaded later
 * joins the same set rather than a second one built beside it. `loadPlugins`
 * builds a set of its own for a caller with nothing to change afterwards; a
 * daemon that changes plugins while it runs keeps the one it started with.
 */
export interface PluginSet {
  /**
   * Resolve and name every spec, in the order it was configured.
   *
   * Every entry is imported and named before any applies, a switched-off one
   * too, so that each one's id is known: root config keys an entry by it,
   * enabled or not. An id that repeats is one plugin configured twice, which
   * is a problem naming it, and only the first entry is answered.
   */
  plan(specs: PluginSpec[]): Promise<{ entries: Planned[]; problems: string[] }>;
  /** Import and apply one planned plugin, and hold what it contributed. */
  load(entry: Planned): Promise<StagedPlugin>;
  /**
   * Import one plugin again from a URL of its own, so new code runs.
   *
   * Follows an unload of the same id: the caller closes the plugin first, and
   * this imports the code as it is now and applies it with the entry's options.
   * The module the daemon held before stays in memory, because the runtime
   * never drops an imported URL, so each reload keeps one copy until a restart.
   */
  reload(entry: Planned): Promise<StagedPlugin>;
  /**
   * Close one plugin and forget it.
   *
   * Its connections are closed, its closers run in registration order, and its
   * contribution stops being folded in. One problem per closer that threw, and
   * nothing else: a plugin that cannot close still costs only itself.
   */
  unload(id: string): Promise<string[]>;
  /** One plugin this set holds, by its id. */
  held(id: string): HeldPlugin | undefined;
  /** Every plugin that loaded, in load order. */
  loaded(): Loaded[];
  /** Every contribution, in load order. */
  contributions(): Contribution[];
  /** The alerts each plugin's row carries, by id; a plugin with none has no entry. */
  alerts(): Record<string, Alert[]>;
  /**
   * The views each plugin's row carries, by id and then by surface.
   *
   * A plugin with no view has no entry, and a surface holds one view.
   */
  views(): Record<string, Record<string, PluginView>>;
  /**
   * Fold the base with every contribution, and the agents made from records.
   *
   * `records` is what the agents channel opened from its stored records. It is
   * passed on every fold rather than kept, because a record made or removed
   * while the daemon runs is a new list.
   */
  fold(records?: Agent[]): FoldedOptions;
  /**
   * Answer what a plugin waiting on `sessions()` or `records()` reads.
   *
   * Called once the fold has run, which is the only moment the daemon knows
   * which store the host was built over.
   */
  settle(host: HostOptions): void;
}

/**
 * A set of plugins, loaded against one base and changed independently after.
 *
 * The base is read and never written: every fold is a new object built from
 * the same base's property descriptors, so a live value such as `mcpServers`
 * stays live in each one.
 */
export const pluginSet = (options: LoadOptions): PluginSet => {
  const paths = options.paths ?? [options.base.path];
  const version = options.version ?? sdkVersion();
  const where = { configDir: options.configDir, cwd: options.cwd };
  const kept = new Map<string, Kept>();
  /**
   * What each plugin's row says, by id, in the order the alerts arrived.
   *
   * The oldest goes first once a plugin holds `MAX_ALERTS`, so a plugin that
   * alerts in a loop cannot grow its row.
   */
  const alerted = new Map<string, Alert[]>();
  /**
   * The views each plugin's row carries, by id and then by surface.
   *
   * A plugin sends a whole view for a surface, and a new one replaces the one
   * before it on that surface. A clear removes that surface, and the plugin's
   * entry once it holds no surface.
   */
  const viewed = new Map<string, Record<string, PluginView>>();
  /**
   * The plugins whose load has answered, by id.
   *
   * An alert raised while one of these is not here is part of a load the caller
   * is about to read: the caller refreshes its rows once it has the answer. One
   * raised for an id that is here comes out of a plugin that kept its host, and
   * is said with `alertsChanged` so a client reads the row again now.
   */
  const answered = new Set<string>();
  /**
   * The load each plugin's alerts are taken from, by id.
   *
   * A host outlives its plugin when a closer leaves a watch running, and what
   * that host says is not about the plugin now on the row. Each load is its own
   * token, and an alert from a token that is not here is dropped.
   */
  const current = new Map<string, object>();
  /**
   * Raise one alert on a plugin's row.
   *
   * An alert with the `ref` of one already there replaces it, and the newest is
   * at the end: the replacement is the current thing rather than the old one.
   */
  const addAlert = (id: string, alert: Alert): void => {
    const list = alerted.get(id) ?? [];
    const at = alert.ref === undefined ? -1 : list.findIndex((one) => one.ref === alert.ref);
    if (at !== -1) list.splice(at, 1);
    list.push(alert);
    if (list.length > MAX_ALERTS) list.splice(0, list.length - MAX_ALERTS);
    alerted.set(id, list);
    if (answered.has(id)) options.alertsChanged?.();
  };
  /** Take one alert away by its `ref`, and say so when the load has answered. */
  const dropAlert = (id: string, ref: string): void => {
    const list = alerted.get(id);
    if (list === undefined) return;
    const at = list.findIndex((one) => one.ref === ref);
    if (at === -1) return;
    list.splice(at, 1);
    if (list.length === 0) alerted.delete(id);
    if (answered.has(id)) options.alertsChanged?.();
  };
  /** Show one view on a plugin's row, replacing what the surface had. */
  const setView = (id: string, surface: ViewSurface, view: PluginView): void => {
    viewed.set(id, { ...(viewed.get(id) ?? {}), [surface]: view });
    if (answered.has(id)) options.viewsChanged?.();
  };
  /** Remove one surface's view, and say so when the load has answered. */
  const dropView = (id: string, surface: ViewSurface): void => {
    const held = viewed.get(id);
    if (held === undefined || !Object.hasOwn(held, surface)) return;
    const rest = { ...held };
    delete rest[surface];
    if (Object.keys(rest).length === 0) viewed.delete(id);
    else viewed.set(id, rest);
    if (answered.has(id)) options.viewsChanged?.();
  };
  /** How many times each plugin has been imported again, by id. */
  const counts = new Map<string, number>();
  /**
   * Every agent this host has, filled as plugins load and emptied as they go.
   *
   * The machine-making plugin asks this at create time rather than at load, so
   * the list may be incomplete while any one plugin applies - a plugin that
   * registers an agent is allowed to load after one that makes machines.
   */
  const known: Agent[] = [...options.base.agents];
  /**
   * The agents the stored records opened, as the last fold served them.
   *
   * A record is an agent like any other to a plugin asking what a provider
   * needs, and a plugin asks through this list because the host it ends up in
   * does not exist while it applies. The fold answers which records it took, so
   * one whose id a plugin already serves is not answered for here either.
   */
  let served: Agent[] = [];

  /*
   * The host this set ends up folded into, which a usage record is written to.
   *
   * Assigned once the fold has run and read at write time rather than now,
   * because the fold may have replaced the daemon's store with a plugin's, and
   * a recorder still holding the daemon's own would write where nobody reads.
   *
   * A plugin asking about the sessions waits on `hosted` instead, because it
   * asks while the later plugins are still applying: a computer plugin adopts
   * its leftovers at startup, and answering "this daemon keeps nothing" until
   * the fold has run would make the order plugins load in decide which
   * leftovers it owns.
   */
  let reached: HostOptions | undefined;
  let settled: (host: HostOptions) => void = () => {};
  const hosted = new Promise<HostOptions>((resolve) => { settled = resolve; });

  /*
   * The vault a load resolves against: the daemon's own, unless a plugin in
   * this set has taken the port over.
   *
   * Read from the contributions rather than from the fold, because the fold has
   * not run yet and a plugin that registered a vault is meant to be serving the
   * plugins that come after it. `owner` is the fold's own rule, seeded from the
   * base: a port is set once, and a second plugin that did not ask to take it
   * over is told rather than served from its own store.
   */
  let standing: Vault | undefined;
  let owner: string | undefined = options.base.vault === undefined ? undefined : 'the daemon';
  const vaultInForce = (): Vault | undefined => standing ?? options.base.vault;

  // Which plugin opened each collection, one map for every plugin in this set.
  const collections = new Map<string, string>();

  const plan = async (specs: PluginSpec[]): Promise<{ entries: Planned[]; problems: string[] }> => {
    const found: Planned[] = [];
    for (const spec of specs) {
      const disabled = typeof spec !== 'string' && spec.enabled === false;
      let resolved: Resolved;
      try {
        resolved = resolvePlugin(spec, where);
      }
      catch (error) {
        found.push({ spec, id: sourceOf(spec), unresolved: reason(error), disabled });
        continue;
      }
      const named = await namePlugin(resolved, version);
      const id = 'refused' in named ? sourceOf(spec) : named.id;
      ids.set(sourceOf(spec), id);
      found.push({ spec, id, resolved, named, disabled });
    }

    /*
     * An id that repeats is one plugin configured twice, which refuses: a plugin
     * is loaded once and its options are what make its variants, so the second
     * and later entries of an id are problems naming it. A switched-off entry
     * still counts, since root config would key it the same.
     */
    const specsOf = new Map<string, string[]>();
    for (const { spec, id } of found) specsOf.set(id, [...(specsOf.get(id) ?? []), sourceOf(spec)]);
    const problems: string[] = [];
    const taken = new Set<string>();
    const entries: Planned[] = [];
    for (const entry of found) {
      if (taken.has(entry.id)) {
        const all = specsOf.get(entry.id) ?? [];
        problems.push(`plugin ${entry.id} is named ${String(all.length)} times, by ${all.join(' and ')}; write it once and use its options for variants`);
        continue;
      }
      taken.add(entry.id);
      entries.push(entry);
    }
    return { entries, problems };
  };

  const load = async (entry: Planned): Promise<StagedPlugin> => {
    const { spec, id, resolved, named, unresolved } = entry;
    // A load starts a clean row: a reload replaces what the last one said.
    alerted.delete(id);
    viewed.delete(id);
    answered.delete(id);
    if (resolved === undefined || named === undefined) {
      const line = unresolved ?? `plugin ${id} did not resolve`;
      addAlert(id, { level: 'error', text: line });
      answered.add(id);
      return { id, problems: [line] };
    }
    /*
     * The texts the plugin raised while it applied.
     *
     * A line the plugin said itself is in `problems` too, because the loader
     * tells it on the plugin's behalf for the log and for `ahpd start`, so it
     * is on the row once rather than twice.
     */
    const raised: string[] = [];
    const self = {};
    current.set(id, self);
    const one = await loadOne(resolved, {
      path: options.base.path,
      paths,
      version,
      configDir: options.configDir,
      log: options.log,
      ...(options.say === undefined ? {} : { say: options.say }),
      agents: () => [...known, ...served],
      ...(options.base.agentOwners === undefined ? {} : { agentOwners: options.base.agentOwners }),
      ...(options.base.hostName === undefined ? {} : { hostName: options.base.hostName }),
      ...(options.hostId === undefined ? {} : { hostId: options.hostId }),
      ...(options.base.users === undefined ? {} : { users: true }),
      usage: () => reached?.usage,
      vault: vaultInForce,
      ...(options.base.nodes === undefined ? {} : { nodes: options.base.nodes }),
      sessions: () => hosted.then((host) => host.sessions),
      records: () => hosted.then((host) => host.records),
      collections,
      reload: counts.get(id) ?? 0,
      // The plugin's own alerts, while it applies and after: the sink outlives
      // this call, so a plugin that kept its host still reaches its own row.
      alert: (alert) => {
        if (current.get(id) !== self) return;
        if (!answered.has(id)) raised.push(alert.text);
        addAlert(id, alert);
      },
      clearAlert: (ref) => { if (current.get(id) === self) dropAlert(id, ref); },
      // The plugin's own view, held the same way an alert is: a host that
      // outlives its plugin is not the one on the row, and loses its say.
      showView: (surface, view) => { if (current.get(id) === self) setView(id, surface, view); },
      clearView: (surface) => { if (current.get(id) === self) dropView(id, surface); },
      ...(options.fetcher === undefined ? {} : { fetcher: options.fetcher }),
      ...(options.run === undefined ? {} : { run: options.run }),
    }, (counts.get(id) ?? 0) > 0 ? undefined : named);
    /*
     * The lines this load found, on the row as well as in the answer: the last
     * one when the plugin did not load says why, and every other line is what
     * the loader or the plugin went without.
     */
    const refused = one.loaded === undefined || one.contribution === undefined;
    /*
     * The manifest's options form is one a client draws, and a hole in it is
     * named like any other: one problem line for each gap, and the plugin
     * still loads. Checked here rather than where the schema is kept, so the
     * line reaches the row with the rest of this load's problems.
     */
    const optionsSchema = one.loaded?.manifest?.optionsSchema;
    if (optionsSchema !== undefined) {
      for (const gap of schemaGaps(optionsSchema)) one.problems.push(gapLine(id, 'options', gap));
    }
    for (const [at, line] of one.problems.entries()) {
      if (raised.includes(line)) continue;
      addAlert(id, { level: refused && at === one.problems.length - 1 ? 'error' : 'warning', text: line });
    }
    answered.add(id);
    if (one.loaded === undefined || one.contribution === undefined) return { id, problems: one.problems };
    kept.set(id, { loaded: one.loaded, contribution: one.contribution, resolved, named });
    known.push(...one.contribution.agents);
    // A copy: the schema answers for a key a client edits, so it is the host's
    // to hold and not one a plugin may reach back into.
    if (one.loaded.manifest?.optionsSchema === undefined) schemas.delete(id);
    else schemas.set(id, frozenCopy(one.loaded.manifest.optionsSchema));
    const port = one.contribution.ports.vault;
    if (port !== undefined && (owner === undefined || port.replace)) {
      standing = port.value as Vault;
      owner = one.contribution.by;
    }
    return { id, loaded: one.loaded, contribution: one.contribution, problems: one.problems };
  };

  const reload = (entry: Planned): Promise<StagedPlugin> => {
    counts.set(entry.id, (counts.get(entry.id) ?? 0) + 1);
    return load(entry);
  };

  const unload = async (id: string): Promise<string[]> => {
    const one = kept.get(id);
    if (one === undefined) {
      // A plugin that never loaded has no row to clear, but a failed one does.
      alerted.delete(id);
      viewed.delete(id);
      answered.delete(id);
      current.delete(id);
      return [];
    }
    const problems: string[] = [];
    // The plugin's own connections first: a closer that tells somebody about
    // the ending needs the connection it tells them over.
    one.contribution.connects.close();
    for (const close of one.contribution.closers) {
      try {
        await close();
      }
      catch (error) {
        problems.push(`plugin ${id}: a closer failed: ${reason(error)}`);
      }
    }
    kept.delete(id);
    // A plugin that is gone has nothing left to say: its row carries no alerts.
    alerted.delete(id);
    viewed.delete(id);
    answered.delete(id);
    current.delete(id);
    schemas.delete(id);
    for (const agent of one.contribution.agents) {
      const at = known.findIndex((each) => each.provider === agent.provider);
      if (at !== -1) known.splice(at, 1);
    }
    // A vault this plugin held goes back to the daemon's own, or to whichever
    // plugin still holds one.
    if (owner === one.contribution.by) {
      standing = undefined;
      owner = options.base.vault === undefined ? undefined : 'the daemon';
      for (const other of kept.values()) {
        const port = other.contribution.ports.vault;
        if (port !== undefined && (owner === undefined || port.replace)) {
          standing = port.value as Vault;
          owner = other.contribution.by;
        }
      }
    }
    return problems;
  };

  const contributions = (): Contribution[] => [...kept.values()].map((one) => one.contribution);

  return {
    plan,
    load,
    reload,
    unload,
    held: (id) => kept.get(id),
    loaded: () => [...kept.values()].map((one) => one.loaded),
    contributions,
    // A copy of each list: a row a client reads is not the one the next alert
    // would push into while it is being served.
    alerts: () => Object.fromEntries([...alerted].map(([id, list]) => [id, [...list]])),
    // A copy of each plugin's surfaces and of each view on it: what a client
    // reads is not the object the next view of that surface would replace.
    views: () => Object.fromEntries([...viewed].map(([id, bySurface]) => [id, { ...bySurface }])),
    /*
     * Fold what is loaded, and the records the host has opened.
     *
     * A fold with no records folds the ones the last fold served, so a caller
     * asking for the options again after the records opened does not put the
     * host back to the plugin agents alone. The agents kept for `machineNeeds`
     * are the ones this fold took, not the ones it was handed: a record whose
     * id a plugin already serves is not an agent of this host.
     */
    fold: (records?: Agent[]) => {
      const folded = foldHostOptions(options.base, contributions(), records ?? served);
      if (records !== undefined) {
        const took = new Set(folded.records);
        served = records.filter((agent) => took.has(agent.provider));
      }
      return folded;
    },
    settle: (host) => { reached = host; settled(host); },
  };
};

/**
 * Load every spec, in the order it was configured.
 *
 * Nothing here throws and nothing here exits: a spec that fails is a problem
 * and the next one is still tried, so one bad plugin costs itself and not the
 * daemon. The agent `provider` collisions the plan asks this to scan for are
 * the fold's, which sees every contribution at once and reports one problem
 * per collision naming both parties.
 */
export async function loadPlugins(specs: PluginSpec[], options: LoadOptions): Promise<LoadedPlugins> {
  const set = options.set ?? pluginSet(options);
  const problems: string[] = [];
  const planned = await set.plan(specs);
  problems.push(...planned.problems);
  for (const entry of planned.entries) {
    if (entry.disabled) continue;
    const one = await set.load(entry);
    problems.push(...one.problems);
  }
  const folded = set.fold();
  problems.push(...folded.problems);
  set.settle(folded.options);
  return { options: folded.options, contributions: set.contributions(), problems, loaded: set.loaded(), routes: folded.routes, alerts: set.alerts() };
}

/**
 * What a listing says about one spec.
 *
 * The states are doop's, adapted to a command that does not load: `ready` for
 * one that resolves and whose manifest parses, `incompatible` for a `@ahpd/sdk`
 * range the running SDK does not satisfy, `unconfigured` for a manifest that
 * names a required option the configuration does not set, `disabled` for a
 * spec turned off, `missing` for one that does not resolve, and `error` for a
 * manifest that does not parse or does not hold, or an id that is not a slug.
 */
export type PluginState = 'ready' | 'incompatible' | 'unconfigured' | 'disabled' | 'missing' | 'error';

/** One spec, as a listing shows it. */
export interface PluginRow {
  /** What was named, as it was named. */
  spec: PluginSpec;
  /**
   * The plugin's id, which is what every other `plugin` verb takes and what
   * root config keys the entry by: a client reads a row and passes this back.
   */
  name: string;
  /** Which of the six states this spec is in. */
  state: PluginState;
  /**
   * The name the module or the manifest declares itself by.
   *
   * Not the same as `name` when the module exports a name its manifest does
   * not say. Absent for a spec that did not resolve, so nothing said what it is.
   */
  module?: string;
  /** The URL a load would import, when a spec resolved. */
  url?: string;
  /** The file a load would import, when there is one. */
  path?: string;
  /** The title the manifest declares. */
  title?: string;
  /** The version package.json declares. */
  version?: string;
  /**
   * What the manifest says the plugin adds, read with no import.
   *
   * A row carries this whether or not the plugin loaded, so a client shows what
   * a switched-off plugin is before anybody turns it on.
   */
  manifest?: PluginManifest;
  /** The catalogs `ahpd.i18n` names, which the plugins channel translates a row with. */
  i18n?: Catalogs;
  /** The one line explaining a state that is not `ready`. */
  problem?: string;
}

/**
 * Describe one spec without running anything.
 *
 * Resolve, then read the manifest from the resolved path, and nothing else: no
 * `import`, no `apply`. The id is the one `pluginIdOf` holds, which a caller
 * fills with `pluginIdsOf` first; a plugin that would throw on import still
 * lists, by its manifest's name.
 *
 * A switched-off plugin is described like any other. Its manifest is read, so a
 * client shows its title, version, what it adds and which options it takes
 * before anybody turns it on; only the state differs. A switched-off spec that
 * does not resolve is still `missing`, because what it would have been is not
 * known.
 */
export async function describePlugin(
  spec: PluginSpec,
  options: { configDir: string; cwd: string },
  version: string = sdkVersion(),
): Promise<PluginRow> {
  // The id the entry is keyed by, which this row answers whichever state it is
  // in, because a state is a thing to read about a name and not a name.
  const name = pluginIdOf(spec, options);
  const disabled = typeof spec !== 'string' && spec.enabled === false;

  let resolved: Resolved;
  try {
    resolved = resolvePlugin(spec, options);
  }
  catch (error) {
    return { spec, name, state: 'missing', problem: reason(error) };
  }

  const row: PluginRow = { spec, name, state: 'ready', url: resolved.url };
  if (resolved.path !== undefined) row.path = resolved.path;
  // An id a load refuses, as the line a listing shows for it.
  const slugged = (one: PluginRow): PluginRow =>
    isRecordSlug(name) ? one : { ...one, state: 'error', problem: `its name is not a slug: ${RECORD_SLUG}` };

  let manifest: Manifest | undefined;
  if (resolved.manifestPath !== undefined) {
    manifest = readStandalone(resolved.manifestPath);
    const bad = checkStandalone(manifest);
    if (bad !== undefined) return { ...row, state: 'error', problem: bad };
  }
  if (manifest === undefined) {
    manifest = inlineManifestOf(resolved.spec, resolved.path === undefined ? undefined : dirname(resolved.path));
    const bad = manifest === undefined ? undefined : checkStandalone(manifest);
    if (bad !== undefined) return { ...row, state: 'error', problem: bad };
  }
  const packageDir = resolved.packageDir ?? (resolved.path === undefined ? undefined : nearestManifest(resolved.path));
  if (manifest === undefined && packageDir !== undefined) {
    manifest = readManifest(packageDir);
    if (manifest.problem !== undefined) return { ...row, state: 'error', problem: manifest.problem };
    const bad = checkManifest(manifest, packageDir);
    if (bad !== undefined) return { ...row, state: 'error', problem: bad };
  }
  if (manifest === undefined) {
    // The same refusal a load makes, said with no import.
    if (standaloneSpec(resolved)) return { ...row, state: 'error', problem: noManifestProblem(resolved) };
    if (resolved.path !== undefined) row.module = fileNameOf(resolved.path);
    return disabled ? { ...row, state: 'disabled' } : slugged(row);
  }
  if (manifest.name !== undefined) row.module = manifest.name;
  if (manifest.title !== undefined) row.title = manifest.title;
  if (manifest.version !== undefined) row.version = manifest.version;
  const declared = manifestFields(manifest);
  if (declared !== undefined) row.manifest = declared;
  if (manifest.i18n !== undefined) row.i18n = manifest.i18n;

  // Read, so the row is whole; the state is the one a switched-off entry has.
  if (disabled) return { ...row, state: 'disabled' };

  if (manifest.sdkRange !== undefined) {
    let satisfied = false;
    let why = `${manifest.sdkRange} is not satisfied by ${version}`;
    try {
      satisfied = satisfies(version, manifest.sdkRange);
    }
    catch (error) {
      why = reason(error);
    }
    if (!satisfied) return { ...row, state: 'incompatible', problem: why };
  }
  if (!isRecordSlug(name)) return slugged(row);

  /*
   * An option the schema names in its `required` list and the configuration
   * does not set is what keeps a plugin from loading, said here without an
   * import. A default the module carries is not visible to a listing, so a
   * required key with a default may be reported unconfigured and still load;
   * the state is a hint for the person reading it, not the load's own check.
   */
  const required = manifest.optionsSchema?.['required'];
  if (Array.isArray(required)) {
    const given = typeof spec === 'object' && spec !== null ? (spec.options ?? {}) : {};
    const absent = required.filter((key) => typeof key === 'string' && given[key] === undefined);
    if (absent.length > 0) return { ...row, state: 'unconfigured', problem: `needs ${absent.join(', ')}` };
  }

  return row;
}

/**
 * One row as the line a person reads.
 *
 * Pulled out of the verb so it can be tested without starting `main.ts`: the
 * verb itself is untestable, and the shape of the line - a state, the spec, the
 * path and who the manifest says it is - is the decision worth pinning.
 */
export const pluginLine = (row: PluginRow): string => {
  const where = row.path ?? row.url ?? '-';
  // The id, and the spec beside it when the two differ.
  const said = sourceOf(row.spec) === row.name ? row.name : `${row.name} (${sourceOf(row.spec)})`;
  // What the manifest says it is, which the label reads as `module`.
  const label = row.module !== undefined || row.title !== undefined
    ? `(${[row.module ?? '?', ...(row.title === undefined ? [] : [row.title])].join(', ')})`
    : row.state === 'disabled' ? '(turned off)'
      : row.state === 'missing' ? '(not resolved)'
        : row.state === 'error' ? '(bad manifest)'
          : '(no manifest)';
  const why = row.problem === undefined ? '' : `: ${row.problem}`;
  return `${row.state} ${said} -> ${where} ${label}${why}`;
};
