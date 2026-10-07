import { lstatSync, readFileSync } from 'node:fs';
import { realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { computerId, computerSource, machineRefusal, openComputer } from '../computers.js';
import { RpcError } from '../rpc.js';
import type { Scope } from '../scopes.js';
import type { BroughtBack } from '../types/computers.js';
import type { Principal } from '../types/users.js';
import type { Owner } from '../types/usage.js';
import type { GitDir } from '../types/worktrees.js';
import type { HostContext } from './context.js';

/** The machine a session runs in, and the checks that decide it may. */
export interface Machines {
  sessionMachines: Map<string, { source: string; machine: string }>;
  enteredIn: Map<string, string>;
  inMachine(id: string | undefined, uri: string, entering: boolean): void;
  bringBackOf(uri: string): Promise<BroughtBack | undefined>;
  followOf(uri: string): Promise<void>;
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

/** What `lstat` says of a path, or nothing when it is not there. */
const statOf = (path: string) => {
  try { return lstatSync(path); }
  catch { return undefined; }
};

/** What a file says, trimmed, or nothing where it cannot be read. */
const saidBy = (path: string): string | undefined => {
  try { return readFileSync(path, 'utf8').trim(); }
  catch { return undefined; }
};

/**
 * A folder's own `.git` naming another repository's git directory, or nothing.
 *
 * Read before git is asked, because git is no help here: a `commondir` in the
 * folder's `.git` is followed, so git answers the repository it names - and
 * where the folder's `.git` holds nothing else, git answers nothing at all and
 * the folder looks like one with no repository in it. Naming that file is the
 * point: it is what somebody has to look at.
 *
 * `commondir` is read by git on the host and names where everything else is,
 * so the only directory it may name is the one it is in - which is what this
 * host itself writes for a main checkout, an empty one being one git breaks on.
 */
const stray = (folder: string): string | undefined => {
  const dotGit = join(folder, '.git');
  if (statOf(dotGit)?.isDirectory() !== true) return undefined;
  const commondir = join(dotGit, 'commondir');
  const said = saidBy(commondir);
  if (said === undefined || said === '' || resolve(dotGit, said) === resolve(dotGit)) return undefined;
  return `${commondir} names ${said}, which is not the directory it is in, so ${folder} has no git directory of its own`;
};

/**
 * Why the git directory git answered is not the tree's own, or nothing.
 *
 * Git takes the folder's `.git` as it is: a directory is a main checkout's git
 * directory, and a file names a worktree entry - so the answer is compared
 * against what the tree actually holds, and against the repository this host
 * made the session's tree from where it made one. What survives is the
 * folder's own, which is the only one a machine may be given.
 */
const notOwn = (found: GitDir, made: { repository: string } | undefined): string | undefined => {
  if (made !== undefined && resolve(found.gitDir) !== resolve(made.repository, '.git')) {
    return `${found.gitDir} is not the git directory of ${made.repository}, the repository this session was isolated from`;
  }
  const dotGit = join(found.repository, '.git');
  const there = statOf(dotGit);
  if (there?.isDirectory() === true) {
    if (resolve(dotGit) === resolve(found.gitDir)) return undefined;
    const commondir = join(dotGit, 'commondir');
    const said = saidBy(commondir);
    return said === undefined || said === '' || resolve(dotGit, said) === resolve(dotGit)
      ? `${found.gitDir} is not ${dotGit}, the git directory of ${found.repository}`
      : `${commondir} names ${said}, which is not the directory it is in`;
  }
  if (there?.isFile() === true) {
    const named = /^gitdir:\s*(.+?)\s*$/m.exec(saidBy(dotGit) ?? '')?.[1];
    if (named === undefined) return `${dotGit} names no gitdir, so it is not the worktree of ${found.gitDir} this folder belongs to`;
    const entry = isAbsolute(named) ? named : resolve(found.repository, named);
    if (resolve(entry) !== resolve(found.worktreeDir)) {
      return `${dotGit} names ${entry}, and the worktree git has for ${found.repository} is ${found.worktreeDir}`;
    }
  }
  return undefined;
};

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
      .then(() => (entering ? options.computers?.enter?.(id, uri) : letGo(id, uri)))
      .catch((error: unknown) => {
        ctx.log(`computers: ${entering ? 'enter' : 'leave'} of ${id} for ${uri} failed: ${error instanceof Error ? error.message : String(error)}`);
      });
  };

  /**
   * What one machine committed, brought back onto the host.
   *
   * A machine that commits in a git directory of its own keeps its work there
   * until ahpd fetches it - decision
   * `a-machine-commits-in-its-own-repository-and-the-host-fetches-it` - so
   * this is the host asking for it, and the answer is what became of it: on
   * the branch, or waiting in a ref of ahpd's own.
   *
   * A port that fails is a line in the log and no answer rather than a throw.
   * Every moment this is asked at is a moment that goes on without it - a turn
   * still ends, a session still leaves, a machine still goes - and a failure
   * there is a fact about one machine, not a reason for the host to fail what
   * somebody asked of it. What the caller does with the answer is the caller's:
   * a fetch that could not be made is not the same as work that waits.
   */
  const askedOf = async (id: string, uri: string): Promise<BroughtBack | undefined> => {
    try {
      return await options.computers?.bringBack?.(id);
    }
    catch (error) {
      ctx.log(`computers: bringing the work of ${id} back for ${uri} failed: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
  };

  /**
   * The machine a session is in, asked for what it committed.
   *
   * The name is normalised first, because a caller holds whichever spelling of
   * the session it was handed - a client's `ahp-session:/<id>`, a changeset
   * URI's owner - and the machines a session entered are kept under the one
   * name this host holds it by.
   */
  const bringBackOf = async (uri: string): Promise<BroughtBack | undefined> => {
    const named = ctx.heldAs(uri);
    const id = enteredIn.get(named);
    return id === undefined ? undefined : await askedOf(id, named);
  };

  /**
   * The machine a session is in, put where the host's branch is.
   *
   * A machine that commits in a git directory of its own reads history the host
   * already has and writes commits the host does not, so a commit made on the
   * host since it last looked - a person's in the tree, or one a changeset
   * operation made - is not in what the agent's next turn reads. This is that
   * commit being handed over, and the port's own call decides the rest: a
   * machine holding work the host has not fetched is left as it is, and says so
   * in the log, because it is the port that can look at both repositories.
   *
   * The same shape as `bringBackOf`, and for the same reason: the name is
   * normalised, a session in no machine asks nothing, and a port that fails is
   * a line in the log rather than a turn that does not start. What a machine
   * that could not be moved costs is one turn on a branch that is behind - the
   * same as before this existed - and refusing the turn would cost the work.
   */
  const followOf = async (uri: string): Promise<void> => {
    const named = ctx.heldAs(uri);
    const id = enteredIn.get(named);
    if (id === undefined) return;
    try {
      await options.computers?.follow?.(id);
    }
    catch (error) {
      ctx.log(`computers: setting ${id} to the host's branch for ${named} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  /**
   * A session leaving its machine: what the machine committed comes back first.
   *
   * The machine is named rather than read back out of `enteredIn`, because the
   * leave is asked for in a promise and the map is cleared by the caller
   * before that promise runs - a machine whose work was never fetched because
   * of the order these two lines run in would be a machine whose volume is
   * removed with the commits still in it.
   */
  const letGo = async (id: string, uri: string): Promise<void> => {
    await askedOf(id, uri);
    await options.computers?.leave?.(id, uri);
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
   * The git directory a machine for `folder` has in it, and the tree root it
   * needs in place of the folder where the folder is below it.
   *
   * The git directory is passed inside the folder too: it adds no mount there,
   * and the machine maker still guards it. A folder that is the root needs no
   * other root. A folder git refuses gets neither, with one line naming it and
   * git's reason, and so does one whose git directory is not its own: git
   * answers what the folder's `.git` says, and a `.git` naming another
   * repository - or a `commondir` in one - makes it answer that repository,
   * which would then be mounted for the machine, writable over it, with
   * `hooks/`, `worktrees/` and `modules/` made inside it.
   */
  const repositoryOf = async (uri: string, folder: string | undefined): Promise<{ gitDir?: string; repository?: string }> => {
    const ask = options.worktrees?.gitDir;
    if (folder === undefined || folder === '' || ask === undefined) return {};
    const named = stray(folder);
    if (named !== undefined) {
      ctx.log(`computers: no git directory for ${folder}: ${named}`);
      return {};
    }
    let found: GitDir | undefined;
    try {
      found = await ask.call(options.worktrees, folder);
    }
    catch (error) {
      ctx.log(`computers: no git directory for ${folder}: ${error instanceof Error ? error.message : String(error)}`);
      return {};
    }
    if (found === undefined) return {};
    const stranger = notOwn(found, ctx.worktrees.get(uri));
    if (stranger !== undefined) {
      ctx.log(`computers: no git directory for ${folder}: ${stranger}`);
      return {};
    }
    const spellings = [folder, await realpath(folder).catch(() => folder)];
    const atRoot = spellings.includes(found.repository);
    return { gitDir: found.gitDir, ...(atRoot ? {} : { repository: found.repository }) };
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
    const devPrefix = 'devcontainer://';
    const tree = await repositoryOf(uri, said.startsWith(devPrefix) ? said.slice(devPrefix.length).trim() : where);
    const machine = await openComputer(options.computers, said, {
      session: uri,
      provider,
      ...(owner === undefined ? {} : { owner }),
      ...(scope?.team === undefined ? {} : { team: scope.team }),
      ...(scope?.project === undefined ? {} : { project: scope.project }),
      ...(where === undefined ? {} : { folder: where }),
      ...tree,
      ...(agent?.machine === undefined ? {} : { needs: agent.machine() }),
    });
    sessionMachines.set(uri, { source: said, machine });
    config.computer = machine;
  };

  return { sessionMachines, enteredIn, inMachine, bringBackOf, followOf, leaveForgotten, machineFor, admitted, placedIn };
}