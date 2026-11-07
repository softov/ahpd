/**
 * The background tasks a backend reports, drawn as a chat's rows.
 *
 * One place builds every row, sends every action and answers every snapshot,
 * because the row is the protocol's and the backend's report is not: a second
 * builder is a second answer to what a client reads, and the two drift the day
 * one of them learns a field.
 */

import type { BackgroundShellWork, BackgroundSubagentWork, BackgroundWork } from '@microsoft/agent-host-protocol';
import type { Bag } from '../types/common.js';
import type { BackgroundTask, BackgroundTasks } from '../types/background.js';
import type { HostContext } from './context.js';

/**
 * The flag a client stops work through.
 *
 * The reference host's own key, under which a row is a row with something to
 * stop. A task the backend cannot answer `stop` for carries none, and a client
 * that offers the action anyway is answered `{ stopped: false }` rather than
 * shown a button that does nothing.
 */
export const STOP_FLAG = 'vscode.stopBackgroundWork';

/** One task as the host holds it: what it says, and the row last sent for it. */
interface Record {
  task: BackgroundTask;
  row: BackgroundWork;
  /** The row as JSON, so a poll that says the same thing sends nothing. */
  said: string;
}

/** Where one chat's tasks are, by id. */
type Held = Map<string, Record>;

export interface Background {
  /** The seam a backend reports through, handed on `Start`. */
  heldTasks(): BackgroundTasks;
  /** The rows a chat's snapshot carries, or `undefined` when it has none. */
  rows(chat: string): BackgroundWork[] | undefined;
  /** Stop a task, answering whether live work was stopped. */
  stop(chat: string, id: string): Promise<boolean>;
  /** Drop every record of a session's chats, sending nothing. */
  forgetSession(uri: string): void;
}

/**
 * The row for one task.
 *
 * `_meta` is laid on only when there is something to stop: the flag is what a
 * client reads to decide whether to offer the action, so a row carrying it on
 * a task nothing can stop is a button that answers `{ stopped: false }`.
 */
export function rowOf(task: BackgroundTask): BackgroundWork {
  const base = {
    id: task.id,
    label: task.label,
    startedAt: task.startedAt,
    ...(task.stop === undefined ? {} : { _meta: { [STOP_FLAG]: true } }),
  };
  if (task.kind === 'shell') {
    const shell: BackgroundShellWork = {
      ...base,
      kind: 'shell' as BackgroundShellWork['kind'],
      command: task.command ?? '',
      ...(task.terminal === undefined ? {} : { terminal: task.terminal }),
    };
    return shell;
  }
  const subagent: BackgroundSubagentWork = {
    ...base,
    kind: 'subagent' as BackgroundSubagentWork['kind'],
    chat: task.chat ?? '',
  };
  return subagent;
}

export function createBackground(ctx: HostContext): Background {
  const { dispatch, log, subagents, byChat, sendSubagent } = ctx;

  /** Every chat's tasks, by id. */
  const records = new Map<string, Held>();

  /**
   * One action on a chat.
   *
   * A worker chat is reduced before it is sent, through the spawn area's own
   * `sendSubagent`: a worker has no `Session`, so what a subscriber reads of it
   * is the state this host folded from the backend's actions - and a row sent
   * round that is a row a late subscriber never sees.
   */
  const send = (at: string, action: Bag): void => {
    if (subagents.has(at)) sendSubagent(at, action);
    else dispatch(at, action);
  };

  const heldTasks = (): BackgroundTasks => ({
    set: (at, task) => {
      const held = records.get(at) ?? new Map<string, Record>();
      const row = rowOf(task);
      const said = JSON.stringify(row);
      const before = held.get(task.id);
      records.set(at, held);
      held.set(task.id, { task, row, said });
      // The row is what a client sees, so a report that builds the same one
      // is nothing to send - which is what a poll every second would otherwise
      // be: the same row, forty times a turn.
      if (before?.said === said) return;
      send(at, { type: 'chat/backgroundWorkSet', work: row });
    },
    remove: (at, id) => {
      const held = records.get(at);
      // An id the host never had is the protocol's no-op, and the backend
      // reports removals without tracking what the host kept.
      if (held === undefined || !held.delete(id)) return;
      if (held.size === 0) records.delete(at);
      send(at, { type: 'chat/backgroundWorkRemoved', id });
    },
  });

  const rows = (chat: string): BackgroundWork[] | undefined => {
    const held = records.get(chat);
    if (held === undefined || held.size === 0) return undefined;
    return [...held.values()].map((one) => one.row);
  };

  /**
   * Stop one task, through the backend that reported it.
   *
   * The record is the whole of the decision: a chat the host holds nothing
   * for, an id it never had and a task the backend gave no `stop` are the same
   * answer, `false`, because a client is not told which of the three it was.
   *
   * A `stop` that rejects fails the request with its own failure, as the
   * reference host lets its runtime's rejection through. The row stays where
   * it is either way: removing it is the backend's report to make, through
   * `remove`, when the work has actually ended - a host that took the row down
   * here would show a task gone while it ran.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/protocolServerHandler.ts#L3444
   */
  const stop = async (chat: string, id: string): Promise<boolean> => {
    const act = records.get(chat)?.get(id)?.task.stop;
    if (act === undefined) return false;
    return await act();
  };

  const forgetSession = (uri: string): void => {
    for (const chat of [...records.keys()]) {
      const lead = byChat.get(chat);
      const worker = subagents.get(chat);
      if (lead?.uri !== uri && worker?.session !== uri) continue;
      records.delete(chat);
      log(`forgot the background work of ${chat}, whose session ${uri} is gone`);
    }
  };

  return { heldTasks, rows, stop, forgetSession };
}
