import { join } from 'node:path';
import type { Turn } from '@microsoft/agent-host-protocol';
import { idOf, uriOf } from '@ahpd/sdk';
import type { Agent, Bag, Listed, MessageAttachment, MessageFrom, Session, Start, WireTurn } from '@ahpd/sdk';

/**
 * A backend that answers by saying it back, and nothing else.
 *
 * There is no model here and no subprocess - which is the point: it is the
 * whole of `Agent` and `Session` with none of a real harness in the way, so
 * what is left is exactly what the host asks a backend for.
 *
 * Reading order:
 *
 * 1. `echo()` at the bottom is the `Agent`: what it is called, what it can be
 *    configured with, what sessions it already has, and how to start one.
 * 2. `converse()` is the `Session`: the state its two channels hold, and the
 *    actions it emits as things happen.
 *
 * Everything a real backend does differently is in `converse`. `echo` would
 * look much the same wrapping a language model, a shell, or a queue.
 */

/** What the schema offers, and what a turn does with it. */
type Voice = 'plain' | 'shouty' | 'backwards';

const speak = (voice: string, text: string): string => {
  if (voice === 'shouty') return text.toUpperCase();
  if (voice === 'backwards') return [...text].reverse().join('');
  return text;
};

/**
 * A session that has finished, kept so the catalogue has something in it.
 *
 * A real backend reads these from wherever its harness writes them. Holding
 * them in memory is what makes this example runnable with nothing installed,
 * and is also why restarting the host empties the list.
 */
interface Kept {
  id: string;
  title: string;
  createdAt: string;
  modifiedAt: string;
  turns: Bag[];
}

/** How to build the echo backend. */
export interface EchoOptions {
  /** The directory sessions report as their workspace. */
  path: string;
  /** Milliseconds between streamed words. `0` answers all at once. */
  pace?: number;
}

export function echo(options: EchoOptions): Agent<Session> {
  const dir = options.path;
  const pace = options.pace ?? 60;
  /** Everything this backend has ever finished, by its own id. */
  const kept = new Map<string, Kept>();

  const schema = (): Bag => ({
    properties: {
      voice: {
        type: 'string',
        title: 'Voice',
        description: 'What it does to what you said.',
        enum: ['plain', 'shouty', 'backwards'],
        enumLabels: ['Plain', 'Shouty', 'Backwards'],
        enumDescriptions: [
          'Says it back as it arrived',
          'SAYS IT BACK LIKE THIS',
          'kcab ti syaS',
        ],
        default: 'plain',
        // Changeable on a running session. A key left without this is one a
        // client will only offer before the session exists, which is the
        // right default for anything fixed when the session is built.
        sessionMutable: true,
      },
    },
  });

  const defaults = (): Record<string, string> => ({ voice: 'plain' });

  /**
   * One conversation.
   *
   * The host owns the channels and the sequence numbers; this owns the state
   * they carry and says what changed. `emit('chat', …)` goes to the chat
   * channel and `emit('session', …)` to the session channel - the host routes
   * them and no session needs to know either URI to do it.
   */
  function converse(start: Start): Session {
    const settings = { ...start.settings };
    /** Finished turns. The running one is `active` and is deliberately not here. */
    const turns: Bag[] = [...(start.seed ?? [])];
    let active: Bag | undefined;
    let title = 'Echo session';
    let modified = new Date().toISOString();
    let closed = false;
    /** What it is doing, or nothing while it is idle. */
    let activity: string | undefined;
    /**
     * The turns handed while another ran, each echoed once the one in front of
     * it is done.
     *
     * The host said each start, so each took the place of the one before it in
     * every client's state, as the protocol's reducer replaces the active turn:
     * a backend handed a turn while one runs takes it, and runs the turns it is
     * handed one at a time. The turn it replaced runs on, and is in no history.
     */
    const handed: { turn: Bag; text: string }[] = [];
    /** The turns a later one took the place of. */
    const replaced = new Set<string>();
    /** What somebody is part-way through typing. */
    let draft: Bag | undefined;
    /** The backend's own id, which is not the URI the client chose. */
    const id = start.resume ?? idOf(start.uri);

    // A resumed session opens on what it said before, so a title from the
    // seed is better than one invented now.
    // Where this session works. Named by the client or the backend's own,
    // and reported rather than assumed - the host does not know which.
    const where = start.workingDirectory ?? dir;

    const said = start.seed?.[0];
    if (said) title = String((said.message as Bag | undefined)?.text ?? title).slice(0, 60);

    const touch = (): void => { modified = new Date().toISOString(); };

    /**
     * Say what it is doing, on both channels.
     *
     * The chat is where the work happens; the protocol has a session mirror
     * its default chat's activity, and the session is the one a catalogue row
     * and a detail pane read.
     */
    const doing = (said: string | undefined): void => {
      if (activity === said) return;
      activity = said;
      start.emit('chat', { type: 'chat/activityChanged', ...(said !== undefined ? { activity: said } : {}) });
      start.emit('session', { type: 'session/activityChanged', ...(said !== undefined ? { activity: said } : {}) });
    };
    /** `SessionStatus`: 8 is in progress, 1 is idle. */
    const status = (): number => (active ? 8 : 1);

    const remember = (): void => {
      kept.set(id, { id, title, createdAt: modified, modifiedAt: modified, turns: [...turns] });
    };

    /**
     * Echo a turn the host handed.
     *
     * One handed while another runs waits and is echoed once that one is done;
     * `waited` is such a turn, echoed now.
     */
    const beginTurn = (
      turnId: string,
      text: string,
      from?: MessageFrom,
      attachments?: MessageAttachment[],
      waited?: Bag,
    ): void => {
      if (waited === undefined && title === 'Echo session' && text) {
        title = text.slice(0, 60);
        // Said, because a client that opened the session holds the old one.
        start.emit('session', { type: 'session/titleChanged', title });
      }
      const startedAt = new Date().toISOString();
      // The origin the client sent, carried through: a turn that comes back
      // without it is a person's message a client can only draw as a system
      // line, and `Message.origin` is required by the protocol for exactly
      // this reason. The attachments go with it, so a client reading the turn
      // shows what the person pasted.
      const message: Bag = {
        text,
        ...(from?.origin !== undefined ? { origin: from.origin } : {}),
        ...(from?._meta !== undefined ? { _meta: from._meta } : {}),
        ...(attachments !== undefined && attachments.length > 0 ? { attachments } : {}),
      };
      const turn: Bag = waited ?? { id: turnId, startedAt, message, responseParts: [] };
      if (waited === undefined && (active !== undefined || handed.length > 0)) {
        replaced.add(String((handed.at(-1)?.turn ?? active)?.id));
        handed.push({ turn, text });
        touch();
        return;
      }
      active = turn;
      doing('Echoing');

      const part: Bag = { id: `${turnId}:0`, kind: 'markdown', content: '' };
      (turn.responseParts as Bag[]).push(part);
      start.emit('chat', { type: 'chat/responsePart', turnId, part });

      // A config value is `unknown` on the wire, so a backend narrows the ones
      // it declared rather than assuming every key is a string.
      const voice = typeof settings.voice === 'string' ? settings.voice : 'plain';
      const words = speak(voice, text).split(/\s+/).filter((word) => word !== '');
      const began = Date.now();
      void (async () => {
        // A turn a stop ended echoes nothing more.
        for (const word of words) {
          if (closed || active !== turn) return;
          if (pace > 0) await new Promise((wake) => { setTimeout(wake, pace); });
          if (closed || active !== turn) return;
          const chunk = part.content === '' ? word : ` ${word}`;
          part.content = `${String(part.content)}${chunk}`;
          start.emit('chat', { type: 'chat/delta', turnId, partId: part.id, content: chunk });
        }
        if (closed || active !== turn) return;
        turn.duration = Date.now() - began;
        /*
         * How it ended, which the protocol's `Turn` carries: these turns are
         * what `transcript` answers, and a chat read back from them shows
         * each one as the chat held it when it finished.
         * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-chat/state.ts#L710-L730
         */
        turn.state = 'complete';
        // A turn a later one took the place of is in no history.
        if (!replaced.delete(turnId)) turns.push(turn);
        active = undefined;
        doing(undefined);
        touch();
        remember();
        start.emit('chat', { type: 'chat/turnComplete', turnId, duration: turn.duration });
        sendNext();
      })();
      touch();
    };

    /** The next turn handed while another ran, echoed once nothing runs. */
    const sendNext = (): void => {
      if (active || closed) return;
      const first = handed.shift();
      if (first !== undefined) beginTurn(String(first.turn.id), first.text, undefined, undefined, first.turn);
    };

    return {
      uri: start.uri,
      chatUri: start.chatUri,

      // No models, no id of its own beyond the one above, and nothing handed
      // to it but what the host seeded. Empty lists are real answers.
      models: () => [],
      agentId: () => id,
      customizations: () => start.seedCustomizations ?? [],

      allTurns: () => turns,
      activity: () => activity,
      status,
      title: () => title,
      modifiedAt: () => modified,
      workingDirectories: () => [uriOf(where)],

      sessionState: () => ({
        // No `resource`: it is declared on `SessionSummary` and not on
        // `SessionState`, and a client subscribed to this channel named it.
        provider: 'echo',
        title,
        status: status(),
        lifecycle: 'ready',
        defaultChat: start.chatUri,
        chats: [{ resource: start.chatUri, title }],
        workingDirectories: [uriOf(where)],
        customizations: start.seedCustomizations ?? [],
        ...(activity !== undefined ? { activity } : {}),
        // The schema *and* what is in force. A client reads
        // `config.schema.properties` to know which controls to draw and
        // `config.values` to know where each one sits.
        config: { schema: start.schema(), values: { ...settings } },
      }),

      chatState: () => ({
        resource: start.chatUri,
        title,
        status: status(),
        modifiedAt: modified,
        turns,
        ...(active ? { activeTurn: active } : {}),
        ...(activity !== undefined ? { activity } : {}),
        ...(draft !== undefined ? { draft } : {}),
      }),

      /**
       * The host said a turn has begun before it handed the turn here; making
       * it true is this method.
       *
       * Note the order every backend has to keep: a part is opened before text
       * streams into it. A `chat/delta` naming a part nobody opened appends to
       * nothing, and a part naming a turn no client has is dropped.
       */
      sendMessage: (turnId, text, from, attachments) => beginTurn(turnId, text, from, attachments),

      // An echo runs on no model and as no agent, so a pick of either is kept
      // by nothing.
      changeModel: () => {},
      changeAgent: () => {},

      // The draft the host said, held for the chat's state.
      setDraft: (next) => { draft = next; },

      abort: () => {
        // The chat's turn is the last one handed; the turns it took the place
        // of stop with it, in no history.
        const turn = handed.at(-1)?.turn ?? active;
        if (!turn) return;
        handed.length = 0;
        replaced.clear();
        turn.state = 'cancelled';
        /*
         * `duration` is required, and required in earnest.
         *
         * A client's reducer clamps it with `Math.max(0, duration)` and then
         * adds it to the turn's start - so an absent one is `NaN` rather than
         * a missing number, and the reducer throws building a timestamp out of
         * it. Which stops that client reading the channel at all, over a turn
         * somebody merely cancelled.
         */
        turn.duration = Date.now() - Date.parse(String(turn.startedAt));
        turns.push(turn);
        active = undefined;
        doing(undefined);
        touch();
        remember();
        start.emit('chat', {
          type: 'chat/turnCancelled',
          turnId: String(turn.id),
          duration: turn.duration,
        });
      },

      // Nothing here ever asks, so there is never anything to answer, and the
      // host refuses a confirmation or an answer sent anyway. A backend that
      // asks settles the promise it parked in `canUseTool` or its equivalent,
      // as `src/session.ts` does.
      confirm: () => false,
      answer: () => false,

      // Nothing here has a runtime switch and there are no MCP servers, so
      // all three refuse. False is a real answer: a control that reported
      // success and changed nothing would be worse than one that says no.
      setCustomizationEnabled: async () => false,
      startMcpServer: async () => false,
      stopMcpServer: async () => false,

      settings: () => ({ ...settings }),
      close: () => { closed = true; },
    };
  }

  return {
    provider: 'echo',
    displayName: 'Echo',
    description: `Says back what you said, from ${dir}`,
    schema,
    defaults,

    /**
     * What this backend offers before any session exists.
     *
     * A client asks for this to draw its composer - the models to pick from,
     * the commands behind a slash - so answering it late means offering them
     * only once the conversation has started. `customizations` is the flat
     * list a client shows in a panel; `commands` is what a slash completes.
     */
    probe: async () => ({
      models: [],
      commands: [{ name: 'shout', description: 'Say the rest of this line loudly' }],
      /*
       * Inside a container, because a prompt is never a top-level entry.
       *
       * `Customization` - what `AgentInfo.customizations` and a session's own
       * list are - is a plugin, a directory or an MCP server. A skill, a
       * prompt, an agent, a rule and a hook are `ChildCustomization`s and live
       * under one of those, so a bare `prompt` at the top is a shape no client
       * can place.
       */
      customizations: [{
        type: 'directory',
        id: 'directory:commands',
        uri: uriOf(join(options.path, '.echo', 'commands')),
        name: 'commands',
        contents: 'prompt',
        enabled: true,
        // Required of a directory: whether a client may write a new one into
        // it. This example's is made up, so nothing may.
        writable: false,
        children: [{
          type: 'prompt',
          id: 'command:shout',
          name: 'shout',
          uri: uriOf(join(options.path, '.echo', 'commands', 'shout.md')),
          enabled: true,
          description: 'Say the rest of this line loudly',
        }],
      }],
    }),

    directories: () => [dir],

    /** Sessions somebody can browse. Ordering is the host's business. */
    list: async (): Promise<Listed[]> => [...kept.values()].map((session) => ({
      id: session.id,
      title: session.title,
      createdAt: session.createdAt,
      modifiedAt: session.modifiedAt,
      workingDirectories: [uriOf(dir)],
    })),

    /**
     * A past session's turns, read without starting anything.
     *
     * What makes a catalogue row openable. The host serves the row from here
     * and calls `create` with `resume` only when somebody actually says
     * something to it.
     */
    // Asserted, not checked. This example assembles a turn by mutation - a
    // part is filled in as it streams - so its turns are `Bag`s here, while
    // the port now takes `WireTurn<Turn>`. The built-in provider checks each
    // literal where it is built; doing the same here is worth a pass of its
    // own.
    transcript: async (id) => kept.get(id)?.turns as WireTurn<Turn>[] | undefined,

    create: converse,
  };
}
