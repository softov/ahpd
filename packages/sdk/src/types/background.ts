/**
 * A background task a backend reports, and the seam it reports it through.
 *
 * The backend is the only thing that sees its harness's tasks, and the host is
 * the only thing that knows what a chat row says and how it reaches a client -
 * so the backend brings the words and the host draws the row. That is why this
 * is not the protocol's `BackgroundWork`: nothing here is a URI the host has
 * not minted, and a task is something a backend says rather than something a
 * client reads.
 */

/** What kind of work a task is. */
export type BackgroundTaskKind = 'shell' | 'subagent';

/**
 * One task, as a backend knows it.
 *
 * `id` is the backend's own, opaque to everybody else, and unique within the
 * chat across both kinds. The host turns it into the row a client upserts by,
 * so a task that reports the same id twice is the same row twice rather than
 * two rows.
 */
export interface BackgroundTask {
  /** Unique within the chat, across kinds. Opaque to clients. */
  id: string;
  /** A shell command still running, or a subagent. */
  kind: BackgroundTaskKind;
  /** What a client draws: the command's purpose, or the subagent's name. */
  label: string;
  /** ISO 8601, when the work started. */
  startedAt: string;
  /** A shell's command line. */
  command?: string;
  /** A subagent's chat. */
  chat?: string;
  /** The terminal carrying a shell's output, once the host has one. */
  terminal?: string;
  /**
   * How the host stops this task, when it can.
   *
   * Present is what a client is told as the row's flag, and the answer is
   * whether live work was actually stopped: the task may have ended on its
   * own between the row being sent and the button being pressed.
   */
  stop?: () => Promise<boolean>;
}

/**
 * The seam a backend reports through, handed on `Start`.
 *
 * `set` is an upsert: the same id twice replaces the row. `remove` names a
 * task that has ended, and an id the host never had is a no-op - the protocol's
 * own convention, which is what lets a backend report removals without
 * tracking what the host kept.
 */
export interface BackgroundTasks {
  /** Report a task, or report a running one again. */
  set(chat: string, task: BackgroundTask): void;
  /** Report that a task has ended. */
  remove(chat: string, id: string): void;
}

/**
 * One chat's half of the seam, for a host tool that draws its own row.
 *
 * A tool runs where it runs: it sets a row on the chat of its call and takes
 * it back there, and it never names another chat. The host binds the chat, so
 * the same report a backend makes through `BackgroundTasks` reaches a tool
 * without letting it draw a row somewhere it does not run.
 */
export interface ChatBackgroundTasks {
  /** Report a task on the calling chat, or report a running one again. */
  set(task: BackgroundTask): void;
  /** Report that a task on the calling chat has ended. */
  remove(id: string): void;
}
