import { computerId, computerSource, machineRefusal, openComputer } from '../computers.js';
import { RpcError } from '../rpc.js';
import type { Scope } from '../scopes.js';
import type { Principal } from '../types/users.js';
import type { Owner } from '../types/usage.js';
import type { HostContext } from './context.js';

/** The machine a session runs in, and the checks that decide it may. */
export interface Machines {
  sessionMachines: Map<string, { source: string; machine: string }>;
  enteredIn: Map<string, string>;
  inMachine(id: string | undefined, uri: string, entering: boolean): void;
  leaveForgotten(uri: string, config: Record<string, unknown> | undefined): void;
  machineFor(config: Record<string, unknown>): string;
  admitted(
    principal: Principal | undefined,
    scope: Scope | undefined,
    config: Record<string, unknown>,
    provider: string,
    session: string,
    owner?: Owner,
  ): Promise<string | undefined>;
  placedIn(
    uri: string,
    provider: string,
    config: Record<string, unknown>,
    where: string | undefined,
    owner?: Owner,
  ): Promise<void>;
}

export function createMachines(ctx: HostContext): Machines {
  const { options, agents, charged, checked } = ctx;

  /**
   * The machine a session made from a source, and the source it named.
   *
   * A session whose `computer` setting is `disposable:<profile>` - or any
   * other source a plugin serves - is made a machine when it starts, and the
   * setting is rewritten to the `computer://<id>` that came back. The source
   * is kept because a client sends its whole config bag on the first send,
   * including the source it picked: the two have to be recognised as the same
   * choice rather than a fixed key that moved, or the session would be started
   * again with the source a backend cannot enter and, worse, a second machine
   * would be made for it.
   */
  const sessionMachines = new Map<string, { source: string; machine: string }>();
  /**
   * The machine a session is inside, as the plugin was told.
   *
   * Not the same as the config's `computer://<id>`: that is what the session
   * is being started into, and a restart before the first turn rewrites it.
   * This is where it actually is, which is the machine whose delay a disposal
   * starts and the one a session moving away lets go.
   */
  const enteredIn = new Map<string, string>();

  /**
   * Tell the port that a session is in a machine, or that it is not any more.
   *
   * The port may do work before it answers - a plugin that finds its machines
   * by listing them at startup cannot count a session into one it has not found
   * yet - so either may answer a promise, and a promise nobody waits on that
   * throws takes this process down rather than losing one machine's count.
   * Nothing here is held up by it either: a session starting is not a session
   * that failed because a plugin's own bookkeeping did.
   */
  const inMachine = (id: string | undefined, uri: string, entering: boolean): void => {
    if (id === undefined) return;
    // Asked inside a promise rather than around a call, because a port that
    // throws before it answers is the same failure as one that rejects after,
    // and a `try` around the call would have caught only the first of them.
    void Promise.resolve()
      .then(() => (entering ? options.computers?.enter?.(id, uri) : options.computers?.leave?.(id, uri)))
      .catch((error: unknown) => {
        ctx.log(`computers: ${entering ? 'enter' : 'leave'} of ${id} for ${uri} failed: ${error instanceof Error ? error.message : String(error)}`);
      });
  };

  /**
   * Let a gone session's machine go, for a session that never entered one here.
   *
   * A disposable machine records the session it was made for, and a daemon
   * adopts it when it keeps that session, counting it as a user until the
   * session is disposed. One of the two ways a session this daemon kept can go
   * says so itself: a disposal is a thing a session running in this process
   * does, and it has entered the machine it was started in. The other is a
   * listing that no longer finds the session - a transcript deleted outside
   * this host - which has no session to dispose. This is that one: the stored
   * config still names the machine, and the port is told the session has left
   * it.
   *
   * One function, so the answer to "when does a forgotten session let its
   * machine go" is in one place and another signal can be added beside it. A
   * source or no setting at all names no machine and does nothing, and a
   * session that already left is harmless: the port's set does not count it
   * twice.
   */
  const leaveForgotten = (uri: string, config: Record<string, unknown> | undefined): void => {
    inMachine(computerId(config?.computer), uri, false);
  };

  /**
   * The machine a check names, from the setting a session was given.
   *
   * As the client sent it, so a check runs before a machine exists: a
   * `computer://<id>` it named and the `disposable:` source one is yet to be
   * made from are both what the session asked to run in. Nothing asked means
   * this host, which is what a session with no `computer` setting runs on.
   */
  const machineFor = (config: Record<string, unknown>): string =>
    computerId(config.computer) ?? computerSource(config.computer) ?? 'host';

  /**
   * What a session is refused before it runs in a machine, or nothing.
   *
   * The two questions every road asks, in one order: the policy first and the
   * machine's own label second, so a person refused this machine by policy is
   * told that rather than that some other agent's machine it also is. The two
   * calls sit next to each other here rather than at each road, so the order is
   * one line to change and every road keeps it.
   *
   * The policy is asked for the two kinds a session is checked for, and only
   * those: the harness it asked for and the machine it named, the source read
   * as the machine it is yet to be made from.
   *
   * `createSession`, a change before the first turn and an automation's start
   * all come through here, which is the point: a check that one of them has and
   * the others do not is a check nobody can rely on. Only a `computer://<id>`
   * is read for its label - a `disposable:` source is made by `placedIn` with
   * `for: <provider>`, so it is prepared for the agent asking by construction.
   *
   * `owner` is who is asking, and each road reads it where its owner is: the
   * connection's on `createSession`, the run's on an automation's start, and
   * the session's own recorded owner on a change before the first turn. It is
   * taken from the caller rather than from the store because the store has not
   * been written yet on two of the three roads - a session's owner is recorded
   * when it opens, which is after this - and a session id is the client's to
   * choose, so the owner is what tells two people apart.
   */
  const admitted = async (
    principal: Principal | undefined,
    scope: Scope | undefined,
    config: Record<string, unknown>,
    provider: string,
    session: string,
    owner?: Owner,
  ): Promise<string | undefined> => {
    const machine = machineFor(config);
    const refused = await checked(principal, scope, [
      { kind: 'agent', asked: { agent: provider, computer: machine } },
      { kind: 'computer', asked: { computer: machine } },
    ]);
    if (refused !== undefined) return refused;
    const named = computerId(config.computer);
    return named === undefined
      ? undefined
      : machineRefusal(options.computers, named, provider, session, owner);
  };

  /**
   * The machine a session should run in, made now when its setting names a source.
   *
   * A `disposable:<profile>` setting is a profile the plugin turns into a
   * machine for this session - with the profile, this harness's `machine()`
   * needs and the folder the session works in. What comes back is written over
   * the setting, so everything downstream - the backend's `settings`, a
   * restart, a second chat - sees an ordinary `computer://<id>` and the session
   * runs as if it had been given one.
   *
   * A session that already has a machine for the source it named keeps it: the
   * first send pushes the whole config bag, and rewriting the same choice to
   * the same machine is what stops a pre-turn restart from making a second one.
   * A different source before the first turn is refused rather than silently
   * kept, because a machine is where the session is running.
   *
   * `owner` is whose the machine is - whoever asked for it, which is what the
   * time it spends up is later charged to - and the session's own scope rides
   * along so the machine carries it too - decision
   * `a-machine-is-owned-by-whoever-created-it-and-pays-for-its-up-time`.
   */
  const placedIn = async (
    uri: string,
    provider: string,
    config: Record<string, unknown>,
    where: string | undefined,
    owner?: Owner,
  ): Promise<void> => {
    const said = computerSource(config.computer);
    if (said === undefined) return;
    const known = sessionMachines.get(uri);
    if (known !== undefined) {
      if (known.source !== said) {
        throw new RpcError(-32602, `This session is already running in ${known.machine}, made from ${known.source}, and cannot switch to ${said} before its first turn; dispose it and create one that asks for ${said}`);
      }
      config.computer = known.machine;
      return;
    }
    const agent = agents.get(provider);
    const scope = charged.get(uri)?.scope;
    const machine = await openComputer(options.computers, said, {
      session: uri,
      provider,
      ...(owner === undefined ? {} : { owner }),
      ...(scope?.team === undefined ? {} : { team: scope.team }),
      ...(scope?.project === undefined ? {} : { project: scope.project }),
      ...(where === undefined ? {} : { folder: where }),
      ...(agent?.machine === undefined ? {} : { needs: agent.machine() }),
    });
    sessionMachines.set(uri, { source: said, machine });
    config.computer = machine;
  };

  return { sessionMachines, enteredIn, inMachine, leaveForgotten, machineFor, admitted, placedIn };
}