import { rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ConfigTaken, Session } from '@ahpd/sdk';
import { bag } from './common.js';
import type { SessionContext } from './context.js';

/**
 * The effort levels this backend has, weakest first: what a model's own
 * `thinkingLevel` form offers and a turn's message names, the five VS Code's
 * Claude resolves a model selection to.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/claudeModelConfig.ts#L66-L81
 */
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;

/** What a person reads instead of an effort level. The reference client's words. */
export const EFFORT_LABELS: Record<typeof EFFORTS[number], string> = {
  low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra High', max: 'Max',
};

/**
 * The SDK's alias row for the model the CLI is set to use, which names a
 * model the list already holds, so it is no model of its own to offer, as
 * VS Code's Claude agent leaves it out.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeAgent.ts#L147-L164
 */
export const SDK_DEFAULT_MODEL_VALUE = 'default';

/**
 * What each effort does, in VS Code's words for it.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/reasoningEffort.ts#L72-L84
 */
export const EFFORT_DESCRIPTIONS: Record<typeof EFFORTS[number], string> = {
  low: 'Faster responses with less reasoning',
  medium: 'Balanced reasoning and speed',
  high: 'Greater reasoning depth but slower',
  xhigh: 'Highest reasoning depth but slowest',
  max: 'Absolute maximum capability with no constraints',
};

/**
 * How hard *this* model can be told to think, as its own config schema.
 *
 * Per model: the CLI reports a different `supportedEffortLevels` for each -
 * some take all five, some take one, and some take none - and a control lists
 * what its model has. A model that supports none gets no schema and a client
 * draws no control, which is the honest form of "this one does not think
 * harder on request". The boot probe and every session's handshake read a
 * model this one way, so the list a handshake answers is the list the probe
 * did.
 *
 * `thinkingLevel` is the key, because that is the one the reference client's
 * picker writes into `ModelSelection.config` for both of its providers, and
 * the property is VS Code's Claude schema for it.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/claudeModelConfig.ts#L107-L126
 */
export const thinkingFor = (efforts: string[]): { configSchema?: Record<string, unknown> } => {
  if (efforts.length === 0) return {};
  return {
    configSchema: {
      type: 'object',
      properties: {
        thinkingLevel: {
          type: 'string',
          title: 'Effort Level',
          description: 'Controls how much reasoning effort Claude uses.',
          enum: [...efforts],
          enumLabels: efforts.map((one) => EFFORT_LABELS[one as typeof EFFORTS[number]] ?? one),
          enumDescriptions: efforts.map((one) => EFFORT_DESCRIPTIONS[one as typeof EFFORTS[number]] ?? ''),
          ...(efforts.includes('high') ? { default: 'high' } : {}),
        },
      },
    },
  };
};

/** One client-generated script, sourced before every shell command. */
interface ShellInitScript { shell: 'bash' | 'powershell'; script: string }

/** A generated script is a few hundred bytes; anything near this is not one. */
const MAX_SHELL_INIT_SCRIPT = 64 * 1024;

/**
 * The `shellInitScripts` value, checked to VS Code's `isShellInitScriptList`.
 *
 * A list of at most one `{ shell, script }`, its script non-empty and no
 * longer than a generated one could be. `undefined` for anything else, which
 * is what keeps it off the disk.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/shellInitScript.ts#L110-L126
 */
const shellInitScripts = (value: unknown): ShellInitScript[] | undefined => {
  if (!Array.isArray(value) || value.length > 1) return undefined;
  const list: ShellInitScript[] = [];
  for (const entry of value) {
    const one = bag(entry);
    if ((one.shell !== 'bash' && one.shell !== 'powershell') || typeof one.script !== 'string') return undefined;
    if (one.script.length === 0 || one.script.length > MAX_SHELL_INIT_SCRIPT) return undefined;
    list.push({ shell: one.shell, script: one.script });
  }
  return list;
};

/**
 * A `permissions` value, if it is one.
 *
 * `undefined` for anything else, which is what makes `setConfig` able to
 * refuse: a client sending a string where the schema says an object should
 * hear that the value was not taken rather than have it quietly ignored.
 */
export const listsOf = (value: unknown): { allow: string[]; deny: string[] } | undefined => {
  if (typeof value !== 'object' || value === null) return undefined;
  const held = value as { allow?: unknown; deny?: unknown };
  const names = (one: unknown): string[] =>
    (Array.isArray(one) ? one : []).filter((entry): entry is string => typeof entry === 'string');
  if (held.allow === undefined && held.deny === undefined) return undefined;
  return { allow: names(held.allow), deny: names(held.deny) };
};

/** What this area offers the rest of the session, and its `Session` methods. */
export interface Config {
  /** The path the shell init script is written to, and removed from. */
  initScript: string;
  /** The bash script in force, which a CLI of this session takes as its session environment file. */
  scriptInForce: () => string | undefined;
  /** Take a `shellInitScripts` value, or say why it is not one. */
  setShellInit: (value: unknown) => true | string;
  methods: {
    setConfig: (key: string, value: unknown) => ConfigTaken | Promise<ConfigTaken>;
    settings: () => Record<string, unknown>;
  };
}

export function createConfig(ctx: SessionContext): Config {
  /*
   * The shell init script, on disk where the CLI reads it.
   *
   * The reference client pushes `shellInitScripts` for the profile and the
   * Python environment it has selected, and VS Code's Copilot writes the
   * script to a file and hands its runtime that file. The CLI's own place for
   * one is its session environment file, `CLAUDE_ENV_FILE`, a script whose
   * contents it runs before each Bash command in the same shell process, so
   * the bash entry is written to one path for the session's life and a CLI is
   * handed the path (`query.ts`) while a script is in force. The bash entry
   * only: the CLI's shell tool is bash on every platform it runs on. The
   * operator's environment reaches the same shells through the CLI's
   * `settings.env`, and the script runs after it, so it can still change what
   * the operator set.
   * https://code.claude.com/docs/en/hooks#persist-environment-variables
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/copilot/copilotAgentSession.ts#L8498-L8511
   */
  const initScript = join(tmpdir(), `ahpd-shell-init-${crypto.randomUUID()}.sh`);
  let inForce: string | undefined;
  const setShellInit = (value: unknown): true | string => {
    const list = shellInitScripts(value);
    /*
     * A malformed value is held as it was set and the last valid script stays
     * in force, as VS Code's Copilot ignores one and keeps the script it had.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/copilot/copilotAgentSession.ts#L8469-L8473
     */
    if (list === undefined) {
      console.warn('@ahpd/agent-claude: ignoring a malformed shellInitScripts; the last valid script stays in force');
      ctx.config.shellInitScripts = value;
      return true;
    }
    const bash = list.find((one) => one.shell === 'bash');
    try {
      if (bash === undefined) rmSync(initScript, { force: true });
      else writeFileSync(initScript, bash.script, { mode: 0o600 });
    }
    catch (error) {
      return `Could not write the shell init script: ${error instanceof Error ? error.message : String(error)}`;
    }
    inForce = bash?.script;
    ctx.config.shellInitScripts = list;
    return true;
  };

  const methods: Config['methods'] = {
    /**
     * Every key a client sets, taken as VS Code's host takes any key but its
     * own: `permissions`, `shellInitScripts` and `permissionMode` act on the
     * CLI, and any other is held as it was set. A value the CLI cannot take
     * is refused, so a client never shows a session in a state it is not in.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L13606-L13610
     */
    setConfig: async (key, value) => {
      /*
       * The lists, which really do move on a running session.
       *
       * The SDK takes `allowedTools` / `disallowedTools` when the query is
       * built and has nowhere to put a later change, so a list set halfway
       * through would be a control that reported success and did nothing.
       * `canUseTool` is the other half and reads `allowed` on every call -
       * which is where a change made now takes effect.
       */
      if (key === 'permissions') {
        const held = listsOf(value);
        if (!held) return `${key} takes an object with allow and deny, not ${typeof value}`;
        ctx.allowed = held;
        ctx.config.permissions = held;
        return true;
      }
      if (key === 'shellInitScripts') return setShellInit(value);
      if (key !== 'permissionMode') {
        ctx.config[key] = value;
        return true;
      }
      /*
       * The schema's own property, whose values are the CLI's, `dontAsk` among
       * them unless the record's `dontAsk` is off; a value it does not offer
       * is refused in VS Code's sentence.
       * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/sessionConfigProperties.ts#L144-L147
       */
      const modes = (['default', 'acceptEdits', 'plan', 'auto', 'bypassPermissions', 'dontAsk'] as const)
        .slice(0, ctx.values['dontAsk'] === false ? 5 : 6);
      const found = modes.find((one) => one === value);
      if (!found) return `Session configuration '${key}' does not offer '${String(value)}'.`;
      // The CLI running takes it now, and a session's first CLI starts on it.
      ctx.config.permissionMode = found;
      void ctx.query?.setPermissionMode(found).catch(() => {});
      return true;
    },

    settings: () => ({ ...ctx.config, ...(ctx.chosen ? { model: ctx.chosen } : {}) }),
  };

  return { initScript, scriptInForce: () => inForce, setShellInit, methods };
}
