import { annotationsReducer, IS_CLIENT_DISPATCHABLE } from '@microsoft/agent-host-protocol';
import type { AnnotationsAction } from '@microsoft/agent-host-protocol';
import { idOf, Status } from '../catalog.js';
import { disableConditionsProblem } from '../automations.js';
import { localPath } from '../fileuri.js';
import { reason } from '../values.js';
import { computerNeeds, dispatchNeeds, ACTION_HOMES, ACTION_NEEDS, HOME_WORDS, PER_CONNECTION } from './gate.js';
import { chatUriFor, isRootChannel, MARKS, ROOT, toolCallOfSubagentChat, WORKER_ACTIONS } from './channels.js';
import { chatAction } from './chatactions.js';
import { HOSTS_OWN } from './common.js';
import { claimOf } from './terminals.js';
import type { HeldCopies, TemplatePlugin } from '../types/clientplugins.js';
import type { Bag } from '../types/common.js';
import type { Grant } from '../types/users.js';
import type { Origin } from './state.js';
import type { ConnectionContext, HostContext } from './context.js';

/**
 * The protocol's own answer to "may a client send this?", by action type.
 *
 * Widened from the generated exhaustive map, which is keyed by the action
 * types the package knows: a type read off the wire is a string and may be
 * none of them, and `undefined` there means "no such action" rather than
 * "host-only".
 */
const dispatchable = IS_CLIENT_DISPATCHABLE as Record<string, boolean | undefined>;

/**
 * What one client action does.
 */
export interface Actions {
  applyDispatch: (params: Record<string, unknown>, origin: Origin) => Promise<void> | undefined;
}

export function createActions(ctx: HostContext, conn: ConnectionContext): Actions {
  const { connection, tokensFor } = conn;
  const { refuse } = ctx;
  /*
   * Nothing here that the host rewrites after it is built: `advancedTools`,
   * `contributed`, `contributing` and `restartNeeded` change while this
   * connection is open - a config key is asked about, a plugin tool is
   * contributed - so they are read as `ctx.<name>` where they are used. Bound
   * here they would be the values from when the connection opened, and the
   * read that took one would say so only by being wrong.
   */
  const {
    agents, changed, channelKind, daemonKey, decided, declaresConfigKey,
    dir, dirOf, dispatch, first, homeOf, kept, learned, log, marks, marksOf, meantBy, names, options,
    ownerFor, owners, past, permitted, presence, relayed, restart, retool,
    rootConfig, served, sessionFor, sessions, starting, summaryMoved, terminals, toolDefinitions,
    value, waitingFor,
  } = ctx;

  /**
   * One client action, applied.
   *
   * Only the actions a client is *allowed* to originate: the rest are
   * this host telling clients what it did, and one arriving from a client
   * is a client lying about what happened. The protocol package carries
   * the authority - `IS_CLIENT_DISPATCHABLE` - and its own docstring says
   * servers should check it.
   *
   * Separate from the notification entry below only so the origin can be
   * held around the whole of it. `origin` is taken as an argument as well,
   * for the few sites that answer in a later turn of the event loop: a
   * config key the backend has to be asked about cannot read `applying`,
   * because by the time it answers that is nobody's.
   */
  const applyDispatch = (params: Record<string, unknown>, origin: Origin): Promise<void> | undefined => {
    const asked = String(params.channel ?? '');
    // Resolved before anything looks it up, so a client that talks to a
    // chat - or a session - under its own spelling drives the same one it
    // is watching rather than one nothing here has heard of.
    const channel = meantBy(asked);
    const action = (typeof params.action === 'object' && params.action !== null
      ? params.action
      : {}) as Record<string, unknown>;
    const type = String(action.type ?? '');
    /** Refuse this dispatch, in the words of whatever would not have it. */
    const no = (reason: string): void => refuse(connection.peer, channel, action, origin, reason);
    /*
     * The gate, for the half that arrives as a notification.
     *
     * The one at the dispatch boundary cannot reach this: a notification
     * carries no id, so it returns before the boundary and there is nowhere
     * to put a `-32007`. What it gets instead is the same `rejectionReason`
     * every other refused action gets, which is the only "no" this
     * direction has.
     *
     * First in the function, before the relayed watch below and before
     * anything is read or written, because every branch under here drives
     * something: `terminal/input` runs a command, `chat/turnStarted` runs a
     * model, `root/configChanged` changes a setting for everybody.
     *
     * A host with no user directory refuses nothing, exactly as at the
     * other boundary.
     */
    /*
     * An action only on the kind of channel it belongs on, spelt and
     * resolved, before the gate and before any handler: the handlers
     * below act on the action, and read a session's id out of whatever
     * channel it came on.
     */
    const family = ACTION_HOMES[type.slice(0, type.indexOf('/'))];
    if (family !== undefined) {
      const wrong = [asked, channel].find((one) => homeOf(one) !== family.home);
      if (wrong !== undefined) {
        no(`${wrong} is not ${HOME_WORDS[family.home]} here`);
        return;
      }
    }
    if (options.users !== undefined && connection.root !== true) {
      /*
       * What the action is, what the channel is spelt as and what it
       * resolves to, both because the handler below acts on the resolved
       * one, and what the channel itself needs: the strictest of them is
       * asked.
       *
       * On the root the channel's own answer is the whole of it, because it
       * is the only place that can read the action: a `root/configChanged`
       * setting nothing but this connection's own shell needs no grant at
       * all, which no operation can say on its own.
       */
      const onRoot = isRootChannel(asked) || isRootChannel(channel);
      const all = [...new Set([onRoot ? undefined : ACTION_NEEDS[type], dispatchNeeds(asked, channelKind(asked), action), dispatchNeeds(channel, channelKind(channel), action), computerNeeds(action)])]
        .filter((one): one is Grant => one !== undefined);
      const needed = all.find((one) => connection.principal !== undefined && !connection.principal.can(one)) ?? all[0];
      const needs = needed === undefined ? '' : ` needs ${needed}`;
      const who = connection.principal;
      if (who === undefined) {
        no(`Sign in to use this host: ${channel}${needs}`);
        return;
      }
      // Removed since they signed in: a sign-in again, not a role that
      // does not cover this.
      if (who.standing !== undefined && !who.standing()) {
        no(`Sign in to use this host: ${channel}${needs}`);
        return;
      }
      if (needed !== undefined && !who.can(needed)) {
        no(`${who.id} may not ${needed} here`);
        return;
      }
    }
    /*
     * Whether a client is allowed to originate this at all, asked of the
     * protocol rather than answered here.
     *
     * `IS_CLIENT_DISPATCHABLE` is exhaustive over `StateAction` and its
     * own docstring says servers should check it, so it grows with the
     * protocol and the switch below does not have to. Refused with its own
     * reason: a host-only action arriving from a client is a client
     * claiming something happened, which is not the same complaint as an
     * action this host has not got round to serving - and told apart only
     * here, because both used to fall into the one default.
     */
    /*
     * A watch this client itself keeps, whose reports this host relays.
     *
     * `resourceWatch/changed` is a host's to say - except on a watch over
     * a client's own resources, where that client is the only thing that
     * can see the files move: it was asked for the watch through
     * `createResourceWatch` and answered with the channel. Passed
     * straight through to whoever subscribed, and refused from anybody
     * else by the check below - a change to somebody else's files is not
     * a thing a third client may claim happened.
     */
    if (relayed.get(channel)?.owner === connection && type === 'resourceWatch/changed') {
      dispatch(channel, action, origin);
      return;
    }
    if (dispatchable[type] === false) {
      no(`${type} is this host's to say, not a client's`);
      return;
    }
    /*
     * A type the protocol says a client may send, and this host has not
     * classified.
     *
     * `ACTION_NEEDS` is checked against `IS_CLIENT_DISPATCHABLE` by the
     * staleness test, so a real one cannot reach here with the package
     * installed and the test run - but a type read off the wire is a
     * string, and one that names a client action from a newer protocol is
     * not in that map either. Refused rather than served to anybody
     * because the gate above has nothing to ask about it.
     */
    if (dispatchable[type] === true && ACTION_NEEDS[type] === undefined) {
      no(`${type} is not one this host serves`);
      return;
    }
    /*
     * A mark on a file, kept for whoever else is in the session.
     *
     * Reduced with the protocol's own `annotationsReducer` rather than
     * with five cases written here: every client applies its own dispatch
     * with that function, and a host that reduced the same action even
     * slightly differently would hand out a state its clients disagree
     * with. It returns the state it was given when the action names
     * something that is not there, which is what makes a no-op tellable
     * from a change - and a no-op echoed as though it had applied is a
     * client left holding an optimistic mark this host never kept.
     */
    if (type.startsWith('annotations/')) {
      if (!channel.endsWith(MARKS)) {
        no(`${type} belongs on a session's ${MARKS} channel, not ${channel}`);
        return;
      }
      // A mark on a session this host cannot open is a mark kept for a
      // harness that is not here: refusing by name is what tells a client
      // the row is waiting rather than gone.
      const marked = waitingFor(idOf(channel.slice(0, -MARKS.length)));
      if (marked !== undefined) {
        no(`${marked} is not loaded on this host`);
        return;
      }
      const id = idOf(channel.slice(0, -MARKS.length));
      const before = marksOf(id);
      const after = annotationsReducer(before, action as unknown as AnnotationsAction);
      if (after === before) {
        no(`${type} names an annotation this session does not have`);
        return;
      }
      marks.set(id, after);
      dispatch(channel, action);
      return;
    }
    /*
     * The client flags, which are the host's to keep.
     *
     * Answered before anything looks for a running session, because
     * these are the two actions that are *about* a session nobody has
     * opened: marking a row read, or filing it away, is what somebody
     * does from the catalogue - and starting an agent to record a bit
     * would start one per row scrolled past.
     */
    /*
     * Ticking a file off a diff, which belongs to no session's agent.
     *
     * Answered here for the same reason the flags below are: it is a
     * reader's bookkeeping about a changeset, it writes nothing to disk,
     * and it arrives on the changeset's own channel rather than a
     * session's. Review is deliberately not an *operation* - the
     * protocol has clients dispatch this and the server keep the flag.
     */
    /*
     * What a client wants of this host, kept and said back.
     *
     * On the root channel, so it belongs to no session and there is
     * nothing to look up. VS Code pushes this at connect and used to be
     * answered with `dispatchAction root/configChanged on unknown
     * ahp-root://` - the shell it asked for went nowhere, and every
     * terminal opened whatever `$SHELL` happened to be.
     */
    if (isRootChannel(channel) && type === 'root/configChanged') {
      const pushed = (typeof action.config === 'object' && action.config !== null
        ? action.config
        : {}) as Record<string, unknown>;
      /*
       * The keys nobody declares, taken out before anything is applied.
       *
       * A value with no property in the schema is one no client can draw a
       * control for, so keeping it would be reporting a setting that is not
       * one - the opposite of the reason a declared key this host does not act
       * on is kept. It is a log line rather than a refusal while any declared
       * key is left, because a client newer than this host sends its whole
       * patch at connect and one unknown key must not lose the other forty.
       *
       * A key is offered here whether or not this connection is *shown* it:
       * `seesConfig` decides what a connection reads, not what exists, and the
       * daemon's keys are the ones that difference is about.
       */
      const refused = Object.keys(pushed).filter((key) => !declaresConfigKey(key));
      if (Object.keys(pushed).length > 0 && refused.length === Object.keys(pushed).length) {
        // The path a refused daemon write takes: `behind` logs it and answers
        // the sender with this reason, and nobody else hears it.
        return Promise.reject(new Error(`root config does not declare ${refused.join(', ')}`));
      }
      if (refused.length > 0) log(`root config: refused ${refused.join(', ')}`);
      const config = Object.fromEntries(Object.entries(pushed).filter(([key]) => declaresConfigKey(key)));
      /*
       * A `changeWords` naming a backend this host cannot ask, refused before
       * anything is applied.
       *
       * The check is on what the root would hold after the write rather than
       * on what this push carries, so a client that sets the mode in one push
       * and the provider in the next is not refused for the gap between them.
       * A model mode with nothing named is left alone: the commit and the pull
       * request fall back to the session title and say why, which is a whole
       * answer, and a refusal there would make the mode unreachable in two
       * steps.
       *
       * A model is checked only when the host has a list for the provider. An
       * empty list means a harness nobody has signed into yet - the boot probe
       * keeps an empty list out - and accepting the name is the honest answer
       * when there is nothing to contradict it.
       */
      const words = { ...(action.replace === true ? {} : rootConfig.changeWords as Bag | undefined), ...config.changeWords as Bag | undefined };
      if (words.mode === 'model' && typeof words.provider === 'string') {
        if (!agents.has(words.provider))
          return Promise.reject(new Error(`root config names a provider this host does not serve: ${words.provider}`));
        const listed = learned.get(words.provider)?.models ?? [];
        if (typeof words.model === 'string' && listed.length > 0 && !listed.some((one) => one.id === words.model))
          return Promise.reject(new Error(`root config names a model ${words.provider} does not list: ${words.model}`));
      }
      /**
       * What the daemon's half answers for the keys that were written, put
       * in place of what the client sent.
       *
       * Empty until the write has said so, which is all it can be before:
       * the client's copy of a daemon key is what the client holds, not what
       * the daemon holds.
       */
      const said: Record<string, unknown> = {};
      /**
       * The host's own half, applied and echoed.
       *
       * Kept in `rootConfig` whatever the daemon's half does, so the wire
       * does not move for it: one echo, one replay entry, and `values` reads
       * back what was pushed exactly as the conformance suite pins it.
       */
      const apply = (): void => {
        /*
         * Kept twice, because the keys are two kinds.
         *
         * What changed is who *acts* on a key. `PER_CONNECTION` names the
         * person's - `defaultShell` today - and those are also written to
         * this connection, which is the only place anything reads them from
         * now. `rootConfig`'s copy is display state and nothing opens a shell
         * with it. So two people on one daemon each get their own, and the
         * paths with no connection in hand take the daemon's own shell and
         * nobody's preference at all.
         */
        const mine = Object.fromEntries(Object.entries(config).filter(([key]) => PER_CONNECTION.has(key)));
        /*
         * The host's half and the person's are kept; the daemon's are not.
         * A daemon key is the port's, and `rootState` answers it by asking
         * the port, so a copy kept here would be a second opinion - and
         * `rootState` shows this map to every connection, which would hand a
         * member a credential it has no schema for.
         */
        const ours = Object.fromEntries(Object.entries(config).filter(([key]) => !PER_CONNECTION.has(key) && !daemonKey(key)));
        const into = (target: Record<string, unknown>, from: Record<string, unknown>): void => {
          for (const [key, value] of Object.entries(from)) {
            // `undefined` is how a key is taken back, and JSON has no such
            // value - so a client saying so sends the key with a null.
            if (value === null || value === undefined) delete target[key];
            else target[key] = value;
          }
        };
        if (action.replace === true) {
          for (const key of Object.keys(rootConfig)) delete rootConfig[key];
          delete connection.config;
          delete connection.trustedFolders;
        }
        into(rootConfig, ours);
        if (Object.keys(mine).length > 0) into(connection.config ??= {}, mine);
        /*
         * A `workspaceTrust` push answers for every folder at once, so the
         * folders this window said yes to one at a time are behind it: a window
         * that has just said which folders it trusts is not still vouching for
         * one it answered about earlier. A pushed `null` takes the key back,
         * which is a new answer like any other and clears them too.
         */
        if (Object.prototype.hasOwnProperty.call(mine, 'workspaceTrust')) delete connection.trustedFolders;
        // What the echo carries, which is what a log line about it says too:
        // a value the daemon holds back is not a value the log may print.
        const echoConfig = { ...config, ...said };
        log(`root config: ${Object.entries(echoConfig).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join(', ') || '(nothing)'}`);
        /*
         * Said back whole, like every other action a client originates:
         * nothing in a client applies its own dispatch, and a second client
         * watching the root learns of it only from here.
         *
         * One envelope and one `serverSeq` for everybody, because the
         * sequence and the replay buffer are one per host. What each
         * connection reads in it is `seenBy`'s: the sender's
         * `PER_CONNECTION` keys reach only the sender, and the daemon's
         * keys go out as the port answered them rather than as this client
         * sent them, so a value the port holds back is not carried to the
         * second admin by the echo.
         */
        dispatch(ROOT, { ...action, config: echoConfig });
      };
      /*
       * The daemon's keys, which are not this host's to keep.
       *
       * They go to the port and nowhere else, and they are answered by
       * reading it rather than out of `rootConfig`, so a value a client
       * holds and a value the file holds are never two opinions. A key the
       * schema does not name never gets here: it was refused above, so what
       * the port is asked to write is a key it declared.
       *
       * Asked first, because it is the only half that can be refused: a
       * write is a file being read and written and a schema being held to,
       * and a client whose change never happened is told so rather than
       * echoed. `behind` turns the refusal into this one client's
       * `rejectionReason`, and the echo goes out only once it has answered.
       */
      const theirs = Object.fromEntries(Object.entries(config).filter(([key]) => daemonKey(key)));
      if (Object.keys(theirs).length === 0 || options.rootConfig === undefined) {
        apply();
        return;
      }
      const port = options.rootConfig;
      return Promise.resolve(port.write(theirs)).then(async (answer) => {
        if (answer.restartNeeded === true) ctx.restartNeeded = true;
        /*
         * Read back so the echo is what the daemon holds. The client sent
         * the credential in clear, and the echo is one envelope for every
         * connection that may read the settings, so carrying the sent value
         * out would undo the mask the port applies to everyone else - the
         * sender included, which is a form posting back what it was shown.
         */
        const held = await port.values();
        for (const key of Object.keys(theirs)) {
          if (Object.hasOwn(held, key)) said[key] = held[key];
        }
        apply();
        /*
         * `advancedTools` is a key of the host's own option as much as of
         * the daemon's, so the daemon's answer that it took hold is this
         * host's answer too: the tools are rebuilt and every session is
         * told and retooled now. The answer that said a restart is needed is
         * the daemon's to give, and this key is one it applies while it runs.
         */
        const asked = theirs['advancedTools'];
        if (typeof asked === 'boolean' && asked !== ctx.advancedTools) {
          ctx.advancedTools = asked;
          ctx.contributing = permitted(ctx.contributed);
          for (const uri of sessions.keys()) {
            dispatch(uri, { type: 'session/serverToolsChanged', tools: toolDefinitions(uri) });
            retool(uri);
          }
        }
        /*
         * And what closing a chat does, which is a key of the host's own option
         * too, and one the daemon applies while it runs. Nothing is rebuilt and
         * no session is told: the setting is read where a chat is dropped, so
         * every chat dropped from here on follows the value that was just set.
         */
        const closing = theirs['closedChats'];
        if ((closing === 'hidden' || closing === 'delete') && closing !== ctx.closedChats) ctx.closedChats = closing;
      });
    }
    if (type === 'changeset/filesReviewChanged') {
      const cut = channel.indexOf('/changeset/');
      const owner = cut > 0 ? channel.slice(0, cut) : '';
      const scope = cut > 0 ? channel.slice(cut + '/changeset/'.length) : '';
      const dir = owner === '' ? undefined : dirOf(owner);
      const files = Array.isArray(action.files)
        ? action.files.filter((one): one is string => typeof one === 'string')
        : [];
      const on = action.reviewed === true;
      if (dir === undefined || files.length === 0) {
        no(`${channel} is not a changeset, or no files were named`);
        return;
      }
      // Only when it moved. A client ticking a file already ticked would
      // otherwise have every other client redraw for nothing.
      if (options.changes?.review?.(dir, owner, scope, files, on) !== true) return;
      dispatch(channel, { type, files, reviewed: on });
      return;
    }

    /*
     * Somebody is here, and what they brought.
     *
     * Client-dispatchable and host-kept, which is the whole point: one
     * client says it once and every other client watching the session
     * learns of it, which is not something they could tell each other.
     * The id is this connection's own rather than whatever the action
     * carried - a client naming somebody else would be a client
     * announcing a presence that is not theirs.
     */
    /*
     * A client writing an automation, or patching one.
     *
     * Both are *requests* in the protocol's own spelling - the client
     * says what it wants and the host decides, then says what it
     * actually holds with `automation/set`. So neither of these echoes:
     * what goes out is the store's answer, which is not necessarily what
     * was asked for.
     *
     * A create is also where an automation learns whose work it is, from
     * this connection - and a patch never moves it, because a colleague
     * who edited the definition did not take it over.
     */
    if (type === 'automation/createRequested' || type === 'automation/updateRequested') {
      const store = options.automations;
      if (!store) { no(`${type} needs an automations store, and this host has none`); return; }
      const resource = String(action.resource ?? '');
      if (!resource.startsWith('ahp-automation:/')) {
        no(`${resource || 'That'} is not an automation URI`);
        return;
      }
      /*
       * What the definition says about disabling itself, refused before the
       * store is asked - a definition the host cannot honour is one it must not
       * keep, and a kind named twice is the protocol's own refusal. Read off
       * the definition for a create and off the patch for an update, so a
       * patch that says nothing about conditions is a patch about nothing.
       */
      const written = keyed(type === 'automation/createRequested' ? action.definition : action.changes);
      const problem = disableConditionsProblem(written['disableConditions']);
      if (problem !== undefined) { no(problem); return; }
      /*
       * Client plugins on the template, copied while the client that named
       * them is still here.
       *
       * A template names a plugin by the client's own URI and a run happens
       * with nobody connected, so the host copies each one now and the run
       * loads a path of this host's. That needs somewhere to put a copy, which
       * is exactly what the client plugins port is: a host with no port keeps
       * no client plugins anywhere, so it cannot honour a template naming one -
       * and it says that rather than keeping a definition whose every run
       * loads nothing.
       */
      const port = options.clientPlugins;
      const named = templatePlugins(keyed(written['session'])['customizations']);
      // A list with something in it is what cannot be honoured - an empty one
      // names no plugin, and a host that refuses it would be refusing a
      // template for saying it has none.
      if (named !== undefined && named.length > 0 && port === undefined) {
        no('This host does not load client plugins, so an automation cannot carry them');
        return;
      }
      /*
       * Nothing to copy. A patch that says nothing about plugins is a patch
       * about something else, so the copies this automation already has stay -
       * which is the `undefined` the store reads as "leave them alone". An
       * empty list is not that: it says the template has no plugins, so the
       * copies it had go with the last one.
       */
      if (named === undefined || port === undefined) {
        const kept = type === 'automation/createRequested'
          ? store.create(resource, withPinOf(resource, (action.definition ?? {}) as Bag), ownerFor(connection))
          : store.update(resource, withPinOf(resource, (action.changes ?? {}) as Bag));
        // `onChanged` is what dispatches. A store that told the host
        // nothing would be one whose own timers were invisible, so
        // everything goes out the same way.
        if (!kept) no(`No automation at ${resource}`);
        return;
      }
      /*
       * The copies are made before the store is asked, because a template
       * whose plugins would not copy is a write this host refuses whole: what
       * the client keeps is the automation it had, and not one whose every run
       * loads half of what its template names.
       */
      return (async (): Promise<void> => {
        let held: HeldCopies;
        try {
          held = await port.capture(connection.clientId, named);
        }
        catch (error) {
          no(reason(error));
          return;
        }
        /*
         * The copies are this write's until it has been stored or refused.
         * Another write's prune may run in between, and what it would find at
         * their names is a copy no automation names yet - which is what it
         * removes, and what would leave this entry pointing at nothing.
         */
        try {
          const made = type === 'automation/createRequested'
            ? store.create(resource, withPinOf(resource, (action.definition ?? {}) as Bag), ownerFor(connection), undefined, held.copies)
            : store.update(resource, withPinOf(resource, (action.changes ?? {}) as Bag), held.copies);
          if (!made) { no(`No automation at ${resource}`); return; }
          pruneCopies();
        }
        finally {
          held.release();
        }
      })();
    }

    /*
     * Forgetting one, which the client dispatches and the host checks.
     *
     * The protocol is precise about the order: a client may send this
     * "only while the target advertises `Remove`", and the host
     * "revalidates that operation before permanently deleting". So the
     * advertised list is checked here rather than trusted - a client
     * holding a stale catalogue would otherwise delete something this
     * host had since decided may not be deleted.
     */
    if (type === 'automation/removed') {
      const store = options.automations;
      const resource = String(action.resource ?? '');
      const found = store?.get(resource);
      // "Removing an unknown resource is a no-op."
      if (!store || !found) return;
      if (!found.operations.includes('remove')) {
        no(`${resource} does not offer remove`);
        return;
      }
      store.remove(resource);
      // And the copies its template named, which nothing names any more.
      pruneCopies();
      return;
    }

    if (type === 'automationRun/cancelRequested') {
      no('A run here is a session, and disposing it is how it stops');
      return;
    }

    if (type === 'session/activeClientSet') {
      // `titles` is keyed by the bare id, so the URI has to come off before
      // it is asked. Under the whole channel this never matched, and every
      // client announcing itself in a session read from a transcript - the
      // ordinary way one is opened - was dropped in silence. It became
      // audible only once dropping stopped being silent.
      /*
       * Known to this host, which is not the same as running here.
       *
       * `owners` is every session the catalogue has listed and every one
       * this host started; `titles` is only the ones whose transcript
       * somebody has opened. Asking `titles` turned away a client
       * announcing itself in a row `listSessions` had returned a moment
       * earlier - which is the ordinary case, because a client announces
       * itself when it opens a row rather than after reading it.
       */
      if (!sessions.has(channel) && !owners.has(channel)) {
        no(`${channel} is not a session here`);
        return;
      }
      // A session whose backend has ended takes no client into it, and says why.
      const running = sessions.get(channel);
      const over = running === undefined ? undefined : ctx.leadOf(running)?.ended?.();
      if (over !== undefined) {
        no(over);
        return;
      }
      const clientId = connection.clientId || 'anonymous';
      const carried = (typeof action.activeClient === 'object' && action.activeClient !== null
        ? action.activeClient
        : {}) as Bag;
      const activeClient: Bag = {
        ...carried,
        clientId,
        tools: Array.isArray(carried.tools) ? carried.tools : [],
      };
      const held = presence.get(idOf(channel)) ?? new Map<string, Bag>();
      presence.set(idOf(channel), held);
      /*
       * Saying again what this host already held is not a change.
       *
       * `serverSeq` advances with *state* and never with messages, and a
       * client reconciles what it contributes whenever the session state
       * moves. So an echo of an announcement that changed nothing was
       * itself the change that prompted the next announcement, and the two
       * of us ran that loop three hundred times in a few seconds, burning
       * a sequence number apiece. The guard `isReadChanged` has below is
       * the same guard, and this is the same reason for it.
       */
      if (JSON.stringify(held.get(clientId)) === JSON.stringify(activeClient))
        return;
      // Re-announcing is how a client refreshes what it contributes, so
      // this replaces rather than merges - a tool taken away has to be
      // able to go.
      held.set(clientId, activeClient);
      dispatch(channel, { type, activeClient });
      // What it says it can run is a change to what the model is offered,
      // which is the whole point of the field: announced and never read,
      // `tools` was a list this host published back at the client that
      // sent it.
      retool(channel);
      return;
    }

    if (type === 'session/isReadChanged' || type === 'session/isArchivedChanged') {
      const uri = sessionFor(channel);
      const bit = type === 'session/isReadChanged' ? Status.IsRead : Status.IsArchived;
      const on = type === 'session/isReadChanged'
        ? action.isRead === true
        : action.isArchived === true;
      const before = kept.flags(idOf(uri));
      const after = on ? before | bit : before & ~bit;
      if (after === before)
        return;
      kept.setFlags(idOf(uri), after);
      // Every client watching, and the catalogue: a flag one client sets
      // is a flag the others have to see, which is what having a host
      // for this buys over each client keeping its own.
      dispatch(uri, action);
      summaryMoved(uri);
      return;
    }
    const terminal = terminals.get(channel);
    if (terminal) {
      switch (type) {
        /*
         * Input is side-effect only.
         *
         * The reducer changes nothing on it - what comes back is
         * `terminal/data`, once the shell has actually said something.
         * Echoing it here would print every keystroke twice on the
         * client that typed it and once on the ones that did not.
         */
        case 'terminal/input':
          terminal.write(String(action.data ?? ''));
          break;
        case 'terminal/resized':
          terminal.resize(Number(action.cols ?? 80), Number(action.rows ?? 24));
          break;
        case 'terminal/cleared':
          terminal.clear();
          break;
        case 'terminal/titleChanged':
          terminal.setTitle(String(action.title ?? ''));
          break;
        case 'terminal/claimed': {
          // A notification, so a malformed one is dropped rather than
          // refused - and dropped is right: the alternative was setting
          // the claim to `{}`, which told every other client that
          // nobody owned it.
          const claimed = claimOf(action.claim);
          if (claimed) terminal.setClaim(claimed);
          break;
        }
        default:
          no(`${type} is not served on a terminal`);
      }
      return;
    }
    return chatAction(ctx, conn, params, channel, action, type, origin, no);
  };

  /** The value as a keyed object, or an empty one where it is not. */
  const keyed = (value: unknown): Bag => (typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Bag
    : {});

  /**
   * The client plugins a template names, in the shape the port is handed them.
   *
   * Nothing where the template says nothing about plugins, which is not the
   * same as an empty list: a create that mentions none has none, while a patch
   * that mentions none is a patch about something else and leaves this
   * automation's copies where they are.
   *
   * Every entry of a list that *is* there is kept, even a malformed one, so
   * that the check for a usable id is the port's and answers in its own words -
   * dropping one here would be this host quietly storing a template it cannot
   * honour.
   */
  const templatePlugins = (value: unknown): TemplatePlugin[] | undefined => {
    if (!Array.isArray(value)) return undefined;
    return value.map((one) => {
      const held = keyed(one);
      return {
        id: typeof held.id === 'string' ? held.id : '',
        uri: typeof held.uri === 'string' ? held.uri : '',
        ...(typeof held.name === 'string' ? { name: held.name } : {}),
        ...(typeof held.nonce === 'string' ? { nonce: held.nonce } : {}),
      };
    });
  };

  /**
   * Remove the copies of a template's plugins that nothing names any more.
   *
   * Called after a write and after a removal, which are the two ways a copy
   * stops being one an automation names: a template that dropped a plugin, and
   * an automation that went. What is kept is what the automations this host
   * holds still reference, read back off them rather than remembered here - a
   * host that restarted holds the same answer.
   */
  const pruneCopies = (): void => {
    const port = options.clientPlugins;
    if (port === undefined) return;
    const kept = (options.automations?.list() ?? [])
      .flatMap((one) => (one.customizations ?? []).map((copy) => localPath(copy.uri)));
    port.prune(kept);
  };

  /**
   * A definition a client wrote, with the host's own chat kept where it is.
   *
   * Which chat a pinned automation works in rides in `_meta.ahpd.pinnedSession`
   * and is written by the host alone, so a client writing it would be a client
   * choosing a chat for somebody else's automation - and the run that follows
   * begins a turn there. So the value a client sends is dropped, and the one
   * the store already holds is put back: a patch that says nothing about waking
   * leaves the pin alone, exactly as it leaves every key it does not mention.
   */
  const withPinOf = (resource: string, given: Bag): Bag => {
    const meta = given['_meta'];
    const written = keyed(meta)['ahpd'];
    if (typeof written !== 'object' || written === null || Array.isArray(written)) return given;
    const pin = keyed(keyed(options.automations?.get(resource)?.definition['_meta'])['ahpd'])['pinnedSession'];
    const ahpd = { ...written as Bag };
    delete ahpd['pinnedSession'];
    if (typeof pin === 'string') ahpd['pinnedSession'] = pin;
    return { ...given, _meta: { ...meta as Bag, ahpd } };
  };

  return { applyDispatch };
}
