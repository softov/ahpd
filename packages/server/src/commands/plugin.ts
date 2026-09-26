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
import { optionsFrom, pluginWriteFields, refuse, serverFields } from './options.js';

export const declarePlugin = (registry: Registry<object>): Command[] => {
  const list = registry.action({
    id: 'plugin.list',
    summary: 'What the configuration names, and what a run would load',
    description: 'Resolves every spec and reads its manifest, without importing any of it.',
    surfaces: { cli: { pattern: ['plugin', 'list'] }, http: { method: 'GET', path: '/plugin/list' } },
    input: serverFields,
    run: async (context) => {
      const options = optionsFrom(context.input as Readonly<Record<string, unknown>>);
      if (options.noPlugins) return output([], 'plugins: --no-plugins, so nothing is listed\n');
      if (options.plugins.length === 0) return output([], 'plugins: none named\n');
      const rows = [];
      for (const spec of options.plugins) {
        rows.push(await describePlugin(spec, { configDir: configDir(), cwd: process.cwd() }));
      }
      return output(rows, `${rows.map(pluginLine).join('\n')}\n`);
    },
  });

  const write = (sub: 'install' | 'remove') => registry.action({
    id: `plugin.${sub}`,
    summary: sub === 'install'
      ? 'Install a backend or another plugin into the configuration directory'
      : 'Take a plugin out of the configuration, and uninstall it unless --keep',
    surfaces: { cli: { pattern: ['plugin', sub, ':name...'] }, http: { method: 'POST', path: `/plugin/${sub}` } },
    input: {
      ...pluginWriteFields,
      name: { type: 'array', items: { type: 'string' }, description: 'A package name. One or more.' },
    },
    scopes: ['config:write'],
    run: async (context) => {
      const names = context.list<string>('name');
      const configFile = context.optional<string>('configFile');
      const said: string[] = [];
      const say = (line: string): void => { said.push(line); };
      try {
        if (sub === 'install') {
          installPlugins(names, {
            configDir: configDir(), configFile: configFile ?? configPath(),
            version: version(), enable: !context.flag('noEnable'), run: runProgram, say,
          });
        }
        else {
          removePlugins(names, {
            configDir: configDir(), configFile: configFile ?? configPath(),
            uninstall: !context.flag('keep'), run: runProgram, say,
          });
        }
      }
      catch (error) {
        refuse(context.surface, error instanceof Error ? error.message : String(error));
      }
      /*
       * A running daemon holds the list it started with and nothing here can
       * change that, so the last line says what does.
       */
      const restart = running() !== undefined;
      if (restart) say('Restart the daemon to load the change: ahpd stop && ahpd start');
      return output({ plugins: names, ...(restart ? { restart: true } : {}) }, `${said.join('\n')}${said.length === 0 ? '' : '\n'}`);
    },
  });

  return [list, write('install'), write('remove')];
};
