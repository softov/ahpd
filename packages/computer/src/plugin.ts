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

  const args = words(options.args);
  const env = named(options.env);
  const cpus = typeof options.cpus === 'string' && options.cpus.trim() !== '' ? options.cpus : undefined;
  const memory = typeof options.memory === 'string' && options.memory.trim() !== '' ? options.memory : undefined;
  const image = line(options.image, defaults.image);
  const max = whole(options.max, defaults.max);
  const label = line(options.label, defaults.label);
  const prefix = line(options.prefix, defaults.prefix);

  const made = dockerRuntime({
    command: line(options.command, defaults.command),
    label,
    ...(args === undefined ? {} : { args }),
    ...(env === undefined ? {} : { env }),
  });

  host.registerResourceProvider('computer', computerProvider(made, {
    image,
    max,
    ...(cpus === undefined ? {} : { cpus }),
    ...(memory === undefined ? {} : { memory }),
  }));

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
};
