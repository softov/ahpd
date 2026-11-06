import { deleteSession, getSessionInfo, listSessions } from '@anthropic-ai/claude-agent-sdk';
import { closeSync, existsSync, fstatSync, openSync, readdirSync, readSync, realpathSync, rmSync } from 'node:fs';
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
 * One SDK session as a row, titled by its custom title or else the SDK's
 * summary, in the folder the SDK says it ran in, as VS Code's Claude agent
 * projects a row; a session with neither title is listed untitled, and one
 * with no folder in none.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeSessionMetadataStore.ts#L191-L198
 */
const listed = (info: SDKSessionInfo): Listed => ({
  id: info.sessionId,
  title: info.customTitle ?? info.summary ?? '',
  createdAt: new Date(info.createdAt ?? info.lastModified).toISOString(),
  modifiedAt: new Date(info.lastModified).toISOString(),
  workingDirectories: info.cwd ? [uriOf(info.cwd)] : [],
});

/**
 * Every session the CLI's store holds, wherever it ran: the SDK's
 * `listSessions` with no directory, as VS Code's Claude agent lists them.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeAgentSdkService.ts#L171-L174
 */
export async function catalogue(): Promise<Listed[]> {
  return (await listSessions()).map(listed);
}

/**
 * One session's own row, as the SDK answers it by id without listing the rest.
 *
 * `getSessionInfo` reads one session file where `listSessions` reads every one
 * of them, which is what a client opening a row the host does not hold costs:
 * a link from another machine, a session written to disk after the last
 * listing. Asked with no directory, it searches every project, as VS Code's
 * Claude agent asks it, so a session is found wherever it ran. Same shape as
 * `catalogue`'s rows and the same mapping, so a row found this way is the row
 * a listing would have offered.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeAgent.ts#L2239
 */
export async function findSession(id: string): Promise<Listed | undefined> {
  const info = await getSessionInfo(id).catch(() => undefined);
  return info === undefined ? undefined : listed(info);
}

/** `~/.claude/projects`, or the same under `CLAUDE_CONFIG_DIR` where it is set. */
const projectsDir = (): string => join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), 'projects');

/** Whether an id can name a transcript file, which is all an id here is ever looked up as. */
const fileNamed = (id: string): boolean => /^[A-Za-z0-9-]+$/.test(id);

/** The transcript for `id` in `project`, where the CLI writes it. */
const transcriptIn = (project: string, id: string): string => join(projectsDir(), project, `${id}.jsonl`);

/**
 * The project folder of `folder`, spelled the way the SDK spells it: from its
 * real path where it has one and as given where it does not.
 */
const projectOf = (folder: string): string => {
  let real = folder;
  try { real = realpathSync(folder); }
  catch { /* a folder that is gone keeps its transcript under the name it had */ }
  return real.replace(/[^A-Za-z0-9]/g, '-');
};

/** What every entry of a conversation carries, and the CLI's other lines in a transcript do not. */
const ENTRY = Buffer.from('"parentUuid":');
/** How much of each end of a transcript is read first. */
const END = 65536;
/** How much of the rest is read at a time, and how much of it at most. */
const STEP = 1048576;
const MOST = 16777216;

/**
 * Whether `file` is a transcript that holds a conversation: at least one entry
 * of it, which is what the CLI's resume needs. It ends at startup with
 * `No conversation found` for a transcript of its other lines alone, the last
 * prompt, the cost and the like, which is what a CLI leaves when it is closed
 * after a prompt reached it and before it wrote the prompt's entry.
 *
 * The SDK's own test, read as it reads it: the first and the last 64 KiB, then
 * the rest 1 MiB at a time with each read's last bytes carried into the next,
 * up to 16 MiB, past which a transcript is taken to hold one. Synchronous,
 * because a session is built synchronously and its CLI starts as it is.
 * npm://@anthropic-ai/claude-agent-sdk@0.3.301 (sdk.mjs, the check its session
 * listing makes of a conversation a session continued in)
 */
const conversation = (file: string): boolean => {
  let fd: number;
  try { fd = openSync(file, 'r'); }
  catch { return false; }
  try {
    const size = fstatSync(fd).size;
    const head = Buffer.alloc(Math.min(END, size));
    readSync(fd, head, 0, head.length, 0);
    if (head.includes(ENTRY)) return true;
    if (size <= END) return false;
    const tail = Buffer.alloc(END);
    readSync(fd, tail, 0, END, size - END);
    if (tail.includes(ENTRY)) return true;
    const chunk = Buffer.alloc(STEP + ENTRY.length);
    let kept = 0;
    for (let at = 0; at < MOST;) {
      const read = readSync(fd, chunk, kept, STEP, at);
      if (read === 0) return false;
      const end = kept + read;
      if (chunk.subarray(0, end).includes(ENTRY)) return true;
      kept = Math.min(ENTRY.length, end);
      chunk.copyWithin(0, end - kept, end);
      at += read;
    }
    return true;
  }
  catch { return false; }
  finally { closeSync(fd); }
};

/**
 * Whether the CLI wrote a conversation under `id`, which is the only kind of id
 * its resume takes: it ends at startup with `No conversation found` for any
 * other.
 *
 * The project of `folder` is read first, because the CLI writes a session of
 * that folder there. Every other project follows, because the CLI's resume finds
 * a conversation under any of them, as the reference asks the SDK with no
 * folder at all. The files are read rather than the SDK asked, because a session
 * is built synchronously and its CLI starts as it is.
 * https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/claude/claudeAgent.ts#L1728-L1744
 */
export function written(id: string, folder: string): boolean {
  if (!fileNamed(id)) return false;
  if (conversation(transcriptIn(projectOf(folder), id))) return true;
  let projects: string[];
  try { projects = readdirSync(projectsDir()); }
  catch { return false; }
  return projects.some((project) => conversation(transcriptIn(project, id)));
}

/**
 * Make way for a new conversation under `id` in `folder`.
 *
 * The CLI starts a conversation under a name only on a clean transcript: it
 * ends at startup with `Session ID <id> is already in use` when the project of
 * its folder holds a transcript for that id, whatever the transcript holds. So
 * a transcript there that holds no conversation is deleted first, as the
 * reference deletes a transcript before it starts a conversation over under the
 * same id. One that holds a conversation is never deleted.
 * https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/claude/claudeAgent.ts#L1141-L1168
 */
export function clearFor(id: string, folder: string): void {
  if (!fileNamed(id)) return;
  const file = transcriptIn(projectOf(folder), id);
  if (!existsSync(file) || conversation(file)) return;
  rmSync(file, { force: true });
}

/**
 * One listing the variants of one load of this plugin share, as VS Code's SDK
 * service shares one `listSessions` among the callers that overlap it.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeAgentSdkService.ts#L167-L181
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
export function sharedCatalogue(): () => Promise<Listed[]> {
  let running: Promise<Listed[]> | undefined;
  return () => {
    running ??= catalogue().finally(() => { running = undefined; });
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
 * *started* in, so the other projects are looked through before answering
 * that there is none. What a
 * session does not have is an id that is not a filename: a client may name
 * anything at all, and one id would otherwise be a path out of the store.
 */
export function transcriptOf(id: string, directory: string | undefined): string | undefined {
  if (!/^[A-Za-z0-9-]+$/.test(id)) return undefined;
  const projects = projectsDir();
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
