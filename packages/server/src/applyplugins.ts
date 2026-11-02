import type { Agent, Alert, Host, HostHandlers, Loaded, Route } from '@ahpd/sdk';
import { specsIn } from './install.js';
import { sourceOf } from './plugins.js';
import type { Planned, PluginSet } from './plugins.js';

/**
 * What one live change did, for the caller that asked for it.
 *
 * `restart` is the only answer a client acts on: it means the change this call
 * was made for did not take, and the daemon has to be restarted for it to.
 * A change that did take has `changed` set, and the host has already been given
 * the new fold by the time this is answered.
 */
export interface Applied {
  /** The daemon must restart before this change can take effect. */
  restart: boolean;
  /** A plugin was loaded, reloaded or unloaded. */
  changed: boolean;
  /** Everything that went wrong, in the order it was found. */
  problems: string[];
  /** Every plugin the daemon holds now, in load order. */
  loaded: Loaded[];
  /** The alerts each plugin's row carries, by id; a plugin with none has no entry. */
  alerts: Record<string, Alert[]>;
  /** The routes every plugin the daemon holds now registered. */
  routes: Record<string, Route>;
}

export interface ApplyPluginsOptions {
  /** The set the daemon started with, which this changes in place. */
  set: PluginSet;
  /** The configuration file the plugin list is read from. */
  configFile: string;
  /** The daemon loads no plugin at all, whatever the file names. */
  noPlugins?: boolean;
  /**
   * The host, for the fold to reach a daemon already serving.
   *
   * Read at the end rather than taken as a value, because the plugin channel is
   * built before the host is: a change cannot arrive before the host exists,
   * but the function that builds the channel is written before it.
   */
  host?(): Host | undefined;
  /** One line for each problem, as the daemon reports them. */
  log?(message: string): void;
  /**
   * The agents made from records, as the last fold took them.
   *
   * Folded in beside the plugins, so a change taken while the daemon runs hands
   * the host the whole list rather than dropping every stored agent for the
   * length of one plugin change. Read at the fold rather than taken as a value,
   * because a record made since the last load is in it.
   */
  records?(): readonly Agent[];
  /**
   * The plugins to import again, even though the file says what it said before.
   *
   * Each one is an id or a name the file keys the plugin by, as a person typed
   * it. A reload is the one change the file cannot show: the code a plugin
   * points at moved, and its entry did not, so comparing specs would find
   * nothing to do.
   */
  reload?: string[];
  /**
   * Called before a plugin this apply closes runs its closers, with the
   * handlers it registered: the daemon raises `stopping` to it here.
   */
  beforeUnload?(id: string, events: HostHandlers | undefined): Promise<void>;
  /**
   * Called for each plugin this apply loaded or reloaded and kept, once the
   * host holds the new fold: the daemon raises `listening` to it here.
   */
  afterLoad?(id: string, events: HostHandlers | undefined): Promise<void>;
}

/** Whether a contribution holds something the host cannot take on while it runs. */
const unfixable = (ports: object, providers: object): boolean =>
  Object.keys(ports).length > 0 || Object.keys(providers).length > 0;

/**
 * Bring the loaded plugins up to what the configuration file now says.
 *
 * The file is the only source: a plugin the file no longer names, or names with
 * `enabled: false`, is unloaded; one it names that is not loaded is loaded; one
 * it names with different options runs its closers and applies again, with the
 * module imported once already. A plugin the caller names to reload is imported
 * again from a URL of its own, because its entry did not change and its code
 * did. An unload ends every session that runs on an
 * agent the plugin registered, before the closers run, so no session outlives
 * the backend that answered it. A plugin that holds a port or a URI scheme is
 * never swapped this way, because the host was built over those and refuses a
 * fold that moves them: enabling, disabling or reconfiguring one answers
 * `restart: true` and leaves it as it was.
 *
 * Nothing here takes `oneAtATime`. Every caller that writes the file already
 * holds it - the channel, root config and the terminal all go through it - and
 * a second turn queued inside the first would wait on itself.
 */
/**
 * What the daemon does with a handler that threw at an event it raised.
 *
 * The line goes to `log`, and the plugin's row gets an `error` alert a person
 * can read. The `ref` is the event, so a second throw at it replaces the first.
 */
export const eventFailed = (set: PluginSet, log: (line: string) => void, type: 'listening' | 'stopping') => (line: string, by: string): void => {
  log(line);
  const when = type === 'listening' ? 'when ahpd started' : 'when ahpd stopped it';
  set.alert(by, { level: 'error', ref: `event:${type}`, text: `This plugin failed ${when}, and the ahpd log has the details.` });
};

export const applyPlugins = async (options: ApplyPluginsOptions): Promise<Applied> => {
  const { set } = options;
  const problems: string[] = [];
  let restart = false;
  let changed = false;
  /** The plugins this apply loaded or reloaded and kept, in load order. */
  const started: string[] = [];
  const trouble = (line: string): void => {
    problems.push(line);
    options.log?.(line);
  };

  if (options.noPlugins === true) {
    trouble('this daemon was started with --no-plugins, so it loads nothing; restart it without the flag to load a plugin');
    return { restart: true, changed: false, problems, loaded: set.loaded(), alerts: set.alerts(), routes: {} };
  }

  const planned = await set.plan(specsIn(options.configFile));
  for (const line of planned.problems) trouble(line);
  const asked = new Map<string, Planned>();
  for (const entry of planned.entries) if (!entry.disabled) asked.set(entry.id, entry);

  /*
   * The plugins to import again. A name matches the id the plugin loaded under
   * or the name the file keys it by, because a person types the one the file
   * shows and the two are not always the same word.
   */
  const forced = new Set(options.reload ?? []);
  const isForced = (entry: Planned): boolean => forced.has(entry.id) || forced.has(sourceOf(entry.spec));

  /**
   * End every session a plugin's agents serve, before the plugin goes.
   *
   * A session reads its backend through the agent, so an agent that goes with
   * its plugin leaves a session nothing can serve. The host is the only place
   * that knows which sessions run on one agent, which is why the call is its.
   */
  const endSessions = async (id: string): Promise<void> => {
    const held = set.held(id);
    const host = options.host?.();
    if (held === undefined || host === undefined) return;
    for (const agent of held.contribution.agents) await host.endSessionsOf(agent);
  };

  /*
   * Unload first, in the order the plugins loaded, so a plugin closed here is
   * already gone when a later one applies: a plugin that asks about the vault
   * or about the collections resolves against what is still held.
   */
  for (const one of set.loaded()) {
    if (asked.has(one.name)) continue;
    const held = set.held(one.name);
    if (held !== undefined && unfixable(held.contribution.ports, held.contribution.providers)) {
      trouble(`plugin ${one.name} holds a port or a URI scheme, which cannot be removed while the daemon runs; restart the daemon to unload it`);
      restart = true;
      continue;
    }
    await endSessions(one.name);
    if (held !== undefined) await options.beforeUnload?.(one.name, held.contribution.events);
    for (const line of await set.unload(one.name)) trouble(line);
    changed = true;
  }

  for (const [id, entry] of asked) {
    const held = set.held(id);
    const again = isForced(entry);
    if (held !== undefined) {
      // The same spec as when it loaded means the same options, so nothing moves
      // unless a reload asked for the code itself.
      if (!again && JSON.stringify(held.loaded.spec) === JSON.stringify(entry.spec)) continue;
      if (unfixable(held.contribution.ports, held.contribution.providers)) {
        trouble(again
          ? `plugin ${id} holds a port or a URI scheme, which cannot be reloaded while the daemon runs; restart the daemon to load its new code`
          : `plugin ${id} holds a port or a URI scheme, which cannot be reconfigured while the daemon runs; restart the daemon to apply its options`);
        restart = true;
        continue;
      }
      // A reload ends its agent's sessions too: the closers run before the next
      // `apply`, and a session running on one would hold an agent that moves.
      await endSessions(id);
      await options.beforeUnload?.(id, held.contribution.events);
      for (const line of await set.unload(id)) trouble(line);
    }
    // A reload imports a URL of its own, so the code as it is now is what runs.
    const staged = again ? await set.reload(entry) : await set.load(entry);
    for (const line of staged.problems) trouble(line);
    if (staged.contribution !== undefined && unfixable(staged.contribution.ports, staged.contribution.providers)) {
      // The host cannot take this fold, so the plugin goes back out: it is
      // loaded for the length of one fold, which is what a closer can reach.
      for (const line of await set.unload(id)) trouble(line);
      trouble(`plugin ${id} holds a port or a URI scheme, which cannot be added while the daemon runs; restart the daemon to load it`);
      restart = true;
      continue;
    }
    if (staged.loaded !== undefined) {
      changed = true;
      started.push(id);
    }
  }

  /*
   * A reload asked for by a name the file does not hold cannot happen, and one
   * asked for a plugin that is switched off has nothing to import: both are
   * said rather than answered with an apply that did nothing.
   *
   * A name the file does not hold is a package a plugin uses, whose code moved
   * with no entry to import again: only a restart makes that change take. A
   * plugin switched off is not running, so a restart would load nothing.
   */
  for (const word of forced) {
    const entry = planned.entries.find((one) => one.id === word || sourceOf(one.spec) === word);
    if (entry === undefined) {
      trouble(`plugin ${word} is not in ${options.configFile}, so there is nothing to reload; restart the daemon to load the code it names`);
      restart = true;
    }
    else if (entry.disabled) trouble(`plugin ${entry.id} is switched off, so there is nothing to reload; enable it first`);
  }

  const folded = set.fold([...(options.records?.() ?? [])]);
  for (const line of folded.problems) trouble(line);

  if (changed) {
    const refused = options.host?.()?.replace(folded.options);
    if (refused !== undefined) {
      // The host kept the fold it had. The set now holds plugins the host does
      // not serve, which is why the answer is a restart rather than another try.
      trouble(refused);
      restart = true;
    }
  }

  for (const id of started) {
    const held = set.held(id);
    if (held !== undefined) await options.afterLoad?.(id, held.contribution.events);
  }

  return { restart, changed, problems, loaded: set.loaded(), alerts: set.alerts(), routes: folded.routes };
};
