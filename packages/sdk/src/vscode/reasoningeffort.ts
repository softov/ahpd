/**
 * The reasoning effort levels VS Code's agent host offers, and the words and
 * the default its pickers draw them with.
 *
 * Vendored from VS Code's `reasoningEffort.ts`, which its agents share "so
 * every provider renders the same value consistently": the levels, the label
 * and description of each, and the default a model's picker opens on. The
 * adaptation is this package's: each string is VS Code's English text where
 * VS Code wraps it in `localize`, and the dashes of its comments are written
 * as other punctuation.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/reasoningEffort.ts#L8-L111
 */

/**
 * Every reasoning effort or thinking level value surfaced by any agent host
 * provider, ordered from least to most effort.
 */
export const reasoningEffortLevels = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'] as const;

/** The key a model's `configSchema` names its level under, which VS Code's picker writes. */
export const ReasoningEffortConfigKey = 'thinkingLevel';

/** One of {@link reasoningEffortLevels}. */
export type ReasoningEffortLevel = typeof reasoningEffortLevels[number];

/** Narrows an arbitrary string to a recognized {@link ReasoningEffortLevel}. */
export function isReasoningEffortLevel(value: string | undefined): value is ReasoningEffortLevel {
  return value !== undefined && (reasoningEffortLevels as readonly string[]).includes(value);
}

/**
 * Title-cased picker label for a reasoning effort value. Falls back to
 * capitalizing an unrecognized value so a newly introduced effort tier never
 * surfaces raw.
 */
export function getReasoningEffortLabel(level: string): string {
  switch (level) {
    case 'none': return 'None';
    case 'minimal': return 'Minimal';
    case 'low': return 'Low';
    case 'medium': return 'Medium';
    case 'high': return 'High';
    case 'xhigh': return 'Extra High';
    case 'max': return 'Max';
    case 'ultra': return 'Ultra';
    default: return level.charAt(0).toUpperCase() + level.slice(1);
  }
}

/**
 * Description for a reasoning effort value, shown beneath the label in the
 * picker. Returns `undefined` for an unrecognized value so callers can omit
 * the description rather than show an empty string.
 */
export function getReasoningEffortDescription(level: string): string | undefined {
  switch (level) {
    case 'none': return 'No reasoning applied';
    case 'minimal': return 'Minimal reasoning for fastest responses';
    case 'low': return 'Faster responses with less reasoning';
    case 'medium': return 'Balanced reasoning and speed';
    case 'high': return 'Greater reasoning depth but slower';
    case 'xhigh': return 'Highest reasoning depth but slowest';
    case 'max': return 'Absolute maximum capability with no constraints';
    case 'ultra': return 'Maximum reasoning with automatic task delegation';
    default: return undefined;
  }
}

/**
 * Whether Anthropic's default effort for a Claude model is `'medium'` rather
 * than `'high'`: Claude Opus 5.5 and Claude Haiku 5.5.
 */
function isMediumEffortDefaultClaudeModel(modelId: string | undefined): boolean {
  return !!modelId && /^claude-(?:opus|haiku)-5[.-]5(?![.\d])/.test(modelId.toLowerCase());
}

/**
 * Resolve the default reasoning effort for a model so the picker never renders
 * an `undefined` selection. Prefers the declared default, then `'medium'` for
 * Claude Opus or Haiku 5.5, `'high'` for other Claude and Kimi K3 models and
 * `'medium'` otherwise, then the first supported level.
 */
export function resolveDefaultReasoningEffort(supportedEfforts: readonly string[] | undefined, declaredDefault?: string, modelId?: string): string | undefined {
  if (!supportedEfforts?.length) {
    return undefined;
  }
  if (declaredDefault && supportedEfforts.includes(declaredDefault)) {
    return declaredDefault;
  }
  const lowerId = modelId?.toLowerCase() ?? '';
  const preferred = !isMediumEffortDefaultClaudeModel(lowerId) && (lowerId.startsWith('claude') || lowerId.includes('kimi-k3')) ? 'high' : 'medium';
  return supportedEfforts.includes(preferred) ? preferred : supportedEfforts[0];
}
