import { randomUUID } from 'node:crypto';
import type { ComputerPort, MachineNeed, MachineSource, Plugin, PluginSpec } from '@ahpd/sdk';
import { cliOf, devContainer, hasDefinition, idLabels } from './devcontainer.js';
import type { CliOptions } from './devcontainer.js';
import { computerProvider } from './provider.js';
import { patternOf } from './reference.js';
import { manifestOf } from './manifest.js';
import type { Profile } from './manifest.js';
import { devcontainerFolder, dockerRuntime, preparedFor, profileOf } from './runtime.js';
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
  disposableDelay: 300000,
  /** How a nested host is started in a machine, before a profile says otherwise. */
  host: ['ahpd'],
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
      // The agents a profile prepares for, and any value it gives their needs.
      ...(words(said.agents) === undefined ? {} : { agents: words(said.agents) as string[] }),
      ...(named(said.needs) === undefined ? {} : { needs: named(said.needs) as Record<string, string> }),
      ...(text('folder') === undefined ? {} : { folder: text('folder') as string }),
      // How the host inside a machine from this profile is started. Absent
      // means the port's own default, which is `ahpd`.
      ...(words(said.host) === undefined ? {} : { host: words(said.host) as string[] }),
      // The three fields that make a profile disposal: a machine is made from
      // it when a session starts, it goes a delay after the last session, and
      // `alone` keeps it out of the picker. The delay is written down as the
      // number that will be used, so the timer and the docs cannot disagree.
      ...(said.disposable === true ? { disposable: true, disposableDelay: whole(said.disposableDelay, defaults.disposableDelay) } : {}),
      ...(said.disposableAlone === true ? { disposableAlone: true } : {}),
    };
  }
  return Object.keys(held).length === 0 ? undefined : held;
};

const whole = (value: unknown, fallback: number): number =>
  (typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback);

/**
 * A disposable machine and the sessions using it.
 *
 * The sessions are a set rather than a count, because the same session may
 * announce itself more than once for reasons this plugin cannot see and only
 * the host knows when one is really gone. The timer is the delay running once
 * the set is empty; the profile and its delay are kept because a machine made
 * by a daemon before this one has to be given the delay again from its own
 * label.
 */
interface Disposable {
  /** The profile it was made from. */
  profile: string;
  /** How long it outlives its last session, in milliseconds. */
  delay: number;
  /** The sessions running in it right now. */
  sessions: Set<string>;
  /** The delay already running, or nothing while a session is in it. */
  timer?: ReturnType<typeof setTimeout>;
}

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
   * What any agent's machine needs are given, by need name.
   *
   * The deployment's, beside the profiles': a host whose Claude configuration
   * lives somewhere else says so once, and every profile that prepares for
   * Claude picks it up without repeating it.
   */
  const needValues = named(options.needs);

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
  /*
   * The images a machine may be made from.
   *
   * Absent, any image is allowed, which is what every host did before this
   * existed: naming a set is the operator opting in. A pattern the matcher
   * will not read is fatal here rather than a rule that silently matches
   * nothing - an operator who wrote one meant something by it.
   */
  const images = words(options.images);
  for (const one of images ?? []) {
    try { patternOf(one); }
    catch (error) {
      throw new Error(`plugin ${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /*
   * The Dev Container CLI, as a launcher and as a machine maker.
   *
   * One option, read once, because both routes run the same program with the
   * same words before its verb: the launcher puts a nested host in a
   * container, and the runtime makes a computer from a folder's definition -
   * decision `a-dev-container-is-made-by-the-dev-container-cli`. `false`
   * switches the launcher off, and the runtime keeps the default program so a
   * session can still ask for a `devcontainer://<folder>`.
   */
  const container = options.devcontainer;
  const held = (typeof container === 'object' && container !== null ? container : {}) as Record<string, unknown>;
  const cliArgs = words(held.args);
  const hostCommand = words(held.host);
  const containerEnv = named(held.env);
  const containerPlugins = Array.isArray(held.plugins) ? held.plugins as PluginSpec[] : undefined;
  const cliOptions: CliOptions = {
    ...(typeof held.command === 'string' ? { command: held.command } : {}),
    ...(cliArgs === undefined ? {} : { args: cliArgs }),
    ...(containerEnv === undefined ? {} : { env: containerEnv }),
  };

  const made = dockerRuntime({
    command,
    label,
    devcontainerCli: cliOptions,
    ...(args === undefined ? {} : { args }),
    ...(env === undefined ? {} : { env }),
  });

  /*
   * The disposable machines this plugin made, and the daemon before it left.
   *
   * A disposable machine is made for a session rather than ahead of time and
   * goes a delay after the last session using it is disposed. Nothing in a
   * listing says who is inside, so the host says when a session enters and
   * when one leaves, and this is the book that keeps score.
   */
  const disposables = new Map<string, Disposable>();

  /** The machine's machine is made with this session's agent needs. */
  const needsFor = (asked: MachineSource) =>
    (provider: string): Record<string, MachineNeed> | undefined =>
      provider === asked.provider
        ? (asked.needs ?? host.machineNeeds(provider))
        : host.machineNeeds(provider);

  /**
   * Give a machine the delay again, once nothing is using it.
   *
   * Called with the set empty - at create, and when the last session leaves -
   * and harmless when a session arrived first: a machine with somebody in it
   * never loses its timer and immediately re-arms, which would be a removal
   * racing the session that just picked it.
   */
  const arm = (id: string): void => {
    const held = disposables.get(id);
    if (held === undefined || held.sessions.size > 0) return;
    if (held.timer !== undefined) clearTimeout(held.timer);
    const timer = setTimeout(() => {
      disposables.delete(id);
      void made.remove(id).then(
        () => { host.log(`${name}: removed the disposable machine ${id}, ${held.delay}ms after its last session`); },
        (error: unknown) => {
          host.log(`${name}: could not remove ${id}: ${error instanceof Error ? error.message : String(error)}`);
        },
      );
    }, held.delay);
    // A timer nobody is waiting on is not a reason for the process to stay up.
    (timer as { unref?: () => void }).unref?.();
    held.timer = timer;
  };

  /** Start watching a machine, whether this daemon made it or found it. */
  const watch = (id: string, profile: string, delay: number): void => {
    if (disposables.has(id)) return;
    disposables.set(id, { profile, delay, sessions: new Set() });
    arm(id);
  };

  /*
   * The machines a daemon before this one left behind.
   *
   * The timers died with it, so a labelled disposable machine found at startup
   * is given the delay again. Its profile may be gone from the options, and the
   * default stands then. A machine the listing cannot reach is answered for
   * where a listing is asked for, so nothing is said here.
   */
  void made.list().then((running) => {
    for (const one of running) {
      if (one.disposable === undefined) continue;
      const delay = profiles?.[one.disposable.profile]?.disposableDelay ?? defaults.disposableDelay;
      watch(one.id, one.disposable.profile, delay);
      // Said out loud because a machine nobody remembers making, and that a
      // timer is about to remove, is the sort of thing a person looks for.
      host.log(`${name}: found the disposable machine ${one.id} left behind; it goes ${delay}ms from now`);
    }
  }).catch(() => {});

  host.registerResourceProvider('computer', computerProvider(made, {
    image,
    max,
    label,
    ...(cpus === undefined ? {} : { cpus }),
    ...(memory === undefined ? {} : { memory }),
    ...(mounts === undefined ? {} : { mounts }),
    ...(profiles === undefined ? {} : { profiles }),
    ...(images === undefined ? {} : { images }),
    bodyMounts,
    // Read when a body picks an agent-naming profile, never here: the plugin
    // that registers that agent may apply after this one.
    needsOf: (provider) => host.machineNeeds(provider),
    ...(needValues === undefined ? {} : { needValues }),
  }));

  /*
   * How a backend reaches one of these machines.
   *
   * A descriptor rather than a running process: the backend owns the spawn and
   * its stdio, and this only says what to spawn. The machine's own environment
   * travels as `-e` flags, and the descriptor's `env` is the docker program's
   * own - decision `a-backend-reaches-a-computer-through-a-port`.
   */
  const reach: ComputerPort['how'] = async (id, asked) => {
    const held = await made.inspect(id);
    if (held === undefined) return undefined;
    /*
     * A dev container is reached through the CLI that made it.
     *
     * Its user, its environment and everything the repository's file asks
     * for are the CLI's to apply, so a `docker exec` would run the backend
     * as somebody else with none of it. The folder is the container's own
     * `ahpd.devcontainer.folder` label rather than the session's, because a
     * session's working directory is a host path and this is the container's
     * recipe - decision
     * `a-dev-container-is-a-computer-made-from-its-devcontainer-json`.
     */
    const folder = devcontainerFolder(held);
    if (folder !== undefined) {
      const cli = cliOf(cliOptions);
      const remote = Object.entries(asked.env ?? {}).flatMap(([key, value]) => ['--remote-env', `${key}=${value}`]);
      return {
        command: cli.command,
        args: [
          ...cli.args,
          'exec',
          '--workspace-folder', folder,
          ...idLabels(label, folder),
          ...remote,
          asked.command,
          ...(asked.args ?? []),
        ],
        ...(cli.env === undefined ? {} : { env: cli.env }),
      };
    }
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
  };

  /*
   * A whole host inside a machine, in stdio mode.
   *
   * What a backend that cannot move its own process asks for: the machine's
   * profile says how its host is started (`host`, default `ahpd`), and this
   * runs `<host> --stdio --plugin <each>` by the same `how` a backend's own
   * command takes - so a dev container is reached through its CLI and an
   * image through Docker without either being spelled twice. The profile is
   * read back from the machine's own label, so a machine found by a daemon
   * that did not make it still starts its own host - decision
   * `a-cofold-session-in-a-computer-runs-in-a-nested-host`.
   */
  const nestedHost: NonNullable<ComputerPort['nested']> = async (id, asked) => {
    const held = await made.inspect(id);
    if (held === undefined) return undefined;
    const key = profileOf(held);
    const host = (key === undefined ? undefined : profiles?.[key]?.host) ?? defaults.host;
    const [program, ...before] = host;
    return reach(id, {
      command: program ?? defaults.host[0],
      // One `--plugin` per spec, which is how the daemon's own flag repeats.
      args: [...before, '--stdio', ...asked.plugins.flatMap((plugin) => ['--plugin', plugin])],
      ...(asked.cwd === undefined ? {} : { cwd: asked.cwd }),
    });
  };

  host.registerComputers({
    how: reach,
    nested: nestedHost,
    /*
     * The agents one was prepared for, read back from its own label.
     *
     * The host checks this before a session enters, so an agent is never run
     * in a machine that was made for another; the picker reads the same label
     * from the listing. Undefined for a machine that is not there, which the
     * `how` above already answers for.
     */
    agents: async (id) => {
      const held = await made.inspect(id);
      return held === undefined ? undefined : preparedFor(held);
    },
    /*
     * And the machine a session starts in, made from what its setting named.
     *
     * The profile says what the machine is; the session says which harness it
     * must run and where it works. `manifestOf` is the one place either is
     * read, so a disposable machine carries the same mounts, the same refused
     * host path and the same `ahpd.agents` label as one made from the form -
     * with `for` standing in for the agents a disposable profile cannot name.
     */
    create: async (asked) => {
      /*
       * A folder's own dev container, made when the session starts.
       *
       * The source is `devcontainer://<folder>` and the folder is the whole of
       * what it names; the machine's recipe is the runtime's, so the CLI reads
       * the file. What the session's harness needs is resolved by `manifestOf`
       * exactly as it is for a profile, and the runtime hands the result to the
       * CLI as `--mount` and `--remote-env` - decision
       * `the-host-hands-an-agents-machine-needs-to-the-machine-maker`.
       */
      const devPrefix = 'devcontainer://';
      if (asked.source.startsWith(devPrefix)) {
        const folder = asked.source.slice(devPrefix.length).trim();
        if (!folder.startsWith('/')) {
          throw new Error(`devcontainer:// names a folder on this host, and ${folder} is not an absolute path`);
        }
        if (!hasDefinition(folder)) {
          throw new Error(`${folder} has no devcontainer.json or .devcontainer/devcontainer.json, so there is no dev container to make`);
        }
        const id = `${prefix}-${randomUUID().slice(0, 8)}`;
        const spec = manifestOf(id, { data: JSON.stringify({}), encoding: 'utf-8' }, {
          runtime,
          image,
          ...(cpus === undefined ? {} : { cpus }),
          ...(memory === undefined ? {} : { memory }),
          ...(mounts === undefined ? {} : { mounts }),
          bodyMounts,
          ...(images === undefined ? {} : { images }),
          ...(needValues === undefined ? {} : { needValues }),
          needsOf: needsFor(asked),
          for: asked.provider,
          devcontainer: folder,
        });
        try {
          // The CLI decides the container's name, so the id is the one it made
          // rather than the one this host suggested.
          const machine = await made.run({ ...spec, label });
          return machine.id;
        }
        catch (error) {
          throw new Error(`The machine for ${asked.source} could not be made: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      const prefixOf = 'disposable:';
      if (!asked.source.startsWith(prefixOf)) return undefined;
      const key = asked.source.slice(prefixOf.length).trim();
      const known = profiles ?? {};
      const profile = known[key];
      if (profile === undefined) {
        throw new Error(`This host has no profile called ${key}; it has ${Object.keys(known).join(', ') || 'none'}`);
      }
      if (profile.disposable !== true) {
        throw new Error(`profile ${key} is not disposable, so no machine is made from it when a session starts; pick a running computer://<id> or make one from the form`);
      }
      const delay = profile.disposableDelay ?? defaults.disposableDelay;
      /*
       * The session's folder wins over the profile's, and is written into the
       * profile rather than the body: a body's `folder` is the deployment's to
       * allow, and this one is the operator's own source plus the host's own
       * session folder.
       */
      const chosen: Profile = { ...profile, ...(asked.folder === undefined ? {} : { folder: asked.folder }) };
      const id = `${prefix}-${randomUUID().slice(0, 8)}`;
      const spec = manifestOf(id, { data: JSON.stringify({ profile: key }), encoding: 'utf-8' }, {
        runtime,
        image,
        ...(cpus === undefined ? {} : { cpus }),
        ...(memory === undefined ? {} : { memory }),
        ...(mounts === undefined ? {} : { mounts }),
        profiles: { ...known, [key]: chosen },
        bodyMounts,
        ...(images === undefined ? {} : { images }),
        ...(needValues === undefined ? {} : { needValues }),
        needsOf: needsFor(asked),
        for: asked.provider,
      });
      try {
        await made.run({
          ...spec,
          label,
          disposable: { profile: key, ...(profile.disposableAlone === true ? { alone: true } : {}) },
        });
      }
      catch (error) {
        // The runtime's own sentence, kept: it is the only thing that says
        // what Docker refused, and the session reads it as its creation error.
        throw new Error(`The machine for ${asked.source} could not be made: ${error instanceof Error ? error.message : String(error)}`);
      }
      // Watched before the host says the session entered, so a session that
      // never starts still leaves a machine that goes.
      watch(id, key, delay);
      return id;
    },
    /*
     * The count, which only a session starting or a session disposed moves.
     *
     * A session leaving is what starts the delay; a session arriving again -
     * the same one after a restart the host did not report as a start, or
     * another one that picked the machine - cancels it.
     */
    enter: (id, session) => {
      const held = disposables.get(id);
      if (held === undefined) return;
      held.sessions.add(session);
      if (held.timer !== undefined) {
        clearTimeout(held.timer);
        delete held.timer;
      }
    },
    leave: (id, session) => {
      const held = disposables.get(id);
      if (held === undefined) return;
      held.sessions.delete(session);
      if (held.sessions.size === 0) arm(id);
    },
  });

  for (const tool of computerTools(made, {
    image,
    max,
    label,
    prefix,
    // The same set the manifest is held to: this path makes a machine without
    // a manifest anywhere near it, which is how the flag check was missed.
    ...(images === undefined ? {} : { images }),
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
  if (container !== false) {
    host.registerContainers(devContainer({
      ...cliOptions,
      ...(hostCommand === undefined ? {} : { host: hostCommand }),
      ...(typeof held.docker === 'string' ? { docker: held.docker } : {}),
      ...(held.install === false ? { install: false } : typeof held.install === 'string' ? { install: held.install } : {}),
      ...(containerPlugins === undefined ? {} : { plugins: containerPlugins }),
      // The same label the computers carry, so the CLI finds the folder's own
      // container rather than making a second one beside it.
      label,
      /*
       * The computer a folder already is, so a relay finds rather than makes.
       *
       * The runtime is the only thing that knows what is listed, and the
       * launcher cannot ask it without owning a Docker command of its own -
       * which would be a second place the label is spelled.
       */
      existing: async (folder: string) => (await made.list()).find((one) => one.folder === folder)?.id,
    }));
  }

  if (sessionSetting) {
    if (sessionDefault !== '' && !/^computer:\/\/[^/\s]+$/.test(sessionDefault)) {
      throw new Error(`plugin ${name}: sessionDefault is a computer://<id> URI, and ${sessionDefault} is not one`);
    }
    /*
     * And the machines themselves, as the answers to that key.
     *
     * Without this the key reached every client as a text box: a property with
     * no `enum` is a fact somebody types, so a person had to know a machine's
     * name and spell it. The plugin that named the key is the only thing that
     * knows what is running, and answering here means every client gets the
     * picker rather than the one that wrote code for `computer` by name.
     *
     * Empty is offered first and always, because it is the default and it is
     * the way back: a session with no machine runs on this host.
     *
     * And only the machines prepared for the agent being chosen: the ask
     * carries the `provider`, and a machine made for another one would fail
     * when the session tried to enter it. A machine with no label is one made
     * before this existed and stays offered to every agent, so nothing
     * disappears from a host that has been running for a while.
     */
    host.registerSessionConfig('computer', {
      type: 'string',
      title: 'Computer',
      description: 'The computer://<id> this session runs in. Empty runs it on this host.',
      // Fixed once the session runs: the machine is opened when the backend
      // starts, and a value taken after that would say something the session
      // is not doing. Before the first turn it is still the session being
      // created differently, and the host starts the backend again for it.
      sessionMutable: false,
      ...(sessionDefault === '' ? {} : { default: sessionDefault }),
    }, async (ask) => {
      const running = await made.list();
      const found = running
        .filter((one) => ask.provider === undefined
          || (one.agents ?? []).length === 0
          || (one.agents ?? []).includes(ask.provider))
        // A machine nobody else may run in is not offered: `disposableAlone`
        // is the profile saying this machine belongs to the session it was
        // made for, and a row for it would be a way into somebody's machine.
        .filter((one) => one.disposable?.alone !== true)
        .map((one) => ({
          value: `computer://${one.id}`,
          label: one.id,
          // A dev container's own record is its folder, which is what a person
          // recognises; a machine made from an image has that instead.
          description: [one.folder ?? one.image, one.status].filter((word) => word !== '').join(' · '),
        }))
        .filter((one) => one.value.toLowerCase().includes(ask.query.toLowerCase())
          || one.label.toLowerCase().includes(ask.query.toLowerCase()));
      /*
       * And the session folder's own dev container, when it has one.
       *
       * A folder carrying a `devcontainer.json` may run in the container that
       * file defines, made when the session starts. The row is offered only
       * while no computer is labelled with the folder, so a person who already
       * made it picks the ordinary `computer://` row and nothing is made
       * twice - decision
       * `a-dev-container-is-a-computer-made-from-its-devcontainer-json`.
       */
      const where = ask.workingDirectory === undefined ? undefined : ask.workingDirectory.replace(/^file:\/\//, '');
      const devcontainer = where === undefined || where === '' || !hasDefinition(where) || running.some((one) => one.folder === where)
        ? []
        : [{
          value: `devcontainer://${where}`,
          label: 'Dev container',
          description: `The development container ${where} defines.`,
        }].filter((one) => one.value.toLowerCase().includes(ask.query.toLowerCase())
          || one.label.toLowerCase().includes(ask.query.toLowerCase()));
      /*
       * And the profiles a session may make a machine from.
       *
       * A disposable profile has no machine yet, so it is offered as the source
       * `disposable:<key>` and the machine is made when the session starts,
       * with that session's harness needs. The label is the profile's title,
       * which is what a person picked in the operator's configuration.
       */
      const sources = Object.entries(profiles ?? {})
        .filter(([, one]) => one.disposable === true)
        .map(([key, one]) => ({
          value: `disposable:${key}`,
          label: one.title ?? key,
          description: one.description ?? `A machine made from ${key} when this session starts.`,
        }))
        .filter((one) => one.value.toLowerCase().includes(ask.query.toLowerCase())
          || one.label.toLowerCase().includes(ask.query.toLowerCase()));
      return [
        ...(ask.query === '' ? [{ value: '', label: 'This host', description: 'Run the session here, in no machine.' }] : []),
        ...found,
        ...devcontainer,
        ...sources,
      ];
    });
  }
};
