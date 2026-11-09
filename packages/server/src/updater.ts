/*
 * The update helper for Windows, where the daemon cannot install the package it
 * is running from: the `node-pty` binding it loaded is a file npm cannot
 * replace until the process holding it is gone.
 *
 * The daemon copies this file, as built, to a folder outside the install and
 * starts it detached, with a manifest beside it. The helper waits for the
 * daemon's pid to go, runs npm, moves the plugins with the binary npm just
 * installed, and starts the daemon again with the line it recorded. Each step
 * is written to the daemon log, because by then nothing is left running that
 * could answer a caller.
 *
 * Nothing here is imported from the daemon's own modules. The helper runs while
 * npm rewrites them, so the only imports are Node's built-ins, and the package
 * it changes is reached only as a program it starts. The steps are `updateOnce`
 * over `HelperFacts`, so a case can drive them without a daemon, npm or a
 * clock.
 */

import { spawn } from 'node:child_process';
import { appendFileSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * How npm is started, as the daemon read it through `launch` before it went.
 * The shape is the daemon's `Launch`, written again because this file may not
 * import it.
 */
export interface HelperNpm {
  /** The program to start, which is this Node when npm is npm's own `.js` file. */
  command: string;
  /** Its arguments, already quoted when a shell reads them. */
  args: string[];
  /** Whether a shell reads the command line. */
  shell: boolean;
}

/** What one run of a program left behind. */
export interface HelperRan {
  /** Its exit status, or `-1` when it could not be started. */
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * What the helper is told before it starts, written beside it as `update.json`.
 *
 * Everything is a value the daemon read while it was still up: the pid to wait
 * for, the installed `main.js` to run, the recorded line to start it with, and
 * the log to write to. None of it is read from the daemon's files, which npm is
 * about to replace.
 */
export interface HelperManifest {
  /** The daemon to wait for. */
  pid: number;
  /** How npm is started, as `launch` answered it. */
  npm: HelperNpm;
  /** The `main.js` of the package npm installs. */
  entry: string;
  /** The configuration folder, which the plugin root sits under. */
  configDir: string;
  /** The version npm installs, which is the `@ahpd/sdk` the plugins move to. */
  version: string;
  /** The recorded line, without `start`, the daemon is started with again. */
  line: string[];
  /** The folder the daemon was started in; absent is the log's folder. */
  cwd?: string;
  /** The daemon log, where each step is written. */
  log: string;
  /** How long the daemon is given to go before the log says it is late, in milliseconds; absent is a minute. */
  waitMs?: number;
}

/** How one program is run by the helper, so a case can answer it without a process. */
export interface HelperRunOptions {
  /** Whether a shell reads the command line, which npm through `cmd.exe` needs. */
  shell: boolean;
  /** The folder it runs in; absent is the log's folder. */
  cwd?: string | undefined;
  /** The environment it runs with; absent is this process's. */
  env?: NodeJS.ProcessEnv | undefined;
}

/** What running the steps is given, so a case can answer the clock, the process table and the programs. */
export interface HelperFacts {
  /** Whether that pid is still there. */
  alive(pid: number): boolean;
  /** Wait one poll interval. */
  wait(): Promise<void>;
  /** The time now, which `waitMs` is counted against. */
  now(): number;
  /** Run that program, keeping its output. */
  run(program: string, args: readonly string[], options: HelperRunOptions): Promise<HelperRan>;
  /** Write one line of the daemon log. */
  log(line: string): void;
}

/**
 * One line of the daemon log as the daemon writes it: the local time, the level
 * and the line, as `logline.ts` writes a line with no colour. Written out here
 * rather than imported, for the reason at the top of this file.
 */
const logLine = (at: Date, level: 'info' | 'error', line: string): string => {
  const two = (n: number): string => String(n).padStart(2, '0');
  const time = `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())} `
    + `${two(at.getHours())}:${two(at.getMinutes())}:${two(at.getSeconds())}.${String(at.getMilliseconds()).padStart(3, '0')}`;
  return `${time} [${level}] ${line}`;
};

/** How long a daemon is given to go before the log says it is late: a minute. */
const WAIT_MS = 60_000;

/** How often the daemon's pid is looked at, as `ahpd stop` looks. */
const POLL_MS = 100;

/** The first line of a program's output that says anything, so a log line stays one line. */
const firstLine = (said: string): string | undefined => said
  .split(/\r?\n/u)
  .map((line) => line.trim())
  .find((line) => line !== '');

/** Why a program failed, in its own words when it has any. */
const reasonOf = (done: HelperRan): string => firstLine(done.stderr)
  ?? firstLine(done.stdout)
  ?? `it exited with ${String(done.code)}`;

/**
 * The environment the plugin move runs with.
 *
 * `plugin update` takes the plugin root from `AHPD_PLUGIN_ROOT`, or from the
 * configuration folder of its own environment, which need not be the folder the
 * daemon read its plugins from. So the root the daemon would have moved is
 * passed explicitly - unless the daemon had one of its own, which is the same
 * root here and is inherited rather than restated.
 */
const pluginEnv = (manifest: HelperManifest, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv => (
  env.AHPD_PLUGIN_ROOT === undefined
    ? { ...env, AHPD_PLUGIN_ROOT: join(manifest.configDir, 'node_modules') }
    : env
);

/**
 * Wait for the daemon, install the version, move the plugins and start the
 * daemon again, answering the exit status the helper leaves with.
 *
 * The daemon comes first, because the reason the helper exists is a file npm
 * cannot replace while the daemon runs. The daemon was told to go down once it
 * had answered, so the helper waits for as long as that takes: giving up would
 * leave nothing to start it again. A daemon still there at the limit is said in
 * the log, once, and never killed or installed under.
 *
 * A failed npm is not a daemon left down: the old files are still where they
 * were, so the old line is started again and npm's reason is written to the
 * log. The plugin move is the new binary's `plugin update all`, which pins the
 * sdk at its own version; it runs from the completed install, never from the
 * copy that is being replaced.
 */
export async function updateOnce(manifest: HelperManifest, facts: HelperFacts): Promise<number> {
  const say = (line: string): void => { facts.log(logLine(new Date(facts.now()), 'info', `update: ${line}`)); };
  const limit = manifest.waitMs ?? WAIT_MS;
  const cwd = manifest.cwd ?? dirname(manifest.log);
  say(`waiting for pid ${String(manifest.pid)} to stop`);
  const until = facts.now() + limit;
  let late = false;
  while (facts.alive(manifest.pid)) {
    if (!late && facts.now() >= until) {
      late = true;
      say(`pid ${String(manifest.pid)} is still running after ${String(Math.round(limit / 1000))} seconds; waiting for it to stop`);
    }
    await facts.wait();
  }
  const spec = `@ahpd/server@${manifest.version}`;
  say(`installing ${spec} with npm`);
  const installed = await facts.run(manifest.npm.command, manifest.npm.args, { shell: manifest.npm.shell, cwd });
  if (installed.code !== 0) {
    say(`npm could not install ${spec}: ${reasonOf(installed)}`);
    say('starting the daemon again with the files it was running');
    const back = await facts.run(process.execPath, [manifest.entry, 'start', ...manifest.line], { shell: false, cwd });
    if (back.code !== 0) say(`the old daemon did not start again: ${reasonOf(back)}`);
    return 1;
  }
  say(`installed ${spec}`);
  say('moving the plugins to the new sdk');
  const moved = await facts.run(process.execPath, [manifest.entry, 'plugin', 'update', 'all'], {
    shell: false,
    cwd,
    env: pluginEnv(manifest, process.env),
  });
  if (moved.code !== 0) say(`the plugins did not move: ${reasonOf(moved)}`);
  say('starting the daemon');
  const started = await facts.run(process.execPath, [manifest.entry, 'start', ...manifest.line], { shell: false, cwd });
  if (started.code !== 0) {
    say(`the daemon did not start: ${reasonOf(started)}`);
    return 1;
  }
  say('the daemon is up');
  return 0;
}

/** The steps against the real process table, the real clock and real programs. */
const realFacts = (manifest: HelperManifest): HelperFacts => ({
  alive: (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    }
    // On Windows a process this one may not signal is still a process that is
    // there; only a pid the process table does not know is gone.
    catch (error) {
      return (error as { code?: unknown }).code === 'EPERM';
    }
  },
  wait: () => new Promise((done) => { setTimeout(done, POLL_MS); }),
  now: () => Date.now(),
  run: (program, args, options) => new Promise((done) => {
    const child = spawn(program, [...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: options.shell,
      windowsHide: true,
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      ...(options.env === undefined ? {} : { env: options.env }),
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (answer: HelperRan): void => {
      if (settled) return;
      settled = true;
      done(answer);
    };
    child.stdout?.on('data', (chunk: Buffer) => { stdout += String(chunk); });
    child.stderr?.on('data', (chunk: Buffer) => { stderr += String(chunk); });
    child.once('error', (error: Error) => { finish({ code: -1, stdout, stderr: error.message }); });
    child.once('close', (code: number | null) => { finish({ code: code ?? -1, stdout, stderr }); });
  }),
  // A log that cannot be written is not a reason to leave the daemon down, so
  // the failure is swallowed rather than ending the helper before it starts
  // anything.
  log: (line) => {
    try { appendFileSync(manifest.log, `${line}\n`); }
    catch { /* nothing else to do */ }
  },
});

/** Whether this file is the program that was run, rather than a module a case imported. */
const direct = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (direct) {
  const file = process.argv[2];
  if (file === undefined) {
    process.stderr.write('usage: updater.mjs <update.json>\n');
    process.exitCode = 2;
  }
  else {
    const manifest = JSON.parse(readFileSync(file, 'utf8')) as HelperManifest;
    let code = 1;
    try { code = await updateOnce(manifest, realFacts(manifest)); }
    catch (error) {
      const why = error instanceof Error ? error.message : String(error);
      try { appendFileSync(manifest.log, `${logLine(new Date(), 'error', `update: the helper stopped: ${why}`)}\n`); }
      catch { /* nothing else to do */ }
    }
    // The folder is this helper's own, and the daemon it started runs from the
    // install place; a copy left behind is one nothing would ever remove.
    try { rmSync(dirname(file), { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
    catch { /* a temporary folder left behind is not worth a failed update */ }
    process.exitCode = code;
  }
}
