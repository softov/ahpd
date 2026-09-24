import type { Plugin, PluginSpec } from '@ahpd/sdk';
import { devContainer } from './devcontainer.js';
import { computerProvider } from './provider.js';
import type { Profile } from './manifest.js';
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

/**
 * The profiles an option named, with anything unusable dropped.
 *
 * The plugin's rule throughout: a misspelled key costs its own setting rather
 * than the plugin, so a profile that is not an object is not a profile and the
 * rest still load. What survives is checked properly when a body picks it.
 */
const profilesOf = (value: unknown): Record<string, Profile> | undefined => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const held: Record<string, Profile> = {};
  for (const [name, one] of Object.entries(value as Record<string, unknown>)) {
    if (typeof one !== 'object' || one === null || Array.isArray(one)) continue;
    const said = one as Record<string, unknown>;
    const text = (key: string): string | undefined =>
      (typeof said[key] === 'string' && said[key].trim() !== '' ? said[key] : undefined);
    held[name] = {
      ...(text('title') === undefined ? {} : { title: text('title') as string }),
      ...(text('description') === undefined ? {} : { description: text('description') as string }),
      ...(text('image') === undefined ? {} : { image: text('image') as string }),
      ...(text('cpus') === undefined ? {} : { cpus: text('cpus') as string }),
      ...(text('memory') === undefined ? {} : { memory: text('memory') as string }),
      ...(text('workdir') === undefined ? {} : { workdir: text('workdir') as string }),
      ...(words(said.mounts) === undefined ? {} : { mounts: words(said.mounts) as string[] }),
    };
  }
  return Object.keys(held).length === 0 ? undefined : held;
};

const whole = (value: unknown, fallback: number): number =>
  (typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback);

/**
 * Where a path on this host is inside one machine, or nothing.
 *
 * A caller's working directory is this host's, and a `-w` of a host path is a
 * directory the machine does not have. A bind mount is the one thing that
 * makes the two the same place, so a path a mount covers is rewritten to its
 * path inside and a path no mount covers has no answer here - the caller falls
 * back to the machine's own working directory rather than starting somewhere
 * that only looks right.
 *
 * The longest source wins, so a mount nested inside another is not shadowed by
 * it, and a match is on a path boundary: `/srv/app` does not cover
 * `/srv/application`.
 */
const within = (held: Record<string, unknown>, path: string): string | undefined => {
  const mounts = Array.isArray(held.Mounts) ? held.Mounts : [];
  let best: { source: string; target: string } | undefined;
  for (const mount of mounts) {
    if (typeof mount !== 'object' || mount === null) continue;
    const { Source: source, Destination: target } = mount as Record<string, unknown>;
    if (typeof source !== 'string' || typeof target !== 'string' || source === '' || target === '') continue;
    if (path !== source && !path.startsWith(source.endsWith('/') ? source : `${source}/`)) continue;
    if (best === undefined || source.length > best.source.length) best = { source, target };
  }
  if (best === undefined) return undefined;
  const rest = path.slice(best.source.length);
  if (rest === '') return best.target;
  return `${best.target.endsWith('/') ? best.target.slice(0, -1) : best.target}${rest}`;
};

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

  /*
   * What every machine this plugin makes can see.
   *
   * The operator's, in the configuration, so one line shares a directory with
   * every machine rather than every manifest repeating it. A body's own
   * mounts are added to these.
   */
  const mounts = words(options.mounts);
  /*
   * The named sets a person picks from when making a machine.
   *
   * The operator's, in the configuration, because what a machine is given is
   * a deployment decision: a profile that shares this host's agent
   * configuration and one that shares nothing are the same mechanism, and
   * which a person may pick is the operator saying so.
   */
  const profiles = profilesOf(options.profiles);
  /*
   * Whether a person making a machine may name mounts of their own.
   *
   * Off unless the deployment says otherwise, because a mount is the one field
   * in a create body that reaches outside the machine: a body free to name
   * `/:/host` makes `computer:write` a permission over this host rather than
   * over the machines it makes. On is the older behaviour and a fair setting
   * for a host with one person on it.
   */
  const bodyMounts = options.bodyMounts === true;

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
    ...(mounts === undefined ? {} : { mounts }),
    ...(profiles === undefined ? {} : { profiles }),
    bodyMounts,
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
       * Where in the machine to start.
       *
       * A caller that names nowhere gets the machine's own working directory.
       * A caller that names a path names one on *this host*, so it is read
       * through the machine's mounts: covered by one, it is the same place
       * under another name and `-w` takes the inside path; covered by none,
       * there is no such directory in there and the machine's own stands.
       */
      const config = (typeof held.Config === 'object' && held.Config !== null ? held.Config : {}) as Record<string, unknown>;
      const workdir = typeof config.WorkingDir === 'string' && config.WorkingDir !== '' ? config.WorkingDir : undefined;
      const inside = (asked.cwd === undefined ? undefined : within(held, asked.cwd)) ?? workdir;
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

  /*
   * The dev container launcher.
   *
   * On unless the option says otherwise, because whether a container can be
   * made is a question with an answer rather than a setting: the host asks
   * `available()` before it advertises the capability, so a host with this
   * loaded and no Docker is a host no client offers the flow against. Every
   * part of it is an option, because the program, the image's own host and the
   * plugins that host loads are deployment facts - decision
   * `a-dev-container-is-made-by-the-dev-container-cli`.
   */
  const container = options.devcontainer;
  if (container !== false) {
    const held = (typeof container === 'object' && container !== null ? container : {}) as Record<string, unknown>;
    const cliArgs = words(held.args);
    const hostCommand = words(held.host);
    const containerEnv = named(held.env);
    const plugins = Array.isArray(held.plugins) ? held.plugins as PluginSpec[] : undefined;
    host.registerContainers(devContainer({
      ...(typeof held.command === 'string' ? { command: held.command } : {}),
      ...(cliArgs === undefined ? {} : { args: cliArgs }),
      ...(hostCommand === undefined ? {} : { host: hostCommand }),
      ...(containerEnv === undefined ? {} : { env: containerEnv }),
      ...(typeof held.docker === 'string' ? { docker: held.docker } : {}),
      ...(held.install === false ? { install: false } : typeof held.install === 'string' ? { install: held.install } : {}),
      ...(plugins === undefined ? {} : { plugins }),
    }));
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
