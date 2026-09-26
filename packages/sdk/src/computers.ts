import type { Start } from './types/agent.js';
import type { ComputerPort, MachineSource, NestedStart } from './types/computers.js';

/**
 * Refuse a session that was told to run in a computer this backend cannot enter.
 *
 * A session key is the person's, and the host hands it to whichever backend was
 * named in `Start.settings`. A backend that spawns its process through the
 * host's `computers` port honours it, and there is exactly one of those today,
 * `@ahpd/agent-acp`. Every other backend must refuse rather than run on the
 * host and leave a person believing they are inside a sandbox they are not in -
 * decision `a-backend-reaches-a-computer-through-a-port`.
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
 * runs the session on this host. Anything else - `disposable:<profile>` today,
 * `devcontainer://<folder>` after it - is a source the plugin that owns the
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
 * a disposable profile today and a folder's dev container after it. A value
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
 * The port a session's backend is handed, with the machine's label checked.
 *
 * A machine is prepared for the agents its profile named, and remembers them
 * in its `ahpd.agents` label. The picker already offers only machines prepared
 * for the asking agent, but a value can be set by hand, or arrive from a client
 * that read an older list - and a session running in a machine that was not
 * prepared for it fails much later and further away, if it runs at all. So the
 * provider is checked as the backend asks to enter, which is the one place the
 * host knows both numbers and the one place every path - a client's
 * `createSession`, an automation, a tool call - goes through.
 *
 * A machine with no label is one made before this existed, and is offered to
 * every agent; a port that cannot answer labels is one this check cannot make.
 * The refusal names the agents the machine was made for rather than only the
 * one it was not, because that is what tells a person where to go.
 */
export const computersFor = (computers: ComputerPort, provider: string): ComputerPort => {
  /** Refuse a machine prepared for somebody else, before either verb reaches it. */
  const prepared = async (id: string): Promise<void> => {
    const for_ = computers.agents === undefined ? undefined : await computers.agents(id);
    if (for_ !== undefined && for_.length > 0 && !for_.includes(provider)) {
      throw new Error(`computer://${id} was prepared for ${for_.join(', ')}, and this session runs ${provider}; make a machine prepared for ${provider} or run this session on the host`);
    }
  };
  return {
    ...computers,
    how: async (id, options) => {
      await prepared(id);
      return computers.how(id, options);
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
        return (computers.nested as NonNullable<ComputerPort['nested']>)(id, asked);
      },
    }),
  };
};
