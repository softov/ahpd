/**
 * Turning what a person wrote into something importable.
 *
 * A plugin is named in the configuration file or on the command line as a
 * module specifier, a path, or a package installed in the configuration
 * directory. This file is the half of the plugin mechanism that touches the
 * machine - the filesystem and the module resolver - and it stops short of
 * `import()`: resolving is a question a listing can ask without running
 * anything, so a listing and a load agree on what a spec means.
 *
 * A bare name is resolved through the configuration directory's own
 * `node_modules`, which is what makes `npm i` there the install rather than a
 * flag somewhere. A path is tried against the working directory and then the
 * configuration directory, because a relative path means the person's shell
 * decides what runs and that has to be said rather than guessed.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runtime } from '@ahpd/sdk';
import type { PluginSpec } from '@ahpd/sdk';

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
