import { callTimes, withCallTimes } from '@ahpd/sdk';
import type { Bag, Chosen, MessageAttachment, MessageFrom, Ran, Session } from '@ahpd/sdk';
import { bag, UNTITLED } from './common.js';
import type { SessionContext } from './context.js';

/** What runs next: the host's own `!command` turn, and the queue behind it. */
export interface Queue {
  begin(turnId: string, text: string, model?: Chosen, from?: MessageFrom, attachments?: MessageAttachment[]): void;
  startNext(): void;
  ran: NonNullable<Session['ran']>;
  queue: Session['queue'];
  unqueue: Session['unqueue'];
  reorder: Session['reorder'];
}

export function createQueue(ctx: SessionContext): Queue {
  const { emit, turns, queued, doing, touch } = ctx;

  /**
   * One shell command, run by the host rather than asked of the server.
   *
   * `!ls` is a person's command, not a prompt: the host spawns the shell and
   * hands back what it printed, so nothing here reaches the ACP server. The
   * turn is still this chat's and still a turn - it opens, carries one tool
   * call and completes - which is what puts the command and its output in the
   * transcript beside the conversation it interrupted.
   *
   * The ACP connection is not touched: a server that is mid-prompt is not
   * asked to stop, and one that is idle stays idle. Any `session/update` that
   * arrives meanwhile is dropped, because `mapping` is deliberately cleared
   * while a command runs - there is no model turn for it to belong to.
   */
  const runCommand = (
    turnId: string,
    command: string,
    run: (toolCallId: string) => Promise<Ran>,
    queuedMessageId?: string,
  ): void => {
    if (ctx.closed || ctx.active !== undefined) return;
    ctx.cancelRequested = false;
    ctx.failed = undefined;
    if (ctx.title === UNTITLED && command !== '') {
      ctx.title = command.slice(0, 60);
      if (ctx.record !== undefined) ctx.record.title = ctx.title;
      emit('session', { type: 'session/titleChanged', title: ctx.title });
    }
    const began = Date.now();
    const toolCallId = `${turnId}:command`;
    /*
     * `terminal` as the name, which is what a client draws a shell by.
     *
     * The call is held as the turn's one part, so a client that subscribes
     * after the command finished reads the row from the snapshot rather than
     * the actions it missed.
     */
    const call: Bag = {
      toolCallId,
      toolName: 'terminal',
      displayName: 'Terminal',
      intention: command,
      invocationMessage: command,
      toolInput: command,
      confirmed: 'not-needed',
      status: 'running',
      _meta: callTimes(began),
    };
    const part: Bag = { id: toolCallId, kind: 'toolCall', toolCall: call };
    ctx.active = {
      id: turnId,
      startedAt: new Date(began).toISOString(),
      message: { text: `!${command}`, origin: { kind: 'user' } },
      responseParts: [part],
    };
    // No ACP turn is running, so a stray `session/update` has nothing to be
    // mapped into and is dropped rather than written into this shell's turn.
    ctx.mapping = undefined;
    emit('chat', {
      type: 'chat/turnStarted', turnId, startedAt: ctx.active.startedAt, message: ctx.active.message,
      ...(queuedMessageId !== undefined ? { queuedMessageId } : {}),
    });
    emit('chat', {
      type: 'chat/toolCallStart', turnId, toolCallId, toolName: 'terminal', displayName: 'Terminal', intention: command,
    });
    emit('chat', {
      type: 'chat/toolCallReady', turnId, toolCallId, invocationMessage: command, confirmed: 'not-needed', toolInput: command,
      _meta: callTimes(began),
    });
    doing('Running');
    touch();
    void run(toolCallId).then((done) => {
      if (ctx.active === undefined || String(ctx.active.id) !== turnId) return;
      /*
       * The terminal first, so a client can watch the output arrive, then the
       * text it printed. `content` replaces rather than appends, so the two go
       * out together in the one action that closes the row.
       */
      const content: Bag[] = [
        ...(done.terminal === undefined ? [] : [{
          type: 'terminal',
          resource: done.terminal,
          title: 'Terminal',
          // Pipes, not a pseudoterminal: a client reads this to decide whether
          // the preview needs VT parsing.
          isPty: false,
          result: {
            ...(done.code !== undefined ? { exitCode: done.code } : {}),
            ...(done.output === '' ? {} : { preview: done.output }),
          },
        }]),
        ...(done.output === '' ? [] : [{ type: 'text', text: done.output }]),
      ];
      const result: Bag = {
        success: done.success,
        pastTenseMessage: done.said,
        content,
        ...(done.success ? {} : { error: { message: done.said } }),
      };
      // Into the part as well, so the snapshot a late subscriber reads holds
      // the finished call rather than the `running` one it was opened with.
      Object.assign(call, result, {
        status: 'completed',
        confirmed: 'not-needed',
        _meta: withCallTimes(bag(call._meta), callTimes(began, Date.now())),
      });
      emit('chat', { type: 'chat/toolCallComplete', turnId, toolCallId, result, _meta: bag(call._meta) });
      const turn = ctx.active;
      const duration = Date.now() - began;
      turn.state = done.success ? 'complete' : 'error';
      turn.duration = duration;
      turns.push(turn);
      ctx.active = undefined;
      if (!done.success) ctx.failed = done.said;
      /*
       * The turn closes like any other.
       *
       * A shell command is a turn of this chat, so a client that watched it
       * needs the same completion a model's answer gets; without it the row
       * stays open on screen while the session already counts it as done.
       */
      emit('chat', { type: 'chat/turnComplete', turnId, duration });
      doing(undefined);
      touch();
      startNext();
    });
  };

  /** Begin a turn, once the session is free. */
  const begin = (
    turnId: string,
    text: string,
    model: Chosen | undefined,
    from: MessageFrom | undefined,
    attachments: MessageAttachment[] | undefined,
    queuedMessageId?: string,
  ): void => {
    if (ctx.closed || ctx.active !== undefined) return;
    ctx.cancelRequested = false;
    ctx.failed = undefined;
    if (ctx.title === UNTITLED && text !== '') {
      ctx.title = text.slice(0, 60);
      if (ctx.record !== undefined) ctx.record.title = ctx.title;
      // Said, because a client that opened the session holds the old one.
      emit('session', { type: 'session/titleChanged', title: ctx.title });
    }
    ctx.openTurn(turnId, text, from, queuedMessageId);
    void ctx.run(turnId, text, model, attachments);
  };

  /**
   * The head of the queue, once there is nothing running.
   *
   * A queued `!command` is *run* rather than sent: `ran` queued the command
   * itself when a turn was already running, and handing its text to the server
   * as a prompt is the one thing the `!` prefix exists not to do.
   */
  const startNext = (): void => {
    if (ctx.active !== undefined || ctx.closed) return;
    const next = queued.shift();
    if (next === undefined) return;
    const held = bag(next.command);
    const typed = typeof held.text === 'string' ? held.text : undefined;
    if (typed !== undefined && typeof held.run === 'function') {
      runCommand(crypto.randomUUID(), typed, held.run as (toolCallId: string) => Promise<Ran>, String(next.id));
      return;
    }
    const message = bag(next.message);
    begin(
      crypto.randomUUID(),
      String(message.text ?? ''),
      next.model as Chosen | undefined,
      next.from as MessageFrom | undefined,
      // A queued message carries no attachments: `Session.queue` takes none.
      undefined,
      String(next.id),
    );
  };

  /**
   * A person's `!command`, run by the host in one of its own shells.
   *
   * An ACP server has no shell turn of its own, so this turn belongs to the
   * bridge: the host spawns the shell and this session opens the turn around
   * it. The command waits its turn when one is already running, because a
   * shell that jumped the queue would run against a tree the turn in front
   * of it is still editing - and what waits is the command, not its text, so
   * `startNext` runs it rather than asking the server about `!ping`.
   */
  const ran: NonNullable<Session['ran']> = (turnId, command, run, queuedAs) => {
    if (ctx.active !== undefined || (queuedAs !== undefined && queued.length > 0)) {
      const id = queuedAs ?? turnId;
      const message: Bag = { text: `!${command}`, origin: { kind: 'user' } };
      const entry: Bag = { id, command: { text: command, run }, message };
      const at = queued.findIndex((held) => held.id === id);
      if (at >= 0) queued[at] = entry;
      else queued.push(entry);
      emit('chat', { type: 'chat/pendingMessageSet', kind: 'queued', id, message });
      touch();
      return;
    }
    runCommand(turnId, command, run, queuedAs);
  };

  const queue: Session['queue'] = (id, text, model, from) => {
    const entry: Bag = {
      id,
      message: { text },
      ...(model !== undefined ? { model } : {}),
      ...(from !== undefined ? { from } : {}),
    };
    const at = queued.findIndex((held) => held.id === id);
    if (at >= 0) queued[at] = entry;
    else queued.push(entry);
    emit('chat', { type: 'chat/pendingMessageSet', kind: 'queued', id, message: entry.message });
    touch();
    startNext();
  };

  const unqueue: Session['unqueue'] = (id) => {
    const at = queued.findIndex((held) => held.id === id);
    if (at < 0) return;
    queued.splice(at, 1);
    emit('chat', { type: 'chat/pendingMessageRemoved', kind: 'queued', id });
    touch();
  };

  const reorder: Session['reorder'] = (order) => {
    const byId = new Map(queued.map((held) => [String(held.id), held]));
    const seen = new Set<string>();
    const moved: Bag[] = [];
    for (const id of order) {
      const held = byId.get(id);
      if (held === undefined || seen.has(id)) continue;
      seen.add(id);
      moved.push(held);
    }
    // Anything the order did not name keeps its place behind what it did.
    for (const held of queued) if (!seen.has(String(held.id))) moved.push(held);
    queued.length = 0;
    queued.push(...moved);
    emit('chat', { type: 'chat/queuedMessagesReordered', order: moved.map((held) => String(held.id)) });
    touch();
  };

  return { begin, startNext, ran, queue, unqueue, reorder };
}