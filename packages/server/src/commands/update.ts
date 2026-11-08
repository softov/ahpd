/**
 * `ahpd update`: the daemon installs a newer `@ahpd/server` and starts it again.
 *
 * The command is the same on both surfaces, and the declaration is the one
 * `daemon.restart` is written beside: `config:write` and, over HTTP, the
 * deployment token alone, because what it changes is the process's own code.
 * `--check` answers without changing anything, which is what a desk asks
 * before it asks for the update itself.
 *
 * Everything the body reads besides the command's input - the record, the turns
 * running, the registry and the install place - is in `UpdateFacts`, so a case
 * can drive it without a daemon, a network or an install of this package.
 */

import { dirname } from 'node:path';
import { output } from '@cofold/commands';
import type { Command, Registry } from '@cofold/commands';
import { INTERNAL_ERROR, RpcError } from '@ahpd/sdk';
import type { PluginMethod } from '@ahpd/sdk';
import { configDir, daemonLog } from '../config.js';
import { running, stop as stopDaemon } from '../daemon.js';
import type { Running } from '../daemon.js';
import { oneAtATime, run as npm } from '../install.js';
import type { Runner } from '../install.js';
import { checkPlugins, handOffToHelper, installServer, movePlugins, planUpdate } from '../selfupdate.js';
import type { HelperOptions, PlaceFacts } from '../selfupdate.js';
import type { Fetch } from '../update.js';
import { conflict } from './options.js';
import { RESTART_DELAY_MS, parkedWords, restartFromTerminal, successorTakes } from './restart.js';
import { deploymentOnly } from './scopes.js';
import type { ServedFacts } from './served.js';

/** What the update reads besides the command's input, so a case can answer it without this machine. */
export interface UpdateFacts {
  /** The daemon's record, as `ahpd start` wrote it; absent is the one on disk. */
  record?(): Running | undefined;
  /** The sessions with a turn running over the daemon; absent is none, as a terminal cannot see them. */
  turning?(): readonly string[];
  /** How the registry is asked; absent is the global `fetch`. */
  fetch?: Fetch;
  /** What `installPlace` reads; absent is this machine's own install. */
  place?: PlaceFacts;
  /** The configuration directory the plugins live in; absent is the daemon's own. */
  configDir?: string;
  /** How npm is run; absent runs it. */
  run?: Runner;
  /** npm's own version, which decides `--allow-scripts`; absent asks npm. */
  npmVersion?(): Promise<string | undefined>;
  /**
   * How the new binary is asked whether it takes a line, for a terminal, whose
   * restart is a signal rather than a call the daemon answers here; absent
   * spawns it.
   */
  takes?(line: readonly string[]): Promise<void>;
  /**
   * How a terminal restarts the daemon once the answer has gone; absent runs
   * `ahpd restart`'s own path. A served daemon restarts through `ServedFacts`.
   */
  restart?(force: boolean): Promise<unknown> | void;
  /**
   * How the update is handed over on Windows, where npm cannot install the
   * package this daemon runs from while it runs; absent copies the helper out
   * of the install and starts it detached.
   */
  handOff?(options: HelperOptions): Promise<unknown> | unknown;
  /**
   * How a terminal on Windows stops the daemon once the answer has gone, where
   * the helper starts it again; absent stops it as `ahpd stop` does. A served
   * daemon goes down through `ServedFacts`.
   */
  down?(): Promise<unknown> | unknown;
  /**
   * The daemon's own line, after the program, for a supervised daemon whose
   * record has none; absent is this process's. Only a served daemon uses it:
   * at a terminal it is `update` and its flags, not the unit's line.
   */
  ownArgv?: readonly string[];
}

/** The words of a thrown value. */
const words = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** What an update was asked for, as either surface spells it. */
export interface UpdateAsk {
  /** The version to move to; absent is npm's latest. */
  version?: string | undefined;
  /** Whether to answer the versions without installing anything. */
  check: boolean;
  /** Whether a running turn does not refuse the update. */
  force: boolean;
}

/** What an update answers: the value both surfaces return, and the line the terminal prints. */
export interface Updated {
  data: Record<string, unknown>;
  text: string;
}

/**
 * The update itself, from the plan to the restart, for the command and the AHP
 * method alike: one path, so the two surfaces cannot disagree about what an
 * update does or when it refuses.
 *
 * A refusal or a failed step is thrown, and each caller answers it in its own
 * vocabulary - a conflict for the terminal and the API, an `RpcError` for AHP.
 * The restart is asked for only once the plugin move and the successor check
 * have passed, so a caller told `restarting` is one whose successor check
 * already took.
 */
export async function runUpdate(ask: UpdateAsk, served?: ServedFacts, facts: UpdateFacts = {}): Promise<Updated> {
  const record = (facts.record ?? running)();
  // The served daemon is the one being restarted; at the terminal the record
  // names it, and `planUpdate` holds that pid against the record itself.
  const self = served?.running().pid;
  const turning = served === undefined ? (facts.turning?.() ?? []) : served.turning();
  const plan = await planUpdate({
    version: ask.version,
    force: ask.force,
    record,
    self,
    turning,
    fetch: facts.fetch,
    place: facts.place,
  });
  if (ask.check) {
    const checked = 'why' in plan
      ? { current: plan.current, latest: plan.latest, may: false, why: plan.why }
      : { current: plan.current, latest: plan.latest, may: true };
    return {
      data: checked,
      text: 'why' in plan
        ? `${plan.current} installed; ${plan.latest} is the target, and the update is refused: ${plan.why}\n`
        : `${plan.current} installed; ${plan.latest} is the target, and ahpd update would install it\n`,
    };
  }
  if ('why' in plan) throw new Error(plan.why);
  const where = facts.configDir ?? (served === undefined ? configDir() : dirname(served.configFile));
  /** What the steps say, in the order they said it, for this update's own output. */
  const said: string[] = [];
  const run = facts.run ?? npm;
  const fetch = facts.fetch ?? globalThis.fetch;
  /*
   * The plugin check is first and before npm: a plugin with no version that
   * admits the new sdk would be one the daemon that starts next cannot load,
   * and the update is refused while the old daemon still runs.
   */
  const checked = await checkPlugins({ configDir: where, version: plan.latest, run, fetch, force: ask.force, say: (line) => { said.push(line); } });
  const platform = facts.place?.platform ?? process.platform;
  const daemon = record as Running;
  /*
   * On Windows the daemon holds the native `node-pty` binding npm would
   * replace, so the install can only run once this process is gone. The helper
   * is outside the install and waits on this pid: it is started before the
   * answer, so nothing is left to do if this process dies now, and the way down
   * runs after the answer. What the caller is told is that the daemon restarts,
   * which it does, by the helper; the plugin move happens there too, with the
   * binary npm installs.
   */
  if (platform === 'win32') {
    const line = served === undefined
      ? (daemon.argv === undefined ? undefined : [...daemon.argv])
      : [...(daemon.argv ?? facts.ownArgv ?? process.argv.slice(2))];
    if (line === undefined) throw new Error('The recorded line is missing; run ahpd stop and ahpd start.');
    // Read before the hand-off, so a refusal leaves no helper waiting on this pid.
    const down = served === undefined ? (facts.down ?? (() => stopDaemon())) : served.down;
    if (down === undefined) throw new Error('It is still starting; update it once it has.');
    await (facts.handOff ?? handOffToHelper)({
      pid: self ?? daemon.pid,
      place: plan.place,
      version: plan.latest,
      configDir: where,
      line,
      ...(daemon.startFolder === undefined ? {} : { cwd: daemon.startFolder }),
      log: daemonLog(),
      platform,
      ...(facts.npmVersion === undefined ? {} : { npmVersion: facts.npmVersion }),
    });
    // Down once the answer has had VS Code's upgrade kill delay to reach the caller.
    setTimeout(() => {
      void Promise.resolve()
        .then(() => down())
        .catch((error: unknown) => { process.stderr.write(`${words(error)}\n`); });
    }, RESTART_DELAY_MS);
    return {
      data: { from: plan.current, to: plan.latest, restarting: true, restartDelayMs: RESTART_DELAY_MS },
      text: `${said.length === 0 ? '' : `${said.join('\n')}\n`}${plan.current} to ${plan.latest}; restarting the daemon\n`,
    };
  }
  await installServer({
    place: plan.place,
    version: plan.latest,
    run,
    ...(facts.npmVersion === undefined ? {} : { npmVersion: facts.npmVersion }),
    say: (line) => { said.push(line); },
  });
  const moved = await movePlugins({ configDir: where, version: plan.latest, run, fetch, force: ask.force, say: (line) => { said.push(line); } });
  /*
   * A terminal's restart is a signal another process answers, so the new
   * binary is asked about the recorded line here, before the answer: the
   * daemon could otherwise refuse the restart after the caller was told it
   * happened. A served daemon is asked inside `served.restart`, which is the
   * same daemon's own restart path; a supervised daemon has no recorded line,
   * and its manager's line is not one a terminal knows.
   */
  if (served === undefined && daemon.argv !== undefined) {
    await (facts.takes ?? successorTakes)(daemon.argv);
  }
  /*
   * The restart, after the answer. A served daemon's own restart defers
   * itself until the response in hand has gone, or parks itself until the
   * turns end when one began during the install, which is why it is awaited
   * here: the caller is told which, and what it throws is a refusal the caller
   * gets instead. A terminal's restart waits for the successor, so it runs on
   * the next turn of the loop, after this answer has been printed, and says a
   * park when the daemon answers with one.
   */
  const before = `${said.length === 0 ? '' : `${said.join('\n')}\n`}${plan.current} to ${plan.latest}`;
  const kept = { from: plan.current, to: plan.latest, plugins: moved, left: checked.left };
  if (served !== undefined) {
    const outcome = await served.restart([...(daemon.argv ?? facts.ownArgv ?? process.argv.slice(2))], ask.force);
    if ('parked' in outcome) {
      return { data: { ...kept, restarting: false, parked: outcome.parked }, text: `${before}\n${parkedWords(outcome.parked)}\n` };
    }
    return { data: { ...kept, restarting: true, restartDelayMs: outcome.restartDelayMs }, text: `${before}; restarting the daemon\n` };
  }
  const restart = facts.restart ?? (async (wanted: boolean): Promise<void> => {
    const answer = await restartFromTerminal(wanted);
    if ('parked' in answer) process.stdout.write(`${answer.parked}\n`);
  });
  setTimeout(() => {
    void Promise.resolve()
      .then(() => restart(ask.force))
      .catch((error: unknown) => { process.stderr.write(`${words(error)}\n`); });
  }, 0);
  return { data: { ...kept, restarting: true }, text: `${before}; restarting the daemon\n` };
}

export const declareUpdate = (registry: Registry<object>, served?: ServedFacts, facts: UpdateFacts = {}): Command => registry.action({
  id: 'daemon.update',
  summary: 'Install a newer ahpd and start it again, moving the plugins with it',
  description: 'Refused for a checkout or a linked package, a daemon in the foreground, and a running turn unless --force. --check answers the versions without installing anything.',
  surfaces: { cli: { pattern: ['update'] }, http: { method: 'POST', path: '/update' } },
  // The process and what it runs are what change, and neither is a row a list returns.
  effect: 'change',
  input: {
    version: { type: 'string', description: 'Install this version, instead of the one npm calls latest.' },
    check: { type: 'boolean', description: 'Answer the versions and whether the update may run, without installing anything.' },
    force: { type: 'boolean', description: 'Update even while a turn is running.' },
  },
  scopes: ['config:write'],
  // An update replaces the code this daemon runs and restarts it, as a restart
  // does, so over HTTP it is the deployment's own token and never a person.
  meta: { deploymentTokenOnly: 'update the daemon' },
  /*
   * One update at a time, with the plugin commands: npm writing this package's
   * files while another npm writes the plugins beside it is two writers in the
   * same tree. The check is inside it too, because it reads the same record and
   * install place the install is about to change.
   */
  run: async (context) => oneAtATime(async () => {
    try {
      const updated = await runUpdate({
        version: context.optional<string>('version'),
        check: context.flag('check'),
        force: context.flag('force'),
      }, served, facts);
      return output(updated.data, updated.text);
    }
    catch (error) {
      return conflict(words(error));
    }
  }),
});

/** The code this host refuses a caller with, as `admit` and the usage methods do. */
const REFUSED = -32009;

/**
 * What `x-ahpd/update` takes as its params, read as the command's own input is:
 * a version and the two flags, and nothing else.
 */
const askedBy = (params: Record<string, unknown>): UpdateAsk => ({
  version: typeof params.version === 'string' ? params.version : undefined,
  check: params.check === true,
  force: params.force === true,
});

/**
 * `x-ahpd/update`, the update itself for a client of the daemon's AHP.
 *
 * The grant lets in whoever holds `config:write`, and the owner is what decides:
 * what an update replaces is the code this process runs and the process
 * itself, so it is the host's own connection and never one of its people. A
 * host with no users directory has no owner to name, and every connection it
 * admits is the host itself, so only an owner that names somebody else is
 * refused - with the words the API refuses the same person with.
 *
 * The answer is the command's own value, after the same steps in `oneAtATime`;
 * the restart is `served.restart`, which defers itself until the answer has
 * gone, exactly as it does for the API.
 */
export const updateMethod = (served?: ServedFacts, facts: UpdateFacts = {}): PluginMethod => ({
  grant: 'config:write',
  describe: () => ({ title: 'Update the daemon', description: 'Install a newer ahpd, move the plugins and start it again.' }),
  handle: async (params, reader, _client, owner) => {
    if (reader !== undefined || (owner !== undefined && !owner.startsWith('root:'))) {
      throw new RpcError(REFUSED, deploymentOnly(reader?.id ?? owner ?? 'This caller', 'update the daemon'));
    }
    try {
      const updated = await oneAtATime(() => runUpdate(askedBy(params), served, facts));
      return updated.data;
    }
    catch (error) {
      if (error instanceof RpcError) throw error;
      throw new RpcError(INTERNAL_ERROR, words(error));
    }
  },
});
