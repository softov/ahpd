import { realpathSync } from 'node:fs';
import { posix } from 'node:path';
import { localPath, uriOf } from '../fileuri.js';
import type { Connection } from '../types/host.js';
import type { Bag } from '../types/common.js';

/*
 * Whether a client trusts a folder, read from the `workspaceTrust` value it
 * pushed - decision `a-folder-is-untrusted-until-a-client-says-otherwise` - and
 * from the folders it said yes to one at a time, which are kept on its
 * connection until it pushes a new value.
 *
 * VS Code's own reading of the same value, `codexAgent.ts:8074-8090`: nothing
 * pushed is untrusted, a falsy `enabled` trusts everything, and otherwise a
 * folder is trusted when one of `trustedUris` is it or its parent. This is the
 * one place that reading lives, so the session start, the ACP refusal and the
 * move's question cannot drift from each other. The question the host puts to a
 * window that has said nothing lives here with it, for the same reason.
 *
 * Two folders are compared as what they name, never as the text they were
 * written as: `/a/../b` is `/b` and a folder under a symlink is the folder the
 * link points at, so neither spelling walks past a parent a window vouched for.
 * An entry that names no folder on this machine - the empty string, a `file:`
 * URI whose host is another machine - vouches for nothing rather than for
 * everything, since what it names is nothing.
 */

/**
 * A path with any trailing slash taken off, so `/a/` and `/a` are one folder.
 *
 * The root keeps its own, because a root stripped of it is the empty string
 * and then nothing is under it.
 */
const bare = (path: string): string => (path.length > 1 && path.endsWith('/') ? path.replace(/\/+$/, '') : path);

/**
 * A path as the folder it names: absolute, and read the way the filesystem
 * reads it - `..` against the component before it, and every symlink followed.
 *
 * The target rather than the link, because a folder inside a trusted one that
 * is a link out of it is the folder outside: judging it by its own text lets
 * one symlink open everything. The text is not resolved first, because `..`
 * after a symlink means the parent of the target and not of the link, and a
 * text that says otherwise is the bypass this closes.
 *
 * A folder that is not there, and one this process may not reach, is settled by
 * the part of it above, which is followed: what exists decides what is inside
 * what. Nothing for the empty string and for a relative path, which name no
 * folder this host can enter.
 */
const settled = (path: string): string | undefined => {
  if (path === '' || !path.startsWith('/')) return undefined;
  let there = path;
  const beyond: string[] = [];
  for (;;) {
    try {
      // The part that is there, followed, with the part that is not put back
      // on it: `link/not-yet` is read through `link` rather than beside it,
      // which reading the whole path as written would get wrong.
      return bare(posix.join(realpathSync(there), ...beyond));
    }
    catch {
      const above = posix.dirname(there);
      if (above === there) return bare(there);
      beyond.unshift(posix.basename(there));
      there = above;
    }
  }
};

/** The path one `trustedUris` entry names, or nothing when it names no folder here. */
const folderOf = (entry: string): string | undefined => {
  if (entry === '') return undefined;
  if (entry.startsWith('file://')) {
    /*
     * The authority, which is everything before the first slash: an empty one
     * and `localhost` are this machine, and any other is another machine's
     * folder. A window vouching for a folder on another machine is not
     * vouching for anything here, which is what an unreadable entry means.
     */
    const rest = entry.slice('file://'.length);
    const slash = rest.indexOf('/');
    const authority = (slash === -1 ? rest : rest.slice(0, slash)).toLowerCase();
    if (authority !== '' && authority !== 'localhost') return undefined;
  }
  return settled(localPath(entry));
};

/** Whether `folder` is `parent` itself or somewhere under it, path by path. */
const under = (folder: string, parent: string): boolean => {
  const one = bare(folder);
  const two = bare(parent);
  if (one === two) return true;
  // A parent that is the root already ends in the separator the comparison
  // needs, and one that is not gets it - so `/ab` is a sibling of `/a` and
  // never one of its children, which is what a bare `startsWith` would say.
  return one.startsWith(two.endsWith('/') ? two : `${two}/`);
};

/** Whether two paths name the same folder, once both are settled. */
export const sameFolder = (one: string, two: string): boolean => {
  const left = settled(one);
  return left !== undefined && left === settled(two);
};

/**
 * Whether one folder is trusted under one pushed `workspaceTrust` value, or
 * under the folders the same connection said yes to one at a time.
 *
 * `value` is what a client put in root config, which is `unknown` because a
 * client can send anything: anything that is not an object trusts nothing, and
 * `trustedUris` that is not a list trusts nothing either - VS Code throws on
 * the second, and a value read while a session starts is not a place to throw.
 *
 * `enabled: false` trusts every folder, which is what that says: the window has
 * workspace trust turned off, so there is no such thing as an untrusted folder
 * there. VS Code's own test is `!trust.enabled`, which would trust a value
 * naming no `enabled` at all as well; the decision's words are `enabled: false`
 * and a push this host cannot read trusts nothing rather than everything. It is
 * said of the window rather than of the folder, so it is answered before the
 * folder is looked at, exactly as VS Code reads it.
 *
 * `said` is the folders this connection answered yes to when the host asked it,
 * settled when they were recorded. They are read beside the pushed value rather
 * than folded into it, because a push replaces the window's whole answer and a
 * question answered folder by folder is not part of that answer.
 */
export const trusted = (folder: string | undefined, value: unknown, said?: string[]): boolean => {
  if (folder === undefined || folder === '') return false;
  const held = (typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {}) as {
    enabled?: unknown;
    trustedUris?: unknown;
  };
  if (held.enabled === false) return true;
  const asked = settled(folder);
  if (asked === undefined) return false;
  if (said !== undefined && said.some((one) => under(asked, one))) return true;
  if (held.enabled !== true || !Array.isArray(held.trustedUris)) return false;
  return held.trustedUris.some((one) => {
    if (typeof one !== 'string') return false;
    const parent = folderOf(one);
    return parent !== undefined && under(asked, parent);
  });
};

/** What the host tells a client about a folder it will not enter. */
export const trustRefused = (folder: string): string => `Workspace trust was not granted for '${folder}'`;

/**
 * Whether this session is one nobody is asked about.
 *
 * VS Code's own test, `sessionWorkspaceConversionService.ts:169-170`: a window
 * with global auto-approve on, or a session set to auto-approve, is one where
 * the question would be answered by the setting rather than by a person - so
 * there is nothing to ask and nothing to wait for.
 *
 * `config` is the session's value in effect, defaults and all, and `rootConfig`
 * is the host's own record, which is where a pushed `globalAutoApproveEnabled`
 * lands: it is a setting about the host rather than about one window, unlike
 * `workspaceTrust` beside it.
 */
export const autoApproved = (config: Record<string, unknown>, rootConfig: Record<string, unknown>): boolean =>
  rootConfig.globalAutoApproveEnabled === true || config.autoApprove === 'autoApprove';

/**
 * Ask one window whether it trusts one folder, and answer what it said.
 *
 * The request VS Code's host puts to its window: `workspace` is the folder and
 * the answer is `{ trusted: boolean }`. `trustedParent`, which VS Code sends
 * for a folder that does not exist yet, is not sent: the one folder this host
 * asks about before it exists is a worktree, and a worktree is vouched for by
 * the repository it was cut from rather than by a window - decision
 * `a-worktree-inherits-its-repositorys-trust`.
 *
 * Whatever comes back that is not `{ trusted: true }` is a no, and so is a
 * client that does not serve the method at all - it answers `-32601`, which
 * arrives here as a rejection. There is no timeout, as there is none in VS
 * Code: a window somebody is looking at may hold the question for as long as
 * they take, and a client that never answers holds the move until it
 * disconnects, which rejects it.
 */
const granted = async (sender: Connection, folder: string): Promise<boolean> => {
  const answer = await sender.peer.request('vscode/requestWorkspaceTrust', { workspace: uriOf(folder) });
  const held = (typeof answer === 'object' && answer !== null ? answer : {}) as Bag;
  return held.trusted === true;
};

/**
 * The question, put to whoever asked for the move, or a refusal.
 *
 * A folder this window already pushed as trusted, or said yes to when it was
 * asked about another one, is not asked about again: the answer is on its
 * connection, and asking a window what it has already said is a round trip for
 * nothing. A folder no window asked about at all - an automation's session, a
 * host tool acting for nobody - is refused without a question, because there is
 * nobody to vouch for it and a folder nobody vouched for is untrusted.
 *
 * The yes that follows is kept on the connection, so every backend started
 * there while it stands is told the same thing - a move starts the backend
 * again, and the process that starts has never heard the question. It stands
 * until that window pushes a `workspaceTrust` value, which is it answering for
 * every folder at once and so puts the folder-by-folder answers behind it.
 */
export const requireTrust = async (asked: {
  folder: string;
  sender: Connection | undefined;
  autoApproved: boolean;
}): Promise<void> => {
  if (asked.autoApproved) return;
  /*
   * The folder as it names itself rather than as it was written: `..` inside a
   * path that begins like a trusted folder is a folder outside it, and it has
   * to be asked about as the folder it resolves to. A path that resolves to
   * nothing is kept as written, so the question and the refusal name what the
   * caller asked for.
   */
  const folder = settled(asked.folder) ?? asked.folder;
  const sender = asked.sender;
  if (sender !== undefined && trusted(folder, sender.config?.workspaceTrust, sender.trustedFolders)) return;
  if (sender === undefined || !(await granted(sender, folder))) throw new Error(trustRefused(folder));
  const vouched = settled(folder);
  if (vouched !== undefined) sender.trustedFolders = [...(sender.trustedFolders ?? []), vouched];
};
