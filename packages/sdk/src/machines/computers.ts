import type { Start } from '../types/agent.js';
import type { ComputerPort, MachineSource, NestedStart, SandboxedSpawn, Spawn } from '../types/computers.js';
import type { SandboxConfigValue } from '../types/sandbox.js';
import type { Owner } from '../types/usage.js';

/**
 * Refuse a session that was told to run in a computer this backend cannot enter.
 *
 * A session key is the person's, and the host hands it to whichever backend was
 * named in `Start.settings`. A backend that spawns its process through the
 * host's `computers` port honours it, and the one that does is
 * `@ahpd/agent-acp`. Every other backend must refuse rather than run on the
 * host and leave a person believing they are inside a sandbox they are not in.
 *
 * **Having the port is not the same as using it.** The host hands `computers`
 * to every backend, because whether a machine can be reached is the host's to
 * know; whether a backend ever asks is the backend's. A gate that read the port
 * as permission let Claude Code run on the host for weeks while the session
 * said `computer://box`, which is the exact failure this exists to prevent.
 * So this refuses on the setting alone, and a backend that *can* enter a
 * machine is the one that never calls it.
 */
export const refuseComputer = (start: Start, backend: string): void => {
  const said = start.settings?.computer;
  if (typeof said !== 'string' || said.trim() === '') return;
  throw new Error(`${backend} cannot run a session inside ${said.trim()}: it spawns its own process on this host and cannot be moved into a machine. Load a backend that spawns through the host's computers port, or create the session without a computer`);
};

/** The machine a session's settings name, or nothing. */
export const machineAsked = (start: Start): string | undefined => {
  const said = start.settings?.computer;
  return typeof said === 'string' && said.trim() !== '' ? said.trim() : undefined;
};

/**
 * A setting that names a source to make a machine from, or nothing.
 *
 * A `computer://<id>` names a machine that already exists, and an empty value
 * runs the session on this host. Anything else - `disposable:<profile>`,
 * `devcontainer://<folder>` - is a source the plugin that owns the
 * machines knows how to make one from, which is what the host asks about
 * before a session starts.
 */
export const computerSource = (said: unknown): string | undefined => {
  if (typeof said !== 'string') return undefined;
  const held = said.trim();
  return held === '' || held.startsWith('computer://') ? undefined : held;
};

/** The id a `computer://<id>` setting names, or nothing. */
export const computerId = (said: unknown): string | undefined => {
  if (typeof said !== 'string') return undefined;
  const named = /^computer:\/\/([^/\s]+)$/.exec(said.trim());
  return named === null ? undefined : named[1];
};

/**
 * The value a session should run with, making a machine when it names a source.
 *
 * The one session-time create, shared by every kind of source a plugin serves:
 * a disposable profile and a folder's dev container. A value
 * that already names a machine comes back unchanged, so a restart before the
 * first turn is the same call with the same answer and no second machine.
 *
 * A source and no plugin that serves it is refused rather than run on the host,
 * for the reason every computer refusal exists: a session that asked for a
 * sandbox and silently got the host is worse than one that did not start. What
 * the plugin throws - the runtime's own sentence - travels on untouched.
 */
export const openComputer = async (
  computers: ComputerPort | undefined,
  said: string,
  asked: Omit<MachineSource, 'source'>,
): Promise<string> => {
  const source = computerSource(said);
  if (source === undefined) return said.trim();
  if (computers?.create === undefined) {
    throw new Error(`This session asked to run in ${source}, and this host has no computer plugin that makes a machine from it`);
  }
  const made = await computers.create({ ...asked, source });
  if (made === undefined) {
    throw new Error(`Nothing here makes a computer from ${source}`);
  }
  return `computer://${made}`;
};

/**
 * What stops `provider` running on machine `id`, or nothing.
 *
 * The rules are read from the machine itself and each is refused in one
 * sentence. A machine is prepared for the agents its profile named, and
 * remembers them in its `ahpd.agents` label: the picker already offers only
 * machines prepared for the asking agent, but a value can be set by hand, or
 * arrive from a client that read an older list - and a session running in a
 * machine that was not prepared for it fails much later and further away, if
 * it runs at all. A machine made from a `disposableAlone` profile is kept for
 * the one session it was made for, and the picker is not consulted when an id
 * is typed. And
 * a machine made without a part the agent needs - its build failed, or nothing
 * asked for it - is refused naming the part, since a machine never gains one
 * while it runs.
 *
 * A machine with no label is one made before this existed, and is offered to
 * every agent and to every session; a port that cannot answer labels is one
 * this reader cannot ask. The sentence names the agents the machine was made
 * for rather than only the one it was not, because that is what tells a person
 * where to go. The one about a machine kept for another session names neither
 * session, since what it says is that this machine is not this session's.
 *
 * A sentence rather than a throw, because the three places that ask are three
 * different shapes of refusal: a request that answers an error, an action that
 * is undone, and a port that throws before either verb reaches the machine.
 */
export const machineRefusal = async (
  computers: ComputerPort | undefined,
  id: string,
  provider: string,
  session: string,
  owner?: Owner,
): Promise<string | undefined> => {
  const keptFor = computers?.keptFor;
  const mine = keptFor === undefined
    ? undefined
    : await keptFor(id, { session, ...(owner === undefined ? {} : { owner }) });
  if (mine !== undefined && mine.mine === false) {
    return `computer://${id} is another daemon's machine, and this daemon neither runs in it nor removes it; make a machine of your own for this session or run it on the host`;
  }
  if (mine !== undefined && mine.session !== session) {
    return `computer://${id} belongs to another session, which is the only one it runs; make a machine of your own for this session or run it on the host`;
  }
  /*
   * The owner, which the session's own id cannot stand in for.
   *
   * A channel is the client's to choose, so a session opened under a disposed
   * one's id spells the same URI and passes the first rule while running in a
   * machine built for somebody else's needs and folder.
   */
  if (mine !== undefined && owner !== undefined && mine.owner !== undefined && mine.owner !== owner) {
    return `computer://${id} was made for another owner, which is the only one it runs for; make a machine of your own for this session or run it on the host`;
  }
  const for_ = computers?.agents === undefined ? undefined : await computers.agents(id);
  if (for_ !== undefined && for_.length > 0 && !for_.includes(provider)) {
    return `computer://${id} was prepared for ${for_.join(', ')}, and this session runs ${provider}; make a machine prepared for ${provider} or run this session on the host`;
  }
  /*
   * A part the agent needs and the machine was made without, which is a build
   * that failed or a profile that never named it: the machine runs every other
   * session, and never gains a part while it runs.
   */
  const missing = computers?.partsMissing === undefined ? undefined : await computers.partsMissing(id, provider);
  if (missing === undefined || missing.length === 0) return undefined;
  return `computer://${id} was made without ${missing.length === 1 ? 'the part' : 'the parts'} ${missing.join(', ')}, which ${provider} needs; make a machine with ${missing.length === 1 ? 'it' : 'them'} or run this session on the host`;
};

/**
 * The port a session's backend is handed, with the machine's label checked.
 *
 * The check is the one every path goes through - a client's `createSession`, an
 * automation, a tool call - and the host asks it once more of its own before it
 * makes a session or starts one again, so a wrong machine fails where the
 * person is rather than at the first turn.
 *
 * `sandbox` is the host's resolution of a chat's sandbox, which the port
 * carries to the runtime: VS Code's agent host resolves a chat's sandbox in
 * its configuration service and hands the result to the runtime that applies
 * it.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/copilot/copilotSessionSandbox.ts#L292-L303
 */
export const computersFor = (
  computers: ComputerPort,
  provider: string,
  session: string,
  owner?: Owner,
  sandbox?: (chat?: string) => SandboxConfigValue,
): ComputerPort => {
  /** Refuse a machine prepared for somebody else, before either verb reaches it. */
  const prepared = async (id: string): Promise<void> => {
    const said = await machineRefusal(computers, id, provider, session, owner);
    if (said !== undefined) throw new Error(said);
  };
  /**
   * A command or a server where the chat's sandbox puts it: inside the
   * runtime where the sandbox is on, and for a server only where
   * `sandboxMcpServers` is too, as VS Code's MCP sandbox starts a server
   * inside it only while that switch is on; as it was otherwise, on this host
   * or reached in its machine.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/workbench/contrib/mcp/common/mcpSandboxService.ts#L108-L112
   */
  const sandboxed = async (id: string | undefined, options: SandboxedSpawn): Promise<Spawn> => {
    const resolved = sandbox?.(options.chat);
    const inside = resolved?.enabled === 'on' && (options.server !== true || resolved.sandboxMcpServers === true);
    if (inside && computers.sandboxed !== undefined) {
      if (id !== undefined) await prepared(id);
      return computers.sandboxed(id, { ...options, provider, sandbox: resolved });
    }
    if (inside) throw new Error('This chat\'s sandbox is on, and this host has no sandbox runtime to run its commands in');
    const { chat: _chat, server: _server, unsandboxed: _unsandboxed, sandbox: _sandbox, ...plain } = options;
    if (id === undefined) return { command: plain.command, args: plain.args ?? [], ...(plain.env === undefined ? {} : { env: plain.env }), ...(plain.cwd === undefined ? {} : { cwd: plain.cwd }) };
    await prepared(id);
    const reached = await computers.how(id, { ...plain, provider });
    if (reached === undefined) throw new Error(`There is no computer called ${id}`);
    return reached;
  };
  return {
    ...computers,
    ...(sandbox === undefined ? {} : { sandbox, sandboxed }),
    how: async (id, options) => {
      await prepared(id);
      return computers.how(id, { ...options, provider });
    },
    /*
     * The same check for the whole host one is started inside a machine: a
     * nested session enters the machine through `nested`, never through `how`,
     * so a gate that wrapped only `how` would let a session into a machine
     * that was prepared for another agent.
     */
    ...(computers.nested === undefined ? {} : {
      nested: async (id: string, asked: NestedStart) => {
        await prepared(id);
        return (computers.nested as NonNullable<ComputerPort['nested']>)(id, { ...asked, provider });
      },
    }),
    // A folder read out of a machine is the machine's too, behind the same check.
    ...(computers.readFolder === undefined ? {} : {
      readFolder: async <T>(id: string, folder: string, read: (copy: string) => T | Promise<T>): Promise<T | undefined> => {
        await prepared(id);
        return (computers.readFolder as NonNullable<ComputerPort['readFolder']>)(id, folder, read);
      },
    }),
  };
};
