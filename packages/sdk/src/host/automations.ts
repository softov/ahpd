import { computerSource } from '../machines/computers.js';
import { Status, idOf, uriFor } from '../sessions/catalog.js';
import { INVALID_PARAMS, RpcError } from '../rpc.js';
import { EVENT_TRIGGERS, pluginTriggerTypes, wrongIn } from '../automations/automations.js';
import { sameOwnerOrHost, withConnectorChoices } from '../connectors/fields.js';
import { presetById } from '../automations/triggerpresets.js';
import { localPath } from '../resources/fileuri.js';
import { createRuleEngine } from '../automations/triggers.js';
import { wakeMessage } from '../automations/wakemessage.js';
import { bag } from '../utils/values.js';
import { AUTOMATIONS, chatUriFor } from './channels.js';
import { CLOSING, NO_AGENT, need } from './common.js';
import { refusalReason } from './gate.js';
import type { Bag } from '../types/common.js';
import type { AutomationEntry, AutomationRun, AutomationRunState, RunEnding, StartSession } from '../types/automations.js';
import type { ConnectorOwner } from '../types/connectors.js';
import type { PluginStarts, ChatRequest, TriggerTypeDefinition } from '../types/plugin.js';
import type { RuleMatch } from '../automations/triggers.js';
import type { WakeFacts } from '../automations/wakemessage.js';
import type { AutomationWake, SessionEventKind, SessionRule } from '../types/triggers.js';
import type { Owner } from '../types/usage.js';
import type { HostContext } from './context.js';

/** How long the window the hourly cap counts runs over is. */
const HOUR_MS = 3_600_000;

/** How many runs one automation may start in that window. */
const WAKES_AN_HOUR = 20;

/** The answers an automation may give to an event that arrives mid-run. */
const OVERLAPS = ['queue', 'steer', 'parallel', 'skip'];

/** The kinds that end a session's turn, which is when its chat is free again. */
const ENDING = new Set<SessionEventKind>(['turnCompleted', 'turnFailed', 'turnCancelled']);

/** The lifecycles a run has already ended in, which a cancel may not move. */
const OVER = new Set(['completed', 'failed', 'cancelled']);

/**
 * Who a run's own plugins are announced as.
 *
 * An active client, as a person's window is, and named for what it is rather
 * than for anybody: the plugins it carries are the automation's, and a client
 * reading a session that began at nine is owed something that says so.
 */
const AUTOMATION_CLIENT = 'Automation';

/** The event ids a saved trigger names, in the order the client put them. */
const eventsOf = (trigger: Bag): string[] => (Array.isArray(trigger.events) ? trigger.events : [])
  .map((one) => bag(one))
  .map((one) => (typeof one.id === 'string' ? one.id : ''))
  .filter((one) => one !== '');

/** The first event trigger of a definition, where it has one at all. */
const eventTrigger = (definition: Bag): Bag | undefined =>
  (Array.isArray(definition.triggers) ? definition.triggers : []).map((one) => bag(one))
    .find((one) => one.kind === 'event');

/**
 * The rule a saved event trigger means, or nothing where this host cannot read one.
 *
 * The event the client picked says what to watch and the config is the rest of
 * it, which is why a saved trigger carries both: the `session` type is the rule
 * with `on` taken out, and a `watch` trigger names a preset whose numbers are
 * the config. A type this host does not list - a plugin's, until it registers
 * one - is a trigger nothing here fires, and so is an event the type does not
 * offer.
 */
const ruleOf = (trigger: Bag): SessionRule | undefined => {
  const [id] = eventsOf(trigger);
  if (id === undefined) return undefined;
  if (trigger.type === 'watch') return presetById(id)?.rule(bag(trigger.config));
  const type = EVENT_TRIGGERS.find((one) => one.type === trigger.type);
  if (type === undefined || !type.events.some((one) => one.id === id)) return undefined;
  return { on: id as SessionEventKind, ...bag(trigger.config) } as SessionRule;
};

/** What the type that offers an event calls it, in the words a person reads. */
const eventTitle = (type: string, id: string): string =>
  EVENT_TRIGGERS.find((one) => one.type === type)?.events.find((one) => one.id === id)?.title ?? id;

/** What a plugin's own type calls one of its events, in the words a person reads. */
const eventName = (type: TriggerTypeDefinition, id: string): string =>
  type.events.find((one) => one.id === id)?.title ?? id;

/** The resource an automation id names, or the URI it already is. */
const automationResource = (id: string): string =>
  (id.startsWith('ahp-automation:/') ? id : `ahp-automation:/${id}`);

/**
 * Whose an automation is, as the entry a client reads carries it.
 *
 * Read back through `_meta`, which is where a typed reference survives the
 * protocol's own declaration: a value that is not one of the four kinds is a
 * value nobody wrote, and an automation nobody owns is what it says.
 */
const ownerOf = (entry: AutomationEntry): Owner | undefined => {
  const held = entry._meta?.['ahpd.owner'];
  return typeof held === 'string' && /^(?:user|team|project|root):.+$/.test(held) ? held as Owner : undefined;
};

/**
 * What an automation says about waking, from `_meta.ahpd` on its definition.
 *
 * The protocol has a trigger with a type, an event and a config on it, and no
 * field for either of these - so they ride in the one place a definition has
 * for what is the host's rather than a client's. Anything else written there is
 * left to whoever wrote it, and a value this host does not know is the plain
 * default rather than a refusal: a client from a newer build may have put it
 * there, and it is not this one's to argue with.
 */
const wakeOf = (definition: Bag): AutomationWake => {
  const held = bag(bag(definition._meta)['ahpd']);
  const overlap = String(held.overlap);
  return {
    session: held.session === 'pinned' ? 'pinned' : 'new',
    overlap: (OVERLAPS.includes(overlap) ? overlap : 'queue') as NonNullable<AutomationWake['overlap']>,
    ...(typeof held.pinnedSession === 'string' ? { pinnedSession: held.pinnedSession } : {}),
  };
};

/**
 * Whether a fire's data matches a trigger's `config`: every key the config and
 * the data both hold has the same value in each, compared as JSON. A config key
 * the data does not hold is a setting of the form, not a field of the fire, and
 * never blocks a run. An empty config matches every fire.
 */
const configMatches = (config: Bag, data: Record<string, unknown>): boolean =>
  Object.entries(config).every(([key, value]) => !Object.hasOwn(data, key) || JSON.stringify(data[key]) === JSON.stringify(value));

/** One automation this host is watching for what a session does. */
interface Waking {
  /** The trigger type's own name, as the definition wrote it. */
  type: string;
  /** The trigger's id, as the definition wrote it, which the run's origin records. */
  id: string;
  /** The trigger's own title, as the definition wrote it. */
  title: string;
  /** The event's plain title, for the message a run is given. */
  event: string;
  /** The event ids the trigger names, in the order the client put them. */
  events: string[];
  /** Whose the automation is, where it names anybody. */
  owner?: Owner | undefined;
  /** What it says about a run of its own and about an event arriving during one. */
  wake: AutomationWake;
  /** The trigger's `config`, which a plugin's fire must match on every key its data holds to wake it. */
  config: Bag;
}

/**
 * The run state a client reads on the run's own channel.
 *
 * The stored record less `owner` and `notes`, both of which go out under the
 * key an automation entry carries the same kind of value on: the protocol
 * declares `_meta` on a run state and neither of those two names, so a client
 * that found one would be reading a field it has no declaration for. Nothing
 * here is lost to the host - the gates that check an owner before a run starts
 * read it off the record the store holds, and so does the count of what was
 * dropped while the run was going.
 */
export const runState = ({ owner, notes, ...rest }: AutomationRun): AutomationRunState => ({
  ...rest,
  ...(owner === undefined && notes === undefined
    ? {}
    : { _meta: { ...notes, ...(owner === undefined ? {} : { 'ahpd.owner': owner }) } }),
});

/**
 * What the host does about the automations a store holds.
 *
 * What started each session and which run it belongs to, the two things a run
 * is told when it moves, and the run a due automation starts.
 */
export interface Automations {
  /** The sessions each run was last announced as having, by run URI. */
  linked: Map<string, string[]>;
  /** Move the run a session belongs to, when that session stops working. */
  settleRun(uri: string, ending: RunEnding): void;
  /** Stop the run a client named: nothing where it stopped, or why it did not. */
  cancelRun(run: string): string | undefined;
  /** A session this host was running is gone: nothing about it is measured any more. */
  gone(session: string): void;
  /** Stop watching what sessions do. Called as the host closes, before its stores. */
  stop(): void;
  /** Say an automation moved, on whichever channel is about it. */
  changed(event: { automation?: string; run?: string; removed?: string }): void;
  /** What a store is handed when a run starts, however it started. */
  beginAutomation(wanted: StartSession): Promise<string>;
  /** `beginAutomation`, refused once the host is closing, and held while it runs. */
  startForAutomation(wanted: StartSession): Promise<string>;
  /**
   * A session a plugin asked for, as the owner it named.
   *
   * The same steps a run takes, asked the same way, and one question more: a
   * plugin starts work *for* somebody, who could have started it themselves,
   * so the owner's own `session:create` is asked first. `who` is the plugin's
   * own entry, which is what says whether it may ask for a trusted folder.
   *
   * `named` is the plugin's own door, called with the URI once the host has
   * named it - before the tree is made and before the backend spawns.
   */
  startForPlugin(wanted: StartSession, who?: PluginStarts, named?: (uri: string) => void): Promise<string>;
  /**
   * A chat a plugin asked for, in a session this host is running.
   *
   * The same question a session request is asked, one grant over: the chat is
   * added to a session that belongs to somebody, so it is their own
   * `chat:create` that has to hold before anything is started.
   */
  startForPluginChat(session: string, wanted: ChatRequest): Promise<string>;
  /**
   * Set every plugin trigger's `deliver` and `run` on the entry it closes over.
   *
   * Run at start and again from `replace`, because a plugin a live fold brings
   * has no function on it until this runs.
   */
  wireTriggerTypes(): void;
  /**
   * Set every plugin's `start`, `startChat` and `opens` on the entry it holds.
   *
   * Run at start and again from `replace`, for the same reason.
   */
  wirePluginStarts(): void;
  /** The clock, wired to the only thing that can act on it. */
  due(event: { automation: string; origin: Bag }): void;
}

export function createAutomations(ctx: HostContext): Automations {
  const {
    options, sessions, byChat, senders, charged, origins, kept,
    dispatch, log, fire, statusOf, principalFor, admitted, placedIn,
    isolated, settle, openSession, backendsOwn, modelIn, unheld, forWhom, leadOf,
    turnInstructions,
  } = ctx;

  /** The sessions each run was last announced as having, by run URI. */
  const linked = new Map<string, string[]>();

  /**
   * The one wake each automation is holding behind a run that is still going.
   *
   * One and not a list, because that is what `queue` means: what the second
   * event adds is what has happened since the first, and a run per event
   * arriving is what `parallel` is for. A later event replaces what is here,
   * with the counts added up, so what starts when the turn in front ends is the
   * news as it stands. Beside `watched` rather than on it, because an
   * automation a clock fires and no event wakes is held here too.
   */
  const waiting = new Map<string, { origin: Bag; facts: WakeFacts | undefined }>();

  /**
   * When each automation's runs started, in milliseconds, oldest first.
   *
   * While this map holds an entry for an automation, the switch holding it - or
   * the row of the file behind it - is not what bounds it: what the cap bounds
   * is how often an automation starts, and switching it off and on again is not
   * a way to start another twenty. So this outlives the watch, and an automation
   * nobody has ever run is simply absent from it.
   */
  const wakes = new Map<string, number[]>();

  /**
   * Whether any of a run's sessions is still working.
   *
   * The protocol says a run stays `running` while any linked session executes
   * or awaits a person, so this is the question both the settling of a run and
   * the stopping of one are asked against. `except` leaves one session out,
   * which is the one whose own ending is being read.
   */
  const stillGoing = (run: AutomationRun, except?: string): boolean =>
    run.sessions.some((one) => one !== except && sessions.has(one)
      && (statusOf(one) & (Status.InProgress | Status.InputNeeded)) !== 0);

  /**
   * Move the run a session belongs to, when that session stops working.
   *
   * Only when nothing else of the run is still busy: one session finishing is
   * not the run finishing.
   */
  const settleRun = (uri: string, ending: RunEnding): void => {
    const from = origins.get(uri);
    if (from === undefined) return;
    const run = options.automations?.runOf?.(from.run);
    if (run === undefined) return;
    if (stillGoing(run, uri)) return;
    options.automations?.settle?.(from.run, ending);
    /*
     * And the run that has been waiting behind this one starts, a turn later.
     *
     * Deferred, because this runs inside the action that ended the last turn:
     * beginning a turn from inside a backend's own bookkeeping is a turn begun
     * in the middle of somebody else's work. One turn of the loop is enough for
     * that to be over.
     */
    setTimeout(() => { release(from.automation); }, 0);
  };

  /**
   * One session of a run stopped, the way a person pressing Stop in a chat
   * stops one.
   *
   * A run is sessions and what runs in a session is a turn, so the call is the
   * one `chat/turnCancelled` makes: the chat's backend is asked to stop the
   * turn it is running, and the backend's own ending is what the run reads. A
   * session that is not live here has no turn to stop, which is the same
   * answer as one between turns.
   */
  const stopTurn = (session: string): void => {
    const chat = byChat.get(chatUriFor(session))?.chat;
    if (chat === undefined) return;
    const active = (chat.chatState() as { activeTurn?: { id?: unknown } }).activeTurn;
    if (typeof active?.id === 'string') void chat.abort();
  };

  /**
   * Stop a run, and answer why it did not stop where it did not.
   *
   * The action is a request with no room for an answer, so the reason travels
   * back to the one client that asked as a `rejectionReason` rather than as a
   * result - which is why this hands one out instead of refusing.
   *
   * A run that has no session running a turn is settled here and now. That is
   * a run whose session is between turns, one asleep in the catalogue, and one
   * whose session is still being made: none of the three will ever emit an
   * ending, and a cancel that waited for one would wait for ever. The
   * reference host does the same with the last of them, which it answers by
   * writing the run's own end rather than by asking a session for it.
   *
   * The wake this automation is holding behind the run goes with it. That wake
   * was waiting for the slot this run had, and a person pressing Stop is
   * stopping the work rather than asking for the next piece of it: left where
   * it is, the run's own ending would release it a turn later and the stop
   * would have started the automation's next run.
   */
  const cancelRun = (run: string): string | undefined => {
    const store = options.automations;
    const found = store?.runOf?.(run);
    if (found === undefined) return `Automation run not found: ${run}`;
    if (OVER.has(String(found.lifecycle.status))) return `Automation run is already terminal: ${run}`;
    waiting.delete(found.automation);
    for (const session of found.sessions) stopTurn(session);
    if (!stillGoing(found)) store?.settle?.(run, { status: 'cancelled' });
    return undefined;
  };

  /**
   * Say an automation moved, on whichever channel is about it.
   *
   * The store owns the clock and this owns the channels, so a run that started
   * on its own reaches a client only through here. Wired once at startup
   * rather than per request, because the interesting case is the one nobody
   * asked for.
   */
  const changed = (event: { automation?: string; run?: string; removed?: string }): void => {
    if (event.removed !== undefined) {
      watchFor(event.removed);
      dispatch(AUTOMATIONS, { type: 'automation/removed', resource: event.removed });
      return;
    }
    if (event.automation !== undefined) {
      watchFor(event.automation);
      const found = options.automations?.get(event.automation);
      if (found) dispatch(AUTOMATIONS, { type: 'automation/set', automation: found });
    }
    if (event.run !== undefined) {
      const run = options.automations?.runOf(event.run);
      if (!run) return;
      // Two channels, because they answer different questions: the run's own
      // says what it is doing, and the catalogue's says which session it is
      // doing it in.
      dispatch(event.run, { type: 'automationRun/lifecycleChanged', lifecycle: run.lifecycle });
      /*
       * Which sessions it has, as the difference rather than the list.
       *
       * `automationRun/sessionSet` appends one and `sessionRemoved` takes one
       * away - there is no action carrying the whole set - so what is sent is
       * what moved since the last time this looked. A run that started one
       * session says so once; one whose session was disposed says that too,
       * and a client watching the run channel is not left pointing at a
       * channel nobody can open.
       */
      const before = linked.get(event.run) ?? [];
      for (const gone of before.filter((one) => !run.sessions.includes(one)))
        dispatch(event.run, { type: 'automationRun/sessionRemoved', session: gone });
      for (const added of run.sessions.filter((one) => !before.includes(one)))
        dispatch(event.run, { type: 'automationRun/sessionSet', session: added });
      linked.set(event.run, [...run.sessions]);
      if (run.primarySession !== undefined) {
        dispatch(event.run, { type: 'automationRun/primarySessionChanged', primarySession: run.primarySession });
      }
    }
  };

  /**
   * The run of this automation that has not ended, where it has one.
   *
   * Read from the store rather than remembered here, because the store is what
   * owns a run's lifecycle: a run is going from the moment it is recorded until
   * the turn it started ends, and only the store knows which of those has
   * happened. The newest is the one to ask about, because a later run is what
   * an event arrives on top of.
   */
  const flying = (automation: string): { run: string; session?: string | undefined } | undefined => {
    const newest = bag(options.automations?.get(automation)?.runs?.[0]);
    const status = String(bag(newest.lifecycle).status ?? '');
    const resource = typeof newest.resource === 'string' ? newest.resource : undefined;
    if (resource === undefined || (status !== 'pending' && status !== 'running')) return undefined;
    return { run: resource, session: typeof newest.primarySession === 'string' ? newest.primarySession : undefined };
  };

  /** Pinned chats a run has passed the busy check for and is still waking, so a second run finds them busy. */
  const claimed = new Set<string>();

  /**
   * Whether a chat has a turn running in it, is waiting on a person, or is
   * claimed by a run that is waking it.
   *
   * Otherwise read off the chat's own status rather than off anything this
   * file holds, because a turn in a chat is a turn whoever started it - and a
   * person typing in the chat an automation runs in is the case this is here
   * for.
   */
  const pinBusy = (pin: string): boolean => claimed.has(pin) || (statusOf(pin) & (Status.InProgress | Status.InputNeeded)) !== 0;

  /**
   * The chat a pinned automation runs in, where it has one and this host still
   * has it, live or asleep in the catalogue.
   *
   * A chat that is gone - a session somebody disposed of, or one no listing
   * has reached - is a run that makes itself another rather than a run that
   * fails, which is the same answer the pin already gives when there is nothing
   * to add a turn to.
   */
  const pinnedChat = (automation: string): string | undefined => {
    const wake = wakeFor(automation);
    const pin = wake.session === 'pinned' ? wake.pinnedSession : undefined;
    return pin !== undefined && (sessions.has(pin) || ctx.owners.has(pin)) ? pin : undefined;
  };

  /** The chat a pinned automation runs in, where a turn is running in it. */
  const pinnedBusy = (automation: string): { session: string } | undefined => {
    const pin = pinnedChat(automation);
    return pin !== undefined && pinBusy(pin) ? { session: pin } : undefined;
  };

  /**
   * The run of this automation that has not settled in the chat it is pinned to.
   *
   * `flying` reads the newest run off the store, which is a run that has not
   * ended - but a pinned run can have ended its turn and not yet settled, and a
   * run whose origin was moved off it before it settled is a run nothing will
   * ever settle again. So a pinned chat is this automation's to use only once
   * the store says the run that was in it is over.
   */
  const heldBy = (automation: string, pin: string): string | undefined => {
    const from = origins.get(pin);
    if (from === undefined || from.automation !== automation) return undefined;
    const status = String(bag(options.automations?.runOf?.(from.run)?.lifecycle).status ?? '');
    return status === 'pending' || status === 'running' ? from.run : undefined;
  };

  /**
   * Whether anything of this automation is going.
   *
   * Two answers in one, because what waits on it is one thing: a run of its own
   * that has not settled, or a turn running in the chat it is pinned to. The
   * second is not the automation's turn to begin with - somebody may be typing -
   * and a run that started on top of it would be a second turn in one chat.
   */
  const going = (automation: string): { run?: string | undefined; session?: string | undefined } | undefined =>
    flying(automation) ?? pinnedBusy(automation);

  /** How many events a wake origin says were counted, which is one where it says nothing. */
  const countOf = (origin: Bag): number => {
    const held = bag(origin['event'])['count'];
    return typeof held === 'number' ? held : 1;
  };

  /**
   * The message an automation sends, as its definition wrote it.
   *
   * Read here for the one wake that does not go through `run`: a steered event
   * is put into a turn that is already going, so the store is never asked for
   * the text it would have handed a run.
   */
  const templateOf = (automation: string): string => {
    const definition = bag(options.automations?.get(automation)?.definition);
    const message = bag(definition['message']);
    return typeof message['text'] === 'string' ? message['text'] : String(definition['title'] ?? '');
  };

  /**
   * Start a run, with the message a person wrote told what woke it.
   *
   * One door for all three ways a run happens - a clock, a person pressing Run,
   * and an event - because what an automation says about running twice is about
   * the automation rather than about which of the three asked. `facts` is what
   * the message is filled from, and is absent for the two that have no event.
   */
  const fly = async (automation: string, origin: Bag, facts: WakeFacts | undefined, said: string): Promise<void> => {
    try {
      const run = await options.automations?.run(automation, origin, facts === undefined
        ? startForAutomation
        : (wanted) => startForAutomation({ ...wanted, text: wakeMessage(wanted.text, facts) }));
      log(run
        ? `${said} and started ${run.primarySession ?? run.resource}`
        : `${said} and is switched off or gone`);
    }
    catch (error) {
      log(`${said} and failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  /**
   * Keep an event until the run that is going ends, or fold it into the one
   * already kept.
   *
   * One waiting run and no more: what the second event adds is what has happened
   * since the first, and a run per event arriving is what `parallel` is for.
   * What starts when the turn in front ends is therefore the news as it stands,
   * with a count of everything that has gone into it.
   */
  const hold = (automation: string, origin: Bag, facts: WakeFacts | undefined, said: string): void => {
    const held = waiting.get(automation);
    if (held === undefined) {
      waiting.set(automation, { origin, facts });
      log(`${said} while a run was still going, so it waits its turn`);
      return;
    }
    const counted = countOf(held.origin) + countOf(origin);
    const filled = facts ?? held.facts;
    waiting.set(automation, {
      origin: { ...origin, event: { ...bag(origin['event']), count: counted } },
      facts: filled === undefined ? undefined : { ...filled, count: counted },
    });
    log(`${said} and was folded into the wake already waiting, which now counts ${String(counted)}`);
  };

  /** What an automation says about waking, whether or not an event wakes it. */
  const wakeFor = (automation: string): AutomationWake =>
    watched.get(automation)?.wake ?? wakeOf(bag(options.automations?.get(automation)?.definition));

  /**
   * The event an automation asked to be dropped while it was busy.
   *
   * Counted on the run it would have joined where there is one, because a run
   * whose notes grow is how the agent working in that turn, and anybody
   * watching the run, learns what happened while it worked. A chat busy with a
   * turn that is nobody's run of this automation has no run to count on, so the
   * log is the whole of it.
   */
  const skip = (
    automation: string,
    flight: { run?: string | undefined; session?: string | undefined },
    said: string,
  ): void => {
    if (flight.run === undefined) {
      log(`${said} while the chat it runs in was busy, so it was dropped`);
      return;
    }
    const held = bag(options.automations?.runOf?.(flight.run)?.notes)['ahpd.dropped'];
    options.automations?.note?.(flight.run, { 'ahpd.dropped': (typeof held === 'number' ? held : 0) + 1 });
  };

  /**
   * Ask for a run, and do what the automation says about running twice.
   *
   * With nothing of it going, every answer is the same one run started now.
   * With a run of it going, or a turn running in the chat it is pinned to, the
   * automation's own answer is what happens - and `steer` needs an event to
   * send, so a clock or a person is held like a queued one: there is no message
   * of theirs to put into a turn.
   *
   * `byEvent` is whether this wake came from an event, which is what the hourly
   * cap bounds. A clock is not counted: a schedule's own cadence is the bound
   * on it, and the store is what keeps that.
   */
  const request = (automation: string, origin: Bag, facts: WakeFacts | undefined, said: string, byEvent: boolean): void => {
    const flight = going(automation);
    const overlap = wakeFor(automation).overlap ?? 'queue';
    /*
     * Dropped before anything is counted, because an event an automation asked
     * to be thrown away while it was busy is an event that did not start it: it
     * is not one of the twenty it may start in an hour either.
     */
    if (flight !== undefined && overlap === 'skip') {
      skip(automation, flight, said);
      return;
    }
    if (byEvent && !counted(automation)) return;
    if (flight === undefined) {
      void fly(automation, origin, facts, said);
      return;
    }
    // The one answer that does not care: a run per event is the whole of it.
    if (overlap === 'parallel') {
      void fly(automation, origin, facts, said);
      return;
    }
    if (overlap === 'steer' && facts !== undefined && flight.session !== undefined) {
      const chat = byChat.get(chatUriFor(flight.session))?.chat;
      if (chat?.sendSteeringMessage?.({ id: crypto.randomUUID(), text: wakeMessage(templateOf(automation), facts) }) === true) {
        log(`${said} into the turn that was already running`);
        return;
      }
    }
    hold(automation, origin, facts, said);
  };

  /**
   * Start what an automation has been holding, now that nothing of it is going.
   *
   * Called where a run ends, which is the only thing that can free one: what a
   * waiting run waits for is the turn in front of it.
   */
  const release = (automation: string): void => {
    const held = waiting.get(automation);
    if (held === undefined) return;
    waiting.delete(automation);
    void fly(automation, held.origin, held.facts, `${automation} waited its turn`);
  };

  /**
   * A turn ended in a chat, so what waits behind that chat may go.
   *
   * `settleRun` frees a wake held behind a run, and this is the other half of
   * it: the turn in the chat an automation is pinned to need not have been one
   * of its runs at all - a person typing is the likeliest of them - and a wake
   * held behind a chat waits for the chat rather than for a run.
   *
   * Deferred a turn, as `settleRun`'s own release is, and it asks first whether
   * anything is still going: a run of this automation that has not settled is
   * still going, and whatever settles it arms a release of its own - so the
   * wake is released once, by whichever of the two comes last.
   */
  const freed = (session: string): void => {
    for (const [automation, one] of watched) {
      if (one.wake.session !== 'pinned' || one.wake.pinnedSession !== session) continue;
      if (waiting.get(automation) === undefined) continue;
      setTimeout(() => { if (going(automation) === undefined) release(automation); }, 0);
    }
  };

  /**
   * The only place that knows a run was started by an automation rather than by
   * a person, and which run it is.
   */
  const fireRun = (wanted: StartSession): void => {
    if (wanted.origin === undefined) return;
    void fire({ type: 'automation_fire', automation: wanted.origin.automation, run: wanted.origin.run });
  };

  /**
   * Say the first thing in the chat a run works in.
   *
   * The turn is sent by whoever made the automation, whoever pressed the button
   * or whose clock came round - and by nobody at all where the automation names
   * no owner, which is the absence this host already knows how to answer for.
   *
   * Nothing at all where there is nothing to say: a plugin may ask for a
   * session that opens silent, which is what a bot with no instructions gets,
   * and a turn with no text in it is an empty bubble rather than no turn.
   */
  const beginIn = (session: string, wanted: StartSession): void => {
    if (wanted.text.trim() === '') return;
    const turnId = crypto.randomUUID();
    if (wanted.owner !== undefined) senders.set(turnId, wanted.owner);
    const chat = byChat.get(chatUriFor(session))?.chat;
    if (chat !== undefined) void ctx.startTurn(chat, turnId, wanted.text, modelIn(wanted.model), { origin: { kind: 'automation' } });
  };

  /**
   * Remember the session a pinned automation runs in.
   *
   * Written into the definition's own `_meta` and read back by the next run,
   * because that is where the rest of what an automation says about waking
   * lives. A daemon that restarts has none of these sessions left, which is the
   * same case as one somebody disposed of.
   */
  const keepPinned = (automation: string, session: string): void => {
    const store = options.automations;
    const definition = store?.get(automation)?.definition;
    if (store === undefined || definition === undefined) return;
    const meta = bag(definition._meta);
    // The whole `_meta` is written rather than the one key, because a patch
    // replaces it: what else a client put in there is not this function's to
    // drop.
    store.update(automation, { _meta: { ...meta, ahpd: { ...bag(meta['ahpd']), pinnedSession: session } } });
  };

  /**
   * A session started for somebody, taking every step a client's `createSession`
   * takes.
   *
   * Two roads reach here, and they are the two ways this host starts work for a
   * person who is not at the keyboard: an automation's run, and a plugin asking
   * for one. Neither may take a shorter route than a client, so the steps are
   * here once - the tree is isolated, the owner's policies and grants are asked
   * about, the machine the config names is made, and the first turn is sent -
   * and what each road adds is the question that is its own.
   */
  const beginSession = async (wanted: StartSession, named?: (uri: string) => void): Promise<string> => {
    const provider = wanted.provider ?? ctx.first?.provider;
    if (provider === undefined) throw new Error(NO_AGENT);
    // Named the way a client's `createSession` names a session.
    const uri = uriFor(crypto.randomUUID());
    unheld(uri);
    /*
     * Told before anything is made, which is what puts a plugin's own answer
     * in the first tool list: the backend is spawned with the list built
     * while the tree is being isolated, so a reader that learns the URI after
     * the start answers has already missed it.
     *
     * A door that throws has heard as much as it could and is not this
     * session's failure: it is logged against the host and the start goes on,
     * which is the same answer a plugin that asks too early gets.
     */
    if (named !== undefined) {
      try { named(uri); }
      catch (error) {
        log(`${uri} is being started, but the plugin that asked was not told: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const config = wanted.config ?? {};
    // The same two steps a client's `createSession` takes: the tree is made
    // before anything runs in it, and the host's own keys are not the
    // backend's to read. An automation asking for isolation is the case this
    // exists for - nobody is at the keyboard to notice two of them colliding.
    const where = await isolated(uri, config, wanted.workingDirectory);
    await settle(uri, wanted.workingDirectory, config);
    /*
     * The two checks a client's `createSession` makes, asked here too and before
     * anything runs in the machine - an automation is nobody at the keyboard to
     * notice a refusal, so this is the only gate before the run.
     *
     * It acts as its owner, which is who sent the work and whose policies apply
     * to it. An owner this process has never seen sign in cannot be checked, so
     * the run waits for them rather than going unchecked.
     */
    const owner = wanted.owner;
    const person = principalFor(owner);
    /*
     * `computer:write`, which only a source asks for: naming one is a machine
     * made for this run, held to the same grant a client's `createSession` is.
     * It is asked of the owner, who is who this run acts as, and read in this
     * one place.
     *
     * Asked before the sign-in below, because it is the narrower of the two:
     * an owner this process has never met has no grants to ask about, and what
     * this run cannot do is make a machine, which is what it says. A host with
     * no users directory gates nothing here as anywhere else.
     *
     * And only a `user:` owner, which is the only owner with a person behind
     * it: an automation the host owns, or one nobody owns, is not a somebody's
     * machine to hand a grant to, and a root connection is not gated as
     * anywhere else.
     */
    if (options.users !== undefined && computerSource(config.computer) !== undefined && owner?.startsWith('user:') === true) {
      if (person === undefined) {
        throw new RpcError(-32009, `${owner} has not signed in since this daemon started, so this run cannot make a machine for itself; sign in on this host, or start it without a computer`);
      }
      if (!person.can('computer:write')) throw new RpcError(-32009, refusalReason(person.id, 'computer:write'), {});
    }
    if (owner?.startsWith('user:') === true && person === undefined) {
      throw new RpcError(-32009, `${owner.slice('user:'.length)} has to sign in once before an automation of theirs may run`);
    }
    const wrong = await admitted(person, charged.get(uri)?.scope, config, provider, uri, owner);
    if (wrong !== undefined) throw new RpcError(-32009, wrong);
    // A source in the config is made into a machine before anything runs, the
    // same step a client's `createSession` takes.
    await placedIn(uri, provider, config, where, wanted.owner);
    /*
     * The plugins this automation captured, put on the session before it is.
     *
     * The same path a client announcing itself takes - the active client goes
     * into the presence a session's state is built from, and the chats are
     * retooled - because what loads a client plugin is one route and a run may
     * not take a shorter one. It is the host that is the client here, which is
     * the whole point: nobody is at the keyboard when nine o'clock comes.
     *
     * Awaited, which a client's own announcement never is. A backend takes its
     * plugins when it starts and offers no way to add one after, so a session
     * opened while the copy was still being made would run with none of them.
     *
     * The copies' URIs are this host's own paths, under the directory they were
     * copied into, so the copy a session makes of them is the directory it is
     * already in and no client is asked for a byte.
     *
     * And they are this run's for as long as it lasts, which is said here for
     * the same reason: an automation removed while this turn is still working
     * would otherwise take the directory out from under it.
     */
    if (wanted.customizations !== undefined && wanted.customizations.length > 0) {
      options.clientPlugins?.spare(wanted.customizations.map((one) => localPath(one.uri)));
      ctx.presence.set(idOf(uri), new Map([[AUTOMATION_CLIENT, {
        clientId: AUTOMATION_CLIENT,
        displayName: AUTOMATION_CLIENT,
        tools: [],
        customizations: wanted.customizations,
      }]]));
      ctx.retool(uri);
      await ctx.pluginsSettled(uri);
    }
    /*
     * The folder a trusted request asked for, kept with the session before it
     * is opened: the backend is told what is trusted when it starts, and the
     * row is what a restart reads. So the folder is trusted again after a
     * restart without anybody repeating the request, and it is the one folder
     * named rather than everything under it.
     */
    if (wanted.trusted === true && wanted.workingDirectory !== undefined) {
      kept.setTrustedFolder?.(idOf(uri), localPath(wanted.workingDirectory));
    }
    await openSession(
      uri,
      provider,
      config,
      where,
      wanted.origin,
      undefined,
      undefined,
      // Named before it is announced where whoever asked had a name for it: a
      // bot called Motion opens a session called Motion, rather than a row a
      // catalogue names after the turn it was asked to say.
      wanted.title,
      forWhom(wanted.owner),
      {
        ...(wanted.instructions === undefined ? {} : { instructions: wanted.instructions }),
        ...(wanted.tools === undefined ? {} : { tools: wanted.tools }),
        ...(wanted.userSettings === undefined ? {} : { userSettings: wanted.userSettings }),
      },
    );
    fireRun(wanted);
    beginIn(uri, wanted);
    return uri;
  };

  /**
   * What a store is handed when a run starts, however it started.
   *
   * The session *and* the first message: a session created and never spoken to
   * is a session that does nothing, and the whole point of an automation is
   * that nobody is at the keyboard to say the first thing.
   */
  const beginAutomation = async (wanted: StartSession): Promise<string> => {
    /*
     * A pinned automation adds a turn to the chat it already has, where it
     * still has one. For it a run *is* a turn rather than a session, so this is
     * the whole of the difference and everything below is what a run does when
     * it needs a session of its own.
     */
    const automation = wanted.origin?.automation;
    const wake = automation === undefined ? undefined : wakeOf(bag(options.automations?.get(automation)?.definition));
    const pin = wake?.session === 'pinned' ? wake.pinnedSession : undefined;
    // Live, or asleep in the catalogue: a sleeping one is woken in place once
    // every check below has let the run through.
    const reachable = pin !== undefined && (sessions.has(pin) || ctx.owners.has(pin));
    if (automation !== undefined && pin !== undefined && reachable) {
      /*
       * A chat somebody else has is not a chat this run may work in.
       *
       * A pinned run is the one road into a session that does not go through
       * `createSession`, so what it must not be is a way for whoever may write
       * an automation to have it type in another person's session as though the
       * work were theirs. An automation nobody owns is the host's own work and
       * has nobody to be.
       */
      const owner = wanted.owner;
      if (owner !== undefined && kept.owner(idOf(pin)) !== owner) {
        throw new RpcError(-32009, 'This automation is set to run in a chat that belongs to somebody else');
      }
      /*
       * And who the run is: the same two questions an ordinary run is asked,
       * about the chat this one goes into rather than about a session it has yet
       * to make.
       *
       * A person this process has never met cannot be checked at all, and one
       * who may not read the chat is one whose work would be put into a place
       * the host cannot show them. Either way the run does not start, which is
       * what a revoked or signed-out owner gets.
       */
      const person = principalFor(owner);
      if (owner?.startsWith('user:') === true && person === undefined) {
        throw new RpcError(-32009, `${owner.slice('user:'.length)} has to sign in once before an automation of theirs may run`);
      }
      if (person !== undefined && owner?.startsWith('user:') === true && !person.can('session:read')) {
        throw new RpcError(-32009, refusalReason(person.id, 'session:read'), {});
      }
      /*
       * A sleeping session is asked about with what it comes back with: the
       * config the store keeps and the charge it was settled with.
       */
      const live = sessions.get(pin);
      const agent = live?.agent ?? ctx.owners.get(pin);
      if (agent === undefined) throw new RpcError(-32009, `No backend owns ${pin}`);
      const config = live?.config ?? ctx.storedConfig(agent, idOf(pin));
      const scope = charged.has(pin) ? charged.get(pin)?.scope : kept.scope(idOf(pin)) ?? undefined;
      const notAdmitted = await admitted(person, scope, config, agent.provider, pin, owner);
      if (notAdmitted !== undefined) throw new RpcError(-32009, notAdmitted);
      /*
       * And the chat has to be free.
       *
       * A pinned automation has one chat and one turn in it at a time, and
       * either a turn is running there or a run of this automation has not
       * finished with it. Everything arriving through `request` has already had
       * the automation's own answer about running twice, so what is left here
       * is a person pressing Run: they are owed a reason rather than a second
       * turn in a chat that is busy.
       */
      if (pinBusy(pin) || heldBy(automation, pin) !== undefined) {
        throw new RpcError(-32009, 'The chat this automation runs in is already running a turn');
      }
      /*
       * Woken only now, for a run that will go ahead, and held awake until its
       * turn has begun. A resume that fails fails the run.
       */
      const release = ctx.hold(pin);
      claimed.add(pin);
      try {
        if (!sessions.has(pin)) await ctx.wake(pin);
        /*
         * The newest run owns it from here.
         *
         * The session is the same one every time, and what is settled when its
         * turn ends is the run whose turn that was - so the origin moves with
         * the run, and the one that made the session is remembered by the
         * session itself rather than by this map.
         */
        origins.set(pin, { kind: 'automation', automation, run: String(bag(wanted.origin)['run'] ?? '') });
        fireRun(wanted);
        beginIn(pin, wanted);
      } finally {
        claimed.delete(pin);
        release();
      }
      return pin;
    }
    const uri = await beginSession(wanted);
    // A pinned automation keeps the session it just made, so its next run adds
    // a turn to this chat rather than making another.
    if (automation !== undefined && wake?.session === 'pinned') keepPinned(automation, uri);
    return uri;
  };

  /**
   * A session a plugin asked for, as the owner it named.
   *
   * A plugin starts work for somebody - the person whose bot it is, the person
   * whose machine it is - and what makes that honest is that it is the same
   * session they would have made: the same isolation, the same policies, the
   * same machine, and the same first turn.
   *
   * The one question a run is not asked is asked here. A run is an automation
   * doing its own work, which its owner already agreed to by writing it; a
   * plugin naming somebody is asking for a session *as* them, so their own
   * `session:create` is what has to hold - and the refusal is word for word the
   * one a client gets at the door, because a client branching on it has to read
   * the same answer whichever way the work was asked for.
   *
   * Asked first, before the steps below: `session:create` is what a client is
   * stopped by, so it is what a plugin is stopped by, and a `computer:write`
   * refusal would be the answer to a question that had not been reached yet. A
   * host with no users directory gates nothing, as it gates nothing for a
   * client.
   *
   * A request that asks for a trusted folder is a different grant, on the
   * plugin's own entry rather than on the person: the folder is the plugin's
   * business - a bot's own folder, a machine it works in - and nobody at the
   * keyboard vouched for it. So it is asked before anything is started, and
   * the refusal names `session:trust`, which is the one thing an operator has
   * to add.
   */
  const beginPluginSession = async (wanted: StartSession, who?: PluginStarts, named?: (uri: string) => void): Promise<string> => {
    if (wanted.trusted === true && who?.can?.('session:trust') !== true) {
      throw new RpcError(-32009, refusalReason(`plugin:${who?.by ?? 'unknown'}`, 'session:trust'), {});
    }
    const owner = wanted.owner;
    if (options.users !== undefined && owner?.startsWith('user:') === true) {
      const person = principalFor(owner);
      if (person !== undefined && !person.can('session:create')) {
        throw new RpcError(-32009, refusalReason(person.id, 'session:create'), {});
      }
    }
    return await beginSession(wanted, named);
  };

  /**
   * `beginAutomation`, refused once the host is closing, and held in
   * `starting` while it runs so a close waits for it as it waits for a session.
   */
  const startHeld = (begin: () => Promise<string>): Promise<string> => {
    if (ctx.closed) return Promise.reject(new Error(CLOSING));
    const run = begin();
    ctx.starting.add(run);
    const done = (): void => { ctx.starting.delete(run); };
    run.then(done, done);
    return run;
  };

  const startForAutomation = (wanted: StartSession): Promise<string> => startHeld(() => beginAutomation(wanted));

  const startForPlugin = (wanted: StartSession, who?: PluginStarts, named?: (uri: string) => void): Promise<string> =>
    startHeld(() => beginPluginSession(wanted, who, named));

  /**
   * A chat a plugin asked for, added to the session it named.
   *
   * The session is the owner's, not the plugin's, so the grant asked is that
   * owner's `chat:create` - a plugin may not add a chat the person the session
   * belongs to could not have added themselves. Asked first, before the chat is
   * looked at, for the same reason `session:create` is asked first above: a
   * refusal about the person is the answer to a question that has to be
   * reached before any other.
   *
   * What the request names is checked at the plugin boundary, and the start
   * itself is the host's own road - the one `createChat` and a client's
   * `createChat` take - so a chat started here is one nobody could tell apart
   * from one started at the door.
   */
  const beginPluginChat = async (at: string, wanted: ChatRequest): Promise<string> => {
    const owner = kept.owner(idOf(at));
    if (options.users !== undefined && owner?.startsWith('user:') === true) {
      const person = principalFor(owner);
      if (person !== undefined && !person.can('chat:create')) {
        throw new RpcError(-32009, refusalReason(person.id, 'chat:create'), {});
      }
    }
    return (await ctx.openChat(at, wanted)).chat;
  };

  const startForPluginChat = (session: string, wanted: ChatRequest): Promise<string> =>
    startHeld(() => beginPluginChat(session, wanted));

  /**
   * Whether this host can open a session: running now, or in its catalogue.
   *
   * The same two answers a subscribe is served from, asked as one - a session
   * this host is holding, or one a backend's disk has that a read can bring
   * back. What is left is a session that is no more: a store row a restart left
   * behind, with no process here and nothing on disk, and a plugin reusing a
   * session has to be told it apart from one it still has.
   *
   * `past` is what asks the catalogue, because it answers for a backend that
   * can be asked about one id as well as for a listing already held, and it
   * keeps a transcript it read. Nothing is asked of the store: the row that
   * outlived the session is exactly the thing this question does not trust.
   * The URI has to be the one the session is published under, which is the
   * only one it opens by, and is read once `past` has named the row.
   */
  const opensSession = async (uri: string): Promise<boolean> =>
    sessions.has(uri) || ((await ctx.past(idOf(uri))) !== undefined && ctx.nameOf(idOf(uri)) === uri);

  /**
   * Every automation this host is watching, by resource.
   *
   * Beside the engine's rule rather than on it: the engine holds what a rule
   * matched, and these are the facts about the *automation* that a match is
   * judged and reported by - whose it is, what its trigger is called, and when
   * it last woke.
   */
  const watched = new Map<string, Waking>();

  /**
   * The refusals already said, by automation and sentence.
   *
   * A fire may come every few seconds from a sender nobody stopped, so a
   * trigger whose config its type refuses is said once rather than on every
   * call. The sentence is part of the key, so a config edited into a different
   * mistake is a new one to say.
   */
  const refusedSaid = new Set<string>();

  /** What an automation that names no owner sees, which the daemon may narrow. */
  const unownedSees = options.unownedAutomations ?? 'every';

  /**
   * Whether a rule of this automation may look at sessions at all.
   *
   * The owner's own read, asked the way every other gate on this host asks one:
   * a `user:` owner must hold `session:read`, and an owner this process has
   * never met holds nothing and so sees none. Anything else that owns an
   * automation is the host itself, which reads everything.
   *
   * The session is not named here because a read grant on this host is by
   * subject rather than by session: what an owner may read, they may read.
   */
  const maySee = (owner: Owner | undefined): boolean => {
    if (owner === undefined) return unownedSees !== 'none';
    if (!owner.startsWith('user:')) return true;
    const person = principalFor(owner);
    return person !== undefined && person.can('session:read');
  };

  /** What a session calls itself, where this host is running it and it has a title. */
  const titleAt = (session: string): string | undefined => {
    const held = sessions.get(session);
    const title = held === undefined ? undefined : leadOf(held)?.title();
    return title === undefined || title === '' ? undefined : title;
  };

  /**
   * The plugin holding a trigger type name, and the definition it holds.
   *
   * This host knows a plugin's type only because a plugin offered it, so a
   * trigger naming one is a trigger this host fires and a trigger naming
   * anything else is one nothing does. Whose type it is, is the other half, and
   * it is answered here rather than in the caller: the definition and the plugin
   * that may fire it are one record, and the host reads its own record of both.
   */
  const pluginType = (type: string): { by: string; definition: TriggerTypeDefinition } | undefined => {
    for (const one of options.pluginTriggers ?? []) {
      const found = one.types[type];
      if (found !== undefined) return { by: one.by, definition: found };
    }
    return undefined;
  };

  /**
   * Watch one automation, or stop watching it.
   *
   * Read from the definition every time, because that is what a rule is written
   * from: an automation that was disabled, one whose trigger was taken away and
   * one that is gone all come to the same thing here. The runs already counted
   * against the hourly cap are kept, so an edit beside the trigger is not a way
   * to start another twenty.
   */
  const watchFor = (resource: string): void => {
    const found = options.automations?.get(resource);
    const trigger = found === undefined || found.definition.enabled === false
      ? undefined
      : eventTrigger(found.definition);
    const chosen = trigger === undefined ? [] : eventsOf(trigger);
    const type = trigger === undefined ? '' : String(trigger.type ?? '');
    /*
     * A type a plugin registered is watched without a rule.
     *
     * A plugin's type says which events it offers and nothing about what a rule
     * around them looks like, so there is no rule to give the engine: the
     * plugin's own fire is the whole of the match, and `fired` is what it
     * arrives at. Everything the host lists itself goes the other way.
     */
    const byPlugin = trigger === undefined || chosen.length === 0 ? undefined : pluginType(type)?.definition;
    const rule = trigger === undefined || byPlugin !== undefined ? undefined : ruleOf(trigger);
    if (found === undefined || trigger === undefined || (rule === undefined && byPlugin === undefined)) {
      watched.delete(resource);
      engine.remove(resource);
      // And what it was holding: an automation that was switched off or taken
      // away is not one whose wake should start the moment the run ends.
      waiting.delete(resource);
      return;
    }
    const owner = ownerOf(found as AutomationEntry);
    /*
     * What the automation says about waking is read fresh every time, which is
     * the reason this is read again at all. The runs already counted against the
     * hourly cap are not read here: they are held beside `watched` rather than
     * on it, so an edit beside the trigger, or a switch off and on again, is not
     * a way to start another twenty.
     */
    watched.set(resource, {
      type,
      /*
       * The trigger's own id and not the event's: what a client points at
       * with this is the trigger row somebody wrote, which is the same id a
       * schedule trigger's origin carries.
       */
      id: String(trigger.id ?? ''),
      title: typeof trigger.title === 'string' ? trigger.title : type,
      event: byPlugin === undefined ? eventTitle(type, chosen[0] ?? '') : eventName(byPlugin, chosen[0] ?? ''),
      events: chosen,
      ...(owner === undefined ? {} : { owner }),
      wake: wakeOf(found.definition),
      config: bag(trigger.config),
    });
    // A trigger that stopped being one the engine matches stops being watched
    // by it, which is what an edit from a session trigger to a plugin's is.
    if (rule === undefined) engine.remove(resource);
    else engine.add(resource, rule);
  };

  /**
   * What the host does about a rule that matched.
   *
   * Everything here is a fact an event does not carry: whose the automation is
   * and what they may read, and whether the session is one a run of this
   * automation made. A match that fails one of them is a match that does not
   * fire, which is what "this rule does not watch that session" means.
   *
   * A host that is closing is one whose turns are over, so a match arriving
   * after `close` starts nothing - the same refusal `due` and `fired` make.
   */
  const woke = (match: RuleMatch): void => {
    const one = watched.get(match.automation);
    if (one === undefined || ctx.closed) return;
    if (!maySee(one.owner)) return;
    /*
     * A run's own session is a session like any other - it runs turns, calls
     * tools and may fail - so without this a rule that fires on a failing turn
     * would fire on the failure of its own repair, for ever.
     */
    if (origins.get(match.session)?.automation === match.automation) return;

    const title = titleAt(match.session);
    const facts = {
      trigger: one.title,
      event: one.event,
      count: match.count,
      at: match.at,
      session: match.session,
      ...(title === undefined ? {} : { sessionTitle: title }),
    };
    const origin = {
      kind: 'trigger',
      triggerId: one.id,
      event: { ...match.event, count: match.count },
    };
    // And what the automation says about a run of its own already going, which
    // is the last thing between an event and a run.
    request(match.automation, origin, facts, `${match.automation} woke on ${one.event}`, true);
  };

  /**
   * Whether an automation may wake again now, counting this wake if it may.
   *
   * One bound for both ways an event reaches an automation - a rule that
   * matched and a plugin that fired - because what it bounds is how often an
   * automation starts, and a rule that fires on every turn of every session is
   * the case it exists for. Counted before the run starts rather than after,
   * because a run that fails to start fired all the same.
   */
  const counted = (automation: string): boolean => {
    const at = Date.now();
    const recent = (wakes.get(automation) ?? []).filter((when) => at - when < HOUR_MS);
    const may = recent.length < WAKES_AN_HOUR;
    if (may) recent.push(at);
    wakes.set(automation, recent);
    if (!may) log(`${automation} woke ${String(recent.length)} times in the last hour, so this wake was dropped`);
    return may;
  };

  /**
   * An event a plugin fired, offered to every automation that watches its type.
   *
   * A plugin's type is not a rule, so nothing is filtered or waited for here: a
   * fire is a match as it stands, and what happens about it is what the
   * automation says about any other wake - the hourly cap, and the overlap mode
   * for a run of its own already going.
   *
   * Whose the automation is asked here as it is of a rule's own match, because
   * what that answers is whether this host lets the automation see sessions at
   * all - and a fire that starts a run starts one a rule of the same automation
   * would not have been allowed to.
   *
   * The plugin's own account of the event goes on the run's origin, where the
   * protocol keeps a host's provenance for it, and the words the type gave the
   * event are what fill the message. A plugin names no session, because it may
   * have none to name, and a message asking for one is filled with nothing.
   */
  const fired = (by: string, type: string, event: string, data: Record<string, unknown>, owner?: ConnectorOwner): void => {
    if (ctx.closed) return;
    const held = pluginType(type);
    if (held === undefined) return;
    /*
     * A fire is a plugin's own say-so about a type that host holds for it, so a
     * fire under a name another plugin registered is that other plugin's
     * automations run on this one's word - and it is dropped and said, the way
     * every other fire this host will not act on is.
     */
    if (held.by !== by) {
      log(`${by} fired ${type}, which plugin ${held.by} registered, so this fire was dropped`);
      return;
    }
    const title = eventName(held.definition, event);
    const schema = held.definition.configSchema;
    for (const [automation, one] of watched) {
      if (one.type !== type || !one.events.includes(event)) continue;
      /*
       * A config the type's schema refuses is a trigger this host cannot know
       * the meaning of, so it does not run: a save after the type was loaded is
       * refused, and one written before it - or against a type this store never
       * saw - is caught here instead of firing on a rule nobody meant.
       */
      if (schema !== undefined) {
        const wrong = wrongIn(one.config, schema);
        if (wrong !== undefined) {
          const said = `${automation}\n${type}\n${wrong}`;
          if (!refusedSaid.has(said)) {
            refusedSaid.add(said);
            log(`${automation} holds a ${type} trigger its type refuses (${wrong}), so this fire did not wake it`);
          }
          continue;
        }
      }
      if (!configMatches(one.config, data)) continue;
      /*
       * A fire that names the owner of the connector it came from may wake only
       * an automation that may read that connector. A plugin firing with no
       * owner - a machine going away, a forecast - names none, and its fire is
       * the host's own rather than a connector's.
       */
      if (owner !== undefined && !sameOwnerOrHost(owner, one.owner)) continue;
      if (!maySee(one.owner)) continue;
      const origin = { kind: 'trigger', triggerId: one.id, event: { ...data, event } };
      const facts: WakeFacts = { trigger: one.title, event: title, count: 1, at: new Date().toISOString(), data };
      request(automation, origin, facts, `${automation} woke on ${title} from ${by}`, true);
    }
  };

  /**
   * Start one automation by its id, for a plugin that knows which one it means.
   *
   * A fire reaches every automation watching a type; this reaches the one the
   * caller named, and is what a connector holding an automation id uses. The
   * owner is the connector's, compared the way a fire's is, and a run that is
   * switched off or gone is said rather than started - a plugin asking for one
   * that cannot run is owed a line, unlike a fire that reached nobody.
   *
   * The origin is the first event trigger's, because that is the row the
   * protocol points `triggerId` at, and the plugin's own data goes on `event`.
   */
  const runOne = (by: string, id: string, data: Record<string, unknown>, owner?: ConnectorOwner): void => {
    if (ctx.closed) return;
    const resource = automationResource(id);
    const found = options.automations?.get(resource);
    if (found === undefined) {
      log(`${by} asked for ${resource}, which this host does not hold`);
      return;
    }
    const automationOwner = ownerOf(found as AutomationEntry);
    if (owner !== undefined && !sameOwnerOrHost(owner, automationOwner)) {
      log(`${by} asked for ${resource} from ${owner}, whose owner is ${automationOwner ?? 'the host'}, so it was not run`);
      return;
    }
    if (found.definition.enabled === false) {
      log(`${by} asked for ${resource}, which is switched off, so it was not run`);
      return;
    }
    if (!maySee(automationOwner)) {
      log(`${by} asked for ${resource}, which belongs to ${automationOwner ?? 'nobody to this host'}, so it was not run`);
      return;
    }
    const trigger = eventTrigger(found.definition);
    const event = eventsOf(trigger ?? {})[0] ?? '';
    const type = pluginType(String(trigger?.type ?? ''));
    const facts: WakeFacts = {
      trigger: String(trigger?.title ?? resource),
      event: type === undefined ? event : eventName(type.definition, event),
      count: 1,
      at: new Date().toISOString(),
      data,
    };
    const origin = { kind: 'trigger', triggerId: String(trigger?.id ?? ''), event: data };
    void fly(resource, origin, facts, `${by} asked for ${resource}`);
  };

  /** The rule engine, with the clock a test may hand it and the host's own answer. */
  const engine = createRuleEngine({ onMatch: woke });

  /*
   * Every event every session does, every turn as it starts, and everything a
   * session does that is not an event, for as long as this host runs.
   *
   * The three subscriptions are held rather than dropped, because a rule
   * outliving the host it belongs to would be a rule firing into a closed
   * daemon: `stop` is what the host's own close calls. Every turn as it starts
   * is what a rule about a long turn is timed from, since a turn that says
   * nothing never becomes an event - and every delta and tool call is what
   * keeps such a rule from firing on a turn that is working.
   */
  const stopEvents = ctx.sessionEvents.watch((event) => {
    engine.feed(event);
    // The turn in a chat is over, which is when a wake held behind that chat
    // may go - whether the turn was a run's or a person's.
    if (ENDING.has(event.kind)) freed(event.session);
  });
  const stopTurns = ctx.sessionEvents.turns((turn) => { engine.started(turn); });
  const stopMoving = ctx.sessionEvents.moved((session) => { engine.moved(session); });
  for (const one of options.automations?.list() ?? []) watchFor(one.resource);

  /**
   * A session this host was running is gone.
   *
   * A turn nothing will end is a turn no rule is waiting on, and the timers it
   * armed would otherwise outlive the session they were measuring - so the
   * engine is told, which drops the turn and everything a rule held for it.
   *
   * And an automation pinned to it is free: what waited behind a chat that is
   * not there is not waiting for anything, so the wake goes now and the run
   * that starts makes itself another chat.
   */
  const gone = (session: string): void => {
    engine.end(session);
    for (const [automation, one] of watched) {
      if (one.wake.session !== 'pinned' || one.wake.pinnedSession !== session) continue;
      if (waiting.get(automation) === undefined) continue;
      setTimeout(() => { release(automation); }, 0);
    }
  };

  /**
   * Stop reading what sessions do, and forget every wait.
   *
   * Called as the host closes, before the stores it reads: a wake that arrived
   * between the two would be a run begun in a daemon that is going away. The
   * rules themselves are dropped rather than kept, because a rule that fires
   * into nothing is a rule nobody may act on.
   */
  const stop = (): void => {
    stopEvents();
    stopTurns();
    stopMoving();
    waiting.clear();
    engine.close();
  };

  /*
   * Every plugin's fires come here.
   *
   * Set now rather than handed over at load, because a plugin fires from a
   * route or a timer long after its `apply` returned and nothing else knows
   * this host exists. A plugin that offered no type has nothing here, and one
   * whose name was taken by another plugin was left out of the list the fold
   * built - so what it fires reaches nothing, which is what losing the name
   * meant.
   *
   * Called again by `replace`, because a plugin a live fold brings is an entry
   * nobody has set these on yet, and it fires the moment it applies.
   */
  const wireTriggerTypes = (): void => {
    for (const one of options.pluginTriggers ?? []) {
      one.deliver = (type, event, data, owner) => { fired(one.by, type, event, data, owner); };
      one.run = (automation, data, owner) => { runOne(one.by, automation, data, owner); };
    }
    /*
     * Every saved automation is read again, because a type's arrival is what
     * makes a trigger on it watchable: one saved for a type that was not loaded
     * then has no rule and no definition, and is watched from here on. A type
     * that went with its plugin leaves the same way - read as a trigger nothing
     * answers for, which is what `watchFor` does with it.
     *
     * The first pass is the one beside `stopMoving`, which runs before a store
     * says what it missed while the daemon was down. This one is for a fold.
     */
    for (const one of options.automations?.list() ?? []) watchFor(one.resource);
  };
  wireTriggerTypes();

  /*
   * Every plugin's sessions are started here.
   *
   * Set now rather than handed over at load, for the same reason: a plugin asks
   * from a route or a timer long after its `apply` returned, and the object it
   * holds has to be the one this host filled in. A plugin that registered no
   * `startSession` has nothing here, and a host with no automation port at all
   * - an embedder that never asked for one - leaves every `start` absent, which
   * is a plugin asking into nothing rather than a session started somewhere
   * else.
   *
   * Called again by `replace`, for the same reason as `wireTriggerTypes`: a
   * plugin enabled while the daemon runs starts its sessions through these.
   */
  const wirePluginStarts = (): void => {
    for (const one of options.pluginStarts ?? []) {
      // The entry itself is handed over rather than its name: what it grants is
      // set on this same object by the plugin host, and a request that asks for
      // a trusted folder is answered from it.
      one.start = (wanted, named) => startForPlugin(wanted, one, named);
      one.startChat = (session, wanted) => startForPluginChat(session, wanted);
      one.opens = (uri) => opensSession(uri);
    }
  };
  wirePluginStarts();

  /**
   * The clock, wired to the only thing that can act on it.
   *
   * A store holding one says an automation is due and this starts the run,
   * which is what makes a schedule fire with nobody connected. Wired here,
   * after `startForAutomation` exists, because a store may report what it
   * missed while this daemon was down the moment it is asked.
   *
   * A run that will not start is logged and not thrown: there is no client to
   * answer, and a daemon that died because nine o'clock came round would be
   * worse than one that says so.
   */
  const due = ({ automation, origin }: { automation: string; origin: Bag }): void => {
    if (ctx.closed) return;
    // Through the same door a wake goes through, because what an automation
    // says about running twice is about the automation and not about what asked
    // - and there are no facts here, a clock having nothing to report.
    request(automation, origin, undefined, `${automation} was due`, false);
  };

  return {
    linked, settleRun, cancelRun, gone, stop, changed, beginAutomation, startForAutomation, startForPlugin, startForPluginChat, due,
    wireTriggerTypes, wirePluginStarts,
  };
}

/**
 * The three commands a client draws the automation form from, and presses.
 */
export interface AutomationMethods {
  listAutomationTriggerDefinitions: (params: Record<string, unknown>) => Promise<unknown>;
  runAutomation: (params: Record<string, unknown>) => Promise<unknown>;
  fetchAutomationRuns: (params: Record<string, unknown>) => Promise<unknown>;
}

export function createAutomationMethods(ctx: HostContext): AutomationMethods {
  const { options, startForAutomation } = ctx;

  return {
    /**
     * What kinds of trigger this host understands.
     *
     * Asked before any automation exists, because it is what a client
     * needs to draw the form. A store that schedules nothing answers with
     * no schedule trigger, and the client then offers no cron box - which
     * is better than a box that takes an expression nothing will ever act
     * on.
     */
    listAutomationTriggerDefinitions: async (params) => ({
      items: [
        ...need(options.automations, 'listAutomationTriggerDefinitions').triggers({
          ...(typeof params.provider === 'string' ? { provider: params.provider } : {}),
          ...(Array.isArray(params.workingDirectories)
            ? { workingDirectories: params.workingDirectories.filter((one): one is string => typeof one === 'string') }
            : {}),
        }),
        // Beside the store's own, because a plugin's type is a trigger this
        // host fires and the store has never heard of it. A config field that
        // names a connector carries the host's as its choices, and asks
        // `x-ahpd/completions` for the reader's own.
        ...pluginTriggerTypes(options.pluginTriggers).map((type) => {
          const served = options.connectors?.refs();
          if (served === undefined || type.configSchema === undefined) return type;
          const configSchema = withConnectorChoices(type.configSchema as unknown as Record<string, unknown>, served, true);
          return { ...type, configSchema: configSchema as unknown as typeof type.configSchema };
        }),
      ],
    }),
    /**
     * Start one now.
     *
     * The session is created here rather than in the store, because only
     * this file knows what a session is - the store is handed a function
     * and gets a URI back. `requestId` is echoed nowhere: the protocol has
     * it so a client can match its own request to the run it gets, and the
     * run URI in the result is that match.
     *
     * The origin is `{ kind: 'manual' }` and nothing else, because that is
     * the whole of `AutomationManualRunOrigin` - it carries no room for
     * who asked, and a run's origin goes on the wire in every catalogue
     * row the automation appears in.
     *
     * Which is why a run pressed here is the automation maker's work and
     * not the presser's: the owner rides on the automation and travels
     * with the run, and this origin says only that a person pressed it.
     *
     * A press is never held behind a run that is going, whatever the
     * automation says about overlapping ones: what this answers with is the
     * run it started, and a press that started nothing has nothing to
     * answer with. What an automation says about running twice is about an
     * event arriving on its own, and a person asking for one now is not
     * that - they get a session or a turn in the pinned chat, which is the
     * half of those settings a press is held to.
     *
     * `enabled` and a disable condition are not this method's business
     * either, and the protocol says so: they govern runs an automation
     * schedules for itself, and a person pressing Run gets a run of one
     * that is switched off. `-32001` here means there is no automation at
     * that resource, and nothing else.
     */
    runAutomation: async (params) => {
      const store = need(options.automations, 'runAutomation');
      const automation = String(params.automation ?? '');
      const run = await store.run(automation, { kind: 'manual' }, startForAutomation);
      if (!run) throw new RpcError(-32001, `No automation at ${automation}`);
      return { resource: run.resource };
    },
    /**
     * Ask for one more page of what one automation has done, newest first.
     *
     * The answer is empty, because the protocol's result for this is: the page
     * a client reads is the automation's entry, which the store grew and said
     * so about, and every subscriber of the catalogue has it on the same
     * `automation/set` - which the store dispatches before this answers.
     *
     * The cursor is the entry's `runsNextCursor`, and the store says whether
     * it was one it issued. The protocol asks for an unrecognised cursor to be
     * refused rather than guessed at, which is the refusal `fetchTurns` makes
     * on an older page too.
     */
    fetchAutomationRuns: async (params) => {
      const cursor = typeof params.cursor === 'string' ? params.cursor : undefined;
      const known = need(options.automations, 'fetchAutomationRuns').runs(String(params.automation ?? ''), cursor);
      if (!known) throw new RpcError(INVALID_PARAMS, `Unrecognised cursor ${String(cursor)}`);
      return {};
    },
  };
}
