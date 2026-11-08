import { computerId } from '../machines/computers.js';
import { idOf } from '../sessions/catalog.js';
import {
  readChatSandboxState, readSessionSandboxPolicy, readSessionSandboxState, resolveSandboxEnabled, sessionSandboxConfig,
  withChatSandboxState, withSessionSandboxPolicy, withSessionSandboxState,
} from '../sandbox.js';
import { SANDBOX_ENABLED_KEY, SANDBOX_ROOT_KEY } from '../types/sandbox.js';
import type { Bag } from '../types/common.js';
import type { SandboxConfigValue, SessionSandboxState } from '../types/sandbox.js';
import type { HostContext } from './context.js';
import type { Origin } from './state.js';

/**
 * The words VS Code reads as the runtime's refusal of a sandbox the managed
 * policy does not allow, which a floor that fails closed says to a client's
 * request to turn the sandbox off.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/copilot/copilotSessionLauncher.ts#L999-L1002
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/copilot/copilotSessionSandbox.ts#L280-L290
 */
const MANAGED_POLICY_CONFLICT = 'Sandbox configuration update violates managed policy. Contact your administrator for more information.';

/**
 * The sandbox of each chat this host runs, as VS Code's agent configuration
 * service keeps it: the floor a session publishes, the selection each chat
 * reads from the values it runs on, the enablement last applied to it, and a
 * rejection put back.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentConfigurationService.ts#L1072-L1247
 */
export interface Sandbox {
  /** A chat's sandbox, resolved as VS Code's `getSessionSandboxConfig` resolves it. */
  config(session: string, chat: string): SandboxConfigValue;
  /** What a session's `_meta` carries of the sandbox: the floor it published, and each chat's applied state. */
  meta(session: string): Bag;
  /**
   * The floor published on a session, and the session's selection of `off`
   * that the floor does not allow moved to `on`, VS Code's
   * `_publishSessionSandboxPolicy`. `chosen` says a client's change asks,
   * whose `off` a floor that allows bypass keeps.
   */
  publish(session: string, chosen?: boolean): void;
  /** A chat's sandbox applied with this enablement, VS Code's `setChatSandboxEnabled`. */
  applied(session: string, chat: string, enabled: boolean): void;
  /** A failure this host met applying a chat's sandbox, VS Code's `reportChatSandboxConflict`. */
  conflict(session: string, chat: string, message: string): void;
  /**
   * A client's change of the selection a chat takes from its session that
   * the chat could not apply, VS Code's `rejectChatSandboxChange`: the
   * failure published, then the session's selection put back to the chat's
   * enablement last applied, unless a selection newer than `asked` was made.
   */
  reject(session: string, chat: string, asked: unknown, origin: Origin, message: string): void;
  /**
   * A chat's sandbox applied where its session runs, as VS Code's runtime
   * applies it, `requested` being the selection a client's change carried.
   * A sandbox that is on is applied where the computer the session runs on,
   * a machine or this host, can host the sandbox runtime; one that is off is
   * applied anywhere. Where it cannot, a client's change is rejected in the
   * computer's words and a start reports the failure.
   */
  check(session: string, chat: string, origin?: Origin, requested?: unknown): Promise<void>;
  /** The sandbox's part of a change of a session's config, said once it is checked. */
  configChanged(session: string, config: Bag, origin?: Origin): void;
  /** The sandbox's part of a change of the root settings: every session's floor, and every chat's sandbox applied again. */
  rootChanged(): void;
  /** A session gone, and what this held of it with it. */
  forget(session: string): void;
}

export function createSandbox(ctx: HostContext): Sandbox {
  const { sessions, kept, dispatch, log } = ctx;
  /** Each session's sandbox `_meta`: the floor slot and the state slot, as VS Code's writers leave them. */
  const metas = new Map<string, Bag>();
  /**
   * The sessions whose selection a client made, which a floor that allows
   * bypass keeps while it stays the floor, VS Code's
   * `_sessionSandboxUserSelections`.
   */
  const chosenBy = new Set<string>();
  const policy = () => ctx.options.managedSettingsSandbox;

  /** The values a chat runs on: its own laid over its session's, the host's `chatConfig`. */
  const valuesOf = (session: string, chat: string): Record<string, unknown> | undefined => {
    const held = sessions.get(session);
    return held === undefined ? kept.config(idOf(session)) : ctx.chatConfig(session, held, chat);
  };
  /** Whether a chat set a selection of its own, which a change of its session's does not reach. */
  const ownSelection = (session: string, chat: string): boolean =>
    sessions.get(session)?.backends.has(chat) === true || Object.hasOwn(ctx.getChatOwnConfigValues(session, chat), SANDBOX_ENABLED_KEY);
  /** The session's own selection, which every chat that has no values of its own takes. */
  const sessionSelection = (session: string): unknown =>
    sessions.get(session)?.config[SANDBOX_ENABLED_KEY] ?? kept.config(idOf(session))?.[SANDBOX_ENABLED_KEY];
  /** A chat's selection, from the values it runs on. */
  const selection = (session: string, chat: string): unknown => valuesOf(session, chat)?.[SANDBOX_ENABLED_KEY];
  /** The chats that take their session's selection, which a change of it reaches. */
  const following = (session: string): string[] => {
    const held = sessions.get(session);
    return held === undefined ? [] : [...held.chats.keys()].filter((chat) => !ownSelection(session, chat));
  };

  /*
   * A chat's applied state; the default chat falls back to the session-level
   * state.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentConfigurationService.ts#L1242-L1247
   */
  const appliedState = (session: string, chat: string): SessionSandboxState | undefined => {
    const source = { _meta: metas.get(session) ?? {} };
    return readChatSandboxState(source, chat)
      ?? (sessions.get(session)?.defaultChat === chat ? readSessionSandboxState(source) : undefined);
  };

  /*
   * The applied enablement of the session's own selection: the default
   * chat's while it takes the session's selection, else the selection itself
   * when it is `on` or `off`.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentConfigurationService.ts#L1129-L1136
   */
  const sessionEnabled = (session: string): boolean | undefined => {
    const held = sessions.get(session);
    if (held !== undefined && !ownSelection(session, held.defaultChat)) {
      return readSessionSandboxState({ _meta: metas.get(session) ?? {} })?.enabled;
    }
    const chosen = sessionSelection(session);
    return chosen === 'on' ? true : chosen === 'off' ? false : undefined;
  };

  /** The whole `_meta` said again, with the sandbox's part moved. */
  const said = (session: string): void => {
    const meta = ctx.describes(session)._meta as Bag | undefined;
    dispatch(session, { type: 'session/metaChanged', ...(meta ? { _meta: meta } : {}) });
    ctx.markSummaryDirty(session);
  };

  /*
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

  /*
   * A new selection made for the chats that take the session's: the
   * rejection each reported, and the session level's, cleared.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentConfigurationService.ts#L1180-L1204
   */
  const clearRejected = (session: string): void => {
    const before = metas.get(session);
    if (before === undefined) return;
    let meta = before;
    const level = readSessionSandboxState({ _meta: meta });
    if (level?.rejectedSelection === true) {
      meta = withSessionSandboxState(meta, {
        ...(level.enabled === undefined ? {} : { enabled: level.enabled }),
        ...(level.error === undefined ? {} : { error: level.error }),
      });
    }
    for (const chat of following(session)) {
      const state = readChatSandboxState({ _meta: meta }, chat);
      if (state?.rejectedSelection !== true) continue;
      meta = withChatSandboxState(meta, chat, {
        ...(state.enabled === undefined ? {} : { enabled: state.enabled }),
        ...(state.error === undefined ? {} : { error: state.error }),
      });
    }
    if (meta === before) return;
    metas.set(session, meta);
    said(session);
  };

  /** A chat's sandbox applied, a failure to apply it logged. */
  const applyTo = (session: string, chat: string, origin?: Origin, requested?: unknown): void => {
    void check(session, chat, origin, requested).catch((error: unknown) => {
      log(`${chat}: the sandbox was not applied: ${error instanceof Error ? error.message : String(error)}`);
    });
  };

  /*
   * The sandbox's part of a session's config change, VS Code's handling of a
   * `session/configChanged`: a new selection clears the rejections of the
   * chats that take it unless it puts one back, a client's selection is
   * remembered as a client's, the floor is published again, and each chat
   * that takes the selection applies its sandbox, with the selection a
   * client's change carried.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentConfigurationService.ts#L479-L503
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/copilot/copilotSessionSandbox.ts#L351-L374
   */
  const changed = (session: string, config: Bag, origin: Origin | undefined, rollback: boolean): void => {
    const moved = Object.hasOwn(config, SANDBOX_ENABLED_KEY);
    if (moved && !rollback) clearRejected(session);
    if (moved && origin !== undefined) chosenBy.add(session);
    else if (moved) chosenBy.delete(session);
    publish(session, origin !== undefined);
    if (!moved) return;
    for (const chat of following(session)) applyTo(session, chat, origin, origin === undefined ? undefined : config[SANDBOX_ENABLED_KEY]);
  };

  /*
   * The session's selection this host moves, said as a config change of its
   * own: kept for the session's next start, handed to the chats that take
   * it, and applied, a rollback leaving the rejection it reports in place.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentConfigurationService.ts#L1028-L1050
   */
  const write = (session: string, value: string, rollback: boolean): void => {
    const held = sessions.get(session);
    if (held === undefined) return;
    held.config[SANDBOX_ENABLED_KEY] = value;
    kept.setConfig(idOf(session), { ...kept.config(idOf(session)), [SANDBOX_ENABLED_KEY]: value });
    dispatch(session, { type: 'session/configChanged', config: { [SANDBOX_ENABLED_KEY]: value } });
    for (const chat of following(session)) void Promise.resolve(held.chats.get(chat)?.setConfig?.(SANDBOX_ENABLED_KEY, value));
    changed(session, { [SANDBOX_ENABLED_KEY]: value }, undefined, rollback);
  };

  const config = (session: string, chat: string): SandboxConfigValue => sessionSandboxConfig(
    ctx.rootConfig[SANDBOX_ROOT_KEY] as SandboxConfigValue | undefined,
    selection(session, chat),
    policy(),
    appliedState(session, chat)?.enabled,
  );

  /*
   * Published where the session's schema has the switch or a floor is set.
   * A floor that newly keeps the sandbox on without bypass clears the state
   * applied before it; then a selection of `off` that the floor does not
   * allow becomes `on`, unless a client made it and the floor allows bypass
   * and has not moved since, or the floor fails closed, which keeps the
   * selection and leaves the sandbox on.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentConfigurationService.ts#L1088-L1127
   */
  const publish = (session: string, chosen = false): void => {
    const held = sessions.get(session);
    const floor = policy();
    if (held === undefined) return;
    if (ctx.propertyOf(held.agent, SANDBOX_ENABLED_KEY) === undefined && floor === undefined) return;
    const before = metas.get(session);
    const previous = readSessionSandboxPolicy({ _meta: before ?? {} });
    const moved = JSON.stringify(before?.['vscode.resolvedSandboxPolicy']) !== JSON.stringify(withSessionSandboxPolicy({}, floor)['vscode.resolvedSandboxPolicy']);
    if (moved) {
      // Confirmed `off` is kept only where the new floor allows bypass.
      const base = floor?.enabled === true && previous?.enabled !== true && floor.allowBypass !== true
        ? withSessionSandboxState(before, undefined)
        : before;
      metas.set(session, withSessionSandboxPolicy(base, floor));
      said(session);
    }
    const preserved = (chosen || (!moved && chosenBy.has(session))) && floor?.allowBypass === true;
    if (floor?.failClosed === true || preserved) return;
    if (sessionSelection(session) === 'off' && resolveSandboxEnabled('off', floor, sessionEnabled(session)) === 'on') write(session, 'on', false);
  };

  /*
   * Written only where it moved; a rejected selection stays reported until a
   * new one is made.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentConfigurationService.ts#L1146-L1157
   */
  const applied = (session: string, chat: string, enabled: boolean): void => {
    const previous = appliedState(session, chat);
    const own = readChatSandboxState({ _meta: metas.get(session) ?? {} }, chat);
    if (previous !== undefined && previous.enabled === enabled && previous.error === undefined && own !== undefined) return;
    writeState(session, chat, { enabled, ...(previous?.rejectedSelection === true ? { rejectedSelection: true } : {}) });
  };

  /*
   * Said once for one failure: a failure with the same words already
   * reported is not said again.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentConfigurationService.ts#L1172-L1178
   */
  const conflict = (session: string, chat: string, message: string): void => {
    const previous = appliedState(session, chat);
    if (previous?.error !== undefined && 'id' in previous.error && previous.error.message === message) return;
    writeState(session, chat, { ...previous, error: { id: crypto.randomUUID(), message } });
  };

  /*
   * The failure published before the rollback, so a client can say it before
   * it reconciles its toggle; then the session's selection put back to the
   * enablement last applied. A chat with no enablement applied yet has
   * nothing to go back to, and a selection made since the one asked for
   * stands.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentConfigurationService.ts#L1206-L1240
   */
  const reject = (session: string, chat: string, asked: unknown, origin: Origin, message: string): void => {
    const previous = appliedState(session, chat);
    if (previous?.enabled === undefined || selection(session, chat) !== asked) return;
    writeState(session, chat, {
      enabled: previous.enabled,
      rejectedSelection: true,
      error: { clientId: origin.clientId, clientSeq: origin.clientSeq, message },
    });
    write(session, previous.enabled ? 'on' : 'off', true);
  };

  /*
   * The computer the session runs on asked, as VS Code's runtime applies a
   * chat's sandbox and the configuration service records the result. A
   * client's selection under a floor that keeps the sandbox on and allows
   * bypass is the chat's enablement, as VS Code's runtime takes it with its
   * session command, and a client's `off` under a floor that fails closed is
   * refused in the words VS Code reads as the runtime's refusal.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/copilot/copilotSessionSandbox.ts#L376-L461
   */
  const check = async (session: string, chat: string, origin?: Origin, requested?: unknown): Promise<void> => {
    const port = ctx.options.computers;
    if (port === undefined) return;
    const floor = policy();
    const asked = requested === 'on' || requested === 'off' || requested === 'default' ? requested : undefined;
    const enabled = asked !== undefined && floor?.enabled === true && floor.allowBypass === true
      ? asked === 'on' || (asked === 'default' && config(session, chat).enabled === 'on')
      : config(session, chat).enabled === 'on';
    const refused = asked === 'off' && floor?.failClosed === true
      ? MANAGED_POLICY_CONFLICT
      : enabled && port.sandboxSupport !== undefined
        ? await port.sandboxSupport(computerId(sessions.get(session)?.config['computer']))
        : undefined;
    if (refused === undefined) applied(session, chat, enabled);
    else if (origin !== undefined) reject(session, chat, requested, origin, refused);
    else conflict(session, chat, refused);
  };

  return {
    config,
    meta: (session) => metas.get(session) ?? {},
    publish,
    applied,
    conflict,
    reject,
    check,
    configChanged: (session, config, origin) => { changed(session, config, origin, false); },

    /*
     * Every session's floor published again and every chat's sandbox applied
     * again, as VS Code's host publishes each session's floor on a root
     * change and its runtimes apply their sandbox again.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentConfigurationService.ts#L473-L478
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/copilot/copilotAgentSession.ts#L8229-L8243
     */
    rootChanged: () => {
      for (const [session, held] of sessions) {
        publish(session);
        for (const chat of held.chats.keys()) applyTo(session, chat);
      }
    },

    forget: (session) => {
      metas.delete(session);
      chosenBy.delete(session);
    },
  };
}
