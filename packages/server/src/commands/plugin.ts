/**
 * `ahpd plugin`: what a run would load, and installing one.
 *
 * The listing reads the same flags a run does, through the same declaration, so
 * `--plugin` and `--no-plugins` mean here what they mean there, and nothing
 * below imports a plugin or builds a host. Installing, updating and removing
 * are about the machine rather than a run, so they take only their own flags.
 */

import { output } from '@cofold/commands';
import type { Command, Registry } from '@cofold/commands';
import { configDir, configPath } from '../config.js';
import { running } from '../daemon.js';
import { NpmFailure, installPlugins, removePlugins, run as runProgram, updatePlugins } from '../install.js';
import type { Moved } from '../install.js';
import { describePlugin, pluginLine } from '../plugins.js';
import { version } from '../version.js';
import { withoutSpecSecrets, withoutUserinfoIn } from './config.js';
import { optionsFrom, pluginWriteFields, flagFields, servedPluginWriteFields, stop } from './options.js';
import type { ServedFacts } from './served.js';

export const declarePlugin = (registry: Registry<object>, served?: ServedFacts): Command[] => {
  const list = registry.action({
    id: 'plugin.list',
    summary: 'What the configuration names, and what a run would load',
    description: 'Resolves every spec and reads its manifest, without importing any of it.',
    surfaces: { cli: { pattern: ['plugin', 'list'] }, http: { method: 'GET', path: '/plugin/list' } },
    scopes: ['config:read'],
    // Served, the list is the daemon's own, so no field could name another.
    ...(served === undefined ? { input: flagFields } : {}),
    run: async (context) => {
      const options = served === undefined
        ? optionsFrom(context.input as Readonly<Record<string, unknown>>)
        : served.options;
      if (options.noPlugins) return output([], 'plugins: --no-plugins, so nothing is listed\n');
      if (options.plugins.length === 0) return output([], 'plugins: none named\n');
      const rows = [];
      for (const spec of options.plugins) {
        const row = await describePlugin(spec, { configDir: configDir(), cwd: process.cwd() });
        // Served, a row is read by anyone holding `config:read`, so it says
        // which options a plugin has and never their values, and every string
        // that may quote a spec URL has that URL's userinfo replaced; the
        // terminal's listing is the owner reading their own configuration.
        rows.push(served === undefined ? row : {
          ...row,
          spec: withoutSpecSecrets(row.spec),
          ...(row.url === undefined ? {} : { url: withoutUserinfoIn(row.url) }),
          ...(row.path === undefined ? {} : { path: withoutUserinfoIn(row.path) }),
          ...(row.name === undefined ? {} : { name: withoutUserinfoIn(row.name) }),
          ...(row.title === undefined ? {} : { title: withoutUserinfoIn(row.title) }),
          ...(row.problem === undefined ? {} : { problem: withoutUserinfoIn(row.problem) }),
        });
      }
      return output(rows, `${rows.map(pluginLine).join('\n')}\n`);
    },
  });

  /*
   * The writes, one at a time: an install, an update or a remove starts once
   * the one before it has settled, failure or not, so two served requests never
   * run npm in the same directory together or edit the configuration file
   * between each other's steps.
   */
  let settled: Promise<unknown> = Promise.resolve();
  const oneAtATime = <T>(work: () => Promise<T>): Promise<T> => {
    const turn = settled.then(work);
    settled = turn.catch(() => undefined);
    return turn;
  };

  /*
   * What a failed write says. At the terminal npm's error has already been
   * written there as npm ran, so only what failed is said; served, nothing
   * reached the caller, so npm's reason goes with it.
   */
  const failure = (error: unknown): string => {
    if (error instanceof NpmFailure && served === undefined) return error.failed;
    return error instanceof Error ? error.message : String(error);
  };

  const write = (sub: 'install' | 'remove') => registry.action({
    id: `plugin.${sub}`,
    summary: sub === 'install'
      ? 'Install a backend or another plugin into the configuration directory'
      : 'Take a plugin out of the configuration, and uninstall it unless --keep',
    surfaces: { cli: { pattern: ['plugin', sub, ':name...'] }, http: { method: 'POST', path: `/plugin/${sub}` } },
    input: {
      ...(served === undefined ? pluginWriteFields : servedPluginWriteFields),
      name: { type: 'array', items: { type: 'string' }, description: 'A package name. One or more.' },
    },
    scopes: ['config:write'],
    // Installing or removing a plugin runs code in this process, so over HTTP
    // it is the deployment's own token and never a person.
    meta: { deploymentTokenOnly: true },
    run: (context) => oneAtATime(async () => {
      const names = context.list<string>('name');
      // Served, the file edited is the daemon's, whatever the request names.
      const configFile = served === undefined ? context.optional<string>('configFile') : served.configFile;
      /*
       * Each line is written when it is said, so a step that throws has still
       * shown what it did. With a payload asked for, the lines are diagnostics
       * and go to stderr, because stdout is the JSON.
       */
      const payload = context.globals['json'] === true || context.globals['quiet'] === true;
      const say = (line: string): void => {
        if (payload) context.error(line);
        else context.write(`${line}\n`);
      };
      try {
        if (sub === 'install') {
          await installPlugins(names, {
            configDir: configDir(), configFile: configFile ?? configPath(),
            version: version(), enable: !context.flag('noEnable'), run: runProgram, fetch, say,
          });
        }
        else {
          await removePlugins(names, {
            configDir: configDir(), configFile: configFile ?? configPath(),
            uninstall: !context.flag('keep'), run: runProgram, say,
          });
        }
      }
      catch (error) {
        stop(failure(error));
      }
      /*
       * The list a running daemon serves is the one it started with, and a
       * served install is that same daemon's own file, so the change is loaded
       * only by a restart. At the terminal a record is what says one is up.
       */
      const restart = served !== undefined || running() !== undefined;
      if (restart) say('Restart the daemon to load the change: ahpd stop && ahpd start');
      return output({ plugins: names, ...(restart ? { restart: true } : {}) }, '');
    }),
  });

  const update = registry.action({
    id: 'plugin.update',
    summary: 'Move every installed plugin, or the ones named, to the version that matches this daemon',
    description: 'One npm call in the configuration directory: every @ahpd package at the daemon\'s version, any other from the registry at latest, and one from a path, link, git or URL left as installed.',
    surfaces: { cli: { pattern: ['plugin', 'update', ':name...'] }, http: { method: 'POST', path: '/plugin/update' } },
    input: {
      name: { type: 'array', items: { type: 'string' }, description: 'all, or a package name. One or more.' },
    },
    scopes: ['config:write'],
    // An update runs code in this process as an install does, so over HTTP it
    // is the deployment's own token and never a person.
    meta: { deploymentTokenOnly: true },
    run: (context) => oneAtATime(async () => {
      const payload = context.globals['json'] === true || context.globals['quiet'] === true;
      const say = (line: string): void => {
        if (payload) context.error(line);
        else context.write(`${line}\n`);
      };
      const asked = context.list<string>('name');
      // `all` is a word of its own, so it is never one name among others.
      if (asked.includes('all') && asked.length > 1) {
        stop('Say which plugins to update: ahpd plugin update all, or ahpd plugin update <name>...');
      }
      let moved: Moved[] = [];
      try {
        moved = await updatePlugins(asked.length === 1 && asked[0] === 'all' ? 'all' : asked, {
          configDir: configDir(), version: version(), run: runProgram, say,
        });
      }
      catch (error) {
        stop(failure(error));
      }
      const restart = moved.length > 0 && (served !== undefined || running() !== undefined);
      if (restart) say('Restart the daemon to load the change: ahpd stop && ahpd start');
      return output({ plugins: moved, ...(restart ? { restart: true } : {}) }, '');
    }),
  });

  return [list, write('install'), write('remove'), update];
};
