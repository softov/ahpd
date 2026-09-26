/**
 * Turning what a person wrote into something importable, and then into a host.
 *
 * A plugin is named in the configuration file or on the command line as a
 * module specifier, a path, or a package installed in the configuration
 * directory. This file is the half of the plugin mechanism that touches the
 * machine - the filesystem, the module resolver and `import()` - and it is
 * split so that resolving stops short of running anything: a listing can ask
 * what a spec means without importing it, and a load and a listing agree.
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

import { existsSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { foldHostOptions, pluginHost, runtime, sdkVersion } from '@ahpd/sdk';
import type { Agent, Contribution, HostOptions, Loaded, Plugin, PluginSpec } from '@ahpd/sdk';
import { satisfies } from './compat.js';

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
}

/** What a spec is called, whether it was written as a string or an object. */
export const nameOf = (spec: PluginSpec): string => (typeof spec === 'string' ? spec : spec.name);

/** Whether the spec carries a scheme of its own, which this daemon does not second-guess. */
export const hasScheme = (spec: string): boolean => /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(spec);

/** Why a bare name cannot be resolved on Deno, and what to write instead. */
export const denoMessage = (name: string, configDir: string): string =>
  `Plugin ${name} is a bare name, and Deno has no createRequire to resolve one against ${configDir}; write it as npm:${name}.`;

/** The nearest directory above `from` holding a `package.json`, or nothing when there is none. */
const nearestManifest = (from: string): string | undefined => {
  let at = dirname(from);
  for (;;) {
    if (existsSync(join(at, 'package.json'))) return at;
    const up = dirname(at);
    if (up === at) return undefined;
    at = up;
  }
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

/**
 * The entry a directory's own manifest names, in the order it is looked for.
 *
 * `ahpd.entry` first, because that is the field decision
 * `plugin-manifest-is-package-json` added for exactly this; then the package's
 * own `exports["."]`; then `main`; then the conventional `index.js`. An entry
 * that resolves outside the directory is refused rather than followed, so a
 * manifest cannot point its own package at somebody else's code.
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
 * Resolve one spec to something importable, without importing it.
 *
 * A scheme of the spec's own is passed through untouched, a path is tried
 * against the working directory and then the configuration directory, and a
 * bare name is resolved from the configuration directory. Nothing here is
 * awaited, nothing here touches the network, and nothing here runs plugin code.
 */
export function resolvePlugin(spec: PluginSpec, options: { configDir: string; cwd: string }): Resolved {
  const name = nameOf(spec);
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
    return { spec, url: pathToFileURL(found).href, path: found };
  }

  if (runtime() === 'deno') throw new Error(denoMessage(name, configDir));

  const require = createRequire(join(configDir, 'package.json'));
  let file: string;
  try {
    file = require.resolve(name);
  }
  catch {
    throw new Error(`Plugin ${name} is not installed in ${configDir}; run npm install there, or name a path.`);
  }
  const packageDir = nearestManifest(file);
  return {
    spec,
    url: pathToFileURL(file).href,
    path: file,
    ...(packageDir === undefined ? {} : { packageDir }),
  };
}

/** One error, as the one line a person reads. */
const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** What a plugin's own `package.json` says, read without judging it. */
export interface Manifest {
  /** The `package.json` it was read from, for every message about it. */
  path: string;
  /** The package name, when it is a string. */
  name?: string;
  /** `ahpd.title`, the fallback a listing prints. */
  title?: string;
  /** `ahpd.entry`, the entry a manifest names over what the package resolves to. */
  entry?: string;
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
    return { path, problem: `${path} could not be read: ${messageOf(error)}` };
  }

  const ahpd = value.ahpd;
  const peers = typeof value.peerDependencies === 'object' && value.peerDependencies !== null && !Array.isArray(value.peerDependencies)
    ? value.peerDependencies as Record<string, unknown>
    : undefined;
  const peer = peers?.['@ahpd/sdk'];
  const inside = typeof ahpd === 'object' && ahpd !== null && !Array.isArray(ahpd) ? ahpd as Record<string, unknown> : undefined;

  const manifest: Manifest = { path, ahpd, peer };
  if (typeof value.name === 'string') manifest.name = value.name;
  if (typeof inside?.title === 'string') manifest.title = inside.title;
  if (typeof inside?.entry === 'string') manifest.entry = inside.entry;
  if (typeof peer === 'string') manifest.sdkRange = peer;
  return manifest;
};

/**
 * Whether a manifest is a shape anything can read.
 *
 * The one place decision `plugin-manifest-is-package-json` names: an `ahpd`
 * that is not an object, an `ahpd.entry` that is not a string or that points
 * outside its own package, and a `@ahpd/sdk` peer that is not a string. A
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

/**
 * Resolve, validate, import and apply one plugin.
 *
 * The order is the point: the manifest is read and the range checked before
 * `import()` is reached, so an incompatible or malformed plugin is never
 * executed. Everything after that - the import, the shape of the module and
 * `apply` itself - is caught and turned into a problem line, because a plugin
 * that throws must cost a line in the log rather than the daemon.
 */
export async function loadOne(resolved: Resolved, options: LoadOneOptions): Promise<OneResult> {
  const problems: string[] = [];
  const spec = resolved.spec;
  const said = nameOf(spec);
  const manifestDir = resolved.packageDir ?? (resolved.path === undefined ? undefined : nearestManifest(resolved.path));

  let manifest: Manifest | undefined;
  if (manifestDir !== undefined) {
    manifest = readManifest(manifestDir);
    const bad = checkManifest(manifest, manifestDir);
    if (bad !== undefined) return { problems: [bad] };
    if (manifest.sdkRange !== undefined) {
      let satisfied = false;
      let why = '';
      try {
        satisfied = satisfies(options.version, manifest.sdkRange);
      }
      catch (error) {
        // An unreadable range is refused rather than passed, which is the
        // difference between a plugin that must be spelled differently and one
        // that loads unchecked.
        why = ` (${messageOf(error)})`;
      }
      if (!satisfied) {
        return { problems: [`plugin ${manifest.name ?? said} needs @ahpd/sdk ${manifest.sdkRange}, this is ${options.version}${why}`] };
      }
    }
  }

  /*
   * Where the module actually is.
   *
   * The manifest wins for resolution only when the caller resolved the
   * *package* rather than a file - decision `plugin-manifest-is-package-json`.
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

  const provisional = manifest?.name ?? said;
  let module: unknown;
  try {
    module = await import(url);
  }
  catch (error) {
    return { problems: [...problems, `plugin ${provisional} could not be imported from ${target ?? url}: ${messageOf(error)}`] };
  }

  const wrong = checkShape(module, target ?? url);
  if (wrong !== undefined) return { problems: [...problems, wrong] };

  const held = module as Record<string, unknown>;
  const apply = held.apply as Plugin['apply'];
  // The module wins for shape and its `name` wins for the listing; the
  // manifest is the fallback, and the spec is the last resort.
  const name = typeof held.name === 'string' && held.name.trim() !== '' ? held.name : provisional;
  const title = typeof held.title === 'string' ? held.title : manifest?.title;
  const defaults = typeof held.defaults === 'object' && held.defaults !== null && !Array.isArray(held.defaults)
    ? held.defaults as Record<string, unknown>
    : undefined;
  const named = typeof spec === 'object' && spec !== null ? spec.options : undefined;
  const values: Record<string, unknown> = { ...(defaults ?? {}), ...(named ?? {}) };
  const plugin: Plugin = {
    name,
    apply,
    ...(title === undefined ? {} : { title }),
    ...(defaults === undefined ? {} : { defaults }),
  };

  const { host, contribution } = pluginHost(name, {
    path: options.path,
    paths: options.paths,
    version: options.version,
    log: options.log,
    say: options.say ?? (() => {}),
  }, options.agents === undefined ? {} : { agents: options.agents });
  try {
    await apply.call(plugin, host, values);
  }
  catch (error) {
    // One failure path: whatever the registration check or the plugin itself
    // threw, the whole contribution is discarded and the plugin costs a line.
    return { problems: [...problems, `plugin ${name} failed: ${messageOf(error)}`] };
  }

  // The absolute path is logged, so what ran is in the log even when a spec
  // was relative or a bare name resolved somewhere nobody expected.
  options.log(`plugin ${name} from ${target ?? url}`);
  const loaded: Loaded = {
    spec,
    url,
    path: target ?? url,
    name,
    options: values,
    plugin,
    ...(title === undefined ? {} : { title }),
  };
  return { loaded, contribution, problems };
}

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
}

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
  const paths = options.paths ?? [options.base.path];
  const version = options.version ?? sdkVersion();
  const contributions: Contribution[] = [];
  const problems: string[] = [];
  const loaded: Loaded[] = [];
  /*
   * Every agent this host will have, filled as plugins load.
   *
   * The machine-making plugin asks this at create time rather than at load, so
   * the list may be incomplete while any one plugin applies - a plugin that
   * registers an agent is allowed to load after one that makes machines.
   */
  const known: Agent[] = [...options.base.agents];

  for (const spec of specs) {
    if (typeof spec !== 'string' && spec.enabled === false) continue;
    let resolved: Resolved;
    try {
      resolved = resolvePlugin(spec, { configDir: options.configDir, cwd: options.cwd });
    }
    catch (error) {
      problems.push(messageOf(error));
      continue;
    }
    const one = await loadOne(resolved, {
      path: options.base.path,
      paths,
      version,
      log: options.log,
      ...(options.say === undefined ? {} : { say: options.say }),
      agents: () => known,
    });
    problems.push(...one.problems);
    if (one.loaded !== undefined) loaded.push(one.loaded);
    if (one.contribution !== undefined) {
      contributions.push(one.contribution);
      known.push(...one.contribution.agents);
    }
  }

  const folded = foldHostOptions(options.base, contributions);
  problems.push(...folded.problems);
  return { options: folded.options, contributions, problems, loaded };
}

/**
 * What a listing says about one spec.
 *
 * The states are doop's, adapted to a command that does not load: `ready` for
 * one that resolves and whose manifest parses, `incompatible` for a `@ahpd/sdk`
 * range the running SDK does not satisfy, `unconfigured` for a manifest that
 * names a required option the configuration does not set, `disabled` for a
 * spec turned off, `missing` for one that does not resolve, and `error` for a
 * manifest that does not parse or does not hold.
 */
export type PluginState = 'ready' | 'incompatible' | 'unconfigured' | 'disabled' | 'missing' | 'error';

/** One spec, as a listing shows it. */
export interface PluginRow {
  /** What was named, as it was named. */
  spec: PluginSpec;
  /** Which of the six states this spec is in. */
  state: PluginState;
  /** The URL a load would import, when a spec resolved. */
  url?: string;
  /** The file a load would import, when there is one. */
  path?: string;
  /** The name the module or the manifest declares. */
  name?: string;
  /** The title the manifest declares. */
  title?: string;
  /** The one line explaining a state that is not `ready`. */
  problem?: string;
}

/** Whether a manifest's `ahpd.options` entry says the option must be given. */
const required = (value: unknown): boolean =>
  value === true || (typeof value === 'object' && value !== null && (value as Record<string, unknown>).required === true);

/**
 * Describe one spec without running anything.
 *
 * Resolve, then read the manifest from the resolved path, and nothing else: no
 * `import`, no `apply`. That is the whole reason the `ahpd` key exists - a
 * listing of installed plugins must not run third-party code - and it is why a
 * plugin that would throw on import still lists.
 */
export async function describePlugin(
  spec: PluginSpec,
  options: { configDir: string; cwd: string },
  version: string = sdkVersion(),
): Promise<PluginRow> {
  if (typeof spec !== 'string' && spec.enabled === false) return { spec, state: 'disabled' };

  let resolved: Resolved;
  try {
    resolved = resolvePlugin(spec, options);
  }
  catch (error) {
    return { spec, state: 'missing', problem: messageOf(error) };
  }

  const row: PluginRow = { spec, state: 'ready', url: resolved.url };
  if (resolved.path !== undefined) row.path = resolved.path;

  const packageDir = resolved.packageDir ?? (resolved.path === undefined ? undefined : nearestManifest(resolved.path));
  if (packageDir === undefined) return row;

  const manifest = readManifest(packageDir);
  if (manifest.problem !== undefined) return { ...row, state: 'error', problem: manifest.problem };
  const bad = checkManifest(manifest, packageDir);
  if (bad !== undefined) return { ...row, state: 'error', problem: bad };
  if (manifest.name !== undefined) row.name = manifest.name;
  if (manifest.title !== undefined) row.title = manifest.title;

  if (manifest.sdkRange !== undefined) {
    let satisfied = false;
    let why = `${manifest.sdkRange} is not satisfied by ${version}`;
    try {
      satisfied = satisfies(version, manifest.sdkRange);
    }
    catch (error) {
      why = messageOf(error);
    }
    if (!satisfied) return { ...row, state: 'incompatible', problem: why };
  }

  const inside = manifest.ahpd as Record<string, unknown> | undefined;
  const wanted = inside?.options;
  if (typeof wanted === 'object' && wanted !== null && !Array.isArray(wanted)) {
    const given = typeof spec === 'object' && spec !== null ? (spec.options ?? {}) : {};
    const absent = Object.entries(wanted)
      .filter(([key, value]) => required(value) && given[key] === undefined)
      .map(([key]) => key);
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
  const label = row.name !== undefined || row.title !== undefined
    ? `(${[row.name ?? '?', ...(row.title === undefined ? [] : [row.title])].join(', ')})`
    : row.state === 'disabled' ? '(turned off)'
      : row.state === 'missing' ? '(not resolved)'
        : row.state === 'error' ? '(bad manifest)'
          : '(no manifest)';
  const why = row.problem === undefined ? '' : `: ${row.problem}`;
  return `${row.state} ${nameOf(row.spec)} -> ${where} ${label}${why}`;
};
