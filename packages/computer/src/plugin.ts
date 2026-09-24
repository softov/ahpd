import type { Plugin } from '@ahpd/sdk';
import { computerProvider } from './provider.js';
import { dockerRuntime } from './runtime.js';
import { computerTools } from './tools.js';

/**
 * The package as a plugin.
 *
 * One runtime, one provider for the `computer:` scheme and three tools, all
 * built from the options and registered before the host exists. The runtime is
 * an option rather than a package of its own because a host serves one provider
 * per scheme - decision `one-computer-provider-with-runtimes-as-options`.
 *
 * As the cofold and ACP entries do, an option that is not understood is dropped
 * rather than fatal: a misspelled key costs its own setting and not the plugin.
 */

/** The plugin's id, unique among the plugins a daemon loads. */
export const name = 'ahpd-computer';

/** What a listing prints. */
export const title = 'Computer';

/** What an option falls back to. */
export const defaults = {
  runtime: 'docker',
  command: 'docker',
  image: 'debian:bookworm-slim',
  max: 3,
  label: 'ahpd.computer=1',
  prefix: 'ahpd-computer',
} as const;

const words = (value: unknown): string[] | undefined =>
  (Array.isArray(value) ? value.filter((one): one is string => typeof one === 'string') : undefined);

const named = (value: unknown): Record<string, string> | undefined => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const held = Object.entries(value as Record<string, unknown>)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string');
  return held.length > 0 ? Object.fromEntries(held) : undefined;
};

const line = (value: unknown, fallback: string): string =>
  (typeof value === 'string' && value.trim() !== '' ? value : fallback);

const whole = (value: unknown, fallback: number): number =>
  (typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback);

export const apply: Plugin['apply'] = (host, options) => {
  const runtime = line(options.runtime, defaults.runtime);
  if (runtime !== 'docker') {
    throw new Error(`plugin ${name}: runtime ${runtime} is not one this package has; it has docker`);
  }

  const command = line(options.command, defaults.command);
  const args = words(options.args);
  const env = named(options.env);
  const cpus = typeof options.cpus === 'string' && options.cpus.trim() !== '' ? options.cpus : undefined;
  const memory = typeof options.memory === 'string' && options.memory.trim() !== '' ? options.memory : undefined;
  const image = line(options.image, defaults.image);
  const max = whole(options.max, defaults.max);
  const label = line(options.label, defaults.label);
  const prefix = line(options.prefix, defaults.prefix);
  /*
   * The session setting, which is how a person names the machine a session
   * runs in. Contributed unless the option switches it off, and its default is
   * one machine the operator chose rather than every session sharing one -
   * decision `a-plugin-may-contribute-a-session-key`.
   */
  const sessionSetting = options.sessionSetting !== false;
  const sessionDefault = line(options.sessionDefault, '');

  const made = dockerRuntime({
    command,
    label,
    ...(args === undefined ? {} : { args }),
    ...(env === undefined ? {} : { env }),
  });

  host.registerResourceProvider('computer', computerProvider(made, {
    image,
    max,
    label,
    ...(cpus === undefined ? {} : { cpus }),
    ...(memory === undefined ? {} : { memory }),
  }));

  /*
   * How a backend reaches one of these machines.
   *
   * A descriptor rather than a running process: the backend owns the spawn and
   * its stdio, and this only says what to spawn. The machine's own environment
   * travels as `-e` flags, and the descriptor's `env` is the docker program's
   * own - decision `a-backend-reaches-a-computer-through-a-port`.
   */
  host.registerComputers({
    how: async (id, asked) => {
      const held = await made.inspect(id);
      if (held === undefined) return undefined;
      /*
       * Where in the machine to start, when the caller named nowhere.
       *
       * The machine's own `-w` is the only path that means anything in there:
       * the caller's working directory is this host's, and a `docker exec -w`
       * of a host path is a directory the machine does not have.
       */
      const config = (typeof held.Config === 'object' && held.Config !== null ? held.Config : {}) as Record<string, unknown>;
      const inside = asked.cwd
        ?? (typeof config.WorkingDir === 'string' && config.WorkingDir !== '' ? config.WorkingDir : undefined);
      const into = Object.entries(asked.env ?? {}).flatMap(([key, value]) => ['-e', `${key}=${value}`]);
      return {
        command,
        args: [
          ...(args ?? []),
          'exec', '-i',
          ...(inside === undefined ? [] : ['-w', inside]),
          ...into,
          id,
          asked.command,
          ...(asked.args ?? []),
        ],
        ...(env === undefined ? {} : { env }),
      };
    },
  });

  for (const tool of computerTools(made, {
    image,
    max,
    label,
    prefix,
    ...(cpus === undefined ? {} : { cpus }),
    ...(memory === undefined ? {} : { memory }),
  })) {
    host.registerTool(tool);
  }

  if (sessionSetting) {
    if (sessionDefault !== '' && !/^computer:\/\/[^/\s]+$/.test(sessionDefault)) {
      throw new Error(`plugin ${name}: sessionDefault is a computer://<id> URI, and ${sessionDefault} is not one`);
    }
    host.registerSessionConfig('computer', {
      type: 'string',
      title: 'Computer',
      description: 'The computer://<id> this session runs in. Empty runs it on this host.',
      ...(sessionDefault === '' ? {} : { default: sessionDefault }),
    });
  }
};
