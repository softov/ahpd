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
import type { AutomationStore, LiveNodes, Usage, Users, Vault } from '@ahpd/sdk';
import type { Options } from './options.js';
import { declareAutomation } from './automation.js';
import { declareConfig } from './config.js';
import { declarePaths } from './paths.js';
import { declareNodes } from './nodes.js';
import { declarePlugin } from './plugin.js';
import { declareProxy } from './proxy.js';
import { declareRestart } from './restart.js';
import { declareStatus } from './status.js';
import { declareUpdate } from './update.js';
import { declareTeams } from './teams.js';
import { declareUsage } from './usage.js';
import { declareVault } from './vault.js';
import { declareUser } from './user.js';
import { declareToken } from './token.js';
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
  /** The folder the daemon was started in, when it serves that folder because nothing names one. */
  startFolder?: string;
  startedAt: string;
  /** Where automations are kept and whether their schedules fire. */
  automations?: string;
  /** The service manager that started this daemon, when one did. */
  service?: 'systemd' | 'launchd';
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
  /** The nodes that may join this daemon and the ones that have, when it has a users file. */
  readonly nodes?: LiveNodes;
  /**
   * Where this host's usage records were written, read per request because a
   * plugin may have replaced the store the host was built over. Absent, this
   * daemon was started with none.
   */
  usage?(): Usage;
  /**
   * Where this host's secrets were written, read per request because a plugin
   * may have replaced the vault the host was built over. Absent, this daemon
   * was started with none.
   */
  vault?(): Vault;
  /**
   * Where this host's automations are kept, read per request because a plugin
   * may have replaced the store the host was built over. Absent, or answering
   * nothing, before the host is built.
   */
  automations?(): AutomationStore | undefined;
  /**
   * Load, unload or reconfigure the plugins the configuration file now names,
   * and answer whether this daemon must restart for the change to take.
   *
   * Called by a command that wrote the file itself - an install, a remove, an
   * update, a plugin option, an enable or a disable - inside the turn that
   * wrote it, so what is applied is exactly what the file now holds. A daemon
   * that has not loaded its plugins yet, or one built without a live apply,
   * has none, and its commands answer `restart: true` as they always did.
   *
   * `reload` names the plugins to import again, for a change the file cannot
   * show: the code a plugin points at moved and its entry did not.
   */
  apply?(reload?: string[]): Promise<{ restart: boolean; changed: boolean }>;
  /**
   * Tell the host's root the daemon values a command wrote to the file, with
   * the `root/configChanged` that moves them.
   *
   * Called by a command that wrote one of the daemon's keys itself, inside the
   * turn that wrote it: no client's `root/configChanged` made that write, so
   * nothing else says it to the clients watching the root. Absent before the
   * host is built, when there is no root to tell.
   */
  valuesMoved?(): Promise<void>;
  /**
   * Read that line over the configuration as it is now, then stop this daemon
   * once the answer has gone and start it again with it. Throws, or rejects,
   * with why the line cannot run or, unless forced, which turns are running,
   * and the daemon runs on.
   */
  restart(argv: string[], force: boolean): void | Promise<void>;
  /**
   * Take this daemon down without a successor, once the answer in hand has
   * gone: what the Windows update does, because the helper it starts runs npm
   * only after this process is gone and starts the next daemon itself. Absent
   * before the daemon is up.
   */
  down?(): void;
}

/** The declarations a daemon serves, bound to the daemon's own facts. */
export const servedRegistry = (facts: ServedFacts): Registry<object> => {
  const registry = createRegistry({ authorize: checkScopes });
  declareStatus(registry, facts);
  declareConfig(registry, facts);
  declareUser(registry, facts);
  declareToken(registry, facts);
  declareTeams(registry, facts);
  declarePaths(registry, facts);
  declareNodes(registry, facts);
  declarePlugin(registry, facts);
  declareProxy(registry, facts);
  declareUsage(registry, facts);
  declareVault(registry, facts);
  declareAutomation(registry, facts);
  declareRestart(registry, facts);
  declareUpdate(registry, facts);
  return registry;
};
