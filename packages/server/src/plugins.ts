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
import { basename, dirname, extname, isAbsolute, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { check, type JsonSchema } from '@cofold/commands';
import { foldHostOptions, pluginHost, readSecret, runtime, sdkVersion, secretRef } from '@ahpd/sdk';
import type { Agent, Contribution, HostOptions, Loaded, Plugin, PluginSpec, Route, SessionStore, Usage, Vault } from '@ahpd/sdk';
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
 * The roots a bare name is resolved from, in the order they are looked in.
 *
 * `AHPD_PLUGIN_ROOT` is the root the ahpd part installs its own nested backends
 * into, and it comes after the configuration directory rather than before it:
 * inside that image the config dir is not writable, so a plugin installed there
 * has nowhere else to be, and outside it the variable is not set at all.
 */
function rootsOf(configDir: string): string[] {
  const root = process.env.AHPD_PLUGIN_ROOT;
  if (root === undefined || root === '') return [configDir];
  return [configDir, join(root, 'node_modules')];
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

/** One error, as the one line a person reads. */
const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Whether a value is a plain object, which is what a schema and its `properties` are. */
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

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
 * Read and check the manifest of a resolved spec, and find the module a load
 * imports; or the one problem that stops it being imported at all.
 */
function locate(resolved: Resolved, version: string): Located | { refused: string } {
  const problems: string[] = [];
  const said = nameOf(resolved.spec);
  const manifestDir = resolved.packageDir ?? (resolved.path === undefined ? undefined : nearestManifest(resolved.path));

  let manifest: Manifest | undefined;
  if (manifestDir !== undefined) {
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
        why = ` (${messageOf(error)})`;
      }
      if (!satisfied) {
        return { refused: `plugin ${manifest.name ?? said} needs @ahpd/sdk ${manifest.sdkRange}, this is ${version}${why}` };
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
  return { ...(manifest === undefined ? {} : { manifest }), ...(target === undefined ? {} : { target }), url, problems };
}

/**
 * The options schema the module a spec names exports, imported the way a load
 * imports it, or nothing when it exports none.
 *
 * Throws the problem when the spec does not resolve, its manifest refuses it,
 * or the module does not import as a plugin, so a caller can say it could not
 * check rather than guess.
 */
export async function optionsSchemaOf(
  spec: PluginSpec,
  options: { configDir: string; cwd: string },
): Promise<Record<string, unknown> | undefined> {
  const found = locate(resolvePlugin(spec, options), sdkVersion());
  if ('refused' in found) throw new Error(found.refused);
  const module: unknown = await import(found.url);
  const wrong = checkShape(module, found.target ?? found.url);
  if (wrong !== undefined) throw new Error(wrong);
  const held = module as Record<string, unknown>;
  return isRecord(held.optionsSchema) ? held.optionsSchema : undefined;
}

/**
 * The schema one property of an object is held to, by name.
 *
 * `properties` first, then `patternProperties`, then `additionalProperties`, so
 * the loader and the mask find the same node for a key whichever of the three
 * declares it: which option is a `secretAtUse` one and which is a `writeOnly` one
 * are two questions about one declaration.
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
 * scope, which is the rule decision
 * `a-secret-is-named-in-a-host-team-or-user-scope` settled rather than a second
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
    return { forApply: value, forCheck: inner.forCheck, named: inner.named };
  }
  if (ref !== undefined) {
    if (vault === undefined) throw new Error(`${label}.${path} names ${ref}: ${ref} cannot be read: this host has no vault`);
    let secret: string;
    try {
      secret = await readSecret(vault, ref, {});
    }
    catch (error) {
      throw new Error(`${label}.${path} names ${ref}: ${messageOf(error)}`);
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

/**
 * Resolve, validate, import and apply one plugin.
 *
 * The order is the point: the manifest is read and the range checked before
 * `import()` is reached, so an incompatible or malformed plugin is never
 * executed. Everything after that - the import, the shape of the module, its
 * options held to the `optionsSchema` it exports, and `apply` itself - is
 * caught and turned into a problem line, because a plugin that throws must cost
 * a line in the log rather than the daemon.
 */
export async function loadOne(resolved: Resolved, options: LoadOneOptions): Promise<OneResult> {
  const spec = resolved.spec;
  const said = nameOf(spec);
  const found = locate(resolved, options.version);
  if ('refused' in found) return { problems: [found.refused] };
  const { manifest, target, url } = found;
  const problems = [...found.problems];

  const provisional = manifest?.name ?? (manifest === undefined && target !== undefined ? fileNameOf(target) : said);
  options.log(`plugin ${provisional} loading`);
  // When the start line was logged, which every later line measures from.
  const started = Date.now();
  // How long since the start line, as the ` in <n> ms` a later line carries.
  const took = (): string => ` in ${Date.now() - started} ms`;
  let module: unknown;
  try {
    module = await import(url);
  }
  catch (error) {
    return { problems: [...problems, `plugin ${provisional} could not be imported from ${target ?? url}${took()}: ${messageOf(error)}`] };
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
  const written: Record<string, unknown> = { ...(defaults ?? {}), ...(named ?? {}) };
  const optionsSchema = isRecord(held.optionsSchema) ? held.optionsSchema : undefined;
  if (held.optionsSchema !== undefined && optionsSchema === undefined) {
    return { problems: [...problems, `plugin ${name} skipped: its optionsSchema is not an object`] };
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
    return { problems: [...problems, `plugin ${name} skipped: ${messageOf(error)}`] };
  }
  const values = unwrapped.forApply as Record<string, unknown>;
  if (optionsSchema !== undefined) {
    try {
      check(unwrapped.forCheck, optionsSchema as JsonSchema, label);
    }
    catch (error) {
      return { problems: [...problems, `plugin ${name} skipped: ${messageOf(error)}`] };
    }
    const known = isRecord(optionsSchema.properties) ? optionsSchema.properties : {};
    for (const key of Object.keys(named ?? {})) {
      if (!Object.hasOwn(known, key)) problems.push(`plugin ${name}: ${label}.${key} is not an option ${name} knows; passed through`);
    }
  }
  const plugin: Plugin = {
    name,
    apply,
    ...(title === undefined ? {} : { title }),
    ...(defaults === undefined ? {} : { defaults }),
    ...(optionsSchema === undefined ? {} : { optionsSchema }),
  };

  /*
   * What the plugin itself dropped on the way, said through `problem`.
   *
   * A line the plugin said is a line this loader told on its behalf, so the
   * person who started the daemon reads it beside the ones the loader found -
   * which is the whole point of `problem`: an item skipped costs the item, and
   * the one running `ahpd start` is the one who has to be told.
   */
  const told: string[] = [];

  const { host, contribution } = pluginHost(name, {
    path: options.path,
    paths: options.paths,
    version: options.version,
    hostName: options.hostName ?? 'host',
    configDir: options.configDir,
    ...(options.hostId === undefined ? {} : { hostId: options.hostId }),
    log: options.log,
    say: options.say ?? (() => {}),
  }, {
    ...(options.agents === undefined ? {} : { agents: options.agents }),
    ...(options.usage === undefined ? {} : { usage: options.usage }),
    ...(options.vault === undefined ? {} : { vault: options.vault }),
    problem: (line) => { told.push(line); },
    ...(options.sessions === undefined ? {} : { sessions: options.sessions }),
    // As configuration wrote it, which is what a host inside a machine loads.
    spec: said,
  });
  try {
    await apply.call(plugin, host, values);
  }
  catch (error) {
    // One failure path: whatever the registration check or the plugin itself
    // threw, the whole contribution is discarded and the plugin costs a line.
    return { problems: [...problems, ...told, `plugin ${name} failed${took()}: ${messageOf(error)}`] };
  }
  /*
   * A vault that read a secret out of its own options is a vault that decided
   * where its own secrets come from, which is the one thing it cannot be asked
   * to answer: it would be reading the store it is, or the one it took over.
   */
  if (unwrapped.named && contribution.ports.vault !== undefined) {
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
  };
  return { loaded, contribution, problems: [...problems, ...told] };
}

/*
 * What each plugin that loaded declares its options are, kept for the root
 * config port.
 *
 * The only other copy of one is inside a module that has just been imported, and
 * importing it again to ask would run a plugin's code a second time. Keyed by
 * the name `plugins` holds it under, which is the name the key a client edits is
 * spelled with. A plugin that did not load has no entry here, which is what
 * leaves its options free rather than wrongly bounded.
 */
const schemas = new Map<string, Record<string, unknown>>();

/**
 * The options schema of a plugin this daemon loaded, under the name `plugins`
 * holds it as, or `undefined` for one that did not load.
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
   * Every plugin's route, by plugin name, for the listener to serve.
   *
   * Answered beside the options rather than among them: a route is not
   * something `createHost` is built over but a handler the daemon's own
   * listener mounts, under `/plugins/<name>/`.
   */
  routes: Record<string, Route>;
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

  /*
   * The host this daemon ends up with, which a usage record is written to.
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
   * The vault a load resolves against: the daemon's own, unless a plugin listed
   * earlier has taken the port over.
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

  /*
   * A name that repeats is one module configured twice, which decision
   * `a-plugin-loads-once-and-each-preset-is-a-variant` refuses: a plugin is
   * loaded once and its options are what make its variants, so the second and
   * later entries of a name are problems naming it. A switched-off entry still
   * counts, since root config would key it the same.
   */
  const repeats = new Map<string, number>();
  for (const spec of specs) repeats.set(nameOf(spec), (repeats.get(nameOf(spec)) ?? 0) + 1);
  const taken = new Set<string>();

  for (const spec of specs) {
    const named = nameOf(spec);
    if (taken.has(named)) {
      problems.push(`plugin ${named} is named ${String(repeats.get(named))} times; write it once and use its options for variants`);
      continue;
    }
    taken.add(named);
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
      configDir: options.configDir,
      log: options.log,
      ...(options.say === undefined ? {} : { say: options.say }),
      agents: () => known,
      ...(options.base.hostName === undefined ? {} : { hostName: options.base.hostName }),
      ...(options.hostId === undefined ? {} : { hostId: options.hostId }),
      usage: () => reached?.usage,
      vault: vaultInForce,
      sessions: () => hosted.then((host) => host.sessions),
    });
    problems.push(...one.problems);
    if (one.loaded !== undefined) {
      loaded.push(one.loaded);
      if (one.loaded.plugin.optionsSchema !== undefined) schemas.set(nameOf(spec), one.loaded.plugin.optionsSchema);
    }
    if (one.contribution !== undefined) {
      contributions.push(one.contribution);
      known.push(...one.contribution.agents);
      const entry = one.contribution.ports.vault;
      if (entry !== undefined && (owner === undefined || entry.replace)) {
        standing = entry.value as Vault;
        owner = one.contribution.by;
      }
    }
  }

  const folded = foldHostOptions(options.base, contributions);
  problems.push(...folded.problems);
  reached = folded.options;
  settled(folded.options);
  return { options: folded.options, contributions, problems, loaded, routes: folded.routes };
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
  if (packageDir === undefined) {
    if (resolved.path !== undefined) row.name = fileNameOf(resolved.path);
    return row;
  }

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
