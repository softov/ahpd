/**
 * `ahpd plugin`: what a run would load, and installing one.
 *
 * The listing reads the same flags a run does, through the same declaration, so
 * `--plugin` and `--no-plugins` mean here what they mean there, and nothing
 * below imports a plugin or builds a host. Installing and removing are about
 * the machine rather than a run, so they take only their own flags.
 */

import { output } from '@cofold/commands';
import type { Command, Registry } from '@cofold/commands';
import { configDir, configPath } from '../config.js';
import { running } from '../daemon.js';
import { installPlugins, removePlugins, run as runProgram } from '../install.js';
import { describePlugin, pluginLine } from '../plugins.js';
import { version } from '../version.js';
import { withoutSpecSecrets, withoutUserinfoIn } from './config.js';
import { optionsFrom, pluginWriteFields, serverFields, servedPluginWriteFields, stop } from './options.js';
import type { ServedFacts } from './served.js';

export const declarePlugin = (registry: Registry<object>, served?: ServedFacts): Command[] => {
  const list = registry.action({
    id: 'plugin.list',
    summary: 'What the configuration names, and what a run would load',
    description: 'Resolves every spec and reads its manifest, without importing any of it.',
    surfaces: { cli: { pattern: ['plugin', 'list'] }, http: { method: 'GET', path: '/plugin/list' } },
    scopes: ['config:read'],
    // Served, the list is the daemon's own, so no field could name another.
    ...(served === undefined ? { input: serverFields } : {}),
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
   * The writes, one at a time: an install or a remove starts once the one before
   * it has settled, failure or not, so two served requests never run npm in the
   * same directory together or edit the configuration file between each
   * other's steps.
   */
  let settled: Promise<unknown> = Promise.resolve();
  const oneAtATime = <T>(work: () => Promise<T>): Promise<T> => {
    const turn = settled.then(work);
    settled = turn.catch(() => undefined);
    return turn;
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
            version: version(), enable: !context.flag('noEnable'), run: runProgram, say,
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
        stop(error instanceof Error ? error.message : String(error));
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

  return [list, write('install'), write('remove')];
};
