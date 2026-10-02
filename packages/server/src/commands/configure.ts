/**
 * `ahpd configure`: ask, at the terminal, for each setting a first install needs.
 *
 * A fresh install refuses to start with no backend and no folder, naming an
 * `ahpd plugin install` a person has to know about; this is the other way in.
 * Every question shows the value the file holds now, so a second run edits what
 * is there rather than overwriting it with defaults somebody has changed, and
 * every key this command was not asked about is left where it was.
 *
 * The questions are the ones a first run cannot do without: which backends, the
 * address and the port, the token, and the folders whose sessions this host
 * serves. Anything else is a key somebody who knows the daemon is already
 * looking for, and asking about it here would put a question in front of
 * everybody for a setting almost nobody sets.
 *
 * Terminal only, and never served: a question has no answer over HTTP, and a
 * deployment has no person to give it one. `ask` refuses without a terminal, so
 * this is where a script that pipes a line in is told why it is not going to be
 * asked anything.
 */

import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { output } from '@cofold/commands';
import type { Command, Registry } from '@cofold/commands';
import { ask, answering, confirm, here, type Term } from '../ask.js';
import { asSpec, configDir, configPath } from '../config.js';
import { installPlugins, readEntry, run as runProgram, writeEntry, type Runner } from '../install.js';
import { nameOf } from '../plugins.js';
import type { Fetch } from '../update.js';
import { version } from '../version.js';
import { serverFields, stop, type Options } from './options.js';

/**
 * The backends this daemon can be given, and the package each is.
 *
 * ACP is not here because it has no presets to offer yet: asked about now it
 * would be a name and an install that answers nothing until one is written. The
 * order is the one a person is most likely to want them in.
 */
const BACKENDS = [
  { name: 'Claude', package: '@ahpd/agent-claude' },
  { name: 'cofold', package: '@ahpd/agent-cofold' },
  { name: 'pi', package: '@ahpd/agent-pi' },
] as const;

/** The one a first install gets without being asked, because a daemon needs a backend. */
const FIRST = '@ahpd/agent-claude';

/** The file the token is written to, beside the configuration that names it. */
const TOKEN = 'connection-token';

/** What `ahpd configure` was given, and where it writes. */
export interface ConfigureOptions {
  /** The configuration directory npm installs into. */
  configDir: string;
  /** The configuration file this reads, asks against and writes. */
  configFile: string;
  /** The daemon's own version, which an `@ahpd/` package without one is pinned to. */
  version: string;
  /** The terminal the questions are asked on. */
  term: Term;
  /** How npm is run. */
  run: Runner;
  /** How the registry is asked whether a package is a plugin. */
  fetch: Fetch;
  /** One line of this command's own output. */
  say(line: string): void;
}

/** What a run of `configure` left behind, which is what the command answers with. */
export interface Configured {
  /** The file it wrote. */
  path: string;
  /** The backends this run was given, installed or already named. */
  backends: string[];
  /** The folders this host will serve. */
  paths: string[];
}

/** Every name `plugins` already holds, whether an entry is a string or an object. */
const named = (held: Record<string, unknown>): Set<string> => {
  const names = new Set<string>();
  if (!Array.isArray(held.plugins)) return names;
  for (const entry of held.plugins) {
    const spec = asSpec(entry);
    if (spec !== undefined) names.add(nameOf(spec));
  }
  return names;
};

/** The folders the file holds, or the one this daemon would serve with none. */
const foldersIn = (held: Record<string, unknown>): string[] => {
  if (!Array.isArray(held.paths)) return [process.cwd()];
  const folders = held.paths.filter((one): one is string => typeof one === 'string');
  return folders.length === 0 ? [process.cwd()] : folders;
};

/** What is in the token file, or nothing when there is none or it is empty. */
const heldToken = (path: string): string | undefined => {
  if (!existsSync(path)) return undefined;
  const held = readFileSync(path, 'utf8').trim();
  return held === '' ? undefined : held;
};

/**
 * The entry named, switched on or off, as `ahpd plugin disable` writes it.
 *
 * A string entry is already on, so switching it on leaves the string it was.
 */
const switched = (list: unknown[], name: string, enabled: boolean): unknown[] => list.map((entry) => {
  const spec = asSpec(entry);
  if (spec === undefined || nameOf(spec) !== name) return entry;
  if (enabled && typeof spec === 'string') return entry;
  const at = typeof spec === 'string' ? { name: spec } : { ...entry as Record<string, unknown>, name: spec.name };
  return { ...at, enabled };
});

/**
 * Ask every question, write the file, and install what was asked for.
 *
 * The file is written before npm runs, because a plugin that will not install is
 * a reason to keep the settings somebody just chose, and `enableNames` then adds
 * the packages npm installed to what is already there.
 */
export async function configure(options: ConfigureOptions): Promise<Configured> {
  const held = readEntry(options.configFile);
  const installed = named(held);

  /*
   * The backends, one question each.
   *
   * Enter keeps a backend the file already names, and takes Claude on a first
   * run because a daemon with no backend refuses to start. A No on one the file
   * already names switches it off rather than taking it out, the way
   * `ahpd plugin disable` writes it and with the options it was given left
   * where they are: removing a plugin is `ahpd plugin remove`, and meaning the
   * same thing here would mean uninstalling it too.
   */
  const backends: string[] = [];
  let plugins = Array.isArray(held.plugins) ? [...held.plugins] : [];
  for (const backend of BACKENDS) {
    const was = installed.has(backend.package);
    const keep = await confirm(`${backend.name}?`, was || backend.package === FIRST, options.term);
    if (keep) backends.push(backend.package);
    if (was) plugins = switched(plugins, backend.package, keep);
  }

  const host = await ask('Host', typeof held.host === 'string' ? held.host : '127.0.0.1', options.term);
  const typedPort = await ask('Port', String(typeof held.port === 'number' ? held.port : 9187), options.term);
  const port = Number(typedPort);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    stop(`Port must be a number from 0 to 65535, not ${typedPort}.`);
  }

  /*
   * The token, in a file beside the configuration.
   *
   * A secret written into `config.json` is one that anybody who can read that
   * file has, and the daemon already reads its secret out of a file of its own,
   * so what is asked here is what goes in that file. Enter generates one when
   * there is none and keeps the one there is, and anything else typed is the
   * token itself.
   */
  const tokenFile = typeof held.connectionTokenFile === 'string' ? held.connectionTokenFile : join(options.configDir, TOKEN);
  const fileToken = heldToken(tokenFile);
  /*
   * A token written as a literal is a token clients are already presenting, so
   * it is one of the things Enter keeps. Generating over it would lock out
   * every client that has it, and the question says which of the two it is
   * keeping rather than printing the secret back.
   */
  const literal = typeof held.connectionToken === 'string' && held.connectionToken !== '' ? held.connectionToken : undefined;
  const kept = fileToken ?? literal;
  const make = `generate one in ${tokenFile}`;
  const keep = fileToken === undefined ? `keep the token in ${options.configFile}` : `keep ${tokenFile}`;
  const typed = await ask('Connection token', kept === undefined ? make : keep, options.term);
  if (kept !== undefined && typed === keep) {
    if (fileToken !== undefined) options.say(`${tokenFile} still holds the token.`);
    else {
      writeFileSync(tokenFile, `${kept}\n`, { mode: 0o600 });
      options.say(`Wrote the token in ${options.configFile} to ${tokenFile}.`);
    }
  }
  else {
    const secret = typed === make ? randomUUID().replaceAll('-', '') : typed;
    // Owner-only, because the file is the credential.
    writeFileSync(tokenFile, `${secret}\n`, { mode: 0o600 });
    options.say(`${typed === make ? 'Wrote a new token to' : 'Wrote the token to'} ${tokenFile}.`);
  }
  held.connectionTokenFile = tokenFile;
  // Two spellings of one secret is what `secret()` refuses, so the token this
  // run just placed in a file takes the literal one out.
  delete held.connectionToken;

  /*
   * The folders, each one asked about on its own.
   *
   * With none configured the folder the daemon was started in is the one it
   * serves, so that is the one asked about. Refusing every folder is refused
   * rather than written: an empty `paths` serves the current folder anyway, so
   * answering No to all of them and being given one of them back is the one
   * outcome this must not have.
   */
  const paths: string[] = [];
  for (const folder of foldersIn(held)) {
    if (await confirm(`Serve ${folder}?`, true, options.term)) paths.push(folder);
  }
  if (paths.length === 0) {
    stop(`Every folder was refused, and a daemon serves ${process.cwd()} unless "paths" names others. `
      + 'Answer Yes to one of them, or unset paths and start it where you want it served.');
  }

  held.host = host;
  held.port = port;
  held.paths = paths;
  // Only where there was a list to change: a first run has none yet, and
  // `installPlugins` below writes one.
  if (plugins.length > 0) held.plugins = plugins;
  writeEntry(options.configFile, held);
  options.say(`Wrote ${options.configFile}.`);

  const missing = backends.filter((one) => !installed.has(one));
  if (missing.length > 0) {
    await installPlugins(missing, {
      configDir: options.configDir, configFile: options.configFile,
      version: options.version, enable: true, run: options.run, fetch: options.fetch, say: options.say,
    });
  }
  else if (backends.length > 0) options.say(`Every backend is already named in ${options.configFile}.`);

  return { path: options.configFile, backends, paths };
}

/**
 * Run `ahpd configure` against a file, over a terminal, with npm for real.
 *
 * What the command and the offer below both do, so neither writes the six lines
 * it takes to name the directory, the version and the runner.
 */
export async function runConfigure(configFile: string, term: Term, say: (line: string) => void): Promise<void> {
  await configure({ configDir: configDir(), configFile, version: version(), term, run: runProgram, fetch, say });
}

/** What the offer is given, so a caller can answer for it rather than run npm. */
export interface OfferOptions {
  /** The configuration file that is not there. */
  configFile: string;
  /** The terminal to ask on. */
  term: Term;
  /** One line of the asking command's own output. */
  say(line: string): void;
  /** How `ahpd configure` is run when the answer is yes. Replaced in a test. */
  run?: () => Promise<void>;
}

/**
 * Offer `ahpd configure` to a daemon with no configuration file, and run it.
 *
 * Answers whether it was run, which the caller reads by starting as it meant
 * to: a run that was configured reads the file that was just written.
 *
 * Nothing is asked without a terminal, so a script and a service carry on to the
 * refusal they get today rather than blocking on a prompt no one can see. The
 * question is asked before anything is started, so the detached child `ahpd
 * start` spawns, which has no terminal of its own, never asks one.
 */
export async function offerConfigure(options: OfferOptions): Promise<boolean> {
  if (existsSync(options.configFile) || !answering(options.term)) return false;
  const wanted = await confirm('No configuration. Run ahpd configure now?', true, options.term);
  if (!wanted) {
    options.say('Not run. Nothing was configured.');
    return false;
  }
  await (options.run ?? (() => runConfigure(options.configFile, options.term, options.say)))();
  return true;
}

/** Whether a folder is one of the folders, or is under one of them. */
const under = (folder: string, served: string): boolean => {
  const inside = resolve(folder);
  const above = resolve(served);
  return inside === above || inside.startsWith(above.endsWith(sep) ? above : `${above}${sep}`);
};

/**
 * Ask to serve the folder this was started in, and keep the answer.
 *
 * A folder a host serves is one its agents read, edit and run in, which is what
 * Claude Code asks a person to trust before it does, so a folder under none of
 * them is asked about rather than served quietly - decision
 * `a-start-in-an-unserved-folder-asks-to-serve-it`.
 *
 * Yes writes the folder to the configuration file, so it is asked once, and adds
 * it to this run's folders, because the options were read before the question
 * was asked. Everything else starts without it: a folder already under one that
 * is served, `--no-cwd`, and a terminal with nobody to answer on.
 */
export async function askToServe(options: Options, configFile: string, term: Term, say: (line: string) => void): Promise<void> {
  if (options.noCwd || !answering(term)) return;
  const folder = resolve(process.cwd());
  if (options.paths.some((one) => under(folder, one))) return;
  // No is what Enter keeps, because a folder is a grant and Enter should not
  // make one.
  if (!await confirm(`Serve ${folder}?`, false, term)) return;
  const held = readEntry(configFile);
  const paths = Array.isArray(held.paths) ? held.paths.filter((one): one is string => typeof one === 'string') : [];
  writeEntry(configFile, { ...held, paths: [...paths, folder] });
  options.paths.push(folder);
  say(`Added ${folder} to "paths" in ${configFile}.`);
}

export const declareConfigure = (registry: Registry<object>): Command => registry.action({
  id: 'daemon.configure',
  summary: 'Ask for each setting a first install needs, and write it',
  description: 'Every question shows the value the configuration holds now, and Enter keeps it. A backend chosen and not already named is installed into the configuration directory.',
  surfaces: { cli: { pattern: ['configure'] } },
  input: { configFile: serverFields.configFile },
  run: async (context) => {
    // With a payload asked for, the lines are diagnostics and go to stderr,
    // because stdout is the answer.
    const payload = context.globals['json'] === true || context.globals['quiet'] === true;
    const done = await configure({
      configDir: configDir(),
      configFile: context.optional<string>('configFile') ?? configPath(),
      version: version(),
      term: here,
      run: runProgram,
      fetch,
      say: (line) => {
        if (payload) context.error(line);
        else context.write(`${line}\n`);
      },
    });
    return output(done, '');
  },
});