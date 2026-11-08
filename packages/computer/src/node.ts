/**
 * Machines on hosts that joined this one.
 *
 * A node is a host somebody else runs, behind whatever keeps it from being
 * dialled: it opened the connection. So, as with an ssh box, the machines here
 * are listed rather than made - there is no image of this host's on one, no
 * label of ours to find it by, and no machine to start or to stop. A node is a
 * machine while it is connected, and it is not one at all once it is gone.
 *
 * What a session in one is, is not this file's: `connect` on the port is the
 * registry's own socket, and the proxy reads it as a process. This runtime's
 * one job is the listing, and the refusal of every verb that would make a
 * machine of a node.
 */

import type { NodeRegistry } from '@ahpd/sdk';
import type { ComputerRuntime, Machine, RuntimeCapabilities } from './runtime.js';

/** The value that prefixes a node's id, and the name this runtime reports. */
export const NODE_RUNTIME = 'node';

/** What `capabilities` reports for this runtime. */
const CAPABILITIES: RuntimeCapabilities = {
  runtime: NODE_RUNTIME,
  // No `create`: a node joined this host, so this host makes none of them, and
  // the plugin meters it from reachability rather than from a start and a stop.
  actions: [],
  resources: ['status', 'capabilities'],
};

/** The word a node that is connected is written as, which `isRunning` reads as up. */
const RUNNING = 'running';

/**
 * The refusal of every verb that would make a machine of a node.
 *
 * The node's own ahpd is not this host's to start or stop, and it is already
 * running: what connects it is `ahpd join` on that box, which its operator
 * runs. Answering any of these by reaching over the socket would be this host
 * acting on a machine it does not own.
 */
const joinedElsewhere = (id: string): Error =>
  new Error(`${id}: a node is a host that joined this one, so this host does not make, start or stop it`);

/**
 * Machines, on the hosts that joined this one.
 *
 * Every answer is read from the registry at the moment it is asked, because a
 * node comes and goes without this host doing anything: what is connected now
 * is the whole of what this runtime knows.
 */
export const nodeRuntime = (nodes: NodeRegistry): ComputerRuntime => {
  /** A node's folder, when it is connected now. */
  const workdirOf = (name: string): string | undefined =>
    nodes.joined().find((one) => one.id === name)?.workdir;

  /** A node, or a sentence saying it is not connected here. */
  const must = (name: string): string => {
    const held = workdirOf(name);
    if (held === undefined) throw joinedElsewhere(name);
    return held;
  };

  return {
    kind: NODE_RUNTIME,

    // A node is another host: nothing run here reaches it, so every session in
    // one runs nested, over the socket the node dialled.
    remote: true,

    /*
     * One row per node connected now.
     *
     * A node that is not connected is not listed at all rather than listed
     * stopped: it is a connection this host does not have, and the file of who
     * may join is not this runtime's to read.
     */
    list: async (): Promise<Machine[]> => nodes.joined().map((one) => ({
      id: one.id,
      // Not made from anything here: a node is a host somebody else runs.
      image: '',
      status: RUNNING,
      // Nor made at a moment this host saw.
      created: '',
    })),

    /*
     * What this host knows about one node: its name and the folder it said its
     * sessions start in. A node carries no label of ours, so inventing a record
     * on one would be every reader reading a fact this host made up.
     */
    inspect: async (name) => {
      const workdir = workdirOf(name);
      return workdir === undefined ? undefined : { id: name, workdir };
    },

    /** A node that is connected is up, which is the whole of what it can be. */
    state: async (name) => (workdirOf(name) === undefined ? undefined : RUNNING),

    /*
     * Every agent may run in a node.
     *
     * What runs there is the node's own ahpd with the node's own harness on its
     * own box, so what this host would prepare a machine with is not the
     * question - and an empty list is the runtime's way of saying so.
     */
    agents: async (name) => (workdirOf(name) === undefined ? undefined : []),

    /*
     * No parts: a part is an image mounted when a machine is made, and a node
     * was not made here. Its ahpd and its agents are the ones installed on it.
     */
    parts: async () => undefined,

    /*
     * Nobody here made the node, so it says nothing about who owns it, which
     * the plugin reads as the host's own.
     */
    owner: async (name) => (workdirOf(name) === undefined ? undefined : {}),

    /*
     * No command reaches inside a node.
     *
     * A session there is relayed over the socket the node dialled, and a
     * command somebody's tool wants to run is the node's own ahpd's to run, not
     * one of this host's spawns.
     */
    how: async () => undefined,

    /** Nor does this host say how a node's ahpd is started: the node started it. */
    hostCommand: async () => undefined,

    /*
     * The verbs that make a machine, which a node is not.
     *
     * `must` first, so a name this host serves no node by is answered as that
     * rather than as a machine this host refuses to make.
     */
    run: async (spec) => { throw joinedElsewhere(spec.name); },
    start: async (name) => { must(name); throw joinedElsewhere(name); },
    stop: async (name) => { must(name); throw joinedElsewhere(name); },
    restart: async (name) => { must(name); throw joinedElsewhere(name); },
    remove: async (name) => { must(name); throw joinedElsewhere(name); },

    exec: async (name) => {
      must(name);
      throw new Error(`${name} is a node on another host, and a command is not run in it from here`);
    },

    /*
     * A file written into a node is not a thing this host does.
     *
     * What reaches these two verbs is a session's attachments, which live at a
     * path this host made - there is no such path on the node.
     */
    putIn: async (name, paths) => {
      must(name);
      throw new Error(`${name} is a node on another host, and ${paths.length === 1 ? 'a file is' : 'files are'} not written into it`);
    },
    takeOut: async (name, paths) => {
      must(name);
      throw new Error(`${name} is a node on another host, and ${paths.length === 1 ? 'a file is' : 'files are'} not removed from it`);
    },

    /*
     * The two git verbs, which a node has nothing of this host's in it.
     *
     * A node's session works in a repository on that box, so a bundle is not
     * this host's to fetch: nothing to bring back, and nothing to hand over.
     */
    bringBack: async () => undefined,
    follow: async () => {},

    /** What the node's box is using is the node's to say, and it says none. */
    stats: async () => undefined,

    capabilities: () => CAPABILITIES,

    /*
     * Images are this host's own, and a node is not: a part is pulled or built
     * on a runtime that makes machines, so no image verb has anything to do here.
     */
    hasImage: async () => false,
    buildImage: async () => { throw new Error('an image is not built for a node that joined this host'); },
    pullImage: async () => { throw new Error('an image is not pulled for a node that joined this host'); },
    removeImage: async () => { throw new Error('an image is not removed for a node that joined this host'); },
    imagesOf: async () => [],
    checkPart: async () => 'a part is not checked for a node that joined this host',
  };
};
