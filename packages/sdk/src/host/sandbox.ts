import { computerId } from '../machines/computers.js';
import { idOf } from '../sessions/catalog.js';
import {
  readChatSandboxState, resolveSandboxEnabled, sessionSandboxConfig, sessionSandboxOverrides,
  withChatSandboxState, withSessionSandboxPolicy, withSessionSandboxState,
} from '../sandbox.js';
import { SANDBOX_ENABLED_KEY, SANDBOX_ROOT_KEY } from '../types/sandbox.js';
import type { Bag } from '../types/common.js';
import type { SandboxConfigValue, SessionSandboxState } from '../types/sandbox.js';
import type { HostContext } from './context.js';
import type { Origin } from './state.js';

/**
 * The sandbox of each chat this host runs, as VS Code's agent configuration
 * service keeps it: the floor a session publishes, the selection a chat makes,
 * the enablement last applied, and a rejection put back.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentConfigurationService.ts#L1072-L1223
 */
export interface Sandbox {
  /** A chat's sandbox, resolved as VS Code's `getSessionSandboxConfig` resolves it. */
  config(session: string, chat: string): SandboxConfigValue;
  /** What a session's `_meta` carries of the sandbox: the floor it published, and each chat's applied state. */
  meta(session: string): Bag;
  /** A chat's own selection, made on that chat for a key its backend scopes to it. */
  choose(session: string, chat: string, value: unknown): void;
  /** The floor published on a session, and each selection of `off` it does not allow moved to `on`. */
  publish(session: string): void;
  /** A chat's sandbox applied with this enablement, VS Code's `setChatSandboxEnabled`. */
  applied(session: string, chat: string, enabled: boolean): void;
  /** A failure this host met applying a chat's sandbox, VS Code's `reportChatSandboxConflict`. */
  conflict(session: string, chat: string, message: string): void;
  /**
   * A client's change of a chat's selection that could not be applied, VS
   * Code's `rejectChatSandboxChange`: the failure published, then the
   * selection put back to the enablement last applied.
   */
  reject(session: string, chat: string, origin: Origin, message: string): void;
  /**
   * A chat's sandbox applied where its session runs: the computer it runs on,
   * a machine or this host, asked whether it can host the sandbox runtime
   * where the sandbox is on. Applied, or, where it cannot, the request a
   * client made rejected in the computer's words and the chat left as it was,
   * and a start that met it reported.
   */
  check(session: string, chat: string, origin?: Origin): Promise<void>;
  /** A session gone, and what this held of it with it. */
  forget(session: string): void;
}

export function createSandbox(ctx: HostContext): Sandbox {
  const { sessions, kept, dispatch } = ctx;
  /** Each session's sandbox `_meta`: the floor slot and the state slot, as VS Code's writers leave them. */
  const metas = new Map<string, Bag>();
  /** The selections chats made of their own, by chat, where the session's backend scopes the key to the chat. */
  const own = new Map<string, unknown>();
  const policy = () => ctx.options.managedSettingsSandbox;

  /** The session's own selection: its config in force, or the one it was stored with. */
  const sessionSelection = (session: string): unknown =>
    sessions.get(session)?.config[SANDBOX_ENABLED_KEY] ?? kept.config(idOf(session))?.[SANDBOX_ENABLED_KEY];
  /** A chat's selection: its own, else its session's, as a chat that set none follows its session. */
  const selection = (session: string, chat: string): unknown => (own.has(chat) ? own.get(chat) : sessionSelection(session));
  const appliedOf = (session: string, chat: string): boolean | undefined =>
    readChatSandboxState({ _meta: metas.get(session) ?? {} }, chat)?.enabled;
  /** The default chat's applied state, which a session-level selection is read against. */
  const sessionApplied = (session: string): boolean | undefined => {
    const lead = sessions.get(session)?.defaultChat;
    return lead === undefined ? undefined : appliedOf(session, lead);
  };

  /** The whole `_meta` said again, with the sandbox's part moved. */
  const said = (session: string): void => {
    const meta = ctx.describes(session)._meta as Bag | undefined;
    dispatch(session, { type: 'session/metaChanged', ...(meta ? { _meta: meta } : {}) });
    ctx.markSummaryDirty(session);
  };

  /**
   * One chat's state written, the default chat's also at the session level,
   * which older clients read.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentConfigurationService.ts#L1159-L1170
   */
  const writeState = (session: string, chat: string, next: SessionSandboxState): void => {
    let meta = withChatSandboxState(metas.get(session), chat, next);
    if (sessions.get(session)?.defaultChat === chat) meta = withSessionSandboxState(meta, next);
    metas.set(session, meta);
    said(session);
  };

  /**
   * A selection this host moves, said as a config change of its own: the
   * session's value, kept for its next start and handed to its chats, or one
   * chat's own, said on that chat and handed to it.
   */
  const write = (session: string, chat: string | undefined, value: string): void => {
    const held = sessions.get(session);
    if (held === undefined) return;
    if (chat !== undefined) {
      own.set(chat, value);
      dispatch(chat, { type: 'session/configChanged', config: { [SANDBOX_ENABLED_KEY]: value } });
      void Promise.resolve(held.chats.get(chat)?.setConfig?.(SANDBOX_ENABLED_KEY, value));
      return;
    }
    held.config[SANDBOX_ENABLED_KEY] = value;
    kept.setConfig(idOf(session), { ...kept.config(idOf(session)), [SANDBOX_ENABLED_KEY]: value });
    dispatch(session, { type: 'session/configChanged', config: { [SANDBOX_ENABLED_KEY]: value } });
    for (const [uri, one] of held.chats) {
      if (!held.backends.has(uri) && !own.has(uri)) void Promise.resolve(one.setConfig?.(SANDBOX_ENABLED_KEY, value));
    }
  };

  const config = (session: string, chat: string): SandboxConfigValue => sessionSandboxConfig(
    ctx.rootConfig[SANDBOX_ROOT_KEY] as SandboxConfigValue | undefined,
    selection(session, chat),
    policy(),
    appliedOf(session, chat),
  );

  /*
   * Written only where it moved; a rejected selection stays reported until a
   * new one is made.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentConfigurationService.ts#L1146-L1157
   */
  const applied = (session: string, chat: string, enabled: boolean): void => {
    const previous = readChatSandboxState({ _meta: metas.get(session) ?? {} }, chat);
    if (previous !== undefined && previous.enabled === enabled && previous.error === undefined) return;
    writeState(session, chat, { enabled, ...(previous?.rejectedSelection === true ? { rejectedSelection: true } : {}) });
  };

  /*
   * Said once for one failure: a failure with the same words already
   * reported is not said again.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentConfigurationService.ts#L1172-L1178
   */
  const conflict = (session: string, chat: string, message: string): void => {
    const previous = readChatSandboxState({ _meta: metas.get(session) ?? {} }, chat);
    if (previous?.error !== undefined && 'id' in previous.error && previous.error.message === message) return;
    writeState(session, chat, { ...previous, error: { id: crypto.randomUUID(), message } });
  };

  /*
   * The failure published before the rollback, so a client can say it before
   * it reconciles its toggle; then the selection put back to the enablement
   * last applied, on the chat that set it or on its session. A chat with no
   * enablement applied yet has nothing to go back to.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentConfigurationService.ts#L1206-L1223
   */
  const reject = (session: string, chat: string, origin: Origin, message: string): void => {
    const previous = readChatSandboxState({ _meta: metas.get(session) ?? {} }, chat);
    if (previous?.enabled === undefined) return;
    writeState(session, chat, {
      enabled: previous.enabled,
      rejectedSelection: true,
      error: { clientId: origin.clientId, clientSeq: origin.clientSeq, message },
    });
    write(session, own.has(chat) ? chat : undefined, previous.enabled ? 'on' : 'off');
  };

  return {
    config,

    meta: (session) => metas.get(session) ?? {},

    choose: (session, chat, value) => {
      if (sessions.get(session)?.defaultChat === chat) own.delete(chat);
      else own.set(chat, value);
    },

    /*
     * Published where the session's schema has the switch or a floor is set,
     * and once published, a selection of `off` the floor does not allow
     * becomes `on`, a chat's own and the session's, unless the floor fails
     * closed, which keeps the selection and leaves the sandbox on.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentConfigurationService.ts#L1088-L1127
     */
    publish: (session) => {
      const held = sessions.get(session);
      const floor = policy();
      if (held === undefined) return;
      if (ctx.propertyOf(held.agent, SANDBOX_ENABLED_KEY) === undefined && floor === undefined) return;
      const before = metas.get(session);
      const changed = JSON.stringify(before?.['vscode.resolvedSandboxPolicy']) !== JSON.stringify(withSessionSandboxPolicy({}, floor)['vscode.resolvedSandboxPolicy']);
      if (changed) {
        // Confirmed `off` is kept only where the new floor allows bypass.
        const base = floor?.enabled === true && floor.allowBypass !== true ? withSessionSandboxState(before, undefined) : before;
        metas.set(session, withSessionSandboxPolicy(base, floor));
        said(session);
      }
      if (floor?.failClosed === true) return;
      for (const chat of held.chats.keys()) {
        if (!own.has(chat) || own.get(chat) !== 'off') continue;
        if (sessionSandboxOverrides('off', floor, appliedOf(session, chat)).enabled === 'on') write(session, chat, 'on');
      }
      if (sessionSelection(session) === 'off' && resolveSandboxEnabled('off', floor, sessionApplied(session)) === 'on') write(session, undefined, 'on');
    },

    applied,
    conflict,
    reject,

    /*
     * The computer the session runs on asked, as VS Code's runtime applies a
     * chat's sandbox and the configuration service records the result: a
     * change the computer cannot host rejected and put back where a client
     * made it, a start that met it reported, and the enablement recorded
     * where it was applied. A sandbox that is off is applied anywhere.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/copilot/copilotSessionSandbox.ts#L391-L461
     */
    check: async (session, chat, origin) => {
      const port = ctx.options.computers;
      if (port === undefined) return;
      const enabled = config(session, chat).enabled === 'on';
      const refused = enabled && port.sandboxSupport !== undefined
        ? await port.sandboxSupport(computerId(sessions.get(session)?.config['computer']))
        : undefined;
      if (refused === undefined) applied(session, chat, enabled);
      else if (origin !== undefined) reject(session, chat, origin, refused);
      else conflict(session, chat, refused);
    },

    forget: (session) => {
      const held = sessions.get(session);
      metas.delete(session);
      for (const chat of held?.chats.keys() ?? []) own.delete(chat);
    },
  };
}
