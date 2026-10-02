/**
 * The one registry each surface renders.
 *
 * Every verb and every flag is declared in the files beside this one. Locally
 * this is the list `@cofold/terminal`'s `Program` reads for help, completion,
 * argv and exit codes; the same list, with an `http` binding on the commands
 * that have one, is what the daemon serves under `/api`.
 *
 * The `authorize` hook is where the grants a command declares are checked, on
 * every surface. Locally the caller is the process owner, who already holds the
 * files and the process, so there is nothing to check. Over HTTP the caller is
 * what `authorizeOverHttp` resolved and `serve()` passed on as
 * `context.request.actor`: the deployment's token, which is root, or a person
 * whose grants are then held to the command's scopes.
 *
 * `--remote` is the third shape: the commands a daemon already declares arrive
 * as a manifest and are registered instead of the local ones, with a transport
 * capability in place of the work they would have done here.
 */

import { chmodSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createRegistry } from '@cofold/commands';
import type { Registry, Runner } from '@cofold/commands';
import { commandsFrom, httpTransport, loadManifest } from '@cofold/remote';
import { API_PREFIX } from '../http.js';
import { declareConfig } from './config.js';
import { declarePlugin } from './plugin.js';
import { declareProxy } from './proxy.js';
import { declareRun } from './run.js';
import { declareStart } from './start.js';
import { declareStatus } from './status.js';
import { declareStop } from './stop.js';
import { declareRestart } from './restart.js';
import { declareUser } from './user.js';
import { checkScopes } from './scopes.js';

/** The commands a process runs about itself, and the only ones `--remote` keeps locally. */
export const localRegistry = (): Registry<object> => {
  const registry = createRegistry({ authorize: checkScopes });
  declareRun(registry);
  declareStart(registry);
  declareStop(registry);
  return registry;
};

/** The whole local surface: the process's own commands and the administration ones. */
export const cliRegistry = (): Registry<object> => {
  const registry = createRegistry({ authorize: checkScopes });
  declareRun(registry);
  declareStart(registry);
  declareStop(registry);
  declareRestart(registry);
  declareStatus(registry);
  declareConfig(registry);
  declareUser(registry);
  declarePlugin(registry);
  declareProxy(registry);
  return registry;
};

/**
 * Where a fetched command surface is kept, so `--help` is not a round trip.
 *
 * Per user, under the cache directory, and owner-only before anything writes
 * into it: a manifest is a set of commands this binary will run, so a shared
 * path under `/tmp` with a name anybody can guess is a way for another local
 * user to answer for the daemon.
 */
const remoteCache = (): string => {
  const home = process.env['XDG_CACHE_HOME'] || join(homedir(), '.cache');
  const at = join(home, 'ahpd', 'remote');
  mkdirSync(at, { recursive: true, mode: 0o700 });
  // The mode is a request to `mkdir`, so a directory that was already there
  // keeps whatever it had until it is set again.
  chmodSync(at, 0o700);
  return at;
};

/**
 * The commands a daemon declares, arriving over HTTP.
 *
 * `start` and `stop` are the daemon this process is not, so they stay local:
 * the manifest's `status`, `restart`, `config`, `plugin` and `user` replace
 * their local namesakes, and every one of them runs on the daemon. The token is
 * the same `Authorization: Bearer` the API checks, and `--refresh` ignores the
 * cache.
 */
export async function remoteRegistry(options: {
  /** The origin the daemon answers on; the API is under its `/api`. */
  url: string;
  token?: string;
  refresh?: boolean;
}): Promise<Runner> {
  const base = options.url.replace(/\/+$/u, '');
  const headers = options.token === undefined ? undefined : { authorization: `Bearer ${options.token}` };
  const manifest = await loadManifest(`${base}/api/cli-manifest`, {
    directory: remoteCache(),
    refresh: options.refresh === true,
    ttlMs: 5 * 60 * 1000,
    warn: (message) => process.stderr.write(`ahpd: ${message}\n`),
    ...(headers === undefined ? {} : { headers }),
  });
  const registry = localRegistry().provide('transport', {
    description: `HTTP against ${base}${API_PREFIX}`,
    resolve: () => httpTransport({
      // The prefix is where the routes are, so the transport's base carries it:
      // the manifest names `/status`, and `/api/status` is what answers.
      baseUrl: `${base}${API_PREFIX}`,
      timeoutMs: 10_000,
      ...(headers === undefined ? {} : { headers }),
    }),
  });
  registry.register(...commandsFrom(manifest, { capability: 'transport', expose: () => false }));
  return registry;
}
