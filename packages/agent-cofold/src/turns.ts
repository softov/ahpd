import { run } from '@cofold/agents';
import type { Agent as CofoldAgent, ContentPart, ImagePart, TextPart } from '@cofold/agents';
import { bag, partsOf, reason, str, titleFrom } from '@ahpd/sdk';
import type { Bag, Chosen, MessageAttachment, MessageFrom, TurnOptions } from '@ahpd/sdk';
import { modelReferenceOf } from './agent.js';
import { mapTurn } from './mapping.js';
import type { TurnMapping } from './mapping.js';
import { ruleName } from './tools.js';
import { AGENT_ID } from './turnagent.js';
import type { SessionContext } from './context.js';

/** The attachments a message a client sent carries, where it carries any. */
const attachmentsOf = (message: unknown): MessageAttachment[] | undefined => {
  const kept = bag(message).attachments;
  return Array.isArray(kept) ? kept as MessageAttachment[] : undefined;
};

/**
 * A message's text and attachments, as the content parts cofold takes.
 *
 * `partsOf` decides what each attachment is - an image, an inlined text, or a
 * line in the one reference block at the end - within the limits every backend
 * shares, and `images` is the model in force, so a picture is sent as bytes
 * only to a model that takes one.
 *
 * What is added here is cofold's own two shapes. The `source` the helper keeps
 * for a backend whose block names what it carries is dropped: cofold sends the
 * part itself, and a second copy of a pasted file's text in the transcript is
 * a copy nothing reads.
 */
export const partsFor = async (
  text: string,
  attachments: MessageAttachment[],
  images: boolean,
): Promise<(TextPart | ImagePart)[]> => {
  const parts = await partsOf(text, attachments, { images });
  return parts.map((one) => (one.type === 'image'
    ? { type: 'image', mimeType: one.mimeType, data: one.data }
    : { type: 'text', text: one.text }));
};

/** What opening a turn and running the turns handed offer the other areas. */
export interface Turns {
  beginTurn: (
    turnId: string,
    text: string,
    model?: Chosen,
    from?: MessageFrom,
    attachments?: MessageAttachment[],
    options?: TurnOptions,
  ) => void;
  /** Run the first turn handed while another ran, once nothing runs. */
  sendNext: () => void;
  /**
   * Run the turn that failed again, without its message being said twice.
   *
   * Answers whether there was such a turn to resume: the newest one, in
   * `error`, whose last part is an error that says `resumable`.
   */
  resumeTurn: (turnId: string) => boolean;
  /**
   * Whether the model the running turn was built on takes an image.
   *
   * Read by `steer`, which has no agent of its own: a correction reaches the
   * model the turn is already running on, and a picture sent to one that
   * refuses images is a turn that fails rather than a correction.
   */
  takesImages: () => boolean;
}

export const createTurns = (ctx: SessionContext): Turns => {
  const { start, options, harness, sessionId, where, store, settings, turns } = ctx;

  /**
   * Whether the model the turn now running was built on takes an image.
   *
   * Set where the agent is built, because that is the one place the adapter in
   * force is known, and read by `steer` for a message sent into that same run.
   */
  let takesImages = false;

  /**
   * The values a turn runs on, and the model reference they resolve to.
   *
   * A model named on the turn wins over the session's, and is what the usage
   * report names. The reference is the one `connectionOf` resolves: the values
   * in force, then the plugin option, then the harness file.
   */
  const valuesFor = (model?: Chosen): { values: Record<string, unknown>; reference: string | undefined } => {
    const values: Record<string, unknown> = model === undefined ? settings : { ...settings, model: model.id };
    return { values, reference: modelReferenceOf(options, values, harness) };
  };

  /**
   * The mapping a turn's run is read through, on the parts the turn holds.
   *
   * One mapping serves a turn that opens empty and a turn reopened with the
   * parts its failed run wrote: the mapping numbers new parts after the ones
   * already there, so a resumed run writes its own text rather than appending
   * to the failed one. `began` is when the run started, for the duration the
   * ending action carries.
   */
  const mappingOn = (
    turnId: string,
    parts: Bag[],
    began: number,
    reference: string | undefined,
  ): TurnMapping => mapTurn({
    turnId,
    chatUri: start.chatUri,
    parts,
    startedAt: began,
    // The title the host offered the tool under, else the name its row draws:
    // a client's tool by the name the client announced.
    displayNameOf: (name) => {
      const tool = ctx.offered.find((one) => one.definition.name === name);
      const owner = tool?.owner;
      return tool?.definition.title ?? (owner !== undefined && name.startsWith(`${owner}__`) ? name.slice(owner.length + 2) : name);
    },
    ownerOf: (name) => ctx.offered.find((one) => one.definition.name === name)?.owner,
    cancelled: () => ctx.cancelRequested,
    // The operator's rule, read when a call is put to a person: a matched
    // tool's question offers no session choice cofold would remember.
    asksEveryTime: (name) => start.getAutoApproval?.('tool', ruleName(ctx.offered, name)) === 'ask',
    // A failed turn can be put back when there is a point to cut to: the last
    // message of the turn before, or, for a conversation's first turn, no
    // session at all. A turn read back after a restart has no point, so it is
    // not one this process can resume.
    canCut: () => {
      const before = turns.at(-1);
      return before === undefined || ctx.points.has(String(before.id));
    },
    ...(reference !== undefined ? { model: reference } : {}),
  });

  /**
   * Title a session nobody has named from the first thing said in it, which
   * replaces a title a local command suggested, as VS Code's title controller
   * seeds one. A message of nothing but blanks names nothing.
   *
   * Said, because a client that opened the session holds the old one.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostSessionTitleController.ts#L189-L229
   */
  const retitle = (text: string): void => {
    if (ctx.title !== 'Cofold session' && !ctx.provisional) return;
    const said = titleFrom(text, '');
    if (said === '') return;
    ctx.provisional = false;
    if (said === ctx.title) return;
    ctx.title = said;
    start.emit('session', { type: 'session/titleChanged', title: said });
  };

  /**
   * Open a turn in this session's record, before anything runs it.
   *
   * The host said the turn's start, so nothing is said here; cofold's own
   * `run.started` means nothing on the wire and is dropped in `mapping.ts`.
   *
   * Answers nothing for a session that is closed or already running a turn.
   * Both a turn with a run behind it and one that has to be failed before it
   * starts share this opening, so a client sees the same turn either way.
   */
  const openTurn = (
    turnId: string,
    text: string,
    model?: Chosen,
    from?: MessageFrom,
    attachments?: MessageAttachment[],
  ): { mapping: TurnMapping; values: Record<string, unknown>; reference: string | undefined } | undefined => {
    if (ctx.closed || ctx.active !== undefined) return undefined;
    ctx.cancelRequested = false;
    ctx.failed = undefined;
    const { values, reference } = valuesFor(model);
    const began = Date.now();
    // No part yet: each is opened when the model starts writing the block it holds.
    ctx.active = {
      id: turnId,
      startedAt: new Date(began).toISOString(),
      message: {
        text,
        ...(from?.origin !== undefined ? { origin: from.origin } : {}),
        ...(from?._meta !== undefined ? { _meta: from._meta } : {}),
        // The message's own, so a client reopening the chat reads the picture
        // beside the words the turn was accepted with - and so a message the
        // queue handed over keeps what was pasted into it.
        ...(attachments !== undefined && attachments.length > 0 ? { attachments } : {}),
        // The protocol's `Message.model`: the model this turn runs on, so a
        // client that reconnects shows it. The client's own `config` travels
        // with it, as a claude turn's does.
        ...(reference !== undefined
          ? { model: { id: reference, ...(model?.config === undefined ? {} : { config: model.config }) } }
          : {}),
      },
      responseParts: [],
    };
    /*
     * The first message titles a session nobody has named.
     *
     * Said after the turn has started, as the other harnesses say it: VS Code
     * draws the message a second time when the title comes first. A message of
     * nothing but blanks answers the fallback, which is the title already held,
     * so nothing moves and nothing is said about it.
     */
    retitle(text);
    ctx.doing('Thinking');

    const mapping = mappingOn(turnId, ctx.active.responseParts as Bag[], began, reference);
    ctx.activeMapping = mapping;
    return { mapping, values, reference };
  };

  /**
   * Run a turn's prompt, once the model it runs on is built.
   *
   * `input` is the words the turn was said with, or a reader for them: a
   * message with attachments is read after the agent exists, because `partsOf`
   * needs to know whether the model takes an image before it sends one. The
   * turn is already open on the wire for that moment, so a stop or a close
   * landing inside it is answered here rather than left to a run that never
   * started.
   *
   * A turn that cannot start fails that turn, not the process. Building the
   * agent resolves the model, and a session with none chosen, no default and a
   * harness file that names none has nothing to run on. Thrown from here it
   * would escape every handler and take the daemon and every other session
   * with it; answered, it is one failed turn with the reason on it.
   */
  const runTurn = (
    turnId: string,
    input: string | ((agent: CofoldAgent) => Promise<(TextPart | ImagePart)[]>),
    values: Record<string, unknown>,
    reference: string | undefined,
    mapping: TurnMapping,
    instructions: readonly string[] = [],
  ): void => {
    let agent: CofoldAgent;
    try {
      agent = ctx.agentOf(values, instructions);
    }
    catch (error) {
      void ctx.apply(mapping, turnId, refusal(turnId, 'start_failed', error));
      return;
    }
    // Before the run, so a correction sent the moment the turn appears is read
    // on the model this turn is about to run on.
    takesImages = agent.model.features.images;

    const launch = (prompt: string | ContentPart[]): void => {
      let live: ReturnType<typeof run>;
      try {
        live = run({
          agent,
          session: sessionId,
          workspace: where,
          input: prompt,
          /*
           * The prompt stored under the turn's own id, so the turn read back
           * from cofold's store is the turn a client knows: a turn that
           * follows is anchored by it, and a restart finds it there.
           * `RunArgs.messageId` in npm://@cofold/agents@0.4.0: "A client that
           * supplies it can match run.started to its send."
           */
          messageId: turnId,
          // Kept on the run record, which is where a rebuilt turn reads its model.
          ...(reference !== undefined ? { model: reference } : {}),
        });
      }
      catch (error) {
        void ctx.apply(mapping, turnId, refusal(turnId, 'start_failed', error));
        return;
      }
      ctx.handle = live;
      ctx.read(live, mapping, turnId);
      ctx.touch();
    };

    if (typeof input === 'string') {
      launch(input);
      return;
    }
    /*
     * `images` is what the model this turn resolves takes, never assumed: an
     * image part to a model without the feature throws, and the message is
     * stored, so every later turn of the session would fail on it too.
     */
    void (async (): Promise<void> => {
      try {
        const parts = await input(agent);
        // A turn somebody else settled while the files were being read is not
        // this call's to start, and not this call's to fail either.
        if (ctx.active === undefined || String(ctx.active.id) !== turnId) return;
        if (ctx.cancelRequested || ctx.closed) {
          await ctx.apply(mapping, turnId, stopped(turnId));
          return;
        }
        launch(parts);
      }
      catch (error) {
        await ctx.apply(mapping, turnId, refusal(turnId, 'start_failed', error));
      }
    })();
  };

  /**
   * Open a turn and run it: the whole of what a client's new message means.
   *
   * What the host has to say on this turn is asked now that the turn exists,
   * and goes into the system prompt of its run, as every reference agent puts
   * the instructions its host contributes for a send into that turn's prompt.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L2281-L2288
   */
  const startTurn = (
    turnId: string,
    text: string,
    model?: Chosen,
    from?: MessageFrom,
    attachments?: MessageAttachment[],
    options?: TurnOptions,
  ): void => {
    const opened = openTurn(turnId, text, model, from, attachments);
    if (opened === undefined) return;
    const instructions = options?.instructions?.() ?? [];
    if (attachments === undefined || attachments.length === 0) {
      runTurn(turnId, text, opened.values, opened.reference, opened.mapping, instructions);
      return;
    }
    runTurn(
      turnId,
      (agent) => partsFor(text, attachments, agent.model.features.images),
      opened.values,
      opened.reference,
      opened.mapping,
      instructions,
    );
  };

  /** The `run.finished` a turn that never ran ends with. */
  const refusal = (turnId: string, code: string, why: unknown) => ({
    seq: 0,
    runId: `${turnId}:refused`,
    sessionId,
    agentId: AGENT_ID,
    at: new Date().toISOString(),
    type: 'run.finished' as const,
    outcome: {
      status: 'failed' as const,
      error: { code, message: reason(why) },
      usage: { inputTokens: 0, outputTokens: 0 },
      steps: 0,
      denials: [],
    },
  });

  /**
   * The `run.finished` a turn that was stopped before it ran ends with.
   *
   * A cancel reaches a run through its handle, and a turn whose message is
   * still being read has no handle yet, so the stop finds nothing to stop. The
   * turn is already open on the wire, though, and one that never settles is a
   * spinner nothing can clear - so the ending it would have had is handed to
   * the mapping, the way a turn that cannot start is.
   */
  const stopped = (turnId: string) => ({
    seq: 0,
    runId: `${turnId}:stopped`,
    sessionId,
    agentId: AGENT_ID,
    at: new Date().toISOString(),
    type: 'run.finished' as const,
    outcome: {
      status: 'cancelled' as const,
      reason: 'the turn was stopped before it ran',
      usage: { inputTokens: 0, outputTokens: 0 },
      steps: 0,
      denials: [],
    },
  });

  /**
   * A turn that cannot run, answered with the reason.
   *
   * The client has already dispatched its own `chat/turnStarted`, so the turn
   * exists whether or not a run does, and leaving it open would be a spinner
   * nothing can settle. The failure goes through the mapping like every other
   * ending, so a client draws the same `chat/error` a failed run produces.
   *
   * This is the path a session whose fork or rewind could not be cut takes: the
   * honest answer to "carry on from there" is that there is no there.
   */
  const failTurn = (
    turnId: string,
    text: string,
    model: Chosen | undefined,
    from: MessageFrom | undefined,
    attachments: MessageAttachment[] | undefined,
    why: unknown,
  ): void => {
    const opened = openTurn(turnId, text, model, from, attachments);
    if (opened === undefined) return;
    void ctx.apply(opened.mapping, turnId, refusal(turnId, 'cut_refused', why));
  };

  /**
   * Run the turn that failed again, without its message being said twice.
   *
   * The protocol's `chat/turnResume`: the newest turn, in `error`, whose last
   * part says `resumable`, is reopened with its message and parts intact and
   * the same prompt runs again under the same message id - so the store holds
   * the prompt once rather than once per attempt. cofold's own `resume()`
   * continues only a run that is waiting or running, so the run is put back
   * the way a rewind is: the store is cut through the last message of the turn
   * before, which drops the failed prompt and what the run wrote after it.
   *
   * A conversation's first turn has no turn before to cut to, so its session
   * is dropped instead and `run()` makes it again, with the same workspace.
   * Either way the calls the failed turn ran are run again, because the cut
   * drops them with the prompt. The host said the client's resume.
   */
  const resumeTurn = (turnId: string): boolean => {
    if (ctx.closed || ctx.active !== undefined || ctx.waiting.length > 0 || ctx.opening !== undefined) return false;
    const last = turns.at(-1);
    if (last === undefined || String(last.id) !== turnId || last.state !== 'error') return false;
    const kept = Array.isArray(last.responseParts) ? last.responseParts as Bag[] : [];
    const end = kept.at(-1);
    if (end === undefined || end.kind !== 'error' || end.resumable !== true) return false;
    /*
     * The turn leaves the history before the cut is read, because the point a
     * resume cuts at is the end of the turn *before* this one.
     */
    turns.pop();
    const before = turns.at(-1);
    const point = before === undefined ? undefined : ctx.points.get(String(before.id));
    /*
     * A turn read back after a restart has no entry in `points`, and a
     * conversation this process did not watch run cannot be cut back to. The
     * turn goes back into the history rather than running on a conversation it
     * cannot be taken out of. Past this point a point is absent only when
     * there is no turn before, which is a conversation starting over.
     */
    if (before !== undefined && point === undefined) {
      turns.push(last);
      return false;
    }
    // The record again, so a key fixed since the failure is the one this turn
    // runs on.
    const broken = ctx.refreshOptions();
    const again: Bag = { ...last };
    // `state` and `duration` are what made it a finished turn; the protocol
    // reopens *this* turn rather than replacing it with a new one.
    delete again.state;
    delete again.duration;
    ctx.active = again;
    ctx.cancelRequested = false;
    ctx.failed = undefined;
    const message = bag(again.message);
    const named = bag(message.model);
    const id = str(named.id);
    const chosen: Chosen | undefined = id === undefined
      ? undefined
      : { id, ...(named.config === undefined ? {} : { config: named.config as NonNullable<Chosen['config']> }) };
    const { values, reference } = valuesFor(chosen);
    const began = Date.now();
    const mapping = mappingOn(turnId, kept, began, reference);
    ctx.activeMapping = mapping;
    ctx.doing('Thinking');
    ctx.touch();
    /*
     * A record that can no longer be used cannot run the turn either, and the
     * turn is open again by now: the sentence ends it rather than leaving a
     * spinner nothing can settle.
     */
    if (broken !== undefined) {
      void ctx.apply(mapping, turnId, refusal(turnId, 'resume_failed', new Error(broken)));
      return true;
    }
    void (async (): Promise<void> => {
      try {
        // No point is no turn before: the session is the thing to drop, and
        // `run()` makes it again with the same workspace.
        if (point === undefined) await store.sessions.delete({ sessionId });
        else await store.sessions.truncate({ sessionId, throughMessageId: point });
      }
      catch (error) {
        // The store would not make the cut, so there is nothing to run on. The
        // turn ends with the reason, the way a cut refused before it started.
        await ctx.apply(mapping, turnId, refusal(turnId, 'resume_failed', error));
        return;
      }
      const text = str(message.text) ?? '';
      const attachments = attachmentsOf(message);
      if (attachments === undefined || attachments.length === 0) {
        runTurn(turnId, text, values, reference, mapping);
        return;
      }
      runTurn(
        turnId,
        (agent) => partsFor(text, attachments, agent.model.features.images),
        values,
        reference,
        mapping,
      );
    })();
    return true;
  };

  /**
   * A turn handed, run once the run in front of it is over, as the reference
   * agent runs each send after the one before it. The turn it takes the place
   * of in every client's state runs on here and ends in no history.
   */
  const beginTurn = (
    turnId: string,
    text: string,
    model?: Chosen,
    from?: MessageFrom,
    attachments?: MessageAttachment[],
    options?: TurnOptions,
  ): void => {
    const shown = ctx.waiting.at(-1)?.turnId ?? (ctx.cancelRequested ? undefined : str(ctx.active?.id));
    if (shown !== undefined) ctx.replaced.add(shown);
    ctx.waiting.push({ turnId, text, model, from, attachments, options });
    sendNext();
  };

  /**
   * The first turn handed, once the resume lookup has settled and nothing runs.
   *
   * A resumed session may already have an open turn waiting on a person, so a
   * second run would fight the paused one for the session's writer claim and
   * fail `writer_busy`. Waiting for the lookup is what tells the two apart,
   * and it costs an ordinary session nothing: `opening` is only set when the
   * host named a conversation to continue and when a fork or a rewind is being
   * cut.
   *
   * A chain that ended in a refusal - a cut the store would not make - leaves
   * every turn on the failure path rather than on the ordinary one: the client
   * asked to carry on from a point, and carrying on from somewhere else
   * without saying so is the one answer that is worse than an error.
   */
  const sendNext = (): void => {
    if (ctx.refused === undefined && ctx.opening !== undefined) {
      void ctx.opening.then(sendNext, sendNext);
      return;
    }
    if (ctx.closed || ctx.active !== undefined) return;
    const next = ctx.waiting.shift();
    if (next === undefined) return;
    const { turnId, text, model, from, attachments, options } = next;
    if (ctx.refused !== undefined) {
      failTurn(turnId, text, model, from, attachments, ctx.refused);
      return;
    }
    /*
     * The record first, so this turn runs on what it says now.
     *
     * A record that can no longer be used ends this turn with the sentence:
     * a turn runs on the record as it is when the turn begins.
     */
    const why = ctx.refreshOptions();
    if (why !== undefined) {
      failTurn(turnId, text, model, from, attachments, new Error(why));
      return;
    }
    startTurn(turnId, text, model, from, attachments, options);
  };

  return {
    beginTurn,
    resumeTurn,
    sendNext,
    takesImages: () => takesImages,
  };
};