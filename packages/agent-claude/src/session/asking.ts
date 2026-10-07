import type { StringOrMarkdown } from '@microsoft/agent-host-protocol';
import type { Bag } from '@ahpd/sdk';
import { bag, list, str } from './common.js';
import type { SessionContext } from './context.js';
import { lineOf, pastLineOf, questionRequest, toolInputOf } from '../input.js';
import { toolMetaOf } from '../kinds.js';
interface PendingInput {
  id: string;
  entry: Bag;
  /** `AskUserQuestion` needs its own payload echoed back verbatim. */
  questions?: unknown[];
  /** Question id to the question text the SDK keys answers by. */
  asked: Map<string, string>;
  /**
   * What somebody has typed so far, by question id.
   *
   * The protocol calls this the request's synced answer state: a client
   * dispatches `chat/inputAnswerChanged` per question as it is filled in, and
   * `chat/inputCompleted` may arrive with no answers at all because these are
   * the answers. Held here rather than in a client so the other people in the
   * session see the form being filled in.
   */
  answers: Map<string, Bag>;
  /** The choices a tool confirmation offered, when the SDK suggested a rule to keep. */
  options?: Bag[];
  /** The SDK's `suggestions` for this call, returned as `updatedPermissions` when "always" is picked. */
  suggestions?: unknown[];
  settle(result: { behavior: 'allow'; updatedInput: Bag; updatedPermissions?: unknown[] } | { behavior: 'deny'; message: string }): void;
}

/**
 * What a person refusing a call says, to the model and to anything waiting.
 *
 * One sentence in one place, because the refusal reaches the model as the tool
 * result of a declined call and as the answer to a handler that was waiting for
 * a call nobody will run - and the two are the same refusal.
 */
const DECLINED = 'The person declined this action';

/** Where a kept permission lands, as a person reads it. */
const KEPT_IN: Record<string, string> = {
  session: ' for the rest of the session',
  localSettings: ', kept in local settings',
  projectSettings: ', kept in project settings',
  userSettings: ', kept in user settings',
};

/**
 * What a set of the SDK's permission suggestions does, in one line.
 *
 * The label of the "always" choice, so it says what is kept and where: the
 * rules added, the mode set or the directories added, each followed by where
 * it is kept, joined when there are several. Rules with the same behavior kept
 * in the same place are one phrase, and a rule or phrase said twice is said
 * once: the SDK suggests a rule per command of a compound one, so `a && a`
 * comes as two suggestions of the same rule.
 */
export function keptLabel(suggestions: unknown[]): string {
  /** The rules of each behavior and place, in the order first suggested. */
  const rules = new Map<string, { behavior: string; where: string; said: string[] }>();
  const said: (string | { rules: string })[] = [];
  for (const one of suggestions) {
    const update = bag(one);
    const where = KEPT_IN[str(update.destination) ?? ''] ?? '';
    if (update.type === 'addRules' || update.type === 'replaceRules') {
      const behavior = str(update.behavior) ?? 'allow';
      const key = `${behavior}\u0000${where}`;
      let group = rules.get(key);
      if (group === undefined) {
        group = { behavior, where, said: [] };
        rules.set(key, group);
        said.push({ rules: key });
      }
      for (const entry of list(update.rules)) {
        const rule = bag(entry);
        const content = str(rule.ruleContent);
        const text = content === undefined ? str(rule.toolName) ?? '' : `${str(rule.toolName) ?? ''}(${content})`;
        if (!group.said.includes(text)) group.said.push(text);
      }
    } else if (update.type === 'setMode') {
      const mode = str(update.mode) ?? '';
      said.push(`${mode === 'acceptEdits' ? 'Allow edits' : `Switch to ${mode} mode`}${where}`);
    } else if (update.type === 'addDirectories') {
      said.push(`Allow access to ${list(update.directories).map((entry) => String(entry)).join(', ')}${where}`);
    } else {
      said.push(`Always allow${where}`);
    }
  }
  const phrases = said.map((one) => {
    if (typeof one === 'string') return one;
    const group = rules.get(one.rules)!;
    return `Always ${group.behavior} ${group.said.join(', ')}${group.where}`;
  });
  return [...new Set(phrases)].join('; ');
}

/** What this area offers the rest of the session, and its `Session` methods. */
export interface Asking {
  /** Everything the agent is waiting on, by request id. */
  pending: Map<string, PendingInput>;
  /** The input an answered question ran with, by its call id. */
  answeredInputs: Map<string, Bag>;
  /** The SDK’s own gate between a tool call and the host that runs it. */
  canUseTool: (toolName: string, raw: Bag, asked?: Bag) => Promise<unknown>;
  methods: {
    confirm: (toolCallId: string, approved: boolean, optionId?: string) => void;
    setAnswer: (requestId: string, questionId: string, answer: Bag | undefined) => boolean;
    answer: (requestId: string, accepted: boolean, answers?: Bag) => void;
  };
}

export function createAsking(ctx: SessionContext): Asking {  /**
   * Everything the agent is waiting on, by request id.
   *
   * A map because a turn can ask twice at once. The CLI calls `canUseTool`
   * per tool call and an agent that fires two in parallel produces two live
   * questions - this used to be a single slot, so the second overwrote the
   * first, the first's `settle` became unreachable and that tool waited for
   * an answer no one could give any more. Approving the surviving one then
   * did nothing, because the id no longer matched.
   *
   * The protocol has always modelled it this way: `inputNeeded` is a list and
   * `session/inputNeededSet` says it adds or updates *matched by id*.
   */
  const pending = new Map<string, PendingInput>();

  // ------------------------------------------------------ asking a person

  /**
   * Which tools a person has already answered for, for this session.
   *
   * Deny wins over allow, because the two lists are answers to different
   * questions: allow says "stop asking me", deny says "never do this", and a
   * tool in both is one somebody has forbidden and also once approved.
   */
  const settled = (toolName: string): 'allow' | 'deny' | undefined => {
    if (ctx.allowed.deny.includes(toolName)) return 'deny';
    if (ctx.allowed.allow.includes(toolName)) return 'allow';
    return undefined;
  };

  const canUseTool = async (toolName: string, raw: Bag, asked?: Bag): Promise<unknown> => {
    /*
     * Answered from the lists, before anybody is asked.
     *
     * The SDK was handed the same lists when the query was built, so in the
     * ordinary case it never calls this at all. This is what makes a list set
     * *during* a session take effect: the query cannot be told, and this can.
     * Nothing is announced either way - a tool nobody was asked about is not
     * a question that was answered, and drawing one would put a row on screen
     * for a decision made before the turn began.
     */
    const already = settled(toolName);
    if (already === 'allow') return { behavior: 'allow', updatedInput: raw };
    if (already === 'deny') return { behavior: 'deny', message: `${toolName} is denied for this session` };
    return await new Promise((settle) => {
      const about = bag(asked);
      /*
       * The conversation the tool is running in.
       *
       * A permission ask from inside a subagent belongs on that subagent's
       * chat, against the call it is for - not on the lead chat, where it
       * would read as a question about the parent's own work. The SDK hands
       * the subagent's id on `agentID`; a call whose frames already arrived is
       * joined by its own id, which is the fallback that also works for a
       * harness that says nothing about the subagent.
       */
      const agentId = str(about.agentID);
      const callId = str(about.toolUseID);
      const scope = (callId !== undefined ? ctx.scopeOfCall(callId) : undefined)
        ?? (agentId !== undefined ? ctx.byAgent.get(agentId) : undefined)
        ?? ctx.mainScope;
      if (agentId !== undefined && scope.chat !== undefined) ctx.byAgent.set(agentId, scope);
      const turn = ctx.openTurn(scope);
      /*
       * A spawning call, recorded from the input this callback was handed.
       *
       * `canUseTool` is given the whole input, and the SDK runs it as soon as
       * that input is complete - which for a call confirmed while it was still
       * streaming is before the canonical assistant message arrives, and that
       * message then skips the call because it is no longer streaming. A
       * worker whose spawn is only recorded there would have no chat at all.
       */
      if ((toolName === 'Task' || toolName === 'Agent') && callId !== undefined) {
        ctx.recordSpawn(callId, bag(raw), scope, str(turn.id));
      }
      /*
       * The agent's own id for this call.
       *
       * Not one of this host's making. The assistant message opens the call
       * under this id, and a confirmation that invented its own put a second
       * row beside it for the same command - and answered under a name the
       * client had never been given, so approving did nothing.
       */
      const id = str(about.toolUseID) ?? `req-${Date.now()}`;
      /** Where a question about this call is drawn: the worker's chat, or the lead. */
      const where = scope.chat?.uri ?? ctx.options.chatUri;

      if (toolName === 'AskUserQuestion') {
        // The same builder a restored question is drawn from, so the two are
        // one thing rather than two that have to be kept alike.
        const { request, asked } = questionRequest(raw, id);
        // `chat` is required on every input request and was never sent.
        const entry: Bag = { id, chat: where, kind: 'chatInput', request };
        pending.set(id, { id, entry, questions: list(raw.questions), asked, answers: new Map(), settle });
        ctx.emitOn(scope, { type: 'chat/inputRequested', turnId: turn.id, request });
        ctx.inputNeededSet(entry);
        ctx.touch();
        return;
      }

      /*
       * From here the call is one a person is being asked about, and not one a
       * client runs. The frame that reports it can be read before this question
       * is put and after it, so the id is held either way: an entry already
       * raised comes down, and one that would be raised is not raised.
       */
      ctx.holdCall(id);
      const input = toolInputOf(toolName, raw);
      const displayName = str(about.displayName) ?? toolName;
      // The card reads the row's line; the CLI's own sentence is its title.
      const invocationMessage = lineOf(toolName, raw);
      ctx.pastLines.set(id, pastLineOf(toolName, raw));
      const confirmationTitle = str(about.title) ?? `Run ${displayName}?`;

      // The call the assistant message opened, if it arrived first. Which of
      // the two comes first is the CLI's business; either order is one call.
      const held = scope.parts.get(id);
      const meta = toolMetaOf(toolName);
      const call = held ? bag(held.toolCall) : {
        toolCallId: id,
        toolName,
        displayName,
        ...(input !== undefined ? { toolInput: input } : {}),
        ...(meta ? { _meta: meta } : {}),
      } as Bag;
      /*
       * The choices, when the SDK suggested a permission to keep.
       *
       * Allow once, the "always" the suggestions describe, and deny. With no
       * suggestion there is nothing to keep and the call is approve or deny.
       */
      const suggestions = list(about.suggestions);
      const options: Bag[] | undefined = suggestions.length === 0 ? undefined : [
        { id: 'allow-once', label: 'Allow once', kind: 'approve', group: 1 },
        { id: 'allow-always', label: keptLabel(suggestions), kind: 'approve', group: 1 },
        { id: 'deny', label: 'Deny', kind: 'deny', group: 2 },
      ];
      // A call still streaming has only its half-written json, and the
      // assistant message that would complete it skips a call no longer
      // streaming: the whole input is given here, as the action gives it.
      if (held && str(call.status) === 'streaming') {
        delete call.partialInput;
        if (input !== undefined) call.toolInput = input;
      }
      call.status = 'pending-confirmation';
      call.confirmationTitle = confirmationTitle;
      if (options !== undefined) call.options = options;
      // The same sentence the action carries, so a client reading the snapshot
      // has one too. See the call built in `assistant`.
      call.invocationMessage = invocationMessage;
      delete call.confirmed;
      if (!held) {
        const part: Bag = { id, kind: 'toolCall', toolCall: call };
        scope.parts.set(id, part);
        ctx.holdPart(turn, part);
        ctx.emitOn(scope, {
          type: 'chat/toolCallStart', turnId: turn.id, toolCallId: id, toolName, displayName,
          ...(meta ? { _meta: meta } : {}),
        });
      }
      ctx.emitOn(scope, {
        type: 'chat/toolCallReady',
        turnId: turn.id,
        toolCallId: id,
        invocationMessage,
        confirmationTitle,
        ...(input !== undefined ? { toolInput: input } : {}),
        ...(options !== undefined ? { options } : {}),
      });

      if (scope === ctx.mainScope) ctx.doing(`Waiting on you: ${displayName}`);
      // `chat` and `turnId` are both required on a tool confirmation and
      // neither was sent.
      const entry: Bag = { id, chat: where, kind: 'toolConfirmation', turnId: str(turn.id) ?? '', toolCall: call };
      pending.set(id, {
        id,
        entry,
        asked: new Map(),
        answers: new Map(),
        ...(options !== undefined ? { options, suggestions } : {}),
        settle: (result) => settle(result.behavior === 'allow'
          ? { behavior: 'allow', updatedInput: raw, ...(result.updatedPermissions === undefined ? {} : { updatedPermissions: result.updatedPermissions }) }
          : result),
      });
      ctx.inputNeededSet(entry);
      ctx.touch();
    });
  };

  /**
   * The input an answered question ran with, by its call id.
   *
   * The protocol's complete action carries no `toolInput` of its own, so the
   * answers the tool was given travel in its `result.structuredContent` - the
   * protocol's own structured result - where a client draws them from the call
   * instead of parsing the result's sentence.
   */
  const answeredInputs = new Map<string, Bag>();
  const methods: Asking['methods'] = {
    confirm: (toolCallId, approved, optionId) => {
      // Found by id rather than assumed to be the only one. This used to
      // compare against whichever question happened to be held and return
      // silently when it did not match - which, with two tool calls open, is
      // a person pressing Approve and nothing at all happening.
      const held = [...pending.values()].find((one) => one.entry.kind === 'toolConfirmation'
        && str(bag(one.entry.toolCall).toolCallId) === toolCallId);
      if (!held) return;
      const settle = held.settle;
      pending.delete(held.id);
      ctx.inputNeededRemoved(held.id);
      // The call's own conversation, so an approval given in a worker's chat
      // is said back there rather than on the lead chat.
      const scope = ctx.scopeOfCall(toolCallId) ?? ctx.mainScope;
      // The choice picked, when it is one this call offered and of the
      // answer's kind; anything else is a plain approve or deny.
      const picked = held.options?.find((one) => one.id === optionId && one.kind === (approved ? 'approve' : 'deny'));
      const part = scope.parts.get(toolCallId);
      let times: Bag | undefined;
      if (part) {
        const call = bag(part.toolCall);
        call.status = approved ? 'running' : 'cancelled';
        // And how it was approved, which is required on the call and was only
        // ever said in the action.
        if (approved) call.confirmed = 'user-action';
        delete call.options;
        if (picked !== undefined) call.selectedOption = picked;
        /*
         * A call starts running now, and not at the ready that came before the
         * question: the wait for a person is not work. A call refused never
         * runs, so it loses the start it was given and says none.
         */
        times = approved ? ctx.stampStart(call) : ctx.untimed(call);
      }
      if (scope === ctx.mainScope) ctx.doing(approved ? ctx.busyWith(str(bag(part?.toolCall).toolName) ?? 'tool', {}) : 'Thinking');
      /*
       * A call of a client's, which is the client's to run now and only now.
       *
       * Before the action that says the call is running, because the entry is
       * what the client goes on and the chat is what tells everybody else: a
       * client that reads the session runs the tool the person just allowed.
       * A refused call runs nowhere, and whoever waits for it is told so.
       */
      const call = bag(held.entry.toolCall);
      const name = str(call.toolName) ?? '';
      if (approved) {
        ctx.allowCall(name, str(held.entry.turnId) ?? '', toolCallId, call.invocationMessage as StringOrMarkdown, str(call.toolInput));
      }
      else ctx.refuseCall(name, toolCallId, DECLINED);
      // Said back, like every other action a client originates. Nothing in a
      // client applies its own dispatch, so a row approved here stayed
      // `pending-confirmation` on every screen watching it - including the
      // one that had just answered it.
      ctx.emitOn(scope, {
        type: 'chat/toolCallConfirmed',
        turnId: scope.turn?.id,
        toolCallId,
        approved,
        ...(approved ? { confirmed: 'user-action' } : {}),
        ...(picked === undefined ? {} : { selectedOptionId: picked.id }),
        // The whole bag, because an action's `_meta` replaces the call's.
        ...(times === undefined || Object.keys(times).length === 0 ? {} : { _meta: times }),
      });
      settle(approved
        ? { behavior: 'allow', updatedInput: {}, ...(picked?.id === 'allow-always' && held.suggestions !== undefined ? { updatedPermissions: held.suggestions } : {}) }
        : { behavior: 'deny', message: DECLINED });
      ctx.touch();
    },

    /**
     * One question of a request, part-way answered.
     *
     * The same thing `setDraft` is for a message: held here so that two people
     * looking at one elicitation see the form being filled in rather than each
     * filling in their own. Kept on the request itself as well as emitted,
     * because a client that arrives while the question is open reads
     * `session.inputNeeded` and would otherwise see an empty form somebody has
     * already answered.
     *
     * False when the request is not one this session is waiting on, which is
     * the caller's to report - answering a question nobody asked is a client
     * out of step, not a no-op.
     */
    setAnswer: (requestId, questionId, answer) => {
      const held = pending.get(requestId);
      // Only a question has answers. A tool confirmation is the other kind of
      // pending input and is answered by approving it, so a draft answer to
      // one names a field it does not have.
      if (!held || held.entry.kind !== 'chatInput') return false;
      if (answer === undefined) held.answers.delete(questionId);
      else held.answers.set(questionId, answer);
      const request = bag(held.entry.request);
      if (held.answers.size > 0) request.answers = Object.fromEntries(held.answers);
      else delete request.answers;
      // Not `touch()`: typing is not a change to the conversation, and a
      // catalogue that reordered itself on every keystroke would be unusable.
      ctx.emit('chat', {
        type: 'chat/inputAnswerChanged',
        requestId,
        questionId,
        ...(answer !== undefined ? { answer } : {}),
      });
      return true;
    },

    /**
     * Answer the question, in the shape the tool wants it back.
     *
     * Keyed by each question's own *text* and valued by the option's own
     * label - not by any id. Sending ids, or dropping `questions`, is a call
     * the tool cannot process and a turn that stalls rather than errors.
     */
    answer: (requestId, accepted, answers) => {
      const held = pending.get(requestId);
      if (!held) return;
      pending.delete(requestId);
      ctx.inputNeededRemoved(requestId);

      if (!accepted) {
        held.settle({ behavior: 'deny', message: 'The person declined to answer' });
        ctx.touch();
        return;
      }
      const said: Record<string, unknown> = {};
      /*
       * What was typed, under what was sent.
       *
       * The protocol has `chat/inputCompleted` use the request's synced answer
       * state *plus* whatever the completion carries, and the completion is
       * allowed to carry nothing at all - a client that has been syncing each
       * answer as it went has already said everything. Reading only the action
       * threw that away and submitted an empty form.
       */
      const whole = { ...Object.fromEntries(held.answers), ...answers };
      for (const [key, value] of Object.entries(whole)) {
        const question = held.asked.get(key);
        if (!question) continue;
        const answer = bag(value);
        /*
         * Two levels in, which is where the protocol puts it.
         *
         * `ChatInputAnswer` is `{ state, value }` and that value is itself
         * `{ kind, value }` - so an answer synced through
         * `chat/inputAnswerChanged`, which is protocol-shaped, holds the word
         * the tool wants one level below where a completion's own `answers`
         * carried it. Read at one level a selection arrived as the object
         * around it, and the tool was handed a shape it cannot read.
         *
         * Freeform is the person's own words as the value, not the word they
         * typed it under - the tool reads the value as the answer itself.
         */
        const inner = bag(answer.value);
        said[question] = inner.value ?? answer.value ?? value;
      }
      /*
       * The input the tool ran with: its questions as sent plus what was
       * answered, which is what the SDK records and what a client draws the
       * answered question from once the call is complete.
       */
      const updated = { questions: held.questions ?? [], answers: said };
      answeredInputs.set(held.id, updated);
      held.settle({ behavior: 'allow', updatedInput: updated });
      ctx.touch();
    },
  };

  return { pending, answeredInputs, canUseTool, methods };
}
