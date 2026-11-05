import { annotationsReducer, IS_CLIENT_DISPATCHABLE } from '@microsoft/agent-host-protocol';
import type { AnnotationsAction } from '@microsoft/agent-host-protocol';
import { idOf, Status } from '../sessions/catalog.js';
import { disableConditionsProblem } from '../automations/automations.js';
import { localPath } from '../resources/fileuri.js';
import { reason } from '../utils/values.js';
import { computerNeeds, dispatchNeeds, ACTION_HOMES, ACTION_NEEDS, HOME_WORDS, ownIn } from './gate.js';
import { chatUriFor, isRootChannel, MARKS, ROOT, schemeOf, spaceOf, toolCallOfSubagentChat, WORKER_ACTIONS } from './channels.js';
import { chatAction, chatFlag, readAggregate, sessionFlag } from './chatactions.js';
import { HOSTS_OWN } from './common.js';
import { AUTO_ARCHIVE_KEY, AUTO_DELETE_KEY } from './merged.js';
import { RESTART_KEY } from './root.js';
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
    agents, byChat, cancelRun, changed, changesetAt, channelKind, daemonKey, decided, declaresConfigKey,
    dir, dispatch, homeId, homeOf, kept, learned, log, marks, marksOf, meantBy, names, options,
    ownerFor, owners, past, permitted, presence, relayed, restart, retool,
    rootConfig, served, sessionFor, sessions, shown, starting, subagents, summaryMoved, terminals, toolDefinitions,
    value, waitingFor,
  } = ctx;
  /**
   * Whether this host knows a session: running, listed in the catalogue, or
   * recorded in the store as one it started. A session the catalogue finds
   * when it is read is listed by that read.
   */
  const knownSession = (uri: string): boolean => sessions.has(uri) || owners.has(uri) || kept.provider(idOf(uri)) !== undefined;

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
    // Resolved before anything looks it up, so the root and the automations
    // catalogue under another spelling are the channels they name.
    const channel = meantBy(asked);
    const action = (typeof params.action === 'object' && params.action !== null
      ? params.action
      : {}) as Record<string, unknown>;
    const type = String(action.type ?? '');
    /** Refuse this dispatch, in the words of whatever would not have it. */
    const no = (reason: string): void => refuse(connection.peer, channel, action, origin, reason);
    /*
     * A plugin channel has one writer, its plugin, so a client's action on
     * one is refused before anything reads it - and on an `x-` scheme no
     * plugin serves, before it can be read for a session.
     */
    if (spaceOf(asked) === 'plugin' || spaceOf(channel) === 'plugin') {
      no(`${type || 'An action'} is ${asked}'s plugin's to say, not a client's`);
      return;
    }
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
    const family = ownIn(ACTION_HOMES, type.slice(0, type.indexOf('/')));
    if (family !== undefined) {
      const wrong = [asked, channel].find((one) => homeOf(one) !== family.home);
      if (wrong !== undefined) {
        no(`${wrong} is not ${HOME_WORDS[family.home]} here`);
        return;
      }
    }
    /*
     * A chat's action on a chat's channel: "Actions travel on the channel
     * named by their prefix". A client holds what it sent pending on the
     * subscription it sent it on, and is answered there, so a chat's action
     * sent on a session's channel is one this host could only answer on a
     * chat where that client is not waiting. Input addressed to a session as a
     * whole is the client's to send to the session's default chat.
     * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/guide/actions.md#L54
     * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/guide/reconciliation.md#L7-L11
     * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/specification/chat-channel.md#L82
     */
    if (type.startsWith('chat/') && schemeOf(asked) !== 'ahp-chat' && schemeOf(channel) !== 'ahp-chat') {
      no(`${type} is a chat's action, and ${asked} is not a chat`);
      return;
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
       * naming only `workspaceTrust` needs `trust:push`, and one naming no
       * key needs no grant at all, which no operation can say on its own.
       */
      const onRoot = isRootChannel(asked) || isRootChannel(channel);
      const all = [...new Set([onRoot ? undefined : ownIn(ACTION_NEEDS, type), dispatchNeeds(asked, channelKind(asked), action), dispatchNeeds(channel, channelKind(channel), action), computerNeeds(action)])]
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
    /*
     * A type the protocol does not let a client send, a type it does not know
     * included, and the two chat folder actions no host serves, refused in the
     * reference host's words before anything reads them.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/protocolServerHandler.ts#L2811-L2815
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/protocolServerHandler.ts#L139-L142
     */
    if (ownIn(dispatchable, type) !== true) {
      no(`Server-only action: ${type}`);
      return;
    }
    if (type === 'chat/workingDirectorySet' || type === 'chat/workingDirectoryRemoved') {
      no(`Unsupported action: ${type}`);
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
    if (ownIn(dispatchable, type) === true && ownIn(ACTION_NEEDS, type) === undefined) {
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
     * with. The client's action is said whether or not the reducer moved the
     * state, as the reference host emits an accepted annotation action.
     *
     * The marks are kept by the session's id, read without the session's
     * agent, so a session whose agent this host is not serving keeps them too,
     * as the reference host reads a session's annotations without restoring
     * its provider. Only the name the session is published under reads as
     * that id, as for a subscribe to its marks, and the catalogue is read
     * first, which is what names a row no listing reached. A mark under any
     * other name is refused in the reference host's words for a session it
     * cannot find.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L14267-L14295
     */
    if (type.startsWith('annotations/')) {
      if (!channel.endsWith(MARKS)) {
        no(`${type} belongs on a session's ${MARKS} channel, not ${channel}`);
        return;
      }
      const owning = channel.slice(0, -MARKS.length);
      const id = idOf(owning);
      const mark = (): void => {
        marks.set(id, annotationsReducer(marksOf(id), action as unknown as AnnotationsAction));
        dispatch(channel, action, origin);
      };
      const found = (): boolean => (sessions.has(owning) || owners.has(owning) || waitingFor(id) !== undefined)
        && ctx.nameOf(id) === owning;
      if (found()) {
        mark();
        return;
      }
      return past(id).then(() => {
        if (found()) mark();
        else no(`Session not found: ${owning}`);
      });
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
         * The host's keys are kept, and the daemon's are not. Every key a
         * client pushes, the window's own among them - the shell, the trust,
         * and the command and edit rules - is one value for the whole host,
         * which the last push sets and every session and every client reads,
         * as the reference host keeps one root config for every window
         * connected to it.
         * https://github.com/microsoft/vscode/blob/a12547442f722dfe0a6ec105f986cfe65b8d6f22/src/vs/platform/agentHost/common/agentHostConfigurationSync.ts#L47-L55
         * https://github.com/microsoft/vscode/blob/a12547442f722dfe0a6ec105f986cfe65b8d6f22/src/vs/platform/agentHost/node/agentHostStateManager.ts#L2888-L2899
         *
         * A daemon key is the port's, and `rootState` answers it by asking
         * the port, so a copy kept here would be a second opinion - and
         * `rootState` shows this map to every connection, which would hand a
         * member a credential it has no schema for.
         *
         * The restart mark is the daemon's answer, which `markRestart` keeps,
         * so a client's value for it is not kept here either. It goes out as
         * the client sent it, as the reference host takes a root push as
         * given, and VS Code's settings editor writes every root config
         * property back on a save, this one included.
         * https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentHostStateManager.ts#L2881-L2899
         * https://github.com/microsoft/vscode/blob/8fb60541db0e1a371ea40157e0f58951ae4a485d/src/vs/sessions/contrib/providers/agentHost/browser/agentHostSettingsFileSystemProvider.ts#L52-L67
         */
        const ours = Object.fromEntries(Object.entries(config).filter(([key]) => !daemonKey(key) && key !== RESTART_KEY));
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
          delete connection.trustedFolders;
        }
        into(rootConfig, ours);
        // A merged sessions key moved: the pass runs now, with the new days.
        if (Object.prototype.hasOwnProperty.call(config, AUTO_ARCHIVE_KEY) || Object.prototype.hasOwnProperty.call(config, AUTO_DELETE_KEY)) ctx.mergedSoon();
        /*
         * A `workspaceTrust` push answers for every folder at once, so the
         * folders this window said yes to one at a time are behind it: a window
         * that has just said which folders it trusts is not still vouching for
         * one it answered about earlier. A pushed `null` takes the key back,
         * which is a new answer like any other and clears them too.
         */
        if (Object.prototype.hasOwnProperty.call(config, 'workspaceTrust')) delete connection.trustedFolders;
        // What the echo carries, which is what a log line about it says too:
        // a value the daemon holds back is not a value the log may print.
        const echoConfig = { ...config, ...said };
        log(`root config: ${Object.entries(echoConfig).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join(', ') || '(nothing)'}`);
        /*
         * A `replace` keeps what is not the pusher's to clear: the daemon's
         * values and every backend's account stay where they are, so the echo
         * carries them, and the root's state a client reduces from it is the
         * one this host holds. The reference host keeps its provider-backed
         * values in a replace the same way.
         * https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/node/agentHostStateManager.ts#L2863-L2868
         */
        const echoed = action.replace === true ? { ...ctx.keptOnReplace(config), ...echoConfig } : echoConfig;
        /*
         * Said back whole, like every other action a client originates:
         * nothing in a client applies its own dispatch, and a second client
         * watching the root learns of it only from here.
         *
         * One envelope and one `serverSeq` for everybody, because the
         * sequence and the replay buffer are one per host. What each
         * connection reads in it is `seenBy`'s: the daemon's keys go out as
         * the port answered them rather than as this client sent them, so a
         * value the port holds back is not carried to the second admin by
         * the echo.
         */
        dispatch(ROOT, { ...action, config: echoed }, origin);
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
       * The port's file is where the daemon's keys are held, so its write is
       * the change applied, which comes before it is said, as the reference
       * host applies a client's action to its state and then emits it.
       * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostStateManager.ts#L2745-L2752
       */
      const theirs = Object.fromEntries(Object.entries(config).filter(([key]) => daemonKey(key)));
      if (Object.keys(theirs).length === 0 || options.rootConfig === undefined) {
        apply();
        return;
      }
      const port = options.rootConfig;
      return Promise.resolve(port.write(theirs)).then(async (answer) => {
        if (answer.restartNeeded === true) ctx.markRestart();
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
         * And which sessions are offered the session tools, which are the same
         * kind of keys and applied the same way: `toolDefinitions` and the
         * bound tools are worked out per session from the provider it runs, so
         * every running session is told and retooled and each is handed its own
         * answer. Either key moving is enough, because the two decide together.
         *
         * Read back from what the daemon now holds rather than off what was
         * asked, because a pushed `null` takes a key away - and the value a key
         * taken away holds is its default, every session and every provider
         * again.
         *
         * Only when the push names either key: what the daemon holds is the
         * file alone, so a push of any other key would otherwise undo a
         * `--no-session-tools` or a `--session-tools-providers` the line set.
         */
        const touched = Object.hasOwn(theirs, 'sessionTools') || Object.hasOwn(theirs, 'sessionToolsProviders');
        const heldOn = held['sessionTools'];
        const offering = heldOn === false ? false : true;
        const named = held['sessionToolsProviders'];
        const narrowing = Array.isArray(named)
          ? named.filter((one): one is string => typeof one === 'string')
          : [];
        if (touched && (offering !== ctx.sessionTools || JSON.stringify(narrowing) !== JSON.stringify(ctx.sessionToolsProviders))) {
          ctx.sessionTools = offering;
          ctx.sessionToolsProviders = narrowing;
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
        // And what archive does with a dirty tree, read the same way: when a tree is given back.
        const dirtyTree = theirs['archiveDirtyWorktree'];
        if (dirtyTree === 'keep' || dirtyTree === 'commit') ctx.archiveDirtyWorktree = dirtyTree;
        // And how the merged sessions pass looks a pull request up, read at its next pass.
        const lookup = theirs['pullRequestLookup'];
        if (lookup === 'url' || lookup === 'branch') ctx.pullRequestLookup = lookup;
      });
    }
    /*
     * A review, applied as the protocol's reducer applies it: to the files the
     * changeset holds, and to nothing else.
     *
     * Those are the files its watchers were last told, or the ones a read
     * finds when nobody has been told any. A review that moves nothing writes
     * nothing to the source and goes to every watcher as it came, and one the
     * source keeps no review for is refused in its words. What moved goes to
     * every watcher, and is what they hold from then on.
     * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/guide/changesets.md
     */
    if (type === 'changeset/filesReviewChanged') {
      // A changeset a session's backend serves is said here, and reviewed there.
      const backendChannel = ctx.relayedChannel(channel);
      if (backendChannel !== undefined) {
        dispatch(channel, action, origin);
        backendChannel.dispatch(action);
        return;
      }
      const at = changesetAt(channel);
      if (at !== undefined && ctx.relaysChangesets(at.owner)) {
        no(`No changeset at ${channel}`);
        return;
      }
      const files = Array.isArray(action.files)
        ? action.files.filter((one): one is string => typeof one === 'string')
        : [];
      const on = action.reviewed === true;
      if (at === undefined || files.length === 0) {
        no(`${channel} is not a changeset, or no files were named`);
        return;
      }
      const review = options.changes?.review;
      if (review === undefined) {
        no(`${channel} is not reviewable`);
        return;
      }
      return (async () => {
        const holding = shown.get(channel)?.files
          ?? (await options.changes?.state(at.dir, at.owner, at.scope, at.base))?.files;
        if (holding === undefined) {
          no(`No changeset at ${channel}`);
          return;
        }
        const held = new Set(holding.map((file) => file.id));
        const named = new Set(files.filter((file) => held.has(file)));
        const moved = review(at.dir, at.owner, at.scope, [...named], on);
        if (typeof moved === 'string') {
          no(moved);
          return;
        }
        if (!moved) {
          dispatch(channel, action, origin);
          return;
        }
        // As the next read gives them: a cleared file carries no `reviewed`,
        // which the protocol reads as not reviewed.
        const was = shown.get(channel);
        if (was) {
          shown.set(channel, {
            ...was,
            files: was.files.map((file) => {
              if (!named.has(file.id)) return file;
              const { reviewed: _reviewed, ...rest } = file;
              return on ? { ...rest, reviewed: true } : rest;
            }),
          });
        }
        dispatch(channel, { type, files: [...named], reviewed: on }, origin);
      })();
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
     * actually holds with `automation/set`, which is not necessarily what
     * was asked for. The request itself is answered once the store took
     * it, as any accepted action is "echoed back ... once accepted"; it
     * leaves a catalogue's state as it was, and the `automation/set`
     * ahead of it is what every client holds.
     * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-automation/actions.ts#L61-L80
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
        else dispatch(channel, action, origin);
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
          dispatch(channel, action, origin);
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
      // "Removing an unknown resource is a no-op", and the removal is
      // accepted all the same, so it is answered by itself.
      if (!store || !found) {
        dispatch(channel, action, origin);
        return;
      }
      if (!found.operations.includes('remove')) {
        no(`${resource} does not offer remove`);
        return;
      }
      store.remove(resource);
      // And the copies its template named, which nothing names any more.
      pruneCopies();
      return;
    }

    /*
     * Stop a run.
     *
     * The action carries nothing and names its run by the channel it arrives
     * on, which is the protocol's own shape: `AutomationRunCancelRequestedAction`
     * has a type and no field at all. What comes back where it did not stop is
     * the sentence the store or the state of the run gives, refused in the
     * hearing of the client that asked - the same answer every other refused
     * dispatch gets, because this one has no result to carry it.
     *
     * A stop taken is a side effect that changes no state of its own, which is
     * how the protocol's reducer reads it too. It goes to every client of the
     * run as any accepted action does, and the run's lifecycle, said to
     * everyone, is what came of it.
     */
    if (type === 'automationRun/cancelRequested') {
      const refused = cancelRun(channel);
      if (refused !== undefined) no(refused);
      else dispatch(channel, action, origin);
      return;
    }

    /*
     * An action on a chat this host does not know: no running session holds
     * it, the store records no session for it, and the session its URI names
     * is not one `knownSession` knows, once the catalogue has been read for
     * it. The reference host finds no owner for such a chat and takes the
     * action all the same: it goes out on the channel the client named, with
     * the client's origin, to the clients that watch that channel, and nothing
     * is reduced, kept or run for it. A read or an archive of such a chat is
     * refused, in the reference host's words.
     * https://github.com/microsoft/vscode/blob/a12547442f722dfe0a6ec105f986cfe65b8d6f22/src/vs/platform/agentHost/node/agentService.ts#L12482-L12490
     * https://github.com/microsoft/vscode/blob/a12547442f722dfe0a6ec105f986cfe65b8d6f22/src/vs/platform/agentHost/node/agentService.ts#L13442-L13460
     * https://github.com/microsoft/vscode/blob/a12547442f722dfe0a6ec105f986cfe65b8d6f22/src/vs/platform/agentHost/node/agentHostStateManager.ts#L2988-L2992
     */
    const knownChat = (): boolean => byChat.has(channel) || subagents.has(channel) || homeId(channel) !== undefined
      || knownSession(sessionFor(channel));
    if (spaceOf(asked) === 'chat' && !knownChat()) {
      return past(idOf(sessionFor(channel))).then(() => {
        if (knownChat()) return conn.applyNow(params, origin);
        const refusal = type === 'chat/isReadChanged' ? 'Only a known chat can change its read state.'
          : type === 'chat/isArchivedChanged' ? 'Only a known independently manageable non-default chat can be archived.'
          : undefined;
        if (refusal !== undefined) refuse(connection.peer, asked, action, origin, refusal);
        else dispatch(asked, action, origin);
      });
    }

    if (type === 'session/activeClientSet') {
      /*
       * A session this host runs, or one the catalogue lists, takes the entry,
       * whatever became of its backend: a client announces itself when it
       * opens a row, before or after reading it. Any other session is refused
       * as the reference host's restore refuses a session it finds no agent
       * for.
       * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L14103-L14108
       */
      if (!sessions.has(channel) && !owners.has(channel)) {
        no(`No agent for session: ${channel}`);
        return;
      }
      const activeClient = (typeof action.activeClient === 'object' && action.activeClient !== null
        ? action.activeClient
        : {}) as Bag;
      /*
       * The entry as the client sent it, `tools` included or left out, held
       * under the `clientId` it carries, another client's or none: the
       * reference host takes a set as sent, and its reducer keys the entry by
       * the `clientId` the entry carries. Its window reads `tools` of every
       * client in the session; an entry that names no tools, or no client,
       * provides none (`clientTools`). A client's leaving takes out the entry
       * under its own id, as the reference host removes a leaving client's
       * entry, so an entry that names no client stays until a set replaces
       * it.
       * https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentSideEffects.ts#L2008-L2011
       * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-session/reducer.ts#L264-L273
       * https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/protocolServerHandler.ts#L1659-L1677
       * https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/agentHostCustomizationService.ts#L1083-L1101
       */
      const named: unknown = activeClient.clientId;
      const held = presence.get(idOf(channel)) ?? new Map<unknown, Bag>();
      presence.set(idOf(channel), held);
      /*
       * Saying again what this host already held leaves the entry and the
       * tools every chat is offered as they are, and the action goes to
       * every client of the session, as any accepted action does.
       * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/guide/ahp-and-acp.md#how-they-compose
       *
       * A client that announces itself whenever the session's state moves
       * reads this echo as the state moving. One that compares what it would
       * send with the entry the state holds and with what it sent last, as VS
       * Code's session handler does, sends nothing more.
       * https://github.com/microsoft/vscode/blob/3a2421399905c0c044dade3048a797d1e9ba33d4/src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/agentHostSessionHandler.ts#L1237-L1253
       */
      if (JSON.stringify(held.get(named)) === JSON.stringify(activeClient)) {
        dispatch(channel, action, origin);
        return;
      }
      // Re-announcing is how a client refreshes what it contributes, so
      // this replaces rather than merges - a tool taken away has to be
      // able to go.
      held.set(named, activeClient);
      dispatch(channel, action, origin);
      // What it says it can run is a change to what the model is offered,
      // which is the whole point of the field: announced and never read,
      // `tools` was a list this host published back at the client that
      // sent it.
      retool(channel);
      return;
    }

    if (type === 'session/isReadChanged' || type === 'session/isArchivedChanged') {
      /*
       * A session this host does not know, once the catalogue has been read
       * for it, takes no bit: nothing is kept for it and nothing is said, to
       * the sender or to anybody, as the reference host drops a toggle for a
       * session it has no row for, and the protocol has a server ignore an
       * action naming a session that does not exist, with no echo.
       * https://github.com/microsoft/vscode/blob/a12547442f722dfe0a6ec105f986cfe65b8d6f22/src/vs/platform/agentHost/node/agentService.ts#L12507-L12531
       * https://github.com/microsoft/vscode/blob/a12547442f722dfe0a6ec105f986cfe65b8d6f22/src/vs/platform/agentHost/node/agentService.ts#L12042-L12046
       * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/specification/session-channel.md#L166
       */
      if (!knownSession(sessionFor(channel))) {
        return past(idOf(sessionFor(channel))).then(() => {
          if (knownSession(sessionFor(channel))) return conn.applyNow(params, origin);
        });
      }
      // The session's own bits, kept beside it and never seen by a backend.
      // One function, because `chat/isArchivedChanged` on a session's default
      // chat is this same act - see `sessionFlag`. A bit that did not move
      // keeps the catalogue as it is, and the action goes to every client of
      // the session, as an unchanged announcement does above.
      /*
       * The read bit as the session's chats make it. A session marked read
       * while one of two or more of its `readAggregate` chats is unread is
       * said unread, the client's own action carrying the bit the session
       * holds; a session of one such chat takes that chat to its new bit after
       * its own action, whether or not its own bit moved.
       * https://github.com/microsoft/vscode/blob/37eba0937fdca3097d4bb88e870abf3fc70dbde0/src/vs/platform/agentHost/node/agentHostStateManager.ts#L2869-L2878
       * https://github.com/microsoft/vscode/blob/37eba0937fdca3097d4bb88e870abf3fc70dbde0/src/vs/platform/agentHost/node/agentHostStateManager.ts#L2912-L2918
       * https://github.com/microsoft/vscode/blob/37eba0937fdca3097d4bb88e870abf3fc70dbde0/src/vs/platform/agentHost/node/agentHostStateManager.ts#L3101-L3103
       */
      const uri = sessionFor(channel);
      const flag = (): void => {
        const read = type === 'session/isReadChanged';
        const chats = read ? readAggregate(ctx, uri) : [];
        const on = read
          ? action.isRead === true && !(chats.length > 1 && chats.some((one) => !one.read))
          : action.isArchived === true;
        const said = read && on !== (action.isRead === true) ? { ...action, isRead: on } : action;
        const moved = sessionFlag(ctx, uri, read ? Status.IsRead : Status.IsArchived, on, said, channel === uri ? origin : undefined);
        // Sent on another channel of the session, it is answered on that one:
        // the bit moved on the session's own.
        if (!moved || channel !== uri) dispatch(channel, said, origin);
        const sole = chats.length === 1 ? chats[0] : undefined;
        if (sole !== undefined && sole.read !== on) chatFlag(ctx, uri, sole.uri, Status.IsRead, on);
      };
      if (sessions.has(uri) || owners.has(uri)) {
        flag();
        return;
      }
      /*
       * The bits are kept by the session's id, and only the name the session
       * is published under reads as that id. The catalogue is read first,
       * which is what names a row no listing reached. A toggle under any other
       * name names a session that does not exist here, and is dropped with
       * nothing kept and nothing said, as the protocol has a server ignore
       * such an action.
       * https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/node/agentService.ts#L11472-L11490
       * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/specification/session-channel.md#L166
       */
      return past(idOf(uri)).then(() => {
        if (ctx.nameOf(idOf(uri)) === uri) flag();
      });
    }
    const terminal = terminals.get(channel);
    if (terminal) {
      switch (type) {
        /*
         * Input is side-effect only.
         *
         * The protocol's reducer changes nothing on it, and what comes back is
         * `terminal/data`, once the shell has actually said something. It is a
         * terminal action, so it goes to every client of the terminal and is
         * held for replay, as the reference host records and broadcasts it,
         * and every client reads what it did in the `terminal/data` that
         * follows. It goes out whatever the process's state, as VS Code's host
         * says a client's terminal action before its terminal manager reads
         * it, and it reaches a process only while one runs, as that manager
         * writes it.
         * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/specification/terminal-channel.md#L110-L112
         * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/specification/subscriptions.md#L140-L143
         * https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/node/agentHostTerminalManager.ts#L224-L233
         * https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/node/protocolServerHandler.ts#L4215-L4253
         * https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentHostTerminalManager.ts#L520-L527
         */
        case 'terminal/input':
          dispatch(channel, action, origin);
          terminal.write(String(action.data ?? ''));
          break;
        /*
         * A size, a clearing, a title and a claim, taken by the terminal that
         * holds its state and said as the client sent them, the root's list of
         * terminals following a title and a claim.
         */
        case 'terminal/resized':
          terminal.resize(Number(action.cols ?? 80), Number(action.rows ?? 24));
          dispatch(channel, action, origin);
          break;
        case 'terminal/cleared':
          terminal.clear();
          dispatch(channel, action, origin);
          break;
        case 'terminal/titleChanged':
          terminal.setTitle(String(action.title ?? ''));
          dispatch(channel, action, origin);
          break;
        /*
         * A claim that names nobody is refused, and the terminal's own claim
         * stays: set to `{}`, it would tell every other client that nobody
         * holds the terminal.
         */
        case 'terminal/claimed': {
          const claimed = claimOf(action.claim);
          if (!claimed) {
            no('a claim names a client by its id, or a session and its chat');
            break;
          }
          terminal.setClaim(claimed);
          dispatch(channel, action, origin);
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
