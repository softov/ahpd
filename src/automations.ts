/** Automations held in memory, run when somebody asks. */

import { randomUUID } from 'node:crypto';
import type { Automation, AutomationRun, AutomationStore, StartSession } from './types/automations.js';
import type { Bag } from './types/common.js';

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

export function memoryAutomations(): AutomationStore {
  const held = new Map<string, Automation>();
  /** Runs by automation, newest first. */
  const history = new Map<string, AutomationRun[]>();
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
  });

  /** Rebuild the entry a client reads, so `runs` and `operations` are never stale. */
  const entry = (automation: Automation): Automation => {
    const enabled = automation.definition.enabled !== false;
    return {
      ...automation,
      runs: (history.get(automation.resource) ?? []).slice(0, PAGE).map(summary),
      ...((history.get(automation.resource) ?? []).length > PAGE
        ? { runsNextCursor: String(PAGE) }
        : {}),
      // `run` only where it would do something. A disabled automation is one
      // somebody switched off, and offering the button anyway is a control
      // that argues with the switch beside it.
      operations: enabled ? ['update', 'remove', 'run'] : ['update', 'remove'],
    };
  };

  return {
    list: () => [...held.values()].map(entry),
    get: (resource) => {
      const found = held.get(resource);
      return found && entry(found);
    },

    /*
     * What this store understands, which is one thing.
     *
     * No schedule trigger, because nothing here holds a clock - and saying so
     * is the point: a client reads this to decide which controls to draw, so a
     * store that advertised a cron trigger it would never fire would be asking
     * somebody to fill in a box that does nothing.
     */
    triggers: () => [{
      type: 'manual',
      title: 'Manually',
      description: 'Runs when somebody presses Run, and at no other time',
      events: [],
    }],

    create: (resource, definition) => {
      const at = now();
      const made: Automation = {
        resource,
        definition,
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
        ? (directories[0] as string).replace(/^file:\/\//, '')
        : undefined;
      const options: StartSession = {
        ...(typeof template.provider === 'string' ? { provider: template.provider } : {}),
        ...(where !== undefined ? { workingDirectory: where } : {}),
        ...(typeof template.config === 'object' && template.config !== null
          ? { config: template.config as Record<string, string> }
          : {}),
        text: typeof message.text === 'string' ? message.text : String(found.definition.title ?? ''),
      };

      try {
        const session = await start(options);
        run.sessions = [session];
        run.primarySession = session;
        run.lifecycle = { ...run.lifecycle, status: 'running', startedAt: now() };
      }
      catch (error) {
        // Failed, and why. A run that vanished would be indistinguishable from
        // one that never started.
        run.lifecycle = {
          ...run.lifecycle,
          status: 'failed',
          endedAt: now(),
          error: { message: error instanceof Error ? error.message : String(error) },
        };
      }
      said({ automation: resource, run: run.resource });
      return run;
    },

    runOf: (resource) => byRun.get(resource),

    runs: (resource, cursor) => {
      const all = history.get(resource) ?? [];
      const from = cursor === undefined ? 0 : Number(cursor);
      const at = Number.isFinite(from) && from >= 0 ? from : 0;
      const page = all.slice(at, at + PAGE);
      return {
        items: page.map(summary),
        ...(at + PAGE < all.length ? { nextCursor: String(at + PAGE) } : {}),
      };
    },

    onChanged: (observer) => { listeners.push(observer); },
  };
}
