import type { Bag } from '@ahpd/sdk';
import { bag, list, str } from './common.js';
import type { SessionContext } from './context.js';
import { protectedResource, urlOf } from '../mcp.js';
import { flagSettingsOf } from '../options.js';
import { customizationsOf } from './customizations.js';
import type { Published } from './customizations.js';

/** What this area offers the rest of the session. */
export interface Servers {
  /** What the CLI said of each server it is using, by name. */
  onServer: Map<string, { server: string; turnId: string; blocked: boolean }>;
  /** The MCP servers this session declares, which the CLI is told about. */
  declared: Record<string, Bag>;
  /** Ask the CLI what its MCP servers are, and keep the answer. */
  refreshMcp: () => Promise<void>;
  /** Say what the CLI's servers are, in chat. */
  describe: () => Promise<void>;
  methods: {
    setCustomizationEnabled: (id: string, enabled: boolean) => Promise<boolean>;
    startMcpServer: (id: string) => Promise<boolean>;
    authenticated: (resource: string, token: string) => Promise<boolean>;
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
   * The MCP servers this session declared, by name, as it declared them.
   *
   * Kept because re-declaring one means sending the whole set back: the SDK
   * replaces its dynamic servers with what it is given, so a set rebuilt from
   * one server would take the others away.
   */
  const declared: Record<string, Bag> = { ...(ctx.options.mcpServers ?? {}) };

  /** What each server that needs signing in published about itself, by name. */
  const wanted = new Map<string, Published>();

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
      const url = urlOf(declared[name] ?? server.config);
      if (url === undefined) return;
      wanted.set(name, await protectedResource(url, name).catch(() => ({ resource: url, resource_name: name })) as Published);
    }));
  };

  /**
   * Re-read the MCP servers and say what changed.
   *
   * Asked of the CLI rather than assumed from what was just requested: a
   * server told to start can come back `ready`, still `authRequired`, or
   * `error`, and reporting the state that was *asked for* would show a green
   * row against a server nobody has signed into.
   */
  const refreshMcp = async (): Promise<void> => {
    const found = await ctx.handle.mcpServerStatus().then((r) => (Array.isArray(r) ? r : [])).catch(() => [] as unknown[]);
    await discover(found);
    for (const raw of found) {
      const server = bag(raw);
      const name = str(server.name);
      if (!name) continue;
      const id = `mcp:${name}`;
      const held = ctx.customizations.find((entry) => str(entry.id) === id);
      const fresh = bag(customizationsOf({}, [server], [], wanted)[0]);
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
       * which is why one is put on every `mcp__…` call.
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
        ctx.emit('session', { type: 'session/mcpServerStateChanged', id, state: fresh.state });
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
    const still = new Set(found.map((raw) => `mcp:${str(bag(raw).name) ?? ''}`));
    for (const entry of [...ctx.customizations]) {
      const id = str(entry.id) ?? '';
      if (!id.startsWith('mcp:') || still.has(id)) continue;
      ctx.customizations.splice(ctx.customizations.indexOf(entry), 1);
      ctx.emit('session', { type: 'session/customizationRemoved', id });
    }
  };

  /** The server name behind an `mcp:` customization id, if it is one. */
  const serverNamed = (id: string): string | undefined =>
    (id.startsWith('mcp:') ? id.slice(4) : undefined);

  /**
   * Ask the CLI what it can do, without asking it to do anything.
   *
   * Fired as soon as the query exists. Best effort: a CLI that will not answer
   * yet leaves the lists empty, which is a real answer - the same one a host
   * gives for a harness nobody has signed into - rather than a session that
   * refuses to open.
   */
  const describe = async (): Promise<void> => {
    const [init, mcp, skills, plugins] = await Promise.all([
      ctx.handle.initializationResult().then((r) => bag(r as unknown)).catch(() => ({} as Bag)),
      ctx.handle.mcpServerStatus().then((r) => (Array.isArray(r) ? r : [])).catch(() => [] as unknown[]),
      // The only way to know which commands are skills. It re-reads them from
      // disk, which at the start of a session is what one wants anyway.
      ctx.handle.reloadSkills().then((r) => list(bag(r as unknown).skills)).catch(() => [] as unknown[]),
      /*
       * The plugins, which `initializationResult()` does not report.
       *
       * Its own reload, re-read from disk beside the skills, and only its
       * plugin list is used: it re-reads commands and agents too, and those
       * are already answered above.
       */
      ctx.handle.reloadPlugins().then((r) => list(bag(r as unknown).plugins)).catch(() => [] as unknown[]),
    ]);
    ctx.offered = list(init.models)
      .map((raw) => {
        const model = bag(raw);
        // `value`, not `id`. Reading the wrong name costs every model there
        // is and leaves a picker that offers nothing.
        return { id: str(model.value) ?? '', name: str(model.displayName) ?? str(model.value) ?? '' };
      })
      .filter((model) => model.id !== '');
    if (ctx.options.offerModels) ctx.offered = await ctx.options.offerModels(ctx.offered);
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
      await ctx.handle.applyFlagSettings(flagSettingsOf(ctx.values)).catch(() => {});
    }
    await discover(mcp);
    // The plugins this host handed the CLI, which it reports back by the same
    // paths and which the session already lists from the host's own side.
    const handed = new Set((ctx.options.plugins ?? []).map((one) => one.path));
    ctx.customizations = customizationsOf(init, mcp, skills, wanted, plugins, handed);
    if (ctx.customizations.length > 0) {
      ctx.emit('session', { type: 'session/customizationsChanged', customizations: ctx.customizations });
    }
    ctx.options.onHandshake?.();
  };

  const methods: Servers['methods'] = {
    /**
     * Turn one on or off.
     *
     * Only MCP servers: the CLI has `toggleMcpServer` and nothing equivalent
     * for a skill, a prompt or a subagent. Those are refused rather than
     * accepted and dropped - a switch that reports success and changes
     * nothing is worse than one that says it cannot.
     */
    setCustomizationEnabled: async (id, enabled) => {
      const server = serverNamed(id);
      if (!server)
        return false;
      const held = ctx.customizations.find((entry) => str(entry.id) === id);
      const was = str(bag(held?.state).kind);
      try {
        if (!enabled) {
          await ctx.handle.toggleMcpServer(server, false);
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
          await ctx.handle.toggleMcpServer(server, true);
        }
        else {
          await ctx.handle.toggleMcpServer(server, true).catch(() => {});
          ctx.emit('session', { type: 'session/mcpServerStartRequested', id });
          await ctx.handle.reconnectMcpServer(server);
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
     * this host serves the gesture and not the token.
     */
    startMcpServer: async (id) => {
      const server = serverNamed(id);
      if (!server)
        return false;
      ctx.emit('session', { type: 'session/mcpServerStartRequested', id });
      try {
        await ctx.handle.reconnectMcpServer(server);
      }
      catch {
        await refreshMcp();
        return false;
      }
      await refreshMcp();
      return true;
    },

    /*
     * A token a client signed in with, put where the server will use it.
     *
     * The whole set is re-declared, not the one server: `setMcpServers`
     * replaces the SDK's dynamic servers with what it is given, so sending one
     * would take the others away. Then the server is asked to connect again,
     * which is when the CLI tries the header.
     */
    authenticated: async (resource, token) => {
      const named = [...wanted.entries()].find(([, published]) => published.resource === resource)?.[0];
      if (named === undefined) return false;
      const config = declared[named];
      if (config === undefined) return false;
      const headers = typeof config.headers === 'object' && config.headers !== null
        ? config.headers as Record<string, string>
        : {};
      declared[named] = { ...config, headers: { ...headers, Authorization: `Bearer ${token}` } };
      try {
        await ctx.handle.setMcpServers(declared as never);
        // Discovered again next time: a server that connects is no longer one
        // anybody needs to sign into.
        wanted.delete(named);
        await ctx.handle.reconnectMcpServer(named);
      }
      catch { return false; }
      await refreshMcp();
      return true;
    },

    awaiting: () => [...wanted.values()].map((published) => published.resource),

    stopMcpServer: async (id) => {
      const server = serverNamed(id);
      if (!server)
        return false;
      ctx.emit('session', { type: 'session/mcpServerStopRequested', id });
      try {
        await ctx.handle.toggleMcpServer(server, false);
      }
      catch {
        await refreshMcp();
        return false;
      }
      await refreshMcp();
      return true;
    },
  };

  return { onServer, declared, refreshMcp, describe, methods };
}
