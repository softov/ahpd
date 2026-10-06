import { deleteSession, getSessionInfo, listSessions } from '@anthropic-ai/claude-agent-sdk';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { SDKSessionInfo } from '@anthropic-ai/claude-agent-sdk';
import { uriOf } from '@ahpd/sdk';
import type { Listed } from '@ahpd/sdk';

/**
 * Claude's own sessions, as rows a host can list.
 *
 * Renames the SDK's session listing into `Listed`. The SDK is the authority on
 * which sessions exist; this module only maps the fields - which is why it is
 * here and not beside the URI helpers in `@ahpd/sdk`: a host serving some
 * other harness has a different answer to the same question, and no reason to
 * load this one to find that out.
 */
/**
 * What this backend is a catalogue *of*.
 *
 * `dir`, not `cwd` - the option that scopes a listing to one project is spelled
 * `dir`, and an unrecognised key is ignored rather than refused, so the wrong
 * spelling answers with every session on the machine and looks like it worked.
 */
/** One SDK session as a row, under the directory it was asked for. */
const listed = (info: SDKSessionInfo, dir: string): Listed => ({
  id: info.sessionId,
  title: info.customTitle ?? info.summary ?? info.firstPrompt ?? 'Session',
  createdAt: new Date(info.createdAt ?? info.lastModified).toISOString(),
  modifiedAt: new Date(info.lastModified).toISOString(),
  workingDirectories: [uriOf(info.cwd ?? dir)],
});

export async function catalogue(dir: string): Promise<Listed[]> {
  const found = await listSessions({ dir });
  return found.map((info) => listed(info, dir));
}

/**
 * One session's own row, as the SDK answers it without listing the rest.
 *
 * `getSessionInfo` reads one session file where `listSessions` reads every one
 * of them, which is what a client opening a row the host does not hold costs:
 * a link from another machine, a session written to disk after the last
 * listing. Same shape as `catalogue`'s rows and the same mapping, so a row
 * found this way is the row a listing would have offered.
 *
 * `dir` is passed per path rather than left out because the path is the answer
 * here as well as the row: the transcript reader wants the directory the
 * session ran in, and this is the one call that says which it was without a
 * listing. The paths are asked in turn, since a session lives under exactly one
 * of them and the first that has it is the only one that will.
 */
export async function findSession(dirs: string[], id: string): Promise<{ row: Listed; dir: string } | undefined> {
  for (const dir of dirs) {
    const info = await getSessionInfo(id, { dir }).catch(() => undefined);
    if (info === undefined) continue;
    return { row: listed(info, dir), dir };
  }
  return undefined;
}

/**
 * One listing the variants of one load of this plugin share.
 *
 * Every preset is registered as an agent of its own, and every one of them
 * reads the same projects directory for the same sessions - so three presets
 * is three passes over the same files for one answer, which is the single
 * largest cost in a `listSessions`. The host cannot see that two agents read
 * one store: `registerAgent` records no plugin and `Agent` has no key for a
 * store, so the sharing is here instead.
 *
 * Only the run is shared, never the answer. It is dropped the moment it
 * settles, because the host holds the catalogue (host 56, task 03) and a
 * listing kept here would be a second, older copy of the same rows.
 */
export function sharedCatalogue(dirs: string[]): () => Promise<Listed[]> {
  let running: Promise<Listed[]> | undefined;
  return () => {
    running ??= Promise.all(dirs.map((dir) => catalogue(dir)))
      .then((lists) => lists.flat())
      .finally(() => { running = undefined; });
    return running;
  };
}

/**
 * The transcript on disk for one session, or nothing when it has none.
 *
 * `~/.claude/projects/<directory>/<id>.jsonl`, with the directory spelled the
 * way the CLI spells it - every character that is not a letter or a digit
 * made a dash - and `CLAUDE_CONFIG_DIR` in place of `~/.claude` where it is
 * set.
 *
 * A session resumed elsewhere may have been written under the directory it
 * *started* in, which is a folder no listing was asked about, so the other
 * projects are looked through before answering that there is none. What a
 * session does not have is an id that is not a filename: a client may name
 * anything at all, and one id would otherwise be a path out of the store.
 */
export function transcriptOf(id: string, directory: string | undefined): string | undefined {
  if (!/^[A-Za-z0-9-]+$/.test(id)) return undefined;
  const projects = join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), 'projects');
  if (directory !== undefined) {
    const own = join(projects, directory.replace(/[^A-Za-z0-9]/g, '-'), `${id}.jsonl`);
    if (existsSync(own)) return own;
  }
  let names: string[];
  try { names = readdirSync(projects); }
  catch { return undefined; }
  for (const name of names) {
    const file = join(projects, name, `${id}.jsonl`);
    if (existsSync(file)) return file;
  }
  return undefined;
}

/**
 * Delete a session the way the CLI does: the transcript, and the folder its
 * subagents wrote under the same id.
 *
 * `dir` is left out of the SDK call whatever the host knows, so the search
 * covers every project directory rather than the one the session is said to
 * have run in. A session resumed somewhere else keeps its transcript in the
 * project it started in - which is why `transcriptOf` looks through every
 * project before saying a session has none - and asking for one directory
 * would refuse to delete a transcript that is plainly there. `directory` is
 * still what the not-found below is checked against, because that is the one
 * place a directory narrows the answer rather than widening it.
 *
 * A session the store says it does not have is deleted. The SDK throws for
 * one, and which of its throws that is is not something its message says the
 * same way across versions, so the store is asked rather than the string: a
 * session deleted twice is deleted, and refusing the second delete would be a
 * host failing a request it had in fact carried out. Anything else is raised,
 * because a transcript that would not go is a delete that did not happen.
 */
export async function forgetSession(id: string, directory: string | undefined): Promise<void> {
  try {
    await deleteSession(id, {});
  }
  catch (error) {
    if (transcriptOf(id, directory) === undefined) return;
    throw error;
  }
}
