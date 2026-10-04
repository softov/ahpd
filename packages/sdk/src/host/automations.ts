import { computerSource } from '../computers.js';
import { Status } from '../catalog.js';
import { RpcError } from '../rpc.js';
import { AUTOMATIONS, chatUriFor } from './channels.js';
import { CLOSING } from './common.js';
import { refusalReason } from './gate.js';
import type { Bag } from '../types/common.js';
import type { AutomationRun, AutomationRunState, RunEnding, StartSession } from '../types/automations.js';
import type { HostContext } from './context.js';

/**
 * The run state a client reads on the run's own channel.
 *
 * The stored record less `owner`, under the key an automation entry carries
 * the same value on: the protocol declares `_meta` on a run state and no
 * `owner`, so a client that found one would be reading a field it has no
 * declaration for. Nothing here is lost to the host - the gates that check an
 * owner before a run starts read it off the record the store holds.
 */
export const runState = ({ owner, ...rest }: AutomationRun): AutomationRunState => ({
  ...rest,
  ...(owner === undefined ? {} : { _meta: { 'ahpd.owner': owner } }),
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
  /** Say an automation moved, on whichever channel is about it. */
  changed(event: { automation?: string; run?: string; removed?: string }): void;
  /** What a store is handed when a run starts, however it started. */
  beginAutomation(wanted: StartSession): Promise<string>;
  /** `beginAutomation`, refused once the host is closing, and held while it runs. */
  startForAutomation(wanted: StartSession): Promise<string>;
  /** The clock, wired to the only thing that can act on it. */
  due(event: { automation: string; origin: Bag }): void;
}

export function createAutomations(ctx: HostContext): Automations {
  const {
    options, sessions, byChat, senders, charged, first, origins,
    dispatch, log, fire, statusOf, principalFor, admitted, placedIn,
    isolated, settle, openSession, backendsOwn, modelIn, unheld, forWhom,
  } = ctx;

  /** The sessions each run was last announced as having, by run URI. */
  const linked = new Map<string, string[]>();

  /**
   * Move the run a session belongs to, when that session stops working.
   *
   * Only when nothing else of the run is still busy: the protocol says a run
   * stays `running` while any linked session executes or awaits a person, so
   * one session finishing is not the run finishing.
   */
  const settleRun = (uri: string, ending: RunEnding): void => {
    const from = origins.get(uri);
    if (from === undefined) return;
    const run = options.automations?.runOf?.(from.run);
    if (run === undefined) return;
    const busy = run.sessions.some((one) => one !== uri && sessions.has(one)
      && (statusOf(one) & (Status.InProgress | Status.InputNeeded)) !== 0);
    if (busy) return;
    options.automations?.settle?.(from.run, ending);
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
      dispatch(AUTOMATIONS, { type: 'automation/removed', resource: event.removed });
      return;
    }
    if (event.automation !== undefined) {
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
   * What a store is handed when a run starts, however it started.
   *
   * The session *and* the first message: a session created and never spoken to
   * is a session that does nothing, and the whole point of an automation is
   * that nobody is at the keyboard to say the first thing.
   */
  const beginAutomation = async (wanted: StartSession): Promise<string> => {
    const provider = wanted.provider ?? first.provider;
    // Held under its provider's name, as a client's `createSession` is.
    const uri = `${provider}:/${crypto.randomUUID()}`;
    unheld(uri);
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
     * one place - decision
     * `a-machine-made-for-a-session-counts-against-max-and-needs-computer-write`.
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
    openSession(
      uri,
      provider,
      backendsOwn(config),
      where,
      wanted.origin,
      undefined,
      undefined,
      undefined,
      forWhom(wanted.owner),
    );
    // The only place that knows a session was started by a clock rather than a
    // person, and the run it belongs to.
    if (wanted.origin !== undefined) {
      void fire({ type: 'automation_fire', automation: wanted.origin.automation, run: wanted.origin.run });
    }
    const chatUri = chatUriFor(uri);
    // The first turn is sent by whoever made the automation, whoever pressed
    // the button or whose clock came round - and by nobody at all where the
    // automation names no owner, which is the absence this host already knows
    // how to answer for.
    const turnId = crypto.randomUUID();
    if (wanted.owner !== undefined) senders.set(turnId, wanted.owner);
    byChat.get(chatUri)?.chat.begin(turnId, wanted.text, modelIn(wanted.model), { origin: { kind: 'automation' } });
    return uri;
  };

  /**
   * `beginAutomation`, refused once the host is closing, and held in
   * `starting` while it runs so a close waits for it as it waits for a session.
   */
  const startForAutomation = (wanted: StartSession): Promise<string> => {
    if (ctx.closed) return Promise.reject(new Error(CLOSING));
    const run = beginAutomation(wanted);
    ctx.starting.add(run);
    const done = (): void => { ctx.starting.delete(run); };
    run.then(done, done);
    return run;
  };

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
    void (async () => {
      try {
        const run = await options.automations?.run(automation, origin, startForAutomation);
        log(run
          ? `${automation} was due and started ${run.primarySession ?? run.resource}`
          : `${automation} was due and is switched off or gone`);
      }
      catch (error) {
        log(`${automation} was due and failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    })();
  };

  return { linked, settleRun, changed, beginAutomation, startForAutomation, due };
}