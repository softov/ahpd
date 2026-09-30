/**
 * The registry a daemon serves over HTTP.
 *
 * It is the same declarations the terminal renders, built against the facts of
 * the process answering: a served command reads the daemon's own configuration
 * file, user directory, plugins and directories, and never the request's idea
 * of them. The four fields that name those - `configFile`, `users`, `plugins`
 * and `paths` - are therefore absent from the served declarations, and so from
 * the manifest a `--remote` client reads.
 */

import { createRegistry } from '@cofold/commands';
import type { Registry } from '@cofold/commands';
import type { Users } from '@ahpd/sdk';
import type { Options } from './options.js';
import { declareConfig } from './config.js';
import { declarePlugin } from './plugin.js';
import { declareRestart } from './restart.js';
import { declareStatus } from './status.js';
import { declareUser } from './user.js';
import { checkScopes } from './scopes.js';

/** The running daemon, as a served command describes it. */
export interface ServedRunning {
  pid: number;
  /** The origin AHP is served on. */
  url: string;
  /** The address the daemon's own listener is bound to. */
  host: string;
  /** The port the daemon's own listener is bound to. */
  port: number;
  paths: string[];
  startedAt: string;
  /** Where automations are kept and whether their schedules fire. */
  automations?: string;
}

/** What a served command reads instead of the request. */
export interface ServedFacts {
  /** The options the daemon was started with. */
  readonly options: Options;
  /** The configuration file the daemon reads. */
  readonly configFile: string;
  /** The people directory the daemon built, when it has one. */
  readonly users?: Users;
  /** The daemon as it is now, read per request because the listener is bound after this is built. */
  running(): ServedRunning;
  /** The sessions with a turn running, read per request because the host is built after this is. */
  turning(): string[];
  /**
   * Read that line over the configuration as it is now, then stop this daemon
   * once the answer has gone and start it again with it. Throws, or rejects,
   * with why the line cannot run or, unless forced, which turns are running,
   * and the daemon runs on.
   */
  restart(argv: string[], force: boolean): void | Promise<void>;
}

/** The declarations a daemon serves, bound to the daemon's own facts. */
export const servedRegistry = (facts: ServedFacts): Registry<object> => {
  const registry = createRegistry({ authorize: checkScopes });
  declareStatus(registry, facts);
  declareConfig(registry, facts);
  declareUser(registry, facts);
  declarePlugin(registry, facts);
  declareRestart(registry, facts);
  return registry;
};
