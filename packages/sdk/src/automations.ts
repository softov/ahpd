/** Automations held in memory, run when somebody asks. */

import { randomUUID } from 'node:crypto';
import type { AutomationTriggerDefinition, ConfigPropertySchema, ConfigSchema, JsonPrimitive } from '@microsoft/agent-host-protocol';
import { localPath } from './fileuri.js';
import { durationMs } from './triggers.js';
import { WATCH_PRESETS } from './triggerpresets.js';
import type { Automation, AutomationEntry, AutomationRun, AutomationStore, StartSession } from './types/automations.js';
import type { Bag } from './types/common.js';
import type { PluginTriggers } from './types/plugin.js';
import type { SessionEventKind } from './types/triggers.js';
import { bag } from './values.js';

/**
 * The automations of a host that does not schedule.
 *
 * Deliberately half a store, and the half worth having first: definitions can
 * be written, patched, listed and *run*, and nothing here holds a clock. An
 * automation with a schedule trigger is accepted, kept and reported with no
 * `nextRunAt` - which is the honest form of "this host will not fire that",
 * and is what stops a client drawing a next-run time that will never arrive.
 *
 * Everything is in memory, so it goes when the process does. A store that
 * outlives a restart is a different implementation of the same interface, and
 * the reason the interface exists.
 */

const now = (): string => new Date().toISOString();

/** How many runs a summary list carries before it needs a cursor. */
const PAGE = 20;


/**
 * The eight things a session does that a rule may wake on.
 *
 * The ids are the host's own event kinds rather than the protocol's actions: a
 * rule is written against what a session did, and a client picks one of these
 * to put `on` to.
 */
const SESSION_EVENTS: { id: SessionEventKind; title: string; description: string }[] = [
  { id: 'turnCompleted', title: 'A turn finished', description: 'The last turn of the session ended well.' },
  { id: 'turnFailed', title: 'A turn failed', description: 'The last turn of the session ended with an error.' },
  { id: 'turnCancelled', title: 'A turn was cancelled', description: 'Somebody stopped the last turn.' },
  { id: 'toolCalled', title: 'A tool call finished', description: 'A tool call in the session finished.' },
  { id: 'toolFailed', title: 'A tool call failed', description: 'A tool call in the session failed.' },
  { id: 'messageQueued', title: 'A message was queued', description: 'A message waits behind the turn that is running.' },
  { id: 'idle', title: 'The session went idle', description: 'The last turn ended with nothing waiting behind it.' },
  { id: 'childFinished', title: 'A session it started finished', description: 'A session this one started went quiet, or was disposed of.' },
];

/**
 * Which sessions a rule looks at.
 *
 * One field per fact an event carries, because a rule may be written on any of
 * them and on nothing else: the host settles each one before an event is read,
 * so every field here is one this store can answer for.
 */
const FILTER_SCHEMA: ConfigPropertySchema = {
  type: 'object',
  title: 'Which sessions',
  description: 'Leave a field out and every session is looked at.',
  properties: {
    sessions: { type: 'array', title: 'Sessions', items: { type: 'string', title: 'Session' } },
    providers: { type: 'array', title: 'Providers', items: { type: 'string', title: 'Provider' } },
    owners: { type: 'array', title: 'Owners', items: { type: 'string', title: 'Owner' } },
    projects: { type: 'array', title: 'Projects', items: { type: 'string', title: 'Project' } },
    folders: { type: 'array', title: 'Folders', items: { type: 'string', title: 'Folder' } },
    automated: { type: 'boolean', title: 'Started by a run' },
  },
};

/** How many times the event has to happen, and how they are counted. */
const COUNT_SCHEMA: ConfigPropertySchema = {
  type: 'object',
  title: 'How many',
  description: 'Left out, one event is enough.',
  properties: {
    n: { type: 'number', title: 'Times', default: 1 },
    consecutive: { type: 'boolean', title: 'In a row', description: 'Only a run of them with nothing else in between.', default: false },
    within: { type: 'string', title: 'Within', description: 'A duration such as 30s, 5m or 2h.' },
    sameInput: { type: 'boolean', title: 'The same tool and input', description: 'Only calls of one tool with one input.', default: false },
  },
};

/** What has to follow the event for the rule to hold. */
const THEN_SCHEMA: ConfigPropertySchema = {
  type: 'object',
  title: 'Then',
  description: 'What has to happen after the event.',
  properties: {
    kind: {
      type: 'string',
      title: 'What follows',
      enum: ['event', 'idle', 'absent'],
      enumLabels: ['An event', 'Quiet', 'No event'],
    },
    event: { type: 'string', title: 'The event', enum: SESSION_EVENTS.map((one) => one.id) },
    within: { type: 'string', title: 'Within', description: 'How long the event has to arrive in, such as 30s, 5m or 2h.' },
    for: { type: 'string', title: 'For', description: 'How long the quiet or the absence has to hold, such as 30s, 5m or 2h.' },
  },
};

/**
 * What the session has to look like as the event arrives, or while it runs.
 *
 * `turnLongerThan` is the one of these nothing has to happen for: a rule whose
 * only condition is a turn's length is the host's own timer, and it fires
 * whether or not the turn ever says anything.
 */
const WHEN_SCHEMA: ConfigPropertySchema = {
  type: 'object',
  title: 'While the session is',
  properties: {
    running: { type: 'boolean', title: 'Running' },
    queuedAtLeast: { type: 'number', title: 'Messages waiting at least' },
    toolCallsAtLeast: { type: 'number', title: 'Tool calls at least' },
    turnLongerThan: { type: 'string', title: 'A turn longer than', description: 'A duration such as 30s, 5m or 2h.' },
  },
};

/** The rule a `session` trigger is configured with, which is the rule less `on`. */
const SESSION_RULE_SCHEMA: ConfigSchema = {
  type: 'object',
  properties: { filter: FILTER_SCHEMA, count: COUNT_SCHEMA, then: THEN_SCHEMA, when: WHEN_SCHEMA },
};

/**
 * The rule a `watch` trigger is configured with.
 *
 * One schema for the whole type, because the protocol has one per type rather
 * than one per event - so it carries every preset's numbers, and a preset
 * reads the ones that are its own.
 */
const WATCH_RULE_SCHEMA: ConfigSchema = {
  type: 'object',
  properties: {
    ...Object.fromEntries(WATCH_PRESETS.flatMap((one) => one.numbers.map((held) => [held.key, {
      type: 'number' as const,
      title: held.title,
      default: held.value,
    }]))),
    filter: FILTER_SCHEMA,
  },
};

/**
 * The two event trigger types this host lists.
 *
 * A host that understands an event trigger is telling a client that it will
 * fire one, so this is the whole of what ahpd wakes on: what a session does,
 * and the patterns somebody already thought about.
 */
export const EVENT_TRIGGERS: AutomationTriggerDefinition[] = [
  {
    type: 'session',
    title: 'What a session does',
    description: 'Wakes on one thing a session does, with a count, a follow-up or a state check around it.',
    events: SESSION_EVENTS,
    configSchema: SESSION_RULE_SCHEMA,
  },
  {
    type: 'watch',
    title: 'A pattern worth watching',
    description: 'Wakes on a pattern somebody already thought about, with its numbers left to you.',
    events: WATCH_PRESETS.map((one) => ({ id: one.id, title: one.title, description: one.description })),
    configSchema: WATCH_RULE_SCHEMA,
  },
];

/**
 * The trigger types this host lists beyond its own two.
 *
 * Taken from the plugins that registered them and listed exactly as each
 * registered it, because a client draws the same form from a plugin's type as
 * from `session` and `watch`. An automation may be saved with any of these
 * names, and one that names a type no plugin offers any more is a trigger this
 * host no longer fires.
 */
export const pluginTriggerTypes = (plugins?: readonly PluginTriggers[]): AutomationTriggerDefinition[] =>
  (plugins ?? []).flatMap((one) => Object.values(one.types));

/** The fields written as a duration rather than as a number or a word. */
const DURATIONS = new Set(['count.within', 'then.within', 'then.for', 'when.turnLongerThan']);

/** The fields written as a whole number of times. */
const COUNTED = new Set(['count.n']);

/**
 * The numbers a preset's own config carries.
 *
 * Every one of them counts something - minutes of quiet, times a call has
 * repeated, tool calls in a turn - so the least any of them may be asked for is
 * one. Zero is a preset that matches everything the moment it happens, which
 * is not a pattern worth watching, and a fraction of a minute of quiet is not
 * a length anybody meant.
 */
const PRESET_NUMBERS = new Set(WATCH_PRESETS.flatMap((one) => one.numbers.map((held) => held.key)));

/** What a value has to be, in the words a refusal uses. */
const wanted = (property: ConfigPropertySchema): string => {
  if (property.enum !== undefined) return `one of ${property.enum.map(String).join(', ')}`;
  if (property.type === 'array') return 'a list';
  if (property.type === 'number') return 'a number';
  if (property.type === 'boolean') return 'true or false';
  if (property.type === 'object') return 'an object';
  return 'text';
};

/** Whether a value is the kind the schema asks for. */
const holds = (value: unknown, property: ConfigPropertySchema): boolean => {
  if (property.type === 'array') return Array.isArray(value);
  if (property.type === 'object') return typeof value === 'object' && value !== null && !Array.isArray(value);
  if (property.type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (property.type === 'boolean') return typeof value === 'boolean';
  return typeof value === 'string';
};

/**
 * What is wrong with one config, as one sentence naming the field, or nothing.
 *
 * A field the schema does not name is refused rather than ignored, which is
 * the difference between a rule this host will fire and one it will quietly
 * never fire.
 */
const wrongIn = (value: Bag, schema: ConfigSchema, at = ''): string | undefined => {
  for (const [key, given] of Object.entries(value)) {
    const where = at === '' ? key : `${at}.${key}`;
    const property = schema.properties[key];
    if (property === undefined) return `${where} is not part of a rule here`;
    if (!holds(given, property)) return `${where} has to be ${wanted(property)}`;
    if (property.enum !== undefined && !property.enum.includes(given as JsonPrimitive)) {
      return `${where} has to be ${wanted(property)}`;
    }
    if ((COUNTED.has(where) || (at === '' && PRESET_NUMBERS.has(where)))
      && (!Number.isInteger(given) || (given as number) < 1)) {
      return `${where} has to be a whole number of 1 or more`;
    }
    if (DURATIONS.has(where) && durationMs(String(given)) === undefined) {
      return `${where} has to be a duration such as 30s, 5m or 2h`;
    }
    if (property.type === 'object') {
      const deeper = wrongIn(given as Bag, property as ConfigSchema, where);
      if (deeper !== undefined) return deeper;
    }
    if (property.type === 'array' && property.items !== undefined) {
      for (const one of given as unknown[]) {
        if (!holds(one, property.items)) return `${where} has to be a list of ${wanted(property.items)}`;
      }
    }
  }
  return undefined;
};

/**
 * Refuse a definition carrying an event trigger this store cannot honour.
 *
 * Thrown rather than answered, because that is how a write is refused on this
 * host: the client's dispatch fails with this sentence, and the catalogue it
 * reads back is the one it had. A trigger whose type this store does not list
 * is left alone - a plugin may register one, and until it does the host will
 * not fire it.
 */
const checkTriggers = (definition: Bag): void => {
  for (const raw of Array.isArray(definition.triggers) ? definition.triggers : []) {
    const trigger = bag(raw);
    if (trigger.kind !== 'event') continue;
    const type = EVENT_TRIGGERS.find((one) => one.type === trigger.type);
    if (type?.configSchema === undefined) continue;
    const wrong = wrongIn(bag(trigger.config), type.configSchema);
    if (wrong !== undefined) throw new Error(wrong);
    for (const chosen of Array.isArray(trigger.events) ? trigger.events : []) {
      const id = String(bag(chosen).id ?? '');
      if (!type.events.some((one) => one.id === id)) throw new Error(`${id} is not an event this host watches for`);
    }
  }
};

/**
 * Refuse a definition whose waking settings cannot both hold.
 *
 * A pinned automation runs in one chat, so a run for every event would be two
 * turns at once in the same place. Refused where it is written rather than
 * discovered when it fires, which is the difference between a setting a person
 * can correct and one that quietly did nothing.
 */
const checkWake = (definition: Bag): void => {
  const wake = bag(bag(definition._meta)['ahpd']);
  if (wake.session === 'pinned' && wake.overlap === 'parallel') {
    throw new Error('A pinned automation runs one turn at a time in its own chat, so overlap cannot be parallel');
  }
};

/** Whether a lifecycle has already ended, in the protocol's sense. */
const ended = (lifecycle: Bag): boolean =>
  lifecycle.status === 'completed' || lifecycle.status === 'failed' || lifecycle.status === 'cancelled';

export function memoryAutomations(): AutomationStore {
  const held = new Map<string, Automation>();
  /** Runs by automation, newest first. */
  const history = new Map<string, AutomationRun[]>();
  /**
   * How many of an automation's runs it shows.
   *
   * One count per automation rather than per connection, because the protocol
   * says every subscriber of the catalogue is kept synchronized: two clients
   * reading one automation read the same page, and one of them asking for an
   * older one is what moves it for both. A new run does not move this count,
   * so the newest runs stay in view and the oldest fall off the end.
   */
  const loaded = new Map<string, number>();
  /** Every run by its own URI, for the channel a client watches it on. */
  const byRun = new Map<string, AutomationRun>();
  const listeners: ((event: { automation?: string; run?: string; removed?: string }) => void)[] = [];
  const said = (event: { automation?: string; run?: string; removed?: string }): void => {
    for (const listener of listeners) listener(event);
  };

  /** The summary form of a run, which is what an automation carries. */
  const summary = (run: AutomationRun): Bag => ({
    resource: run.resource,
    automation: run.automation,
    origin: run.origin,
    lifecycle: run.lifecycle,
    sessionCount: run.sessions.length,
    ...(run.primarySession !== undefined ? { primarySession: run.primarySession } : {}),
    // What the host noted about it, under the key a run state carries too. A
    // run with nothing noted sends no `_meta` at all, which is every run of
    // every automation nothing dropped an event on.
    ...(run.notes === undefined ? {} : { _meta: { ...run.notes } }),
  });

  /** How many runs of one automation a client has been shown, newest first. */
  const shown = (resource: string): number =>
    Math.min(loaded.get(resource) ?? PAGE, (history.get(resource) ?? []).length);

  /** Rebuild the entry a client reads, so `runs` and `operations` are never stale. */
  const entry = (automation: Automation): AutomationEntry => {
    const enabled = automation.definition.enabled !== false;
    const { owner, ...rest } = automation;
    const runs = history.get(automation.resource) ?? [];
    const count = shown(automation.resource);
    return {
      ...rest,
      runs: runs.slice(0, count).map(summary),
      ...(count < runs.length ? { runsNextCursor: String(count) } : {}),
      // `run` only where it would do something. A disabled automation is one
      // somebody switched off, and offering the button anyway is a control
      // that argues with the switch beside it.
      operations: enabled ? ['update', 'remove', 'run'] : ['update', 'remove'],
      /*
       * Whose work this is, where a client can read it.
       *
       * The protocol declares `_meta` on an automation entry and no `owner`, so
       * a client that finds `owner` on the wire is finding something it has
       * no declaration to read. The value is the same one the store holds and
       * the host's gates read, under the key ahpd's other additions use.
       */
      ...(owner === undefined ? {} : { _meta: { 'ahpd.owner': owner } }),
    };
  };

  return {
    list: () => [...held.values()].map(entry),
    get: (resource) => {
      const found = held.get(resource);
      return found && entry(found);
    },

    /*
     * What this store understands: what a session does, and the presets.
     *
     * This command answers with *event* triggers. Schedule triggers are
     * protocol-defined and never listed here, and manual is not a trigger at
     * all - the protocol says an empty trigger list is what manual-only means.
     * So what a client draws the automation form from is exactly this list,
     * and a type that is not on it is one this host will not fire.
     */
    triggers: () => EVENT_TRIGGERS,

    create: (resource, definition, owner) => {
      checkTriggers(definition);
      checkWake(definition);
      const at = now();
      const made: Automation = {
        resource,
        definition,
        ...(owner === undefined ? {} : { owner }),
        runs: [],
        operations: [],
        createdAt: at,
        modifiedAt: at,
      };
      held.set(resource, made);
      said({ automation: resource });
      return entry(made);
    },

    update: (resource, changes) => {
      const found = held.get(resource);
      if (!found) return undefined;
      // Only a patch that carries triggers is a patch about them: an
      // automation written before this store checked anything is still
      // editable, and what it holds is refused the moment it is rewritten.
      if (changes.triggers !== undefined) checkTriggers(changes);
      // The waking settings are read together - what a run does about another
      // one is a question about both - so a patch touching either of them is
      // judged on what the definition would then say rather than on the patch.
      if (changes.triggers !== undefined || changes._meta !== undefined) {
        checkWake({ ...found.definition, ...changes });
      }
      // A patch: absent keys are left alone, which is the whole difference
      // between this and a write. A client sending the whole definition back
      // would otherwise revert whatever another client changed meanwhile.
      const after: Automation = {
        ...found,
        definition: { ...found.definition, ...changes },
        modifiedAt: now(),
      };
      held.set(resource, after);
      said({ automation: resource });
      return entry(after);
    },

    remove: (resource) => {
      if (!held.delete(resource)) return false;
      for (const run of history.get(resource) ?? []) byRun.delete(run.resource);
      history.delete(resource);
      loaded.delete(resource);
      said({ removed: resource });
      return true;
    },

    run: async (resource, origin, start) => {
      const found = held.get(resource);
      if (!found) return undefined;
      if (found.definition.enabled === false) return undefined;
      const template = (typeof found.definition.session === 'object' && found.definition.session !== null
        ? found.definition.session
        : {}) as Bag;
      const message = (typeof found.definition.message === 'object' && found.definition.message !== null
        ? found.definition.message
        : {}) as Bag;

      const run: AutomationRun = {
        resource: `ahp-automation-run:/${randomUUID()}`,
        automation: resource,
        /*
         * Whose work this is, whatever started it.
         *
         * Copied off the automation rather than off the origin, because the
         * manual origin is `{ kind: 'manual' }` and carries nobody - and a run
         * a colleague pressed is still the maker's work, since the thing that
         * runs at nine is the thing somebody wrote.
         */
        ...(found.owner === undefined ? {} : { owner: found.owner }),
        origin,
        lifecycle: { status: 'pending', createdAt: now() },
        sessions: [],
      };
      byRun.set(run.resource, run);
      const past = history.get(resource) ?? [];
      // Newest first, which is the order a client shows them in.
      history.set(resource, [run, ...past]);
      said({ automation: resource, run: run.resource });

      const directories = Array.isArray(template.workingDirectories) ? template.workingDirectories : [];
      const where = typeof directories[0] === 'string'
        ? localPath(directories[0] as string)
        : undefined;
      const options: StartSession = {
        ...(typeof template.provider === 'string' ? { provider: template.provider } : {}),
        ...(where !== undefined ? { workingDirectory: where } : {}),
        ...(typeof template.config === 'object' && template.config !== null
          ? { config: template.config as Record<string, string> }
          : {}),
        ...(template.model !== undefined ? { model: template.model } : {}),
        text: typeof message.text === 'string' ? message.text : String(found.definition.title ?? ''),
        origin: { kind: 'automation', automation: resource, run: run.resource },
        ...(found.owner === undefined ? {} : { owner: found.owner }),
      };

      /*
       * Running before the session is asked for.
       *
       * A backend can finish the turn it is given before `start` resolves -
       * the echo backend with no pace does exactly that - and a finished turn
       * is what settles this run. Marking it running first means that ending
       * finds a run with the `startedAt` the protocol requires, rather than a
       * `pending` one where a completed ending has to be refused. A terminal
       * lifecycle the ending produced is left alone below, so the start
       * resolving cannot reopen it.
       */
      run.lifecycle = { ...run.lifecycle, status: 'running', startedAt: now() };
      try {
        const session = await start(options);
        run.sessions = [session];
        run.primarySession = session;
      }
      catch (error) {
        // Failed, and why. A run that vanished would be indistinguishable from
        // one that never started. The protocol's failed lifecycle calls the
        // final timestamp `completedAt`, not `endedAt` - and no execution
        // began, so this carries no `startedAt`.
        run.lifecycle = {
          status: 'failed',
          createdAt: run.lifecycle.createdAt,
          completedAt: now(),
          error: { message: error instanceof Error ? error.message : String(error) },
        };
      }
      said({ automation: resource, run: run.resource });
      return run;
    },

    /*
     * The host has seen the turn this run was, and says how it ended.
     *
     * Handed over rather than derived because only the host sees a turn
     * finish, and this store is the only thing that owns the run. A terminal
     * lifecycle is left exactly as it is: a late event from a session the run
     * no longer holds must not reopen a finished run.
     */
    settle: (resource, ending) => {
      const run = byRun.get(resource);
      if (run === undefined) return false;
      if (ended(run.lifecycle)) return false;
      const startedAt = typeof run.lifecycle.startedAt === 'string' ? run.lifecycle.startedAt : undefined;
      // A completed run must carry `startedAt`, and a timestamp nobody
      // observed is worse than saying nothing moved. In practice a turn ending
      // means the run is `running` and has one.
      if (ending.status === 'completed' && startedAt === undefined) return false;
      run.lifecycle = {
        status: ending.status,
        createdAt: run.lifecycle.createdAt,
        ...(startedAt !== undefined ? { startedAt } : {}),
        completedAt: now(),
        ...(ending.status === 'failed'
          ? { error: ending.error ?? { message: 'The run failed' } }
          : {}),
      };
      said({ automation: run.automation, run: run.resource });
      return true;
    },

    /*
     * What the host decided about a run while it was going.
     *
     * Merged rather than replaced, because each note is about its own thing and
     * the host that writes the second one has no business knowing the first.
     * The run is announced afterwards, so a client watching it reads the count
     * as it grows.
     */
    note: (resource, notes) => {
      const run = byRun.get(resource);
      if (run === undefined) return false;
      run.notes = { ...run.notes, ...notes };
      said({ automation: run.automation, run: run.resource });
      return true;
    },

    runOf: (resource) => byRun.get(resource),

    unlink: (resource, session) => {
      const run = byRun.get(resource);
      if (run === undefined || !run.sessions.includes(session)) return false;
      run.sessions = run.sessions.filter((one) => one !== session);
      // The protocol says removing the primary clears it. A run pointing at a
      // session that is gone is a run a client opens onto nothing.
      if (run.primarySession === session) delete run.primarySession;
      said({ automation: run.automation, run: run.resource });
      return true;
    },

    /*
     * Bring one more page of an automation's runs into view.
     *
     * The page is not answered here, because the protocol does not carry one:
     * `FetchAutomationRunsResult` is empty, and what a client reads is the
     * automation's entry, on the catalogue it is already subscribed to. So this
     * grows what that entry holds and says the automation moved, and every
     * subscriber - the one that asked and every other - reads the longer list
     * off the same `automation/set`.
     *
     * The cursor is the entry's own `runsNextCursor` and nothing else, so a
     * client pages by reading what it was last shown rather than by counting
     * for itself. An omitted cursor is the page in view, which is how a client
     * catches up on runs it has not seen; anything that is not the cursor this
     * store issued is refused rather than guessed at, because a page of new
     * runs for a question about old ones is a client that pages for ever
     * without noticing.
     */
    runs: (resource, cursor) => {
      const all = history.get(resource) ?? [];
      const count = shown(resource);
      if (cursor !== undefined && cursor !== String(count)) return false;
      if (count < all.length) {
        loaded.set(resource, Math.min(count + PAGE, all.length));
        said({ automation: resource });
      }
      return true;
    },

    onChanged: (observer) => { listeners.push(observer); },
  };
}
