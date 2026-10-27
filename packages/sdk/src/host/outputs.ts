import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { TerminalState } from '@microsoft/agent-host-protocol';
import { idOf } from '../sessions/catalog.js';
import { readJsonObject, writeJsonAtomic } from '../utils/jsonfile.js';
import { bag, isRecord, reason, str } from '../utils/values.js';
import { chatUriFor, retainedTerminalOf, retainedTerminalUri } from './channels.js';
import type { Bag } from '../types/common.js';
import type { TerminalOutputs } from '../types/terminals.js';
import type { OnWire } from '../types/wire.js';
import type { HostContext } from './context.js';

/**
 * A terminal's output, kept after its terminal is gone.
 *
 * A tool result that names a terminal names it for as long as its chat lasts:
 * the protocol says a subscription to an exited one MUST answer its content,
 * and that a host MAY rebuild it from persisted output rather than keep a
 * process or an instance.
 * https://github.com/microsoft/agent-host-protocol/blob/d4f542ea7e11fc8ec137fbe790925376f62031ac/docs/specification/terminal-channel.md#historical-terminal-results
 *
 * So the output is kept in the session's own folder, the one the session store
 * removes with the session: one JSON file a terminal, under its chat and its
 * key. A subscribe that no live terminal answers is answered from it, as the
 * reference host answers from its chat's database.
 * https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/agentService.ts#L10647-L10718
 */
export interface Outputs {
  /** The outputs one chat keeps, as a backend is handed them, or nothing where the store keeps no folder. */
  outputsFor(session: string, chat: string): TerminalOutputs | undefined;
  /**
   * Keep what one of this host's own terminals printed, once it has exited.
   *
   * Under its chat and key, in the folder of the session that holds the chat
   * now: a chat that moved while its command ran is not the session the
   * terminal was opened for.
   */
  keepExited(chat: string, key: string, opener: string, state: OnWire<TerminalState>, exitCode: number | undefined): void;
  /**
   * The exited state a retained terminal is rebuilt as, or nothing when it is
   * not one this host can rebuild.
   *
   * Nothing at once for a name that is not a retained terminal's: a subscribe
   * to any other channel takes its snapshot in the tick it arrived in, so what
   * a client dispatches straight after it is replayed after the snapshot.
   */
  retainedState(channel: string): Promise<(OnWire<TerminalState> & { exitCode?: number }) | undefined> | undefined;
  /** Forget the outputs that some dropped turns of a chat name. */
  forgetTurnOutputs(session: string, chat: string, turns: readonly Bag[]): void;
  /** Forget every output a chat kept. */
  forgetChatOutputs(session: string, chat: string): void;
  /** Take a chat's outputs to the session it moved to. */
  moveChatOutputs(from: string, to: string, chat: string): void;
}

/** What one file holds. */
interface Kept {
  output: string;
  exitCode?: number;
  /** Whether a pseudoterminal wrote it, so a client knows to read VT sequences in it. */
  isPty: boolean;
}

/** The folder under a session's own where its terminals' outputs are. */
const OUTPUTS = 'terminals';

/**
 * The most an output may be, in bytes: the reference's limit on a kept one.
 * https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/common/sessionDataService.ts#L19
 */
const MOST = 10 * 1024 * 1024;

/**
 * A name as a file name: its SHA-256, in hex.
 *
 * A chat URI is long and a key is whatever the backend chose, and Windows
 * refuses `:`, `*`, `?`, `"`, `<`, `>`, `|` and a name that ends in a dot. A
 * hex hash is none of those, at one length and in one case, the way
 * `clientplugins.ts` names a file after a URI. Nothing reads a name back.
 * https://learn.microsoft.com/en-us/windows/win32/fileio/naming-a-file
 */
const hashOf = (name: string): string => createHash('sha256').update(name, 'utf8').digest('hex');

/**
 * A terminal's content as the stream it came from: the protocol's own recipe,
 * a command's output or an unclassified part's value.
 */
export const textOf = (content: OnWire<TerminalState>['content']): string =>
  content.map((part) => (part.type === 'command' ? part.output : part.value)).join('');

/** The tool call states whose content a client reads, as the reference reads them. */
const SHOWN = new Set(['running', 'pending-result-confirmation', 'completed']);

/**
 * The newest call whose content names a retained terminal, and that content.
 *
 * Compared as the chat and the key the two names carry, as the reference
 * compares two parsed URIs, so a client that spelt the key's escapes another
 * way still finds the call.
 * https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/agentService.ts#L883-L913
 */
const callNaming = (
  turns: readonly Bag[],
  named: { chat: string; key: string },
): { toolCallId: string | undefined; content: Bag } | undefined => {
  for (let at = turns.length - 1; at >= 0; at -= 1) {
    const parts = turns[at]?.responseParts;
    if (!Array.isArray(parts)) continue;
    for (let one = parts.length - 1; one >= 0; one -= 1) {
      const part = bag(parts[one]);
      if (part.kind !== 'toolCall') continue;
      const call = bag(part.toolCall);
      if (!SHOWN.has(str(call.status) ?? '') || !Array.isArray(call.content)) continue;
      const content = call.content.map(bag).find((block) => {
        if (block.type !== 'terminal' || typeof block.resource !== 'string') return false;
        const names = retainedTerminalOf(block.resource);
        return names?.chat === named.chat && names.key === named.key;
      });
      if (content !== undefined) return { toolCallId: str(call.toolCallId), content };
    }
  }
  return undefined;
};

export function createOutputs(ctx: HostContext): Outputs {
  /** A chat's folder in a session's own, or nothing where the store keeps none. */
  const folderOf = (session: string, chat: string): string | undefined => {
    const dir = ctx.kept.attachmentsDir?.(idOf(session));
    return dir === undefined ? undefined : join(dir, OUTPUTS, hashOf(chat));
  };
  const fileOf = (session: string, chat: string, key: string): string | undefined => {
    const folder = folderOf(session, chat);
    return folder === undefined ? undefined : join(folder, `${hashOf(key)}.json`);
  };

  /** Write one output. Answers whether it was kept, which it is not over 10 MB or where there is no folder. */
  const keep = (session: string, chat: string, key: string, kept: Kept): boolean => {
    const file = fileOf(session, chat, key);
    if (file === undefined || Buffer.byteLength(kept.output, 'utf8') > MOST) return false;
    try {
      // The store's own writer: 0600 under a 0700 folder, renamed into place,
      // so a process killed mid-write leaves no half of one.
      writeJsonAtomic(file, {
        version: 1,
        output: kept.output,
        ...(kept.exitCode === undefined ? {} : { exitCode: kept.exitCode }),
        isPty: kept.isPty,
      }, { dirMode: 0o700 });
      return true;
    }
    catch (error) {
      ctx.log(`could not keep the output of ${retainedTerminalUri(chat, key)}: ${reason(error)}`);
      return false;
    }
  };

  /** What a file holds, with every field checked, or nothing for a file this version did not write. */
  const read = (session: string, chat: string, key: string): Kept | undefined => {
    const file = fileOf(session, chat, key);
    if (file === undefined) return undefined;
    const outcome = readJsonObject(file);
    if (!outcome.ok) return undefined;
    const { version, output, exitCode, isPty } = outcome.value;
    if (version !== 1 || typeof output !== 'string') return undefined;
    return { output, ...(typeof exitCode === 'number' ? { exitCode } : {}), isPty: isPty === true };
  };

  const outputsFor = (session: string, chat: string): TerminalOutputs | undefined => {
    if (folderOf(session, chat) === undefined) return undefined;
    return {
      uri: (key) => retainedTerminalUri(chat, key),
      has: (key) => {
        const file = fileOf(session, chat, key);
        return file !== undefined && existsSync(file);
      },
      // Text a backend has, which no pseudoterminal wrote.
      keep: (key, output, exitCode) => keep(session, chat, key, { output, ...(exitCode === undefined ? {} : { exitCode }), isPty: false }),
    };
  };

  const keepExited = (chat: string, key: string, opener: string, state: OnWire<TerminalState>, exitCode: number | undefined): void => {
    keep(ctx.byChat.get(chat)?.uri ?? opener, chat, key, {
      output: textOf(state.content),
      ...(exitCode === undefined ? {} : { exitCode }),
      isPty: state.isPty === true,
    });
  };

  /**
   * A chat's turns and the session that holds it, read the way its snapshot is.
   *
   * A live chat's are its session's, the running turn included. Otherwise the
   * session is the record's for a recorded chat and the one a first chat's
   * name carries, and the turns are a transcript: the session's own for its
   * first chat, and a recorded chat's own for any other.
   * https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/agentService.ts#L10647-L10685
   */
  const turnsOf = async (chat: string): Promise<{ session: string; turns: Bag[] } | undefined> => {
    const live = ctx.byChat.get(chat);
    if (live !== undefined) {
      const active = bag(live.chat.chatState()).activeTurn;
      return { session: live.uri, turns: [...live.chat.allTurns() as Bag[], ...(isRecord(active) ? [active] : [])] };
    }
    const owning = ctx.homeId(chat) === undefined ? ctx.sessionOfChat(chat) : ctx.sessionFor(chat);
    if (owning === undefined || !ctx.sessionChannel(owning)) return undefined;
    const id = idOf(owning);
    if (ctx.waitingFor(id) !== undefined) return undefined;
    // A chat a client closed is gone, whatever its backend still holds of it.
    if (ctx.heldChats(id).some((one) => one.uri === chat && one.closed === true)) return undefined;
    const own = await ctx.past(id);
    if (own === undefined) return undefined;
    const session = ctx.nameOf(id);
    const opened = ctx.kept.nested?.(id) === undefined ? ctx.recordedChat(id, chat) : undefined;
    if (opened === undefined || opened.uri === chatUriFor(session)) return { session, turns: own };
    const owner = ctx.owners.get(session) ?? ctx.first;
    const turns = await owner?.transcript?.(opened.backendId, ctx.sessionAt(id), outputsFor(session, chat));
    return turns === undefined ? undefined : { session, turns: turns as unknown as Bag[] };
  };

  const retainedState = (channel: string): Promise<(OnWire<TerminalState> & { exitCode?: number }) | undefined> | undefined => {
    const named = retainedTerminalOf(channel);
    return named === undefined ? undefined : rebuilt(channel, named);
  };

  const rebuilt = async (
    channel: string,
    named: { chat: string; key: string },
  ): Promise<(OnWire<TerminalState> & { exitCode?: number }) | undefined> => {
    const held = await turnsOf(named.chat);
    if (held === undefined) return undefined;
    const found = callNaming(held.turns, named);
    if (found === undefined) return undefined;
    const kept = read(held.session, named.chat, named.key);
    const result = isRecord(found.content.result) ? found.content.result : undefined;
    // What the reference refuses: a call that says its output went on past its
    // preview with nothing kept to show the rest, and a call with neither.
    if (kept === undefined && (result === undefined || result.truncated === true)) return undefined;
    const output = kept?.output ?? str(result?.preview) ?? '';
    // The call's own code first, as the reference reads it, and the one kept
    // with the output for a call that carries none: an ACP call's content names
    // its terminal and nothing about how it ended.
    const exitCode = typeof result?.exitCode === 'number' ? result.exitCode : kept?.exitCode;
    return {
      title: str(found.content.title) ?? 'Terminal',
      // The size, the detection and the flat code every terminal state of this
      // host carries, so a rebuilt one reads as a live one that exited.
      cols: 80,
      rows: 24,
      content: output === '' ? [] : [{ type: 'unclassified', value: output }],
      claim: {
        kind: 'session',
        session: held.session,
        chat: named.chat,
        ...(found.toolCallId === undefined ? {} : { toolCallId: found.toolCallId }),
      },
      supportsCommandDetection: false,
      isPty: kept?.isPty ?? found.content.isPty === true,
      lifecycle: { status: 'exited', ...(exitCode === undefined ? {} : { exitCode }) },
      ...(exitCode === undefined ? {} : { exitCode }),
    };
  };

  const forgetTurnOutputs = (session: string, chat: string, turns: readonly Bag[]): void => {
    for (const turn of turns) {
      const parts = Array.isArray(turn.responseParts) ? turn.responseParts : [];
      for (const part of parts) {
        const content = bag(bag(part).toolCall).content;
        for (const block of Array.isArray(content) ? content.map(bag) : []) {
          const named = block.type === 'terminal' && typeof block.resource === 'string'
            ? retainedTerminalOf(block.resource)
            : undefined;
          // This chat's own only: a fork names the outputs of the chat it was
          // made from, and those are that chat's to keep.
          if (named === undefined || named.chat !== chat) continue;
          const file = fileOf(session, chat, named.key);
          if (file === undefined) continue;
          try { rmSync(file, { force: true }); }
          catch (error) { ctx.log(`could not remove ${file}: ${reason(error)}`); }
        }
      }
    }
  };

  const forgetChatOutputs = (session: string, chat: string): void => {
    const folder = folderOf(session, chat);
    if (folder === undefined) return;
    try { rmSync(folder, { recursive: true, force: true }); }
    catch (error) { ctx.log(`could not remove ${folder}: ${reason(error)}`); }
  };

  const moveChatOutputs = (from: string, to: string, chat: string): void => {
    const was = folderOf(from, chat);
    const now = folderOf(to, chat);
    if (was === undefined || now === undefined || was === now || !existsSync(was)) return;
    try {
      mkdirSync(now, { recursive: true, mode: 0o700 });
      // File by file, so a folder the chat left there before keeps what this
      // move does not replace.
      for (const name of readdirSync(was)) renameSync(join(was, name), join(now, name));
      rmSync(was, { recursive: true, force: true });
    }
    catch (error) { ctx.log(`could not move ${was} to ${now}: ${reason(error)}`); }
  };

  return { outputsFor, keepExited, retainedState, forgetTurnOutputs, forgetChatOutputs, moveChatOutputs };
}
