/*
 * Updating the daemon, which is installing `@ahpd/server` the way it was
 * installed and then moving every plugin with it.
 *
 * The first question is where this daemon's own package is. A global install is
 * replaced by `npm install -g --prefix <prefix>`, and a folder with its own
 * `package.json` by `npm install --prefix <dir>`; a checkout and a linked
 * package are neither, because the folder that would change is not one npm put
 * there, and both are refused with the same sentence rather than guessed at.
 *
 * The plugins move with the daemon because they peer on `@ahpd/sdk`: each one
 * is checked for a version that admits the new sdk *before* npm replaces
 * anything, so a plugin that cannot load after the update refuses it while the
 * old daemon still runs. The successor check is the last step before the
 * restart, because the files it reads are the ones npm just wrote.
 *
 * Everything here answers over passed-in facts - the path module, the folder
 * checks, how npm runs, how the registry is asked - so the cases can be driven
 * without an install, a registry or a terminal.
 */

import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FOREGROUND, busy, notRestartable } from './commands/restart.js';
import type { Running } from './daemon.js';
import { fittingVersion, launch, npmFailed, pluginRoot, registryPluginsIn, updatePlugins } from './install.js';
import type { Launch, Moved, Ran, Runner } from './install.js';
import { askRegistry, newer, parse, registryPath } from './update.js';
import type { Fetch } from './update.js';
import type { HelperManifest } from './updater.js';
import { packageRoot, version } from './version.js';

/** Where this daemon's package is installed, as the npm call that replaces it reads the place. */
export interface Place {
  /**
   * `global` for npm's own prefix, which the install is given with `-g` and
   * `--prefix`; `prefix` for a folder whose own `package.json` made it a
   * project, which is given `--prefix` alone.
   */
  kind: 'global' | 'prefix';
  /** The folder npm is given: the global prefix, or the project folder. */
  prefix: string;
}

/** What reading the install place is given, so the layout can be answered without this machine's own install. */
export interface PlaceFacts {
  /** The package root the running code came from; absent is the one `packageRoot` finds. */
  root?: string | undefined;
  /** The platform whose install layout is read; absent is this one. */
  platform?: NodeJS.Platform;
  /** Whether a file is there; absent is `existsSync`. */
  exists?: (path: string) => boolean;
  /** The real path of a folder, resolving links; absent is `realpathSync`. */
  real?: (path: string) => string;
}

/**
 * The one sentence a folder that cannot be replaced is refused with.
 *
 * The folder is named and it is the only path the sentence carries: a person
 * running `ahpd update` on a checkout is told what to update by hand, not where
 * some other ahpd, or some other package, happens to be.
 */
const refused = (root: string): never => {
  throw new Error(`${root} is not an npm install of @ahpd/server that ahpd can update; update it by hand`);
};

/**
 * Where this daemon is installed, or why an update cannot replace it.
 *
 * A link is refused first, whatever its shape: `npm link` leaves a package
 * folder that resolves somewhere else, and replacing the link would leave the
 * code that is actually running where it was. A checkout is refused by its
 * shape, since no npm prefix explains a package under `packages/server`.
 *
 * Linux and macOS put a global package under `<prefix>/lib/node_modules`, and
 * Windows puts it under `<prefix>/node_modules`. The second shape is a project
 * folder when its `package.json` is above the packages - npm treats any folder
 * with one as a project - so it is a prefix install there, and otherwise the
 * Windows global layout.
 */
export const installPlace = (facts: PlaceFacts = {}): Place => {
  const root = facts.root ?? packageRoot();
  if (root === undefined) {
    throw new Error('This ahpd has no package.json above it, so its install cannot be found; update it by hand');
  }
  const platform = facts.platform ?? process.platform;
  const exists = facts.exists ?? existsSync;
  const real = facts.real ?? realpathSync;
  const path = platform === 'win32' ? win32 : posix;

  // A folder that resolves somewhere else is a link, and the package the update
  // would replace is the one behind it.
  let actual: string;
  try { actual = real(root); }
  catch { return refused(root); }
  // Windows paths differ in case between what npm writes and what the file
  // system reports, which is not a link; every other difference is.
  const same = platform === 'win32' ? actual.toLowerCase() === root.toLowerCase() : actual === root;
  if (!same) return refused(root);

  const packages = path.join('node_modules', '@ahpd', 'server');
  // npm's global layout on Linux and macOS: the packages sit under `lib`.
  const fourUp = path.dirname(path.dirname(path.dirname(path.dirname(root))));
  if (platform !== 'win32' && root === path.join(fourUp, 'lib', packages)) {
    return { kind: 'global', prefix: fourUp };
  }

  const threeUp = path.dirname(path.dirname(path.dirname(root)));
  if (root !== path.join(threeUp, packages)) return refused(root);
  // npm reads any folder with a package.json as a project, so a project's own
  // install is a prefix install even where a global one would look the same.
  if (exists(path.join(threeUp, 'package.json'))) return { kind: 'prefix', prefix: threeUp };
  if (platform === 'win32') return { kind: 'global', prefix: threeUp };
  return refused(root);
};

/** The package this is, which an update replaces with a newer version of itself. */
export const SERVER = '@ahpd/server';

/** The version npm calls current, or a refusal when the registry does not answer with one. */
const latestOnNpm = async (fetch?: Fetch | undefined): Promise<string> => {
  const said = await askRegistry(`-/package/${registryPath(SERVER)}/dist-tags`, { fetch }) as { latest?: unknown } | null | undefined;
  if (typeof said?.latest !== 'string') {
    throw new Error(`The registry did not say which version of ${SERVER} is latest; name one with --version.`);
  }
  return said.latest;
};

/** What planning an update is given, so the cases can be answered without a registry, a daemon or an install. */
export interface PlanOptions {
  /** The version to move to; absent asks npm for the latest. */
  version?: string | undefined;
  /** Whether a running turn does not refuse the update. */
  force?: boolean | undefined;
  /** The daemon's record, as `ahpd start` wrote it; absent is a daemon in the foreground. */
  record?: Running | undefined;
  /**
   * The pid a restartable record must name; absent is the recorded daemon's own
   * pid, which is where a terminal stands when it asks.
   */
  self?: number | undefined;
  /** The sessions with a turn running; absent is none, as a terminal cannot see them. */
  turning?: readonly string[] | undefined;
  /** How the registry is asked; absent is the global `fetch`. */
  fetch?: Fetch | undefined;
  /** What `installPlace` reads; absent is this machine's own install. */
  place?: PlaceFacts | undefined;
}

/** What an update would move to, or the one sentence that refuses it. */
export type Planned =
  | { current: string; latest: string; place: Place }
  | { current: string; latest: string; why: string };

/**
 * The version to move to, and whether the daemon may be updated to it.
 *
 * The target is the version named, or npm's latest. It has to be newer than
 * the running version: reinstalling the same one is not an update, and an
 * older one is a downgrade the recorded line and the plugins were not checked
 * for. The daemon then has to be one a restart can start again, with the same
 * refusals `daemon.restart` gives; a turn running refuses it unless forced; and
 * the install place has to be one npm can replace.
 *
 * A refusal is an answer rather than a throw, because `--check` reports it: the
 * caller gets the versions either way, and `why` when there is one.
 */
export async function planUpdate(options: PlanOptions = {}): Promise<Planned> {
  const current = version();
  const latest = options.version ?? await latestOnNpm(options.fetch);
  const refused = (why: string): Planned => ({ current, latest, why });
  if (!newer(latest, current)) {
    return refused(`${latest} is not newer than the running ${current}; there is nothing to update to.`);
  }
  const record = options.record;
  const cannot = record === undefined ? FOREGROUND : notRestartable(record, options.self ?? record.pid);
  if (cannot !== undefined) return refused(cannot);
  const turning = options.turning ?? [];
  if (turning.length > 0 && options.force !== true) return refused(busy(turning));
  try {
    return { current, latest, place: installPlace(options.place) };
  }
  catch (error) {
    return refused(error instanceof Error ? error.message : String(error));
  }
}

/** The flag that lets npm run the build of `node-pty`, which arrives in npm 11.16. */
const ALLOW_SCRIPTS = '--allow-scripts=node-pty';

/** The npm release that first knows `--allow-scripts`. */
const ALLOW_SCRIPTS_FROM: readonly [number, number] = [11, 16];

/**
 * Whether npm, at the version it said, takes `ALLOW_SCRIPTS`.
 *
 * An answer that is not a version, or none at all, is an npm that is not known
 * to take it: the flag is left off rather than a call failed for a flag the
 * npm in hand may not know.
 */
const allowsScripts = (read: string | undefined): boolean => {
  const found = read === undefined ? undefined : parse(read.trim());
  if (found === undefined) return false;
  const [major, minor] = found.numbers;
  return major > ALLOW_SCRIPTS_FROM[0] || (major === ALLOW_SCRIPTS_FROM[0] && minor >= ALLOW_SCRIPTS_FROM[1]);
};

/**
 * A runner that keeps a program's output instead of passing it on.
 *
 * The ordinary runner hands standard output to this process's standard error,
 * which is right for npm's progress and wrong for the one question here that
 * is answered in the output: npm's own version. Its standard error is kept for
 * the same reason, though a version that failed says only its exit status.
 */
const capture: Runner = (program, argv) => new Promise((done) => {
  const started = launch(program, argv, process.platform, process.env, process.execPath, existsSync);
  const child = spawn(started.command, started.args, { stdio: ['ignore', 'pipe', 'pipe'], shell: started.shell, windowsHide: true });
  let stdout = '';
  let stderr = '';
  let settled = false;
  const finish = (answer: Ran): void => {
    if (settled) return;
    settled = true;
    done(answer);
  };
  child.stdout?.on('data', (chunk: Buffer) => { stdout += String(chunk); });
  child.stderr?.on('data', (chunk: Buffer) => { stderr += String(chunk); });
  child.once('error', (error: Error) => { finish({ code: -1, stdout, stderr: error.message }); });
  child.once('close', (code: number | null) => { finish({ code: code ?? -1, stdout, stderr }); });
});

/** npm's own version, as `npm --version` answers it, or nothing when it cannot be asked. */
export const npmVersion = async (): Promise<string | undefined> => {
  const done = await capture('npm', ['--version']);
  return done.code === 0 ? done.stdout.trim() : undefined;
};

/** What installing the server is given, so npm and its version can be answered without a terminal. */
export interface InstallOptions {
  /** Where the package is installed, as `installPlace` read it. */
  place: Place;
  /** The version to install. */
  version: string;
  /** How npm is run. */
  run: Runner;
  /** One line of the update's own output. */
  say(line: string): void;
  /**
   * npm's own version, which decides whether `--allow-scripts` is passed;
   * absent asks npm. Only a global install is asked about, since a prefix
   * install never takes the flag.
   */
  npmVersion?: (() => Promise<string | undefined>) | undefined;
}

/**
 * The npm call that installs `version` into `place`, as `installServer` runs it
 * and as the Windows helper is handed it.
 *
 * A global install is npm's own prefix, which has to be named back to npm with
 * both `-g` and `--prefix`: `--prefix` alone would be read as a project folder.
 * A prefix install is that project folder, and the same one npm installed the
 * package into. The version is named exactly, so a `latest` that moved between
 * the plan and the call installs what was checked rather than what is newer.
 *
 * `--allow-scripts=node-pty` is passed to a global install when npm is 11.16 or
 * later, as the one-line install does, because `node-pty` is a native
 * dependency whose build npm would otherwise not run. A prefix install never
 * takes it: npm refuses the flag on a project install from 12.
 */
const installArgv = async (
  place: Place,
  version: string,
  readNpm: (() => Promise<string | undefined>) | undefined,
): Promise<string[]> => {
  const argv = ['install'];
  if (place.kind === 'global') {
    argv.push('-g');
    const npm = readNpm === undefined ? await npmVersion() : await readNpm();
    if (allowsScripts(npm)) argv.push(ALLOW_SCRIPTS);
  }
  argv.push('--prefix', place.prefix, `${SERVER}@${version}`);
  return argv;
};

/** Install `version` where this daemon's package already is. */
export async function installServer(options: InstallOptions): Promise<void> {
  const spec = `${SERVER}@${options.version}`;
  const argv = await installArgv(options.place, options.version, options.npmVersion);
  options.say(`Installing ${spec} with npm.`);
  const done = await options.run('npm', argv);
  if (done.code !== 0) throw npmFailed(`npm could not install ${spec}`, done);
  options.say(`Installed ${spec} into ${options.place.prefix}.`);
}

/**
 * The `main.js` of the package npm installs: what the Windows helper runs to
 * move the plugins and to start the daemon again.
 *
 * Both layouts Windows has put the package under `<prefix>/node_modules`, a
 * global install and a project alike, so this is one path either way.
 */
export const packageEntry = (place: Place): string => win32.join(place.prefix, 'node_modules', '@ahpd', 'server', 'dist', 'main.js');

/** The child a hand-off started, as much of it as the hand-off uses. */
export interface Started {
  /** Let this process go, so the helper outlives the daemon that started it. */
  unref(): void;
}

/** How the helper is started, so a case can watch it without a process. */
export type Starter = (command: string, args: string[], options: {
  cwd: string;
  detached: boolean;
  stdio: 'ignore';
  windowsHide: boolean;
}) => Started;

/** What handing an update to the Windows helper is given, so a case can answer it without a process. */
export interface HelperOptions {
  /** The daemon to wait for. */
  pid: number;
  /** Where the package is installed, which `packageEntry` reads. */
  place: Place;
  /** The version npm installs, which is the `@ahpd/sdk` the plugins move to. */
  version: string;
  /** The configuration folder the plugin root sits under. */
  configDir: string;
  /** The recorded line, without `start`, the daemon is started with again. */
  line: readonly string[];
  /** The daemon's own starting folder; absent is the log's folder. */
  cwd?: string | undefined;
  /** The daemon log, where each step is written. */
  log: string;
  /** The platform whose npm call is made; absent is this one. */
  platform?: NodeJS.Platform | undefined;
  /** npm's own version, which decides `--allow-scripts`; absent asks npm. */
  npmVersion?: (() => Promise<string | undefined>) | undefined;
  /** The helper to copy; absent is the `updater.js` built beside this file. */
  helper?: string | undefined;
  /** The folder the copy is made under; absent is the system temporary folder. */
  tmp?: string | undefined;
  /** How the helper is started; absent is `spawn`. */
  start?: Starter | undefined;
  /** How long the helper waits for the daemon, in milliseconds; absent is a minute. */
  waitMs?: number | undefined;
}

/** What a hand-off made: the folder it copied into, and the helper the copy runs. */
export interface HandedOff {
  folder: string;
  helper: string;
}

/** The helper as built: beside this module, in the package's own `dist`. */
const helperBeside = (): string => join(dirname(fileURLToPath(import.meta.url)), 'updater.js');

/**
 * Copy the helper out of the install and start it detached, with a manifest
 * beside it.
 *
 * The copy is what runs. The `updater.js` beside the package is a file npm is
 * about to replace, and a script read from the middle of an install is a script
 * that may not be there when it is read; a folder under the system temporary
 * folder has nothing to do with either version of the package. The manifest
 * carries everything the helper needs, because nothing it could read from the
 * daemon's files survives the install.
 *
 * The helper is started with this Node, detached and with its own standard
 * streams ignored, so the daemon that started it can go without waiting for it
 * and without holding the pipe open. Its working folder is the copy's own,
 * which it removes when it ends.
 */
export const handOffToHelper = async (options: HelperOptions): Promise<HandedOff> => {
  const helper = options.helper ?? helperBeside();
  if (!existsSync(helper)) {
    throw new Error(`${helper} is missing, so this install of ahpd cannot hand an update over on Windows`);
  }
  const platform = options.platform ?? process.platform;
  const npm = launch(
    'npm',
    await installArgv(options.place, options.version, options.npmVersion),
    platform,
    process.env,
    process.execPath,
    existsSync,
  );
  const folder = mkdtempSync(join(options.tmp ?? tmpdir(), 'ahpd-update-'));
  try {
    const copy = join(folder, 'updater.mjs');
    copyFileSync(helper, copy);
    const manifest: HelperManifest = {
      pid: options.pid,
      npm,
      entry: packageEntry(options.place),
      configDir: options.configDir,
      version: options.version,
      line: [...options.line],
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      log: options.log,
      ...(options.waitMs === undefined ? {} : { waitMs: options.waitMs }),
    };
    const file = join(folder, 'update.json');
    writeFileSync(file, `${JSON.stringify(manifest, undefined, 2)}\n`);
    const start: Starter = options.start ?? ((command, args, how) => spawn(command, args, how) as unknown as Started);
    start(process.execPath, [copy, file], { cwd: folder, detached: true, stdio: 'ignore', windowsHide: true }).unref();
    return { folder, helper: copy };
  }
  catch (error) {
    // A folder left behind by a hand-off that did not start is one nothing
    // would ever remove.
    try { rmSync(folder, { recursive: true, force: true }); }
    catch { /* nothing else to do */ }
    throw error;
  }
};

/** What checking and moving the plugins is given, so a case can answer it without npm or a configuration. */
export interface PluginOptions {
  /** The configuration directory, which holds the plugin root when `AHPD_PLUGIN_ROOT` is unset. */
  configDir: string;
  /** The version being installed, which is the `@ahpd/sdk` every plugin moves to. */
  version: string;
  /** How npm is run. */
  run: Runner;
  /** How the registry is asked which versions of a plugin fit. */
  fetch: Fetch;
  /** Whether a plugin no version admits is said and left rather than refusing the update. */
  force?: boolean | undefined;
  /** One line of the update's own output. */
  say(line: string): void;
}

/** What the plugin check found: the packages it asked about, and the ones no version admits. */
export interface PluginCheck {
  /** The plugins installed from the registry, in the order the root lists them. */
  plugins: string[];
  /** The plugins no version admits, which `force` leaves where they are. */
  left: string[];
}

/**
 * Ask the registry, for each plugin installed from it, whether a version of it
 * admits the sdk being installed.
 *
 * A plugin with no such version cannot follow the daemon: the daemon that
 * starts next would refuse to load the version left behind. So the update is
 * refused here, before npm replaces anything, with the same words
 * `plugin update` refuses it with. With `force` each one is said and answered
 * as left, and the plugins that do fit move as they would have.
 *
 * A registry that cannot be asked is not a refusal: `fittingVersion` answers
 * nothing to it, and npm's own `latest` decides, as it does for `plugin
 * update`.
 */
export async function checkPlugins(options: PluginOptions): Promise<PluginCheck> {
  const names = registryPluginsIn(pluginRoot(options.configDir));
  const checked = await Promise.all(names.map(async (name): Promise<{ name: string; why: string } | undefined> => {
    try {
      await fittingVersion(name, options.version, { fetch: options.fetch });
      return undefined;
    }
    catch (error) {
      return { name, why: error instanceof Error ? error.message : String(error) };
    }
  }));
  const unfit = checked.filter((one): one is { name: string; why: string } => one !== undefined);
  const first = unfit[0];
  if (first !== undefined && options.force !== true) throw new Error(first.why);
  for (const one of unfit) options.say(one.why);
  return { plugins: names, left: unfit.map((one) => one.name) };
}

/**
 * Move every plugin in the root to the sdk being installed, answering what
 * moved.
 *
 * This is `plugin update all` with the new version in place of the running
 * daemon's: `@ahpd/sdk` is pinned at it, and each plugin goes to the newest of
 * its own versions whose range admits it. The fitted versions were checked
 * before npm installed the daemon, so the same registry answers are chosen
 * again; a plugin the registry cannot be asked about still moves to `latest`.
 */
export async function movePlugins(options: PluginOptions): Promise<Moved[]> {
  return updatePlugins('all', {
    configDir: options.configDir,
    version: options.version,
    run: options.run,
    fetch: options.fetch,
    say: options.say,
  });
}
