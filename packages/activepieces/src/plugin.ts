import { fork } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOGO_LIMIT, LOGO_TIMEOUT_MS, logoOf } from './logos.js';
import type { NetworkMode } from './guard.js';
import { adapterOf, nameOf } from './mapping.js';
import { isAnswer, isOutput } from './wire.js';
import type { ChildProcess } from 'node:child_process';
import type { Logo } from './logos.js';
import type { RunCallArgs } from './mapping.js';
import type { Answer, PieceDescription, Question } from './wire.js';
import type { ActionCall, Plugin, PluginHost } from '@ahpd/sdk';

/**
 * The package as a plugin.
 *
 * The `pieces` option names one Activepieces package for each piece the
 * daemon offers. `apply` forks the engine, the process Activepieces runs piece
 * code in, and asks it what those pieces are; each piece that loads becomes an
 * adapter, and each of its actions is a tool the host offers to a session or a
 * bot that binds a connector of it.
 *
 * The engine is separate because a piece turns off TLS checks for the process
 * it runs in. It answers as plain JSON, and it carries no secret from one call
 * to the next: every request brings its own.
 */

/** The plugin's id, unique among the plugins a daemon loads. */
export const name = 'activepieces';

/** What a listing prints. */
export const title = 'Activepieces connectors';

/** One line saying what went wrong, without a stack. */
const reason = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** The engine's entry: the source beside this module in development, the build otherwise. */
const enginePath = (here: URL = new URL(import.meta.url)): string =>
  fileURLToPath(new URL(here.pathname.endsWith('.ts') ? './engine.ts' : './engine.js', here));

/** The piece packages named in the options. */
const asked = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((one): one is string => typeof one === 'string' && one !== '') : [];

/**
 * One package name with an optional version after it, as npm writes it.
 *
 * The name is a package's, scoped or not; the version is whatever npm takes
 * after the last `@`. A URL or a path matches none of this, because a package
 * name holds no colon and no `/` before its scope.
 */
const PACKAGE = /^(@[^/@\s:]+\/[^/@\s:]+|[^/@\s:][^/@\s:]*?)(?:@([^@\s:]+))?$/u;

/** One piece the options name. */
interface Wanted {
  /** What the engine imports and npm installs: the package, without a version. */
  package: string;
  /** What the options wrote, which is what an install is asked for. */
  spec: string;
  /** The version written after the name, when one was. */
  version?: string;
  /** Whether the name is an npm package, rather than a URL or a path. */
  named: boolean;
}

/** Split one written name into its package and the version after it. */
const wanted = (written: string): Wanted => {
  const found = PACKAGE.exec(written);
  if (found === null) return { package: written, spec: written, named: false };
  return {
    package: found[1] as string,
    spec: written,
    named: true,
    ...(found[2] === undefined ? {} : { version: found[2] }),
  };
};

/** What a package's own `package.json` says, from the folder it sits in. */
const manifestAt = (folder: string): Record<string, unknown> | undefined => {
  try {
    const found: unknown = JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8'));
    return typeof found === 'object' && found !== null ? found as Record<string, unknown> : undefined;
  }
  catch {
    return undefined;
  }
};

/** Where a folder's `node_modules` holds one package, and what that package says. */
const manifestIn = (folder: string, packageName: string): Record<string, unknown> | undefined =>
  manifestAt(join(folder, 'node_modules', ...packageName.split('/')));

/** The plugin's own resolution, which is the one the engine imports a piece by. */
const own = createRequire(import.meta.url);

/**
 * What the plugin's own `node_modules` holds for one package.
 *
 * The file a package resolves to sits somewhere inside it, so the folder is
 * found by walking up to the one whose `package.json` names the package. A
 * package that is not there, or one Node cannot resolve without an `import`
 * condition, answers nothing.
 */
const manifestOfOwn = (packageName: string): Record<string, unknown> | undefined => {
  let at: string;
  try {
    at = own.resolve(packageName);
  }
  catch {
    return undefined;
  }
  let folder = dirname(at);
  for (;;) {
    const manifest = manifestAt(folder);
    if (manifest?.['name'] === packageName) return manifest;
    const up = dirname(folder);
    if (up === folder) return undefined;
    folder = up;
  }
};

/** The version one package's manifest says, if it says one. */
const versionOf = (manifest: Record<string, unknown> | undefined): string | undefined =>
  typeof manifest?.['version'] === 'string' ? manifest['version'] : undefined;

/** What the plugin holds for one package now. */
interface Found {
  /** Whether the package is anywhere the engine can import it from. */
  present: boolean;
  /** The version of the package that is there, when its manifest says one. */
  version?: string;
}

/**
 * Where one piece is now: the plugin's own `node_modules` first, then its
 * `installed/` folder.
 *
 * The order is the one the engine imports in, so a version written in the
 * options is compared with the version the engine would load.
 */
const foundPiece = (packageName: string, installed: string | undefined): Found => {
  const manifests = [
    ...(installed === undefined ? [] : [manifestIn(dirname(installed), packageName)]),
    manifestOfOwn(packageName),
    ...(installed === undefined ? [] : [manifestIn(installed, packageName)]),
  ];
  const manifest = manifests.find((one) => one !== undefined);
  if (manifest === undefined) return { present: false };
  return typeof manifest['version'] === 'string' ? { present: true, version: manifest['version'] } : { present: true };
};

/** One line the engine wrote about a piece, as the package it names and the reason. */
const failureOf = (line: string, pieces: Wanted[]): { package?: string; why: string } => {
  for (const one of pieces) {
    const lead = `${one.package}: `;
    if (line.startsWith(lead)) return { package: one.package, why: line.slice(lead.length) };
  }
  return { why: line };
};

/** The engine's settings, as the plugin's options give them. */
export interface EngineSettings {
  /**
   * Activepieces' `AP_NETWORK_MODE`, the operator's switch: `STRICT` installs
   * the engine's SSRF guard, `UNRESTRICTED` does not. `UNRESTRICTED` when the
   * options name none, which is Activepieces' own default: the boundary a
   * piece's connections meet is the network the operator runs the daemon in,
   * and `STRICT` is the guard the operator turns on in the engine besides.
   * https://github.com/activepieces/activepieces/blob/0a2f7057077cecdc2f014c03475f4b19ecd5dcb8/packages/server/api/src/app/helper/system/system.ts#L68
   * https://github.com/activepieces/activepieces/blob/0a2f7057077cecdc2f014c03475f4b19ecd5dcb8/docs/install/architecture/network-security.mdx#L21-L45
   */
  networkMode?: NetworkMode;
  /** Activepieces' `AP_SSRF_ALLOW_LIST`: the addresses and CIDR ranges the guard lets through. */
  ssrfAllowList?: readonly string[];
  /**
   * The variables of the daemon's environment the engine is given, by name:
   * Activepieces' `AP_SANDBOX_PROPAGATED_ENV_VARS`, none by default.
   */
  sandboxPropagatedEnvVars?: readonly string[];
}

/**
 * The engine's environment, as Activepieces' sandbox builds it: a home of its
 * own, the network mode and the allow list the guard reads, the list of what
 * was propagated, and each of those variables the daemon has. A piece is
 * third-party code, and the daemon's environment holds its own token and
 * whatever keys its agents read, so nothing else of it passes. The home is the
 * system's temporary folder, which is what Activepieces' `/tmp/` is on the
 * machine the engine runs on.
 * https://github.com/activepieces/activepieces/blob/0a2f7057077cecdc2f014c03475f4b19ecd5dcb8/packages/server/sandbox/src/lib/create-sandbox-for-job.ts#L76-L121
 */
export const sandboxEnv = (settings: EngineSettings = {}, env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv => {
  const propagated = settings.sandboxPropagatedEnvVars ?? [];
  const allowList = settings.ssrfAllowList ?? [];
  return {
    HOME: tmpdir(),
    // A step's file is held to 25 MB, Activepieces' default `AP_MAX_FILE_SIZE_MB`.
    // https://github.com/activepieces/activepieces/blob/0a2f7057077cecdc2f014c03475f4b19ecd5dcb8/docs/install/configuration/limits.mdx
    AP_MAX_FILE_SIZE_MB: '25',
    AP_NETWORK_MODE: settings.networkMode ?? 'UNRESTRICTED',
    ...(allowList.length === 0 ? {} : { AP_SSRF_ALLOW_LIST: allowList.join(',') }),
    ...(propagated.length === 0 ? {} : { AP_SANDBOX_PROPAGATED_ENV_VARS: propagated.join(',') }),
    ...Object.fromEntries(propagated.flatMap((key) => {
      const value = env[key];
      return value === undefined || value === '' ? [] : [[key, value]];
    })),
  };
};

/** One answer waiting for its request, by the request's id. */
type Waiting = Map<number, (answer: Answer) => void>;

/** The engine process, the answers it still owes, and who hears each running action's output. */
interface Running {
  process: ChildProcess;
  waiting: Waiting;
  outputs: Map<number, (data: unknown) => void>;
}

/** The engine, started on demand and started again after it exits, five times at most. */
export interface Engine {
  /** Ask one question, and answer its answer; `output` hears what a running action says before it. */
  ask(request: Question, output?: (data: unknown) => void): Promise<Answer>;
  /** Close the channel, which the engine exits on. */
  stop(): void;
}

/**
 * How many times an engine that exited is started again, VS Code's bound on
 * restarting its own agent host process.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostService.ts#L17-L20
 */
const MAX_RESTARTS = 5;

/**
 * The engine process this plugin talks to.
 *
 * Nothing is started until the first question, and an engine that exited is
 * started again by the next one, as VS Code restarts its agent host after an
 * unexpected exit. After five restarts the next exit is the last: every later
 * question is refused in words. A question that was in flight when the engine
 * went away is answered as failed rather than left waiting.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostService.ts#L78-L92
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostService.ts#L206-L248
 */
export function engine(host: PluginHost, settings: EngineSettings = {}): Engine {
  let running: Running | undefined;
  let seq = 0;
  let restarts = 0;
  let exited = false;
  let limitReached = false;

  const start = (): Running => {
    if (exited) restarts += 1;
    const forked = fork(enginePath(), [], {
      /*
       * No inherited flags: the daemon may be run with `--watch`, which would
       * restart the engine on a source change and break the channel under a
       * call. The engine is built beside this module, or it is the source,
       * which Node reads with its types stripped.
       */
      execArgv: [],
      env: sandboxEnv(settings),
      stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
    });
    const waiting: Waiting = new Map();
    const outputs = new Map<number, (data: unknown) => void>();
    const opened: Running = { process: forked, waiting, outputs };

    const fail = (message: string): void => {
      for (const [id, done] of waiting) {
        waiting.delete(id);
        outputs.delete(id);
        done({ type: 'failed', id, message });
      }
    };

    forked.on('message', (message: unknown) => {
      if (isOutput(message)) {
        outputs.get(message.id)?.(message.data);
        return;
      }
      if (!isAnswer(message)) return;
      const done = waiting.get(message.id);
      if (done === undefined) return;
      waiting.delete(message.id);
      outputs.delete(message.id);
      done(message);
    });
    forked.on('error', (error: unknown) => {
      host.problem(`${name}: the engine process failed: ${reason(error)}`);
      fail(`the engine process failed: ${reason(error)}`);
    });
    forked.on('exit', (code, signal) => {
      const unexpected = running === opened;
      if (unexpected) running = undefined;
      const said = signal ?? String(code);
      fail(`the engine process exited (${said})`);
      if (!unexpected) return;
      exited = true;
      if (restarts < MAX_RESTARTS) {
        host.log.warn(`${name}: the engine process terminated unexpectedly with code ${said}`);
        return;
      }
      limitReached = true;
      host.log.error(`${name}: the engine process terminated with code ${said}, giving up after ${MAX_RESTARTS} restarts`);
    });

    running = opened;
    return opened;
  };

  return {
    ask: (request, output) => {
      if (limitReached) {
        return Promise.resolve({ type: 'failed', id: 0, message: `The engine process stopped after ${MAX_RESTARTS} restarts.` });
      }
      const opened = running ?? start();
      const id = ++seq;
      return new Promise<Answer>((resolve) => {
        opened.waiting.set(id, resolve);
        if (output !== undefined) opened.outputs.set(id, output);
        opened.process.send({ ...request, id }, undefined, undefined, (error) => {
          if (error === null) return;
          const done = opened.waiting.get(id);
          if (done === undefined) return;
          opened.waiting.delete(id);
          opened.outputs.delete(id);
          done({ type: 'failed', id, message: reason(error) });
        });
      });
    },
    stop: () => {
      const opened = running;
      running = undefined;
      opened?.process.disconnect();
    },
  };
}

/**
 * How long one action may run, in milliseconds: Activepieces' single action
 * run timeout, `AP_FLOW_TIMEOUT_SECONDS`, 600 by default.
 * https://github.com/activepieces/activepieces/blob/0a2f7057077cecdc2f014c03475f4b19ecd5dcb8/docs/install/configuration/limits.mdx
 */
const ACTION_RUN_TIMEOUT_MS = 600_000;

/**
 * The answer to one call, or a failure when it runs past the timeout, worded
 * as Activepieces answers a timed-out action run: it may have done part of its
 * work, so it is not to be run again blindly.
 *
 * A late answer arrives at a promise nothing waits on, which is how a call
 * that gave up is dropped. The engine stays up, and its next call answers.
 * https://github.com/activepieces/activepieces/blob/0a2f7057077cecdc2f014c03475f4b19ecd5dcb8/packages/server/api/src/app/mcp/tools/flow-run-utils.ts
 */
const awaited = async (answer: Promise<Answer>, action: string): Promise<Answer> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<Answer>((resolve) => {
    timer = setTimeout(() => {
      resolve({
        type: 'failed',
        id: 0,
        message: `${action} timed out before it finished. It may have partially completed, so do not re-run it blindly; check the app for a write from this attempt first, or ask the user.`,
      });
    }, ACTION_RUN_TIMEOUT_MS);
  });
  try {
    return await Promise.race([answer, late]);
  } finally {
    clearTimeout(timer);
  }
};

/** Run one action in the engine, its connector's store kept in `stores`, and answer its result. */
const callAction = async (
  channel: Engine,
  piece: PieceDescription,
  call: RunCallArgs,
  setContent: ActionCall['setContent'],
  stores: string | undefined,
  installed: string | undefined,
  installedFirst: boolean,
): Promise<unknown> => {
  // What the action says with `output.update` is the call's partial content,
  // its `data` as JSON text, each update replacing the last.
  const output = setContent === undefined
    ? undefined
    : (data: unknown): void => { setContent([{ type: 'text', text: JSON.stringify(data) }]); };
  const answer = await awaited(channel.ask({
    type: 'run',
    piece: piece.package,
    ...call,
    ...(stores === undefined ? {} : { stores }),
    ...(installed === undefined ? {} : { installed }),
    ...(installedFirst ? { installedFirst: true } : {}),
  }, output), piece.actions.find((one) => one.name === call.action)?.displayName ?? call.action);
  if (answer.type === 'ran') return answer.result;
  throw new Error(answer.type === 'failed' ? answer.message : 'the engine answered a call with a description');
};

export const apply: Plugin['apply'] = async (host, options) => {
  const pieces = asked(options['pieces']).map(wanted);
  /*
   * A piece that is not there, or not at the version the options wrote, is
   * installed before the engine is asked what the pieces are. One install at a
   * time, in the order the options name them, and each answer is the plugin's
   * news on its own row: the version npm left, or why it could not install
   * one. A plugin with no folder of its own answers an error from `install`.
   */
  /*
   * A name with a version is imported from `installed/` when that folder holds
   * the version, even when the plugin ships the piece itself: the version the
   * options wrote is the one that runs.
   */
  const fromInstalled = new Set<string>();
  // A piece whose install failed: its error stays on the row, and no load
  // warning with the same `ref` replaces it.
  const notInstalled = new Set<string>();
  for (const one of pieces) {
    if (!one.named) continue;
    if (one.version === undefined) {
      if (foundPiece(one.package, host.installed).present) continue;
    }
    else {
      if (host.installed !== undefined && versionOf(manifestIn(host.installed, one.package)) === one.version) {
        fromInstalled.add(one.package);
        continue;
      }
      const shipped = host.installed === undefined ? undefined : manifestIn(dirname(host.installed), one.package);
      if (versionOf(shipped ?? manifestOfOwn(one.package)) === one.version) continue;
    }
    const answer = await host.install(one.spec);
    if ('error' in answer) {
      notInstalled.add(one.package);
      host.alert({ level: 'error', ref: `piece:${one.package}`, text: `could not install ${one.spec}: ${answer.error}` });
      continue;
    }
    if (one.version !== undefined) fromInstalled.add(one.package);
    host.alert({ level: 'info', ref: `piece:${one.package}`, text: `installed ${one.package} ${answer.version}` });
  }
  const first = [...fromInstalled];

  const names = (value: unknown): string[] =>
    (Array.isArray(value) ? value.filter((one): one is string => typeof one === 'string' && one !== '') : []);
  const channel = engine(host, {
    networkMode: options['networkMode'] === 'STRICT' ? 'STRICT' : 'UNRESTRICTED',
    ssrfAllowList: names(options['ssrfAllowList']),
    sandboxPropagatedEnvVars: names(options['sandboxPropagatedEnvVars']),
  });
  host.registerClose(() => { channel.stop(); });

  const answer = await channel.ask({
    type: 'describe',
    pieces: pieces.map((one) => one.package),
    ...(host.installed === undefined ? {} : { installed: host.installed }),
    ...(first.length === 0 ? {} : { installedFirst: first }),
  });
  if (answer.type !== 'described') {
    const message = answer.type === 'failed' ? answer.message : 'the engine answered a description with a run';
    host.problem(`${name}: ${message}`);
    return;
  }
  /*
   * A piece that still does not load is a warning on its own row, under the
   * same `ref` an install's own line used: the name of the piece is what a
   * person reads, and the last thing said about it is what is true now.
   */
  for (const error of answer.errors) {
    const failed = failureOf(error, pieces);
    if (failed.package !== undefined && notInstalled.has(failed.package)) continue;
    host.alert({
      level: 'warning',
      ...(failed.package === undefined ? {} : { ref: `piece:${failed.package}` }),
      text: failed.package === undefined ? `a piece did not load: ${failed.why}` : `${failed.package} did not load: ${failed.why}`,
    });
  }
  /*
   * Every logo is asked for at once, so one slow CDN does not hold the others:
   * a piece whose fetch fails still has its adapter, without the icon. A piece
   * with no name has no adapter either, and its spec is no file name to cache
   * under, so it is not fetched.
   */
  // Each connector's store, one file to a connector, beside the logos. A host
  // with no configuration folder keeps the stores in the engine's memory.
  const stores = host.configDir === undefined || host.configDir === '' ? undefined : join(host.configDir, 'activepieces', 'stores');
  const whole = (value: unknown, fallback: number): number =>
    (typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : fallback);
  const bounds = { limitBytes: whole(options['logoLimitBytes'], LOGO_LIMIT), timeoutMs: whole(options['logoTimeoutMs'], LOGO_TIMEOUT_MS) };
  const logos = await Promise.all(answer.pieces.map((piece): Logo | Promise<Logo> => {
    const named = nameOf(piece.package);
    return named === undefined ? {} : logoOf(named, piece.logoUrl, host.configDir, undefined, bounds);
  }));
  for (const [at, piece] of answer.pieces.entries()) {
    const logo = logos[at];
    if (logo?.problem !== undefined) host.problem(logo.problem);
    const installedFirst = fromInstalled.has(piece.package);
    const validate = async (auth: Record<string, unknown>): Promise<{ valid: boolean; error?: string }> => {
      const said = await channel.ask({
        type: 'validate',
        piece: piece.package,
        auth,
        ...(host.installed === undefined ? {} : { installed: host.installed }),
        ...(installedFirst ? { installedFirst: true } : {}),
      });
      if (said.type === 'validated') return { valid: said.valid, ...(said.error === undefined ? {} : { error: said.error }) };
      throw new Error(said.type === 'failed' ? said.message : `the engine answered a check with ${said.type}`);
    };
    const mapped = adapterOf(piece, (call, setContent) => callAction(channel, piece, call, setContent, stores, host.installed, installedFirst), logo?.icon, validate);
    for (const note of mapped.notes) host.problem(note);
    if (mapped.adapter !== undefined) host.registerAdapter(mapped.adapter);
  }
};
