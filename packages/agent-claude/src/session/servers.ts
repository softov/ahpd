import type { Bag } from '@ahpd/sdk';
import { bag, list, str } from './common.js';
import type { SessionContext } from './context.js';
import { protectedResource, urlOf } from '../mcp.js';
import { flagSettingsOf } from '../options.js';
import { SDK_DEFAULT_MODEL_VALUE } from './config.js';
import { isHostInjectedMcpServerName } from './clienttools.js';
import { customizationsOf, rootOf } from './customizations.js';
import { configDirOf, diskOf, managedDirOf } from './disk.js';
import { watchFolders } from './watch.js';
import type { Published } from './customizations.js';
import type { Disk, DiskKind } from './disk.js';

/** The servers the CLI reports, less this session's own in-process two. */
const reportedServers = (answer: unknown): unknown[] => (Array.isArray(answer) ? answer : [])
  .filter((raw) => !isHostInjectedMcpServerName(str(bag(raw).name) ?? ''));

/** What this area offers the rest of the session. */
export interface Servers {
  /** What the CLI said of each server it is using, by name. */
  onServer: Map<string, { server: string; turnId: string; blocked: boolean }>;
  /** The MCP servers this session declares, which the CLI is told about: the SDK's `mcpServers`. */
  mcpServers: Record<string, Bag>;
  /** Ask the CLI what its MCP servers are, and keep the answer. */
  refreshMcp: () => Promise<void>;
  /** Ask the CLI this session reads what it has, until a CLI has answered. */
  describe: () => Promise<void>;
  /**
   * Ask the CLI for its agents, commands, skills and plugins again, and say the
   * list: VS Code's pipeline's `reloadPlugins`, the SDK's own reload.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeSdkPipeline.ts#L91-L94
   */
  reloadPlugins: () => Promise<void>;
  /** What this session lists until a CLI has answered: the agent's own with the disk scan. */
  provisionalCustomizations: () => Bag[];
  /**
   * Bring the servers the CLI runs to the session's switches before a turn's
   * prompt goes out: VS Code's session's MCP enablement reconcile at the send.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeAgentSession.ts#L1084
   */
  reconcileMcpServerEnablement: () => Promise<void>;
  /** The plugins this session switched, by source, as the CLI's `enabledPlugins` setting takes them. */
  enabledPlugins: () => Record<string, boolean>;
  /** Stop the watch of the Claude folders. */
  unwatch: () => void;
  methods: {
    setCustomizationEnabled: (id: string, enabled: boolean) => Promise<boolean>;
    startMcpServer: (id: string) => Promise<boolean>;
    authenticated: (resource: string, token: string, server?: string) => Promise<boolean>;
    awaiting: () => string[];
    stopMcpServer: (id: string) => Promise<boolean>;
  };
}

export function createServers(ctx: SessionContext): Servers {
  /**
   * Tool calls running against an MCP server, by call id.
   *
   * Kept so a server that starts asking for a sign-in can say *which* calls
   * are stuck on it: the CLI reports a server's status and never a call's, so
   * the join is here or nowhere.
   */
  const onServer = new Map<string, { server: string; turnId: string; blocked: boolean }>();

  /**
   * The MCP servers the session starts with, by name, as it declares them:
   * what `ctx.mcpServers` holds until the client tools' declarations replace
   * it with the set the CLI has.
   *
   * Kept because re-declaring one means sending the whole set back: the SDK
   * replaces its dynamic servers with what it is given, so a set rebuilt from
   * one server would take the others away.
   */
  const mcpServers: Record<string, Bag> = { ...(ctx.options.mcpServers ?? {}) };

  /** What each server that needs signing in published about itself, by name. */
  const wanted = new Map<string, Published>();

  /**
   * The servers a client's stop switched off, by name.
   *
   * The CLI stops a server by its disabled flag, the same flag a switch sets,
   * and a stop leaves the customization's enabled intent where it was. So a
   * server in here reads enabled while the CLI reports it `disabled`, and a
   * start of it lifts the flag before it reconnects. A client's switch of the
   * server is a decision about the intent, and takes it out of here.
   */
  const stopRequested = new Set<string>();

  /**
   * The session's switch of each server a client switched, by name: VS Code's
   * desired MCP server enablement, which the CLI is brought to before each
   * turn's prompt, the first CLI's included.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeAgentSession.ts#L1590-L1600
   */
  const desired = new Map<string, boolean>();

  /**
   * What the CLI last said it has, kept so the list can be built again.
   *
   * A switch moves the plugins and nothing else, and the SDK asks for a whole
   * answer every time - so the halves that did not move are the ones already
   * read, rather than four calls to be answered again for a plugin a person
   * just switched. The MCP half is refreshed where a server is switched, so
   * what is kept here is what the CLI last said.
   */
  const reported: { init: Bag; mcp: unknown[]; skills: unknown[] } = { init: {}, mcp: [], skills: [] };

  /**
   * What this session has decided about each plugin, by id.
   *
   * Two things are made of it. The ones it switched off are the rows the CLI
   * has stopped reporting and the session still lists - a switch here is an
   * `enabledPlugins` setting the CLI reads when it loads its plugins, so there
   * is nothing left in the CLI's answer to build the row from, and what the
   * plugin was is kept here instead.
   *
   * And every decision is sent again on the next switch, because `enabledPlugins`
   * is one key of the flag layer and `applyFlagSettings` merges at the top
   * level: a map holding only the plugin being moved would say this session has
   * no opinion about the ones it moved before, and the CLI would load them
   * again.
   */
  const switched = new Map<string, { name: string; source: string; enabled: boolean }>();

  /**
   * The disk as it is now, read again each time so a file written since is the
   * file listed. A session in a machine reads nothing here: its CLI reads its
   * own volume.
   */
  const diskNow = (): Disk | undefined => (ctx.options.spawn !== undefined ? undefined : diskOf({
    configDir: configDirOf(ctx.options.env),
    managedDir: managedDirOf(),
    ...(ctx.options.cwd !== undefined ? { cwd: ctx.options.cwd } : {}),
  }));

  /**
   * Lay the session's customizations out from a plugin list, and say them.
   *
   * The plugins are the half a switch moves, so every rebuild starts here -
   * the handshake's and a switch's alike. Said as the whole list because a
   * switch can take a row out of it as well as move one, and a client reading
   * one action has nothing to reconcile. Said whenever it moved, an emptied
   * list included: the action replaces the list a client holds, and a list
   * that moved with no action is one every client still holds as it was.
   * https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/docs/guide/actions.md#L3
   */
  const laid = (plugins: unknown[]): void => {
    const handed = new Set((ctx.options.plugins ?? []).map((one) => one.path));
    const off = [...switched.values()]
      .filter((one) => !one.enabled)
      .map((one) => ({ name: one.name, path: one.source, source: one.source }));
    const was = JSON.stringify(ctx.customizations);
    ctx.customizations = customizationsOf(reported.init, reported.mcp, reported.skills, wanted, plugins, handed, off, diskNow(), stopRequested);
    if (JSON.stringify(ctx.customizations) !== was) {
      ctx.emit('session', { type: 'session/customizationsChanged', customizations: ctx.customizations });
    }
  };

  /**
   * Ask each server that needs signing in where to sign in.
   *
   * Only the remote ones: a stdio server has no URL, so there is no protected
   * resource to describe and it stays an error. Cached by name, because the
   * status is re-read on every refresh and the metadata does not move.
   */
  const discover = async (servers: unknown[]): Promise<void> => {
    await Promise.all(servers.map(async (raw) => {
      const server = bag(raw);
      const name = str(server.name);
      if (name === undefined || str(server.status) !== 'needs-auth' || wanted.has(name)) return;
      const url = urlOf(ctx.mcpServers[name] ?? server.config);
      if (url === undefined) return;
      wanted.set(name, await protectedResource(url, name).catch(() => ({ resource: url, resource_name: name })) as Published);
    }));
  };

  /**
   * Re-read the MCP servers and say what changed.
   *
   * Asked of the CLI after a switch, a start or a stop: a server told to start
   * can come back `ready`, still `authRequired`, or `error`, and only the CLI's
   * answer says which. What changed is measured against the entry this
   * session holds, which is what every client was last told of the server, a
   * client's start or stop included. A server is one name in the list, so the
   * entry held for it is the top-level one of that name.
   */
  const refreshMcp = async (): Promise<void> => {
    const to = ctx.query;
    if (to === undefined) return;
    const found = await to.mcpServerStatus().then(reportedServers).catch(() => [] as unknown[]);
    reported.mcp = found;
    await discover(found);
    const disk = diskNow();
    for (const raw of found) {
      const server = bag(raw);
      const name = str(server.name);
      if (!name) continue;
      const held = ctx.customizations.find((entry) => str(entry.type) === 'mcpServer' && str(entry.name) === name);
      const fresh = bag(customizationsOf({}, [server], [], wanted, [], undefined, [], disk, stopRequested)
        .find((entry) => str(entry.type) === 'mcpServer'));
      if (!held) {
        ctx.customizations.push(fresh);
        ctx.emit('session', { type: 'session/customizationUpdated', customization: fresh });
        continue;
      }
      const moved = JSON.stringify(held.state) !== JSON.stringify(fresh.state);
      const switched = JSON.stringify(held.enablement) !== JSON.stringify(fresh.enablement);
      if (!moved && !switched)
        continue;
      /*
       * Which running tool calls this moved, before the row itself.
       *
       * The CLI reports a *server's* status and never a call's, so a call
       * blocked on a sign-in is only tellable by joining the two: every call
       * running against this server is blocked when it starts asking, and
       * unblocked when it is ready again. `chat/toolCallAuthRequired` is a
       * no-op in the reducer unless the call carries an MCP contributor,
       * which a call of a server this session lists carries from its start.
       */
      const asking = str(fresh.state === undefined ? undefined : bag(fresh.state).kind) === 'authRequired';
      for (const [callId, running] of ctx.onServer) {
        if (running.server !== name || running.blocked === asking) continue;
        running.blocked = asking;
        const at = ctx.parts.get(callId);
        const call = bag(at?.toolCall);
        if (asking) {
          const { kind: _kind, ...auth } = bag(fresh.state);
          call.status = 'auth-required';
          call.auth = auth;
          ctx.emit('chat', { type: 'chat/toolCallAuthRequired', turnId: running.turnId, toolCallId: callId, auth });
          // The same block at the session level, which is where a client
          // looking at a list rather than at a conversation sees it.
          ctx.inputNeededSet({
            id: `auth:${callId}`,
            chat: ctx.options.chatUri,
            kind: 'toolAuthentication',
            turnId: running.turnId,
            toolCall: { ...call },
          });
        }
        else {
          call.status = 'running';
          delete call.auth;
          ctx.emit('chat', { type: 'chat/toolCallAuthResolved', turnId: running.turnId, toolCallId: callId });
          ctx.inputNeededRemoved(`auth:${callId}`);
        }
      }
      held.state = fresh.state;
      held.enablement = fresh.enablement;
      // `mcpServerStateChanged` carries the state and nothing else, so a
      // server that came back on would arrive `ready` with the switch still
      // drawn off. The whole row when both moved, the narrow action when only
      // the state did.
      if (switched)
        ctx.emit('session', { type: 'session/customizationUpdated', customization: { ...held } });
      else
        ctx.emit('session', { type: 'session/mcpServerStateChanged', id: str(held.id) as string, state: fresh.state });
    }
    /*
     * And the ones that are no longer there.
     *
     * A server taken out of the configuration stops being reported, and a
     * customization list that only ever grew left it drawn for as long as the
     * session ran. Said one at a time rather than by re-sending the list: the
     * removal is the change, and a list re-sent on every refresh is the row
     * redrawn whether or not anything moved.
     */
    const still = new Set(found.map((raw) => str(bag(raw).name) ?? ''));
    for (const entry of [...ctx.customizations]) {
      if (str(entry.type) !== 'mcpServer' || still.has(str(entry.name) ?? '')) continue;
      ctx.customizations.splice(ctx.customizations.indexOf(entry), 1);
      ctx.emit('session', { type: 'session/customizationRemoved', id: str(entry.id) as string });
    }
  };

  /**
   * Say a start or a stop of a server, and hold the server as the request
   * leaves it in every client.
   *
   * The protocol's reducer moves a server a start names to `starting`, and one
   * a stop names to `stopped`, with no `channel`; the entry this session holds
   * takes the same, so the refresh after the CLI's call says the state the CLI
   * reports whether or not it is the one the server was in.
   * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-session/reducer.ts#L458-L479
   */
  const request = (id: string, type: 'session/mcpServerStartRequested' | 'session/mcpServerStopRequested'): void => {
    ctx.emit('session', { type, id });
    const held = ctx.customizations.find((entry) => str(entry.id) === id);
    if (held === undefined) return;
    held.state = { kind: type === 'session/mcpServerStartRequested' ? 'starting' : 'stopped' };
    delete held.channel;
  };

  /**
   * The server name behind an id that names one, if it is one.
   *
   * A server is named by the file that declares it with the server in a
   * fragment, `<file uri>#mcp=<name>`, a server no file declares by its
   * internal uri the same way, which is how a client reads it and so how a
   * client switches it off. The escaped name is the server's own, so it is
   * decoded before it is used.
   */
  const serverNamed = (id: string): string | undefined => {
    const at = id.indexOf('#mcp=');
    if (at === -1) return undefined;
    try {
      return decodeURIComponent(id.slice(at + '#mcp='.length));
    }
    catch {
      // An id that is not the escaping this host writes names no server.
      return undefined;
    }
  };

  /**
   * Switch a plugin this session offered, the CLI's own built-ins included.
   *
   * The CLI has no call for it. What it takes is an `enabledPlugins` setting,
   * named by the source a plugin is keyed under - `<name>@<marketplace>`, and
   * `<name>@builtin` for one the CLI ships itself - and it reads that when it
   * loads its plugins, so the switch is the setting and then a reload to make
   * it now. The reload is also the answer: a plugin gone from the list is one
   * that stopped being loaded, and one still in it is a switch the CLI did not
   * take, which is what a person is entitled to be told.
   *
   * The rest of the flag settings go with it rather than the one setting
   * alone: `applyFlagSettings` merges into the layer, and a set written from
   * nothing would say this host has an opinion about the style and the
   * `enabledPlugins` of every other plugin.
   *
   * A session with no CLI yet keeps the switch for its first, which starts
   * with every decision in its settings, and the row says it at once.
   */
  const switchPlugin = async (id: string, enabled: boolean): Promise<boolean> => {
    const held = ctx.customizations.find((entry) => str(entry.id) === id);
    const name = str(held?.name);
    const source = str(held?.uri);
    if (held === undefined || str(held.type) !== 'plugin' || name === undefined || name === '' || source === undefined || source === '')
      return false;
    const to = ctx.query;
    if (to === undefined) {
      switched.set(id, { name, source, enabled });
      if (enabled) delete held.enablement;
      else held.enablement = [{ kind: 'session', enabled: false }];
      ctx.emit('session', { type: 'session/customizationUpdated', customization: { ...held } });
      return true;
    }
    const decided = Object.fromEntries([
      ...[...switched.values()].map((one) => [one.source, one.enabled] as const),
      [source, enabled] as const,
    ]);
    try {
      await to.applyFlagSettings({ ...flagSettingsOf(ctx.values), enabledPlugins: decided });
    }
    catch {
      return false;
    }
    const plugins = await to.reloadPlugins()
      .then((answer) => list(bag(answer as unknown).plugins))
      .catch(() => undefined);
    if (plugins === undefined)
      return false;
    const loading = plugins.some((raw) => rootOf(bag(raw)) === source);
    if (enabled ? !loading : loading)
      return false;
    switched.set(id, { name, source, enabled });
    laid(plugins);
    return true;
  };

  /** Whether a reload is running, and whether a change came during it. */
  let reloading = false;
  let again = false;

  /**
   * Ask the CLI again for what a file on disk can change: its agents and
   * commands, its skills and its plugins.
   *
   * `initializationResult()` is the answer of the first connect and stays as
   * it was, so the two reloads are what the CLI reads from disk again. Their
   * answers replace what `describe` kept, and the list is laid out again. A
   * reload that fails keeps the lists that were there, and says nothing.
   *
   * One at a time: a change during a reload is one more reload after it,
   * because the one that runs may have read the folder before that change.
   */
  const reloadPlugins = async (): Promise<void> => {
    if (reloading) {
      again = true;
      return;
    }
    reloading =true;
    try {
      do {
        again = false;
        const to = ctx.query;
        if (ctx.disposed || to === undefined) return;
        const answered = await Promise.all([
          to.reloadPlugins().then((r) => bag(r as unknown)),
          to.reloadSkills().then((r) => list(bag(r as unknown).skills)),
        ]).catch(() => undefined);
        if (answered === undefined || ctx.disposed) continue;
        const [plugins, skills] = answered;
        reported.init = { ...reported.init, agents: list(plugins.agents), commands: list(plugins.commands) };
        reported.skills = skills;
        laid(list(plugins.plugins));
      } while (again && !ctx.disposed);
    }
    finally {
      reloading =false;
    }
  };

  /**
   * What this session lists before a CLI has answered: VS Code's Claude
   * session before its first send, whose list is the agent's own with what
   * the disk scan finds.
   *
   * The agent's own is what the host seeded this session with, which a client
   * reads until the agent reports its own; the scan adds what the seeds do not
   * hold, the working directory's scope among it, each file under the name the
   * CLI knows it by and each server a settings file declares as stopped, as
   * VS Code's scan lists one before its session starts. The servers are the
   * scan's alone, since the seeds' carry the states of a CLI this session does
   * not run, and each switch kept for the first CLI is on its row.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeAgentSession.ts#L1499-L1533
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/customizations/scan/claudeMcpScan.ts#L43-L51
   */
  const provisionalCustomizations = (): Bag[] => {
    const disk = diskNow();
    const named = (kind: DiskKind): Bag[] => [...new Set((disk?.files ?? []).filter((one) => one.kind === kind).map((one) => one.name))]
      .map((name) => ({ name }));
    const skills = named('skill');
    const handed = new Set((ctx.options.plugins ?? []).map((one) => one.path));
    const scanned = customizationsOf({ commands: skills, agents: named('agent') }, named('mcpServer'), skills, wanted, [], handed, [], disk, stopRequested);
    const own = (ctx.options.seedCustomizations ?? []).filter((one) => str(one.type) !== 'mcpServer');
    const held = new Set(own.map((one) => str(one.id)));
    return [...own, ...scanned.filter((one) => !held.has(str(one.id)))].map((one) => {
      const plugin = str(one.type) === 'plugin' ? switched.get(str(one.id) ?? '') : undefined;
      const server = str(one.type) === 'mcpServer' ? desired.get(str(one.name) ?? '') : undefined;
      if (plugin !== undefined) {
        const { enablement: _kept, ...row } = one;
        return plugin.enabled ? row : { ...row, enablement: [{ kind: 'session', enabled: false }] };
      }
      return server === undefined ? { ...one } : { ...one, enablement: [{ kind: 'session', enabled: server }] };
    });
  };

  /** Whether a CLI of this session has answered what it has. */
  let described = false;

  /**
   * Ask the CLI this session reads what it can do, without asking it to do
   * anything.
   *
   * Asked of each CLI the session starts until one answers, whose answer lays
   * the list out. Best effort: a CLI that does not answer leaves the lists as
   * they are and the next CLI is asked, as VS Code's session keeps its disk
   * set when its read of the SDK fails, and the answer of a CLI put away while
   * it answered is not the session's.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeAgentSession.ts#L1521-L1533
   */
  const describe = async (): Promise<void> => {
    const to = ctx.query;
    if (described || to === undefined) return;
    const [init, mcp, skills, plugins] = await Promise.all([
      to.initializationResult().then((r) => bag(r as unknown)).catch(() => undefined),
      to.mcpServerStatus().then(reportedServers).catch(() => [] as unknown[]),
      // The only way to know which commands are skills. It re-reads them from
      // disk, which at the start of a session is what one wants anyway.
      to.reloadSkills().then((r) => list(bag(r as unknown).skills)).catch(() => [] as unknown[]),
      /*
       * The plugins, which `initializationResult()` does not report.
       *
       * Its own reload, re-read from disk beside the skills, and only its
       * plugin list is used: it re-reads commands and agents too, and those
       * are already answered above.
       */
      to.reloadPlugins().then((r) => list(bag(r as unknown).plugins)).catch(() => [] as unknown[]),
    ]);
    if (init === undefined || described || ctx.disposed || ctx.query !== to) return;
    described = true;
    ctx.models = list(init.models)
      .map((raw) => {
        const model = bag(raw);
        // `value`, not `id`. Reading the wrong name costs every model there
        // is and leaves a picker that offers nothing.
        return { id: str(model.value) ?? '', name: str(model.displayName) ?? str(model.value) ?? '' };
      })
      .filter((model) => model.id !== '' && model.id !== SDK_DEFAULT_MODEL_VALUE);
    if (ctx.options.offerModels) ctx.models = await ctx.options.offerModels(ctx.models);
    /*
     * The style the preset names, applied once the CLI is there to take it.
     *
     * It reaches the flag settings rather than the query, which the CLI only
     * reads at startup, and it is applied when it differs from what the CLI
     * already answers in - applying the style the CLI is running is a
     * round-trip that changes nothing.
     */
    const asked = str(ctx.values.outputStyle);
    if (asked !== undefined && asked !== str(init.output_style)) {
      await to.applyFlagSettings(flagSettingsOf(ctx.values)).catch(() => {});
    }
    reported.init = init;
    reported.mcp = mcp;
    reported.skills = skills;
    await discover(mcp);
    laid(plugins);
    ctx.options.onHandshake?.();
  };

  /**
   * The Claude folders, watched for the session's life so a file written into
   * one is listed without a restart, as VS Code's session watches its folders
   * from the moment it is made: the list is laid out again from the scan until
   * a CLI has answered, and the CLI is asked again after. Not for a session in
   * a machine, whose CLI reads its own config volume.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeAgentSession.ts#L500
   */
  let unwatch = ctx.options.spawn !== undefined ? undefined : watchFolders({
    configDir: configDirOf(ctx.options.env),
    ...(ctx.options.cwd !== undefined ? { cwd: ctx.options.cwd } : {}),
  }, () => {
    if (described) {
      void reloadPlugins();
      return;
    }
    if (ctx.disposed) return;
    const was = JSON.stringify(ctx.customizations);
    ctx.customizations = provisionalCustomizations();
    if (JSON.stringify(ctx.customizations) !== was) {
      ctx.emit('session', { type: 'session/customizationsChanged', customizations: ctx.customizations });
    }
  });

  /**
   * The CLI's servers brought to the session's switches before a turn's
   * prompt, as VS Code's pipeline reconciles them: what the CLI runs is read,
   * and each server it reports whose switch differs is switched, one switched
   * on asked to connect again. A server a stop switched off stays off until a
   * start. A switch the CLI refuses fails the turn, as it fails VS Code's send.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeSdkPipeline.ts#L125-L155
   */
  const reconcileMcpServerEnablement = async (): Promise<void> => {
    const to = ctx.query;
    if (to === undefined || desired.size === 0) return;
    const observed = new Map((await to.mcpServerStatus()).map((server) => [server.name, server.status !== 'disabled']));
    let moved = false;
    for (const [server, enabled] of desired) {
      const current = observed.get(server);
      if (current === undefined || current === enabled || stopRequested.has(server)) continue;
      await to.toggleMcpServer(server, enabled);
      if (enabled) await to.reconnectMcpServer(server);
      moved = true;
    }
    if (moved) await refreshMcp();
  };

  const methods: Servers['methods'] = {
    /**
     * Turn one on or off.
     *
     * An MCP server the CLI has, and a plugin it loaded. The rest - a skill, a
     * prompt, a subagent - the CLI has no switch for at all, and those are
     * refused rather than accepted and dropped: a switch that reports success
     * and changes nothing is worse than one that says it cannot.
     *
     * A server's switch is kept as the session's, which each send brings the
     * CLI to; a session with no CLI yet says it on the row at once and its
     * first CLI is brought to it before the first prompt.
     */
    setCustomizationEnabled: async (id, enabled) => {
      const server = serverNamed(id);
      if (!server)
        return switchPlugin(id, enabled);
      stopRequested.delete(server);
      desired.set(server, enabled);
      const held = ctx.customizations.find((entry) => str(entry.id) === id);
      const to = ctx.query;
      if (to === undefined) {
        if (held !== undefined) {
          held.enablement = [{ kind: 'session', enabled }];
          ctx.emit('session', { type: 'session/customizationUpdated', customization: { ...held } });
        }
        return true;
      }
      const was = str(bag(held?.state).kind);
      try {
        if (!enabled) {
          await to.toggleMcpServer(server, false);
        }
        /*
         * Switching on a server that is not ready is how somebody signs into
         * one.
         *
         * `toggleMcpServer` only lifts the disabled flag - a server that was
         * off *because* nobody had signed in comes straight back needing a
         * sign-in, which reads as a switch that flips itself off.
         * `reconnectMcpServer` is the one that makes the CLI run its own
         * sign-in.
         */
        else if (was === 'ready') {
          await to.toggleMcpServer(server, true);
        }
        else {
          await to.toggleMcpServer(server, true).catch(() => {});
          request(id, 'session/mcpServerStartRequested');
          await to.reconnectMcpServer(server);
        }
      }
      catch {
        // What it actually is now, which after a failed sign-in is still the
        // CLI's own `needs-auth` rather than anything this host invented.
        await refreshMcp();
        return true;
      }
      await refreshMcp();
      return true;
    },

    /**
     * Start one, which is also how a server that needs signing into is signed
     * into.
     *
     * `reconnectMcpServer` makes the CLI run its own sign-in, on the machine
     * the CLI is on. AHP's `authenticate` is the other model - the client
     * fetches a token and pushes it - and the SDK has nowhere to put one, so
     * this host serves the gesture and not the token. A server a stop switched
     * off has the CLI's disabled flag lifted first, in the order a switch on
     * takes.
     *
     * Once the request is said it is answered, and what follows it is the
     * state the CLI reports, a call that threw included: the guide has the
     * host follow a start with `session/mcpServerStateChanged`.
     * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/guide/mcp.md#L50
     *
     * A session with no CLI yet runs no server to start, and refuses, as VS
     * Code's session refuses a start before its first send.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeAgentSession.ts#L1003-L1008
     */
    startMcpServer: async (id) => {
      const server = serverNamed(id);
      const to = ctx.query;
      if (!server || to === undefined)
        return false;
      request(id, 'session/mcpServerStartRequested');
      try {
        if (stopRequested.has(server)) {
          await to.toggleMcpServer(server, true);
          stopRequested.delete(server);
        }
        await to.reconnectMcpServer(server);
      }
      catch {
        // Said by the refresh below, which reads what the CLI made of it.
      }
      await refreshMcp();
      return true;
    },

    /*
     * A token a client signed in with, put where the server will use it.
     *
     * The server the client's target named, or the first that waits for the
     * resource when it named none. Either way only a server waiting for that
     * resource takes it, and a named one takes it alone, even beside another
     * server that waits for the same resource.
     *
     * The whole set is re-declared, not the one server: `setMcpServers`
     * replaces the SDK's dynamic servers with what it is given, so sending one
     * would take the others away. Then the server is asked to connect again,
     * which is when the CLI tries the header.
     */
    authenticated: async (resource, token, server) => {
      const named = server === undefined
        ? [...wanted.entries()].find(([, published]) => published.resource === resource)?.[0]
        : serverNamed(server);
      const to = ctx.query;
      if (named === undefined || wanted.get(named)?.resource !== resource || to === undefined) return false;
      // The set the session holds now, its in-process servers among it: the
      // client tools' declarations replace the set the session started with.
      const config = ctx.mcpServers[named];
      if (config === undefined) return false;
      const headers = typeof config.headers === 'object' && config.headers !== null
        ? config.headers as Record<string, string>
        : {};
      ctx.mcpServers[named] = { ...config, headers: { ...headers, Authorization: `Bearer ${token}` } };
      try {
        await to.setMcpServers(ctx.mcpServers as never);
        // Discovered again next time: a server that connects is no longer one
        // anybody needs to sign into.
        wanted.delete(named);
        await to.reconnectMcpServer(named);
      }
      catch { return false; }
      await refreshMcp();
      return true;
    },

    awaiting: () => [...wanted.values()].map((published) => published.resource),

    /**
     * Stop one, by the CLI's disabled flag.
     *
     * The guide has a stop manage the server's process and leave the
     * customization's enabled intent as it was, so a server that was on when
     * it stopped is kept in `stopRequested` and reads on. It is kept from
     * before the CLI is asked, so a start that arrives while the CLI is still
     * stopping it lifts the flag, and given back when the CLI refuses the
     * stop. Once the request is said it is answered, and what follows it is
     * the state the CLI reports, a call that threw included.
     * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/guide/mcp.md#L48-L51
     *
     * A session with no CLI yet runs no server to stop, and refuses, as VS
     * Code's session refuses a stop before its first send.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeAgentSession.ts#L1003-L1008
     */
    stopMcpServer: async (id) => {
      const server = serverNamed(id);
      const to = ctx.query;
      if (!server || to === undefined)
        return false;
      const on = bag(list(ctx.customizations.find((entry) => str(entry.id) === id)?.enablement)[0]).enabled !== false;
      request(id, 'session/mcpServerStopRequested');
      if (on) stopRequested.add(server);
      try {
        await to.toggleMcpServer(server, false);
      }
      catch {
        // Said by the refresh below, which reads what the CLI made of it.
        stopRequested.delete(server);
      }
      await refreshMcp();
      return true;
    },
  };

  return {
    onServer,
    mcpServers,
    refreshMcp,
    describe,
    reloadPlugins,
    provisionalCustomizations,
    reconcileMcpServerEnablement,
    enabledPlugins: () => Object.fromEntries([...switched.values()].map((one) => [one.source, one.enabled])),
    unwatch: () => {
      unwatch?.();
      unwatch = undefined;
    },
    methods,
  };
}
