import { absentResource, asFile, isRecord, ownerFilter, RpcError, splitResource } from '@ahpd/sdk';
import type {
  Entry, MachineNeed, Metadata, Owner, PluginHost, PluginMethod, Principal, Read, ResourceProvider, SchemeDescription,
  SecretRef, SecretWork, Write,
} from '@ahpd/sdk';
import { bodyText, MANIFEST_SCHEMA, manifestOf, pickedOf } from './manifest.js';
import type { FolderAnswer, Profile } from './manifest.js';
import { revealed, vaultNamed, withDefaults } from './secrets.js';
import type { Revealed } from './secrets.js';
import type { ComputerRuntime } from './runtime.js';
import { queue } from './runtime.js';

/**
 * The `computer:` scheme.
 *
 * A machine is a directory with two files in it: `status`, which is the
 * runtime's own record of it, and `capabilities`, which is what this host can
 * be asked for. The root lists what exists.
 *
 * A write to `computer://<name>` makes one and a delete destroys it, which is
 * the person's route: the body is a JSON manifest and the URI is the name. The three tools still
 * exist for a model, marked as needing advanced permission.
 */

/** What the provider was configured with, which `capabilities` reports. */
export interface ProviderOptions {
  /** The image a machine is made from when a call names none. */
  image: string;
  cpus?: string;
  memory?: string;
  /** How many this provider will have at once. */
  max: number;
  /** The label every machine this provider made carries. */
  label: string;
  /** Mounts every machine this provider makes carries, before the body's own. */
  mounts?: string[];
  /** The named sets a create body may pick from, by key. */
  profiles?: Record<string, Profile>;
  /** Whether a create body may name mounts of its own. Off unless an operator says so. */
  bodyMounts?: boolean;
  /** The images a machine may be made from, as patterns. Absent allows any. */
  images?: string[];
  /**
   * Every runtime this host serves, of which the default is what makes machines.
   *
   * A body may name the default and no other. A value this host serves but does
   * not make machines on is a runtime that only lists, and one it does not
   * serve is named with the ones it does.
   */
  runtimes?: string[];
  /**
   * The folder a dev container is made from here, resolved, or the sentence for
   * one this host will not build from. The plugin's own list, reported so a
   * create body is refused the way a session setting is.
   */
  folderFor?: (folder: string) => FolderAnswer;
  /**
   * Whether this host makes dev containers at all. Absent means it does.
   *
   * The plugin's own `devcontainer: false`, reported so the create form draws no
   * field for a route the host refuses.
   */
  devcontainer?: boolean;
  /**
   * Read one agent's machine needs, as the host knows them.
   *
   * The plugin hands the host's `machineNeeds` down, so a profile that names
   * an agent is made with what that agent declared. Absent on a host with no
   * agents to ask, where a profile naming one is refused rather than made
   * without what it was prepared for.
   */
  needsOf?: (provider: string) => Record<string, MachineNeed> | undefined;
  /** Values the plugin option gives any agent's needs, by need name. */
  needValues?: Record<string, string | SecretRef>;
  /**
   * Read a need's value when it names a secret, for the machine's owner.
   *
   * The host's own `secret`, handed down by the plugin: a machine made from a
   * body has an owner and no team, so a `team:` secret in the profile it picked
   * is refused.
   */
  secret: PluginHost['secret'];
}

/**
 * What this provider implements.
 *
 * Narrower than `ResourceProvider`, whose four read methods are optional: this
 * one has three of them and a caller holding it should not have to test for
 * what is always there.
 */
export interface ComputerProvider extends ResourceProvider {
  list(uri: string, reader?: Principal): Promise<Entry[]>;
  resolve(uri: string, followSymlinks?: boolean): Promise<Metadata>;
  read(uri: string, wanted?: string): Promise<Read>;
  write(uri: string, content: Write, owner?: Owner): Promise<void>;
  delete(uri: string, recursive?: boolean): Promise<void>;
  describe(): SchemeDescription;
  /** Make a machine under this name from a manifest body, owned by `owner`. */
  create(name: string, manifest: Write, owner?: Owner): Promise<void>;
  /** Put a machine in `running`, `stopped` or `restarted`. */
  setState(name: string, state: string): Promise<void>;
  /** Destroy a machine. */
  destroy(name: string): Promise<void>;
}

/** A URI, split into the machine it names and the leaf under it. */
interface At {
  /** The machine's name, empty at the root. */
  id: string;
  /** `status`, `capabilities`, or empty for the machine itself. */
  leaf: string;
  /** The text after `?`, which only the root listing reads. */
  query: string;
}

/**
 * Where a `computer:` URI points, or nothing when it is another scheme's.
 *
 * The shared reader answers a wrong scheme with a refusal, and this answers
 * nothing, because `at` below is the one place that says so out loud.
 */
const split = (uri: string): At | undefined => {
  try { return splitResource(uri, 'computer'); }
  catch { return undefined; }
};

/** A machine's directory, or the file under it. */
const isDirectory = (at: At): boolean => at.leaf === '';

const at = (uri: string): At => {
  const held = split(uri);
  if (held === undefined) throw new RpcError(-32602, `${uri} is not a computer: URI`);
  return held;
};

/**
 * When a machine or a leaf was made, as a resource's `mtime` and `ctime`, or
 * nothing where the runtime does not say: the spec gives both when known.
 */
const times = (created: string | undefined): { mtime?: string; ctime?: string } => {
  const when = created === undefined ? undefined : new Date(created);
  if (when === undefined || Number.isNaN(when.getTime())) return {};
  return { mtime: when.toISOString(), ctime: when.toISOString() };
};

/*
 * The one line the `state` leaf holds, from the runtime's own answer.
 *
 * The runtime is asked for the word rather than a record read here: this
 * provider serves one runtime whatever its record looks like, and the words are
 * the ones a write takes. A runtime that answers nothing about a machine that
 * is here is answering one that is not running.
 */
const stateLine = (said: 'running' | 'stopped' | 'suspended' | undefined): string => `${said ?? 'stopped'}\n`;

export function computerProvider(runtime: ComputerRuntime, options: ProviderOptions): ComputerProvider {
  const capabilities = (): string => JSON.stringify({
    ...runtime.capabilities(),
    defaultImage: options.image,
    limits: {
      ...(options.cpus === undefined ? {} : { cpus: options.cpus }),
      ...(options.memory === undefined ? {} : { memory: options.memory }),
    },
    max: options.max,
    /*
     * The create body, as the schema `describe` advertises too, so what a
     * client reads here and what it reads off the handshake cannot drift.
     */
    manifest: MANIFEST_SCHEMA({
      runtime: runtime.kind,
      image: options.image,
      ...(options.profiles === undefined ? {} : { profiles: options.profiles }),
      ...(options.bodyMounts === undefined ? {} : { bodyMounts: options.bodyMounts }),
      ...(options.images === undefined ? {} : { images: options.images }),
      ...(options.devcontainer === undefined ? {} : { devcontainer: options.devcontainer }),
    }),
  }, null, 2);

  /**
   * One machine's files, as listing entries.
   *
   * `server` only for a machine that is a box an operator set up, which is the
   * one kind there is anything to check on: what a machine this host made can
   * run is the image it was made from.
   */
  const leaves = (id: string): Entry[] => [
    { name: 'status', type: 'file' },
    { name: 'capabilities', type: 'file' },
    { name: 'stats', type: 'file' },
    { name: 'state', type: 'file' },
    ...(runtime.checks?.(id) === true ? [{ name: 'server', type: 'file' } as const] : []),
  ];

  /**
   * What the box can run, with the fixes for what it lacks, as JSON.
   *
   * Run fresh on every read: what a box has is what its operator just
   * installed, and a report kept here would hide the fix they ran.
   */
  const serverOf = async (id: string): Promise<string> => {
    const report = await runtime.check?.(id);
    if (report === undefined) throw new Error(`${id} is not a box this host can check`);
    return JSON.stringify(report, null, 2);
  };

  /**
   * What a machine is using, with the cores it was limited to.
   *
   * The runtime reports a percentage of one core's time, which says nothing on
   * its own: 150% is busy on two cores and impossible on one. `NanoCpus` is
   * what the machine was actually given, so it travels beside the number a
   * gauge is drawn from.
   *
   * A machine that is not running has no usage, and that is an empty body
   * rather than zeroes - a dial reading zero says idle, which is not the same
   * as stopped.
   */
  /**
   * What a machine is doing, as one word a client can also write back.
   *
   * A resource scheme has four write operations and none of them is
   * `restart`, so the action is a *write to what the machine is*: reading
   * `state` answers `running` or `stopped`, and writing one of `running`,
   * `stopped` or `restarted` puts it there. That keeps starting a machine
   * inside the same `computer:put` grant that makes one, with no new method
   * for a gate to be taught about.
   */
  const STATES = ['running', 'stopped', 'restarted'] as const;

  /**
   * Whether one machine takes `suspended`, and `running` back from it.
   *
   * A machine whose runtime cannot hold it never reads `suspended`, so the
   * word is refused for it rather than listed with the three.
   */
  const suspends = (id: string): boolean =>
    runtime.suspend !== undefined && runtime.resume !== undefined && runtime.suspends?.(id) === true;

  const statsOf = async (id: string, found: Record<string, unknown>): Promise<string> => {
    const used = await runtime.stats(id);
    if (used === undefined) return JSON.stringify({ running: false }, null, 2);
    const host = (typeof found.HostConfig === 'object' && found.HostConfig !== null
      ? found.HostConfig
      : {}) as Record<string, unknown>;
    const nano = typeof host.NanoCpus === 'number' && host.NanoCpus > 0 ? host.NanoCpus : undefined;
    return JSON.stringify({
      running: true,
      ...used,
      cpu: { ...used.cpu, ...(nano === undefined ? {} : { cores: nano / 1e9 }) },
    }, null, 2);
  };

  /** One need map with every reference read, a refusal as this write's. */
  const read = async (
    values: Record<string, string | SecretRef> | undefined,
    agents: readonly string[],
    work: SecretWork,
  ): Promise<Revealed | undefined> => {
    try {
      return await revealed(values, agents, options.needsOf, work, options.secret);
    }
    catch (error) {
      throw new RpcError(-32602, error instanceof Error ? error.message : String(error));
    }
  };

  /*
   * The profiles a body may pick from, with the picked one's needs read.
   *
   * Only the profile the body named is read: a profile nobody picked is never
   * this machine's, so a reference in it is not this machine's to resolve, and
   * a host with profiles for several people does not read all of them to make
   * one machine.
   */
  const profilesFor = (
    picked: string | undefined,
    profile: Profile | undefined,
    needs: Record<string, string> | undefined,
  ): Record<string, Profile> | undefined => {
    if (options.profiles === undefined || picked === undefined || profile === undefined || needs === undefined) {
      return options.profiles;
    }
    return { ...options.profiles, [picked]: { ...profile, needs } };
  };

  /**
   * A machine is made here, from its manifest, under this name.
   *
   * A client that makes one twice gets `-32010`, as one that writes over a
   * machine does: a machine is not a file and has nothing to splice.
   *
   * `owner` is whoever asked, which the machine keeps as a label: its time up
   * is charged to them, so the record of who made it has to outlive the
   * request.
   */
  const create = async (name: string, manifest: Write, owner?: Owner): Promise<void> => {
    const work: SecretWork = owner === undefined ? {} : { owner };
    /*
     * The profile this body picked, and so the agents whose needs it is
     * resolved with: a need none of them declares is not this machine's, and
     * is never read - from the profile's own `needs` or from the plugin's.
     */
    const picked = pickedOf(manifest);
    const profile = picked === undefined ? undefined : options.profiles?.[picked];
    const agents = profile?.agents ?? [];
    const own = await read(profile?.needs, agents, work);
    // The option's values, and under them any secret an agent names as its
    // own default, read for this machine's owner the same way.
    const values = await read(withDefaults(options.needValues, agents, options.needsOf), agents, work);
    const profiles = profilesFor(picked, profile, own?.values);
    const spec = manifestOf(name, manifest, {
      runtime: runtime.kind,
      ...(options.runtimes === undefined ? {} : { runtimes: options.runtimes }),
      image: options.image,
      ...(options.cpus === undefined ? {} : { cpus: options.cpus }),
      ...(options.memory === undefined ? {} : { memory: options.memory }),
      ...(options.mounts === undefined ? {} : { mounts: options.mounts }),
      ...(profiles === undefined ? {} : { profiles }),
      ...(options.bodyMounts === undefined ? {} : { bodyMounts: options.bodyMounts }),
      ...(options.images === undefined ? {} : { images: options.images }),
      ...(options.folderFor === undefined ? {} : { folderFor: options.folderFor }),
      ...(options.needsOf === undefined ? {} : { needsOf: options.needsOf }),
      ...(values === undefined ? {} : { needValues: values.values }),
      // The needs whose winning value the vault gave, which the machine is
      // never made with.
      named: vaultNamed(own, values),
      ...(owner === undefined ? {} : { owner }),
    });
    if (await runtime.inspect(name) !== undefined) {
      throw new RpcError(-32010, `${name} is already a computer; destroy it or choose another name`);
    }
    /*
     * One create at a time per runtime, as VS Code queues a source's dev
     * container operations. A client's write makes every machine it asks for,
     * as VS Code's host makes every container a client asks for: `max` caps
     * what the agent's tool makes.
     */
    await queue(runtime, async () => {
      try {
        await runtime.run({ ...spec, label: options.label });
      }
      catch (error) {
        throw new RpcError(-32603, error instanceof Error ? error.message : String(error));
      }
    });
  };

  /**
   * A machine put in one of the three states, as `said` names it, or in
   * `suspended` where its runtime can hold it. `running` lets a suspended
   * machine go on from where it was held.
   */
  const setState = async (name: string, said: string): Promise<void> => {
    if (await runtime.inspect(name) === undefined) throw absentResource('computer', `computer://${name}/state`);
    const state = said.trim().toLowerCase();
    if (state === 'suspended') {
      if (!suspends(name) || runtime.suspend === undefined) {
        throw new RpcError(-32602, `${name} cannot be suspended: its runtime cannot hold a machine`);
      }
      await runtime.suspend(name);
      return;
    }
    if (!STATES.includes(state as typeof STATES[number])) {
      throw new RpcError(-32602, `A computer's state is one of ${STATES.join(', ')}, and that body says ${state || 'nothing'}`);
    }
    if (state === 'running' && suspends(name) && runtime.resume !== undefined && await runtime.state(name) === 'suspended') {
      await runtime.resume(name);
    }
    else if (state === 'running') await runtime.start(name);
    else if (state === 'stopped') await runtime.stop(name);
    else await runtime.restart(name);
  };

  /** A machine destroyed, by name. */
  const destroy = async (name: string): Promise<void> => {
    if (await runtime.inspect(name) === undefined) throw absentResource('computer', `computer://${name}`);
    try {
      await runtime.remove(name);
    }
    catch (error) {
      throw new RpcError(-32603, error instanceof Error ? error.message : String(error));
    }
  };

  return {
    describe: (): SchemeDescription => ({
      title: 'Computer',
      description: 'A machine a session can run in.',
      manifest: MANIFEST_SCHEMA({
        runtime: runtime.kind,
        image: options.image,
        ...(options.profiles === undefined ? {} : { profiles: options.profiles }),
        ...(options.bodyMounts === undefined ? {} : { bodyMounts: options.bodyMounts }),
        ...(options.images === undefined ? {} : { images: options.images }),
        ...(options.devcontainer === undefined ? {} : { devcontainer: options.devcontainer }),
      }),
    }),

    /**
     * Every machine, or the caller's own when it is asked with `?owner=me`.
     *
     * The filter narrows this listing and says nothing about who may list: a
     * caller who sees every machine without the query sees the same set of
     * their own with it. A machine with no recorded owner matches nobody, so it
     * is in the plain listing and in no filtered one.
     */
    list: async (uri, reader) => {
      const held = at(uri);
      if (!isDirectory(held)) throw absentResource('computer', uri);
      if (held.id === '') {
        const every = await runtime.list();
        const only = ownerFilter(held.query, reader);
        if (only === undefined) return every.map((one) => ({ name: one.id, type: 'directory' as const }));
        if (only === null) return [];
        const kept: Entry[] = [];
        for (const one of every) {
          if ((await runtime.owner(one.id))?.owner === only) kept.push({ name: one.id, type: 'directory' });
        }
        return kept;
      }
      // A machine that is not there is not a directory either.
      if (await runtime.inspect(held.id) === undefined) throw absentResource('computer', uri);
      return leaves(held.id);
    },

    resolve: async (uri) => {
      const held = at(uri);
      if (held.id === '') return { uri, type: 'directory' };
      const found = await runtime.inspect(held.id);
      if (found === undefined) throw absentResource('computer', uri);
      const created = times(typeof found.Created === 'string' ? found.Created : undefined);
      if (isDirectory(held)) return { uri, type: 'directory', ...created };
      if (!leaves(held.id).some((one) => one.name === held.leaf)) throw absentResource('computer', uri);
      const body = held.leaf === 'status' ? JSON.stringify(found, null, 2)
        : held.leaf === 'stats' ? await statsOf(held.id, found)
          : held.leaf === 'state' ? stateLine(await runtime.state(held.id))
            : held.leaf === 'server' ? await serverOf(held.id)
              : capabilities();
      return {
        uri,
        type: 'file',
        size: Buffer.byteLength(body, 'utf8'),
        ...created,
      };
    },

    read: async (uri) => {
      const held = at(uri);
      const found = held.id === '' ? {} : await runtime.inspect(held.id);
      if (found === undefined) throw absentResource('computer', uri);
      /*
       * A directory that is there is not content, and its read fails as VS
       * Code's file resources fail one: an internal error naming the URI and
       * its file service's words.
       * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/resourceProviders/fileSystemResources.ts#L30-L48
       */
      if (isDirectory(held)) {
        throw new RpcError(-32603, `Failed to read content: ${uri}: Unable to read file '${uri}' that is actually a directory`);
      }
      if (held.leaf === 'status') return asFile(JSON.stringify(found, null, 2));
      if (held.leaf === 'capabilities') return asFile(capabilities());
      if (held.leaf === 'stats') return asFile(await statsOf(held.id, found));
      if (held.leaf === 'server' && runtime.checks?.(held.id) === true) return asFile(await serverOf(held.id));
      if (held.leaf === 'state') {
        return { data: stateLine(await runtime.state(held.id)), encoding: 'utf-8', contentType: 'text/plain' };
      }
      throw absentResource('computer', uri);
    },

    /**
     * A machine is made here, or put in a state.
     *
     * The body is the manifest and the URI is the name; a write to
     * `computer://<name>/state` puts the machine in the state its body names.
     */
    write: async (uri, content, owner) => {
      const held = at(uri);
      /*
       * A write to `state` acts on the machine rather than making one.
       *
       * Checked before the name check below, because `computer://box/state` is
       * a leaf and not a name for a new machine: without this it would be
       * refused as a bad name, which says nothing about what was asked.
       */
      if (held.leaf === 'state') return setState(held.id, bodyText(content));
      if (held.leaf !== '') throw new RpcError(-32602, `${uri} is not something to write; write to computer://<name> or computer://<name>/state`);
      if (held.id === '' || !isDirectory(held)) {
        throw new RpcError(-32602, `${uri} is not a name for a new computer; write to computer://<name>`);
      }
      return create(held.id, content, owner);
    },

    /**
     * A machine is destroyed here.
     *
     * A leaf under a machine is not a thing to delete, and the root is a
     * listing: both are refused rather than passed to the runtime as a name.
     */
    delete: async (uri) => {
      const held = at(uri);
      if (held.id === '' || !isDirectory(held)) {
        throw new RpcError(-32602, `${uri} is not a computer to destroy; delete computer://<name>`);
      }
      return destroy(held.id);
    },

    create,
    setState,
    destroy,
  };
}

/** A command's `name`, or a refusal saying what the command needs. */
const nameParam = (command: string, params: Record<string, unknown>): string => {
  const name = params.name;
  // A name a URI could not hold is refused, so a machine made by command is one
  // `computer://<name>` reads back.
  if (typeof name !== 'string' || name === '' || /[/?]/.test(name)) {
    throw new RpcError(-32602, `${command} needs name, the computer's name, with no / or ?`);
  }
  return name;
};

/**
 * The `x-ahpd/computers/*` commands over this provider, by name.
 *
 * - `create` `{ name, manifest }` makes a machine from the manifest a write to `computer://<name>` takes, owned by the caller.
 * - `start`, `stop` and `restart` `{ name }` put it in `running`, `stopped` or `restarted`.
 * - `remove` `{ name }` destroys it.
 *
 * `remove` needs `computer:delete` and the others `computer:put`, the grants
 * the resource write and delete need. Each answers `{}` once `refresh` has
 * sent the change.
 */
export const computerMethods = (provider: ComputerProvider, refresh: () => Promise<void>): Record<string, PluginMethod> => {
  const to = (verb: string, state: string, title: string): PluginMethod => ({
    grant: 'computer:put',
    describe: () => ({ title, description: `Puts one computer in ${state}.` }),
    handle: async (params) => {
      await provider.setState(nameParam(`x-ahpd/computers/${verb}`, params), state);
      await refresh();
      return {};
    },
  });
  return {
    'x-ahpd/computers/create': {
      grant: 'computer:put',
      describe: () => ({ title: 'Create a computer', description: 'Makes one computer from a manifest.' }),
      handle: async (params, _reader, _client, owner) => {
        const name = nameParam('x-ahpd/computers/create', params);
        const manifest = params.manifest;
        // The manifest as the body a resource write carries, so it is refused
        // with the same sentences.
        await provider.create(
          name,
          { data: manifest === undefined ? '' : JSON.stringify(manifest), encoding: 'utf-8' },
          owner,
        );
        await refresh();
        return {};
      },
    },
    'x-ahpd/computers/start': to('start', 'running', 'Start a computer'),
    'x-ahpd/computers/stop': to('stop', 'stopped', 'Stop a computer'),
    'x-ahpd/computers/restart': to('restart', 'restarted', 'Restart a computer'),
    'x-ahpd/computers/remove': {
      grant: 'computer:delete',
      describe: () => ({ title: 'Remove a computer', description: 'Destroys one computer.' }),
      handle: async (params) => {
        await provider.destroy(nameParam('x-ahpd/computers/remove', params));
        await refresh();
        return {};
      },
    },
  };
};
