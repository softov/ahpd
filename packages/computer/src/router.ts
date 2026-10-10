/**
 * Which runtime a machine id names, and the runtime that answers for it.
 *
 * One plugin serves every runtime a host was configured with, because a host
 * has one `computers` port - decision
 * `a-machine-runtime-is-named-for-its-maker`. So a machine's id says which
 * runtime made it, and this is the only place that spelling is known: nothing
 * else in the package splits an id on a dot.
 *
 * For now an id is `<runtime>.<name>`, and the local Docker keeps a bare name
 * so no machine made before this changes id. The spelling is here so it can
 * change here, and the machines an operator already has keep their names when
 * it does not.
 *
 * `ssh:dev86` is not the spelling, because a `computer:` URI is read by
 * `new URL`, which takes the colon for a port and refuses the URI.
 */

import type { ComputerRuntime } from './runtime.js';

/** The runtime a machine with a bare name is on: the Docker on this host. */
export const BARE = 'docker';

/**
 * The id a machine on `runtime` is named by.
 *
 * The bare runtime keeps the name alone, so the ids a host already lists are
 * the ids it lists afterwards.
 */
export const spellMachineId = (runtime: string, name: string): string =>
  (runtime === BARE ? name : `${runtime}.${name}`);

/**
 * The runtime an id names, and the name alone.
 *
 * The first dot separates them, so a name may hold dots of its own and a
 * runtime value may not: a value with a dot in it would be read as a name's
 * first part, and a machine made on it could not be addressed again. An id with
 * no dot is a machine on the bare runtime, which is every machine this host
 * made before there was more than one.
 */
export const parseMachineId = (id: string): { runtime: string; name: string } => {
  const at = id.indexOf('.');
  if (at <= 0) return { runtime: BARE, name: id };
  return { runtime: id.slice(0, at), name: id.slice(at + 1) };
};

/** How long one runtime's listing is given before it is cut off, in milliseconds. */
const LIST_TIMEOUT = 10_000;

/** What a routed runtime may be given beside the runtimes it serves. */
export interface RoutedOptions {
  /** Lines worth keeping: one per runtime whose listing threw or ran out of time. */
  log?: (line: string) => void;
  /** How long one runtime's listing is given before it is cut off, in milliseconds. */
  listTimeout?: number;
}

/** A runtime that serves several, picked by the id each call carries. */
export interface Routed extends ComputerRuntime {
  /** The runtimes it serves, by the value that prefixes their ids. */
  readonly runtimes: Record<string, ComputerRuntime>;
  /** The runtime one id names, or nothing when this host serves no runtime of that value. */
  runtimeFor(id: string): ComputerRuntime | undefined;
}

const reasonOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * A runtime's listing, or a refusal when it has not answered in time.
 *
 * A runtime whose program hangs - an `ssh` waiting on a password, a Docker
 * talking to a daemon that is not there - answers nothing forever, and a
 * listing that never ends is a daemon whose startup never ends either.
 */
const bounded = <T>(work: Promise<T>, ms: number, value: string): Promise<T> => new Promise((resolve, reject) => {
  const timer = setTimeout(() => { reject(new Error(`the ${value} runtime did not answer within ${ms}ms`)); }, ms);
  // A timer nobody is waiting on is not a reason for the process to stay up.
  (timer as { unref?: () => void }).unref?.();
  work.then(
    (answer) => { clearTimeout(timer); resolve(answer); },
    (error: unknown) => { clearTimeout(timer); reject(error); },
  );
});

/**
 * One runtime per value this host serves, with every call sent by the id it
 * carries.
 *
 * `fallback` is the value a create that names none goes to, and it is what
 * `kind` reports: a caller that knows only one runtime asks the plugin for one
 * and is answered as it always was.
 */
export const routed = (
  runtimes: Record<string, ComputerRuntime>,
  fallback: string,
  options: RoutedOptions = {},
): Routed => {
  const timeout = options.listTimeout ?? LIST_TIMEOUT;
  const served = Object.keys(runtimes);

  /** The runtime and the name alone, or a refusal naming what this host serves. */
  const must = (id: string): { runtime: ComputerRuntime; name: string } => {
    const { runtime, name } = parseMachineId(id);
    const held = runtimes[runtime];
    if (held === undefined) {
      throw new Error(`${id} names a machine on the ${runtime} runtime, and this host serves ${served.join(', ')}`);
    }
    return { runtime: held, name };
  };

  /**
   * One runtime's own answer about one id, or nothing when none here serves it.
   *
   * The shape the three answers that mean "there is no such machine" are given
   * in: `undefined` is that answer, and a runtime that cannot be reached at all
   * still throws its own sentence through.
   */
  const about = <T>(
    id: string,
    ask: (runtime: ComputerRuntime, name: string) => Promise<T>,
  ): Promise<T | undefined> => {
    const { runtime, name } = parseMachineId(id);
    const held = runtimes[runtime];
    return held === undefined ? Promise.resolve(undefined) : ask(held, name);
  };

  /** The runtime a create goes to, which is the value this host is configured with. */
  const maker = (): ComputerRuntime => {
    const held = runtimes[fallback];
    if (held === undefined) {
      throw new Error(`This host serves ${served.join(', ')} and no ${fallback}, so no machine is made`);
    }
    return held;
  };

  return {
    kind: fallback,

    /*
     * The fallback runtime's own answer, and never a machine's: a router that
     * serves one Docker and several boxes is not itself a box. A caller asking
     * about one machine asks `runtimeFor(id)`.
     */
    remote: runtimes[fallback]?.remote ?? false,

    runtimes,
    runtimeFor: (id) => runtimes[parseMachineId(id).runtime],

    /*
     * Every runtime's machines, each under the id its own runtime spells.
     *
     * `allSettled` and a bound per runtime, because one runtime that does not
     * answer is not an empty host: Docker's `list` throws by design when Docker
     * is not running, and a host that also serves a box over ssh would
     * otherwise list nothing at all. The rows of every runtime that answered
     * are kept, and each that did not is one line naming it.
     */
    list: async () => {
      const answers = await Promise.all(Object.entries(runtimes).map(async ([value, runtime]) => {
        try {
          return { value, rows: await bounded(runtime.list(), timeout, value) };
        }
        catch (error) {
          options.log?.(`the ${value} runtime did not list its machines, so they are left out: ${reasonOf(error)}`);
          return undefined;
        }
      }));
      return answers.flatMap((one) => (one === undefined
        ? []
        : one.rows.map((row) => ({ ...row, id: spellMachineId(one.value, row.id) }))));
    },

    inspect: (id) => about(id, (runtime, name) => runtime.inspect(name)),
    how: (id, asked) => about(id, (runtime, name) => runtime.how(name, asked)),
    hostCommand: (id) => about(id, (runtime, name) => runtime.hostCommand(name)),
    bringBack: (id) => about(id, (runtime, name) => runtime.bringBack(name)),
    stats: (id) => about(id, (runtime, name) => runtime.stats(name)),

    /*
     * A machine is made on the runtime this host is configured with, under the
     * id that runtime spells its name into.
     *
     * A name on the bare runtime is the whole id, so a dot in it would be read
     * as another runtime's id - here, and by whatever a client hands back. It
     * is refused at this one moment, where a name becomes an id, rather than
     * made into a machine no caller can address again.
     */
    run: async (spec) => {
      const held = maker();
      if (fallback === BARE && spec.name.includes('.')) {
        throw new Error(`${spec.name} is not a name for a machine on this host: a dot in it reads as another runtime's, and these machines are addressed by their name alone`);
      }
      const made = await held.run(spec);
      return { ...made, id: spellMachineId(fallback, made.id) };
    },

    stop: async (id) => { const { runtime, name } = must(id); await runtime.stop(name); },
    start: async (id) => { const { runtime, name } = must(id); await runtime.start(name); },
    restart: async (id) => { const { runtime, name } = must(id); await runtime.restart(name); },
    remove: async (id) => { const { runtime, name } = must(id); await runtime.remove(name); },
    exec: async (id, command, env, provider) => {
      const { runtime, name } = must(id);
      return runtime.exec(name, command, env, provider);
    },
    putIn: async (id, paths) => { const { runtime, name } = must(id); await runtime.putIn(name, paths); },
    takeOut: async (id, paths) => { const { runtime, name } = must(id); await runtime.takeOut(name, paths); },
    follow: async (id) => { const { runtime, name } = must(id); await runtime.follow(name); },

    // What this host can be asked for is the default runtime's own answer: a
    // client reading it is deciding whether to make a machine, and a machine is
    // made on that runtime.
    capabilities: () => maker().capabilities(),

    // Images are this host's own either way: a part is built here and mounted
    // into a machine, so both verbs are the default runtime's.
    hasImage: (tag) => maker().hasImage(tag),
    buildImage: (tag, context) => maker().buildImage(tag, context),
  };
};
