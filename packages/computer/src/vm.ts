/**
 * Virtual machines, made by a hypervisor and reached over `ssh`.
 *
 * Every VM is a linked clone of a template, booted with cloud-init and this
 * host's own key, and then reached as an ssh machine. What makes, starts and
 * stops one is the hypervisor's, a `VmMaker`: libvirt through `virsh`, Proxmox
 * through its API. Everything after that is here and is the same for both: the
 * labels a VM is listed by, the wait for its address and its ssh, the code
 * sent into it, the template built from the joined image, and the work brought
 * back before it is removed.
 *
 * What a container keeps as labels, a VM keeps where its hypervisor lets it:
 * the same keys, so every reader of a machine's record reads a VM the way it
 * reads a container. The record `inspect` answers has Docker's shape for the
 * same reason.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { hostPathOf, machinePathOf } from '@ahpd/sdk';
import type { BroughtBack } from '@ahpd/sdk';
import { codeRouteOf } from './clone.js';
import { MACHINE_GIT, seedOf } from './gitdir.js';
import { forgetHost, machineKey, runKeygen } from './keys.js';
import type { Keygen, MachineKey } from './keys.js';
import { bringBack, bundledInto, checkedOut, fetchedInto, followOfCopy, keepUncommitted } from './machinegit.js';
import type { FarSeed, MachineGit } from './machinegit.js';
import {
  bytesOf,
  claimedBy,
  disposableOf,
  hostOf,
  MACHINE_AGENTS,
  MACHINE_ALONE,
  MACHINE_DISPOSABLE,
  MACHINE_HOST,
  MACHINE_OWNER,
  MACHINE_PROFILE,
  MACHINE_PROJECT,
  MACHINE_SESSION,
  MACHINE_TEAM,
  preparedFor,
  sessionOf,
} from './runtime.js';
import type { ComputerRuntime, ExecResult, Machine, MachineSpec, RuntimeCapabilities } from './runtime.js';
import { sshReach } from './ssh.js';
import type { SshMachine, SshProgram, SshReach } from './ssh.js';
import { TEMPLATE_PACKAGES, templateMaker } from './template.js';
import type { TemplateLedger, TemplateParts, TemplateSteps } from './template.js';
import type { LogLevel } from '@ahpd/sdk';

/** Where a VM's tree is, which is the session's repository at its own path. */
const MACHINE_TREE = 'ahpd.tree';

/** Where a VM's commands start: the session's folder, inside that tree. */
const MACHINE_WORKDIR = 'ahpd.workdir';

/** What a VM was made from, which is its template. */
export const MACHINE_IMAGE = 'ahpd.image';

/** When a VM was made, since no hypervisor keeps that moment for us. */
export const MACHINE_CREATED = 'ahpd.created';

/** The login a VM is made with, when the option names none. */
const DEFAULT_USER = 'ahpd';

/** A VM's cores and MiB of memory, when its spec says neither. */
export const DEFAULT_CPUS = 2;
export const DEFAULT_MEMORY_MIB = 2048;

/**
 * How a VM starts its nested host: where the template puts ahpd, since a
 * VM's login `PATH` may not hold it.
 */
export const VM_HOST = ['/opt/ahpd/ahpd/bin/ahpd'];

/** How long a new VM is given for an address, then for ssh, and how often each is asked. */
const BOOT_MS = 3 * 60_000;
const READY_MS = 3 * 60_000;
const EVERY_MS = 2_000;
/** How long a guest is given to shut down before it is cut off. */
const SHUTDOWN_MS = 60_000;

/** A name a hypervisor, a disk file and a shell all take as it is. */
const NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/** The server one profile's VMs are made on. */
export interface VmProfile {
  /** The server: a box in `ssh.machines` for libvirt, the node for Proxmox. */
  server: string;
  /** The box a VM is reached through, as the ssh option wrote it. */
  box?: SshMachine;
  /** How a VM from this profile starts its nested host, when not `VM_HOST`. */
  host?: string[];
}

/** One VM as its hypervisor answers for it. */
export interface VmRow {
  name: string;
  /** Its state in the hypervisor's own words, which a listing shows. */
  status: string;
  /** The same state, as a computer's `state` reads it. */
  state: 'running' | 'stopped' | 'suspended';
  /** What it carries in ahpd's place, or nothing when it carries nothing there. */
  labels?: Record<string, string>;
}

/** What one VM is made with. */
export interface VmMade {
  name: string;
  /** The template it is a linked clone of. */
  template: string;
  labels: Record<string, string>;
  /** The login cloud-init makes, and the public key it is given. */
  user: string;
  key: string;
  cpus: number;
  /** Its memory in MiB. */
  memory: number;
}

/** What a template's helper VM is booted with. */
export interface VmHelper {
  /** The cloud image it is a full copy of. */
  image: string;
  user: string;
  key: string;
  /** The packages it is given beyond its login. */
  packages: string[];
}

/**
 * What one hypervisor does to its VMs, by server and name.
 *
 * Each verb is one call, or a few, to the hypervisor: the waits, the reach
 * and the records are `vmRuntime`'s.
 */
export interface VmMaker {
  /** The runtime value: `libvirt` or `proxmox`. */
  kind: string;
  /** Every server its VMs may be on. */
  servers: string[];
  /** The VMs on one server, each with what it carries in ahpd's place. */
  listOn(server: string): Promise<VmRow[]>;
  /** One VM on one server, or nothing when there is none by that name. */
  lookOn(server: string, name: string): Promise<VmRow | undefined>;
  /** One VM's IPv4 address, or what was said in its place. */
  addressOn(server: string, name: string): Promise<{ address?: string; said: string }>;
  /** The box `ssh -J` goes through to a VM on the server, as `host` or `host:port`. */
  jumpOf(server: string, profile?: VmProfile): string | undefined;
  /** One VM made from its template and booted, with its labels; nothing is left of one that fails. */
  make(server: string, made: VmMade): Promise<void>;
  start(server: string, name: string): Promise<void>;
  /** Ask the guest to shut down, without waiting for it. */
  shutdown(server: string, name: string): Promise<void>;
  /** Turn it off at once, as pulling its power would. */
  cut(server: string, name: string): Promise<void>;
  reboot(server: string, name: string): Promise<void>;
  suspend(server: string, name: string): Promise<void>;
  resume(server: string, name: string): Promise<void>;
  /** One VM and its own disk removed, in whatever state it is; its template stays. */
  destroy(server: string, name: string): Promise<void>;
  /** The templates on one server, by name. */
  templates(server: string): Promise<string[]>;
  /** A helper VM booted from the cloud image, whose disk becomes the template `name`. */
  helper(server: string, name: string, helper: VmHelper): Promise<void>;
  /** The packages installed in a reached helper, where its boot could not install them. */
  install?(reach: SshReach, packages: string[]): Promise<void>;
  /** A helper that is shut down, kept as the template it was named for. */
  keep(server: string, name: string): Promise<void>;
  /** A helper and its disk removed, whatever of them there is. */
  drop(server: string, name: string): Promise<void>;
  /** Why a spec cannot be made by this hypervisor, beyond what no VM is given. */
  refusal?(spec: MachineSpec): string | undefined;
}

/** What a VM runtime was configured with, whichever hypervisor makes its VMs. */
export interface VmOptions {
  /** How `ssh` is run, to a VM and through its box. */
  ssh: SshProgram;
  /** A template, which every VM backs onto in place of one built here. */
  template?: string;
  /** The cloud image a template is built from. */
  image?: string;
  /** Where a template built here gets its parts. */
  parts?: TemplateParts;
  /** The login a VM is made with. `ahpd` when absent. */
  user?: string;
  /** The profiles that make VMs, by key. */
  profiles: Record<string, VmProfile>;
  /** The label every machine this provider made carries, as `key=value`. */
  label: string;
  /** The daemon's configuration folder, where the key pair is kept. */
  configDir: string;
  /** The daemon's own id, which a VM is recorded under and listed by. */
  hostId?: string;
  keygen?: Keygen;
  log?: (line: string, level?: LogLevel) => void;
  /** The bounds on a VM's boot and shutdown, in milliseconds, for a test. */
  waits?: { boot?: number; ready?: number; every?: number; shutdown?: number };
}

export const lastLine = (said: string): string =>
  said.split('\n').map((one) => one.trim()).filter((one) => one !== '').at(-1) ?? '';

export const pause = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms); });

/** A box's destination with its port, as `ssh -J` and a libvirt URI write it. */
export const hostPortOf = (box: SshMachine): string => (box.port === undefined ? box.destination : `${box.destination}:${box.port}`);

/** A spec's cores, as a hypervisor takes a whole number. */
const cpusOf = (said: string | undefined): number => {
  const held = said === undefined ? Number.NaN : Number(said);
  return Number.isFinite(held) && held > 0 ? Math.ceil(held) : DEFAULT_CPUS;
};

/** A spec's memory in MiB, from Docker's spelling of it. */
const memoryOf = (said: string | undefined): number => {
  // Docker's `4g` is binary, as `docker run --memory` reads it.
  const bytes = said === undefined ? undefined : bytesOf(/^[0-9.]+[kmgt]$/i.test(said) ? `${said}ib` : said);
  return bytes === undefined || bytes <= 0 ? DEFAULT_MEMORY_MIB : Math.max(256, Math.round(bytes / 1024 ** 2));
};

/**
 * Virtual machines, on one hypervisor's servers.
 *
 * One runtime serves every server its profiles name. Which server holds a VM
 * is kept here once a listing or a make has said it; a VM this process has not
 * seen yet is found by listing every server.
 */
export const vmRuntime = (maker: VmMaker, options: VmOptions): ComputerRuntime => {
  const user = options.user ?? DEFAULT_USER;
  const keygen = options.keygen ?? runKeygen;
  const [labelKey = '', labelValue = ''] = options.label.split('=');
  const boot = options.waits?.boot ?? BOOT_MS;
  const ready = options.waits?.ready ?? READY_MS;
  const every = options.waits?.every ?? EVERY_MS;
  const shutdown = options.waits?.shutdown ?? SHUTDOWN_MS;
  /*
   * When each older template was first found with no VM on it, beside the
   * configuration, so the week an unused template is kept outlives a restart.
   */
  const ledgerPath = join(options.configDir, 'computer-templates.json');
  const ledger: TemplateLedger = {
    read: () => {
      try { return JSON.parse(readFileSync(ledgerPath, 'utf8')) as Record<string, number>; }
      catch { return {}; }
    },
    write: (held) => { writeFileSync(ledgerPath, `${JSON.stringify(held, null, 2)}\n`); },
  };
  const makeTemplate = options.parts === undefined ? undefined : templateMaker(options.parts, options.log, ledger);
  const capabilities: RuntimeCapabilities = {
    runtime: maker.kind,
    actions: ['create', 'delete', 'exec', 'start', 'stop', 'restart', 'suspend', 'resume'],
    resources: ['status', 'capabilities', 'stats', 'state'],
  };

  /** Which server each VM is on, as a listing or a make said it. */
  const where = new Map<string, string>();
  /** Each running VM's address, from the last time its hypervisor said it. */
  const addresses = new Map<string, string>();

  /** Whether a VM's labels are this provider's, and this daemon's to list, as a box's Docker filters by the same label. */
  const ours = (labels: Record<string, string> | undefined): labels is Record<string, string> =>
    labels !== undefined && labels[labelKey] === labelValue
    && (options.hostId === undefined || labels[MACHINE_HOST] === options.hostId);

  /** The VMs on one server that carry this provider's label. */
  const listOn = async (server: string): Promise<(VmRow & { labels: Record<string, string> })[]> => {
    const found = (await maker.listOn(server)).filter((one): one is VmRow & { labels: Record<string, string> } => ours(one.labels));
    for (const one of found) where.set(one.name, server);
    return found;
  };

  /** The server one VM is on, from what was kept or from a listing of every server. */
  const serverOf = async (name: string): Promise<string | undefined> => {
    const held = where.get(name);
    if (held !== undefined) return held;
    for (const server of maker.servers) {
      const found = await listOn(server).catch(() => []);
      if (found.some((one) => one.name === name)) return server;
    }
    return undefined;
  };

  /** A record in Docker's shape, which every reader of a machine's record reads. */
  const recordFrom = (name: string, row: VmRow, labels: Record<string, string>): Record<string, unknown> => ({
    Id: name,
    Name: name,
    Config: {
      Labels: labels,
      Image: labels[MACHINE_IMAGE] ?? '',
      ...(labels[MACHINE_WORKDIR] === undefined ? {} : { WorkingDir: labels[MACHINE_WORKDIR] }),
    },
    State: { Running: row.state === 'running', Status: row.status },
  });

  interface Found { server: string; labels: Record<string, string>; row: VmRow }

  /** One VM's record and the server it is on, or nothing when it is not there. */
  const look = async (name: string): Promise<Found | undefined> => {
    const server = await serverOf(name);
    if (server === undefined) return undefined;
    const row = await maker.lookOn(server, name);
    if (row === undefined || !ours(row.labels)) {
      where.delete(name);
      return undefined;
    }
    return { server, labels: row.labels, row };
  };

  const lookOrFail = async (name: string): Promise<Found> => {
    const found = await look(name);
    if (found === undefined) throw new Error(`there is no ${maker.kind} machine called ${name}`);
    return found;
  };

  /** The address one VM answers on, from what was kept or from its hypervisor. */
  const addressOf = async (server: string, name: string): Promise<string | undefined> => {
    const held = addresses.get(name);
    if (held !== undefined) return held;
    const { address } = await maker.addressOn(server, name);
    if (address !== undefined) addresses.set(name, address);
    return address;
  };

  /** The profile a VM was made from, as its labels say. */
  const profileFrom = (labels: Record<string, string>): VmProfile | undefined => {
    const key = labels[MACHINE_PROFILE] ?? labels[MACHINE_DISPOSABLE];
    return key === undefined ? undefined : options.profiles[key];
  };

  /**
   * One VM as an ssh destination: its own login at its address, with this
   * host's key, through the box its server is reached by.
   */
  const reachTo = (key: MachineKey, server: string, address: string, profile: VmProfile | undefined, workdir?: string): SshReach => {
    const jump = maker.jumpOf(server, profile);
    return sshReach(options.ssh, {
      destination: `${user}@${address}`,
      identity: key.private,
      knownHosts: key.knownHosts,
      ...(jump === undefined ? {} : { jump }),
      host: profile?.host ?? VM_HOST,
      ...(workdir === undefined ? {} : { workdir }),
    });
  };

  /** A running VM's reach, or a sentence saying why there is none. */
  const reachOf = async (name: string, workdir?: string): Promise<{ reach: SshReach; found: Found }> => {
    const found = await lookOrFail(name);
    if (found.row.state !== 'running') throw new Error(`${name} is ${found.row.status}, so it cannot be reached`);
    const address = await addressOf(found.server, name);
    if (address === undefined) throw new Error(`${name} has no address yet`);
    const key = await machineKey(options.configDir, keygen);
    return { reach: reachTo(key, found.server, address, profileFrom(found.labels), workdir), found };
  };

  /** One VM's address forgotten, here and in the known hosts. */
  const forget = async (name: string, address: string | undefined): Promise<void> => {
    where.delete(name);
    addresses.delete(name);
    if (address !== undefined) await forgetHost(options.configDir, address, keygen);
  };

  /** Destroy one VM and its disk, and forget its address. */
  const destroyed = async (server: string, name: string): Promise<void> => {
    const address = addresses.get(name) ?? await addressOf(server, name).catch(() => undefined);
    await maker.destroy(server, name);
    await forget(name, address);
  };

  /** Ask `ask` every `every` milliseconds until it answers, or until `within` has passed. */
  const waited = async <T>(within: number, ask: () => Promise<{ value?: T; said: string }>): Promise<{ value?: T; said: string }> => {
    const until = Date.now() + within;
    let last: { value?: T; said: string } = { said: '' };
    for (;;) {
      last = await ask();
      if (last.value !== undefined || Date.now() >= until) return last;
      await pause(every);
    }
  };

  /** The machine's git, through the VM's own `ssh`. */
  const gitOf = (name: string, reach: SshReach, tree: string): MachineGit => ({
    id: name,
    tree,
    copy: true,
    remote: true,
    git: (args) => reach.ran(['git', '-C', tree, ...args]),
    pour: (args, path) => reach.pour(['git', '-C', tree, ...args], path),
    ...(options.log === undefined ? {} : { log: options.log }),
  });

  /**
   * The session's code, in the VM: the tree's folder made the login's, then
   * its own git directory in the tree, seeded by a bundle sent from this host
   * or by a fetch of the branch from origin, as the profile's `code` says.
   */
  const seeded = async (spec: MachineSpec, reach: SshReach, root: string): Promise<void> => {
    const at = posix.join(root, '.git');
    const must = async (command: string[]): Promise<string> => {
      const held = await reach.ran(command);
      if (held.code !== 0) {
        throw new Error(`${command.slice(0, 2).join(' ')} in ${spec.name} exited ${String(held.code)}: ${lastLine(held.stderr) || lastLine(held.stdout)}`);
      }
      return held.stdout;
    };
    const far: FarSeed = {
      name: spec.name,
      must,
      ran: (command) => reach.ran(command),
      // ssh has no copy of its own, so the file goes on the command's stdin.
      put: (file, path) => sent(reach, file, path, spec.name),
      drop: async (path) => { await reach.ran(['rm', '-f', path]); },
    };
    // `root` is the tree's path in the VM, and `seedOf` reads the host's tree at the same path.
    const seed = seedOf(hostPathOf(root));
    await must(['sudo', 'install', '-d', '-o', user, '-g', user, root]);
    await must(['git', 'init', '--bare', '-q', at]);
    await must(['git', `--git-dir=${at}`, 'config', 'core.bare', 'false']);
    const commit = codeRouteOf(spec) === 'clone'
      ? await fetchedInto(far, root, at, seed.branch)
      : await bundledInto(far, root, at);
    await checkedOut(must, [`--git-dir=${at}`, `--work-tree=${root}`], seed, commit, true);
  };

  /** Wait for a booted VM's address, then its ssh, then its cloud-init, and answer its reach. */
  const upOn = async (server: string, name: string, key: MachineKey, profile: VmProfile | undefined): Promise<SshReach> => {
    const addressed = await waited(boot, async () => {
      const said = await maker.addressOn(server, name);
      return { ...(said.address === undefined ? {} : { value: said.address }), said: said.said };
    });
    if (addressed.value === undefined) throw new Error(`${name} had no address within ${String(boot)}ms: ${addressed.said}`);
    addresses.set(name, addressed.value);
    const reach = reachTo(key, server, addressed.value, profile);
    const reached = await waited(ready, async () => {
      const said = await reach.reached();
      return { ...(said.up ? { value: true } : {}), said: said.said };
    });
    if (reached.value === undefined) throw new Error(`${name} did not answer ssh within ${String(ready)}ms: ${reached.said}`);
    // cloud-init exits 2 for a boot that finished with a warning, which is a booted VM.
    const settled = await reach.ran(['cloud-init', 'status', '--wait']);
    if (settled.code !== 0 && settled.code !== 2) {
      throw new Error(`${name} did not finish cloud-init: ${lastLine(settled.stdout) || lastLine(settled.stderr)}`);
    }
    return reach;
  };

  /**
   * A running VM shut down: the guest is asked, and is cut off when it has not
   * within the bound.
   */
  const shutDown = async (server: string, name: string): Promise<void> => {
    await maker.shutdown(server, name);
    const off = await waited(shutdown, async () => {
      const now = await maker.lookOn(server, name);
      return { ...(now === undefined || now.state === 'stopped' ? { value: true } : {}), said: now?.status ?? 'gone' };
    });
    if (off.value !== undefined) return;
    options.log?.(`${name} did not shut down within ${Math.round(shutdown / 1000)} s, so it is cut off`, 'warn');
    await maker.cut(server, name);
  };

  /** What a template is made with on one server: a helper VM on the cloud image, whose disk is kept. */
  const stepsOn = (server: string, profile: VmProfile): TemplateSteps => ({
    templates: () => maker.templates(server),
    boot: async (name) => {
      const key = await machineKey(options.configDir, keygen);
      await maker.helper(server, name, { image: options.image as string, user, key: readFileSync(key.public, 'utf8'), packages: TEMPLATE_PACKAGES });
      where.set(name, server);
      const reach = await upOn(server, name, key, profile);
      await maker.install?.(reach, TEMPLATE_PACKAGES);
      return reach;
    },
    keep: async (name) => {
      const address = addresses.get(name);
      await shutDown(server, name);
      await maker.keep(server, name);
      await forget(name, address);
    },
    drop: async (name) => {
      const address = addresses.get(name);
      await maker.drop(server, name);
      await forget(name, address);
    },
    // The template each VM on the server was made from, by its own label.
    backed: async () => (await maker.listOn(server)).flatMap((row) => row.labels?.[MACHINE_IMAGE] ?? []),
  });

  /** Why a spec cannot be made as a VM, or nothing when it can. */
  const refusalOf = (spec: MachineSpec): string | undefined => {
    if (!NAME.test(spec.name)) return `${spec.name} is not a name a VM can have: letters, digits, - and _ only`;
    const own = maker.refusal?.(spec);
    if (own !== undefined) return own;
    if (spec.devcontainer !== undefined) return `${spec.name} is not made from a devcontainer.json as a VM: the Dev Container CLI reads the folder on this host`;
    const mounted = [...spec.mounts ?? [], ...(spec.partFallbacks ?? []).map((one) => one.mount)];
    if (mounted.length > 0) return `${spec.name} is a VM on another box, and the mount ${mounted[0] as string} is a path on this host`;
    if ((spec.copies ?? []).length > 0) return `${spec.name} is a VM on another box, and a file of this host's is not copied into one yet`;
    const asked = [...spec.statesAsked ?? [], ...spec.states ?? []];
    const first = asked[0];
    if (first !== undefined) {
      return `${spec.name} is a VM, and ${first.provider} keeps its state ${first.need} in a volume, which a VM has none of; use state: "host" or a Docker profile`;
    }
    const variables = Object.keys(spec.env ?? {});
    if (variables.length > 0) return `${spec.name} is a VM, and the variables ${variables.join(', ')} are not set in one yet`;
    if (spec.folder !== undefined && spec.gitDir === undefined) {
      return `${spec.name} is made on another box, and ${spec.repository ?? spec.folder} is not a repository it may be given, so its code cannot be sent there`;
    }
    if (options.template === undefined && (options.image === undefined || makeTemplate === undefined)) {
      return `${spec.name} is not made: the ${maker.kind} option names no template, and no cloud image to build one from`;
    }
    return undefined;
  };

  return {
    kind: maker.kind,

    // A VM is another host: every backend of a session in one runs nested.
    remote: true,

    // A command into a VM is one string its login shell runs, variables and all.
    envInCommand: true,

    list: async () => {
      const found = await Promise.all(maker.servers.map(async (server) => {
        const rows = await listOn(server);
        return rows.map((row): Machine => {
          const { name, labels } = row;
          const record = recordFrom(name, row, labels);
          const disposable = disposableOf(record);
          const session = sessionOf(record);
          const host = hostOf(record);
          return {
            id: name,
            image: labels[MACHINE_IMAGE] ?? '',
            status: row.status,
            created: labels[MACHINE_CREATED] ?? '',
            agents: preparedFor(record),
            ...(disposable === undefined ? {} : { disposable }),
            ...(session === undefined ? {} : { session }),
            ...(host === undefined ? {} : { host }),
            ...claimedBy(labels),
          };
        });
      }));
      return found.flat();
    },

    inspect: async (name) => {
      const found = await look(name);
      return found === undefined ? undefined : recordFrom(name, found.row, found.labels);
    },

    state: async (name) => (await look(name))?.row.state,

    agents: async (name) => {
      const found = await look(name);
      return found === undefined ? undefined : preparedFor(recordFrom(name, found.row, found.labels));
    },

    // A VM's parts are what its template carries, and no label names them.
    parts: async () => undefined,

    owner: async (name) => {
      const found = await look(name);
      return found === undefined ? undefined : claimedBy(found.labels);
    },

    /*
     * A command in the VM, in the caller's folder where the VM's tree holds it
     * and in the VM's own folder otherwise.
     */
    how: async (name, asked) => {
      const found = await look(name);
      if (found === undefined) return undefined;
      const tree = found.labels[MACHINE_TREE];
      const cwd = asked.cwd === undefined ? undefined : machinePathOf(asked.cwd);
      const inTree = cwd !== undefined && tree !== undefined && (cwd === tree || cwd.startsWith(`${tree}/`));
      const { reach } = await reachOf(name, inTree ? cwd : found.labels[MACHINE_WORKDIR]);
      return reach.how(asked);
    },

    hostCommand: async (name) => {
      const found = await look(name);
      return found === undefined ? undefined : profileFrom(found.labels)?.host ?? VM_HOST;
    },

    /*
     * Make one: a linked clone of the template, which is built first where the
     * server has none for this host's parts, booted with cloud-init and its
     * labels, then a wait for its address and its ssh. A VM that does not come
     * up in time is removed with its disk, and the last thing the wait heard
     * is the sentence thrown.
     */
    run: async (spec) => {
      const refusal = refusalOf(spec);
      if (refusal !== undefined) throw new Error(refusal);
      const key = spec.disposable?.profile ?? spec.profile;
      const profile = key === undefined ? undefined : options.profiles[key];
      if (key === undefined || profile === undefined) throw new Error(`${spec.name} names no ${maker.kind} profile, so there is no server to make it on`);
      const server = profile.server;
      // An operator's template as it is, or the one built here for this host's parts.
      const template = options.template ?? await (makeTemplate as NonNullable<typeof makeTemplate>)(server, stepsOn(server, profile));
      const tree = spec.folder === undefined ? undefined : machinePathOf(spec.repository ?? spec.folder);
      const workdir = spec.folder === undefined ? undefined : machinePathOf(spec.folder);
      const labels: Record<string, string> = {
        [labelKey]: labelValue,
        [MACHINE_PROFILE]: key,
        [MACHINE_IMAGE]: template,
        [MACHINE_CREATED]: new Date().toISOString(),
        ...(spec.agents === undefined || spec.agents.length === 0 ? {} : { [MACHINE_AGENTS]: spec.agents.join(',') }),
        ...(spec.disposable === undefined ? {} : { [MACHINE_DISPOSABLE]: spec.disposable.profile }),
        ...(spec.disposable?.alone === true ? { [MACHINE_ALONE]: 'true' } : {}),
        ...(spec.session === undefined || spec.session === '' ? {} : { [MACHINE_SESSION]: spec.session }),
        ...((spec.host ?? options.hostId) === undefined ? {} : { [MACHINE_HOST]: (spec.host ?? options.hostId) as string }),
        ...(spec.owner === undefined ? {} : { [MACHINE_OWNER]: spec.owner }),
        ...(spec.team === undefined ? {} : { [MACHINE_TEAM]: spec.team }),
        ...(spec.project === undefined ? {} : { [MACHINE_PROJECT]: spec.project }),
        ...(tree === undefined ? {} : { [MACHINE_TREE]: tree, [MACHINE_GIT]: 'fetch' }),
        ...(workdir === undefined ? {} : { [MACHINE_WORKDIR]: workdir }),
      };
      const machineKeyHeld = await machineKey(options.configDir, keygen);
      await maker.make(server, {
        name: spec.name,
        template,
        labels,
        user,
        key: readFileSync(machineKeyHeld.public, 'utf8'),
        cpus: cpusOf(spec.cpus),
        memory: memoryOf(spec.memory),
      });
      where.set(spec.name, server);
      /*
       * A VM that did not come up, or whose tree was not seeded, is stopped
       * and kept for a person to look at or start again, as VS Code stops a
       * container whose preparation failed and keeps it; a stop that fails
       * too is said in one line, and the first failure is what the make
       * answers.
       * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/devContainerAgentHostService.ts#L443-L456
       */
      try {
        const reach = await upOn(server, spec.name, machineKeyHeld, profile);
        if (tree !== undefined) await seeded(spec, reach, tree);
      }
      catch (error) {
        await shutDown(server, spec.name).catch((stuck: unknown) => {
          options.log?.(`${spec.name} was not stopped after it failed to come up: ${stuck instanceof Error ? stuck.message : String(stuck)}`, 'error');
        });
        throw error;
      }
      return { id: spec.name, image: template, status: 'running', created: labels[MACHINE_CREATED] as string };
    },

    /*
     * Stop one: the guest is asked to shut down, and is cut off when it has
     * not within the bound. A held VM cannot hear the ask, so it is cut off at
     * once, and one already off is left as it is.
     */
    stop: async (name) => {
      const found = await lookOrFail(name);
      addresses.delete(name);
      if (found.row.state === 'stopped') return;
      if (found.row.state === 'running') await shutDown(found.server, name);
      else await maker.cut(found.server, name);
    },

    start: async (name) => {
      const found = await lookOrFail(name);
      addresses.delete(name);
      await maker.start(found.server, name);
    },

    restart: async (name) => {
      const found = await lookOrFail(name);
      addresses.delete(name);
      if (found.row.state === 'suspended') await maker.resume(found.server, name);
      if (found.row.state === 'stopped') await maker.start(found.server, name);
      else await maker.reboot(found.server, name);
    },

    suspend: async (name) => {
      const found = await lookOrFail(name);
      if (found.row.state !== 'running') throw new Error(`${name} is ${found.row.status}, so it cannot be suspended`);
      await maker.suspend(found.server, name);
    },

    resume: async (name) => {
      const found = await lookOrFail(name);
      if (found.row.state !== 'suspended') throw new Error(`${name} is ${found.row.status}, so there is nothing to resume`);
      await maker.resume(found.server, name);
    },

    suspends: () => true,

    /*
     * Remove one, after what it committed and what it never committed are
     * brought back: the VM's disk is the last place either exists. A VM whose
     * work cannot be read out is kept.
     */
    remove: async (name) => {
      const found = await lookOrFail(name);
      const tree = found.labels[MACHINE_TREE];
      if (tree !== undefined && found.labels[MACHINE_GIT] === 'fetch') {
        try {
          if (found.row.state === 'suspended') await maker.resume(found.server, name);
          if (found.row.state === 'stopped') {
            await maker.start(found.server, name);
            const up = await waited(ready, async () => {
              const address = await addressOf(found.server, name);
              if (address === undefined) return { said: 'no address yet' };
              const key = await machineKey(options.configDir, keygen);
              const said = await reachTo(key, found.server, address, profileFrom(found.labels)).reached();
              return { ...(said.up ? { value: true } : {}), said: said.said };
            });
            if (up.value === undefined) throw new Error(`it did not come back up: ${up.said}`);
          }
          const { reach } = await reachOf(name);
          await bringBack(gitOf(name, reach, tree));
          await keepUncommitted(gitOf(name, reach, tree));
        }
        catch (error) {
          const said = error instanceof Error ? error.message : String(error);
          throw new Error(`Could not remove ${name}, so it is still here: ${said}`);
        }
      }
      await destroyed(found.server, name);
    },

    exec: async (name, command, env): Promise<ExecResult> => (await reachOf(name)).reach.exec(command, env),

    /*
     * A session's attachments are files at a path of this host's, and copying
     * one onto a VM is not done yet.
     */
    putIn: async (name, paths) => {
      await lookOrFail(name);
      throw new Error(`${name} is a VM on another box, and ${paths.length === 1 ? 'a file is' : 'files are'} not written onto it yet`);
    },
    takeOut: async (name, paths) => {
      await lookOrFail(name);
      throw new Error(`${name} is a VM on another box, and ${paths.length === 1 ? 'a file is' : 'files are'} not removed from it yet`);
    },
    copyOut: async (name) => {
      await lookOrFail(name);
      throw new Error(`${name} is a VM on another box, and files are not read out of it yet`);
    },

    bringBack: async (name): Promise<BroughtBack | undefined> => {
      const found = await look(name);
      if (found === undefined) return undefined;
      const tree = found.labels[MACHINE_TREE];
      if (tree === undefined || found.labels[MACHINE_GIT] !== 'fetch') return { moved: false };
      const { reach } = await reachOf(name);
      return await bringBack(gitOf(name, reach, tree));
    },

    follow: async (name) => {
      const found = await look(name);
      const tree = found?.labels[MACHINE_TREE];
      if (found === undefined || tree === undefined || found.labels[MACHINE_GIT] !== 'fetch') return;
      const { reach } = await reachOf(name);
      await followOfCopy(gitOf(name, reach, tree));
    },

    stats: async (name) => {
      const found = await look(name);
      if (found === undefined || found.row.state !== 'running') return undefined;
      return (await reachOf(name)).reach.stats();
    },

    capabilities: () => capabilities,

    /*
     * A VM is made from its template, and an image is Docker's: a part is
     * pulled or built on a runtime that makes containers.
     */
    hasImage: async () => false,
    buildImage: async () => { throw new Error(`an image is not built by ${maker.kind}`); },
    pullImage: async () => { throw new Error(`an image is not pulled by ${maker.kind}`); },
    removeImage: async () => { throw new Error(`an image is not removed by ${maker.kind}`); },
    imagesOf: async () => [],
    checkPart: async () => `a part is not checked by ${maker.kind}`,
  };
};

/** A file of this host's, written at `path` in a VM through its `ssh` stdin. */
const sent = async (reach: SshReach, file: string, path: string, name: string): Promise<void> => {
  const held = await reach.ran(['sh', '-c', 'cat > "$1"', 'sh', path], readFileSync(file));
  if (held.code !== 0) throw new Error(`a file was not written into ${name}: ${lastLine(held.stderr) || `ssh exited ${String(held.code)}`}`);
};
