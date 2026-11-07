/**
 * A skill's argument hint, in the `_meta` key VS Code's agent host publishes it
 * under and its window reads it from.
 *
 * Vendored from VS Code's `skillCustomizationMeta.ts`. The adaptation is this
 * package's: the skill is any customization with a `_meta` bag, since a host
 * here reads a prompt's hint the same way, and the dashes of its comments are
 * written as other punctuation.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/meta/vscode/skillCustomizationMeta.ts#L8-L26
 */

const argumentHintKey = 'vscode.skill.argumentHint';

/**
 * Reads the optional argument hint (the skill's frontmatter `argument-hint`)
 * from a skill customization's `_meta` bag. Hosts that do not publish the hint
 * omit the key; returns `undefined` when absent, wrong-typed, or blank.
 */
export function readSkillArgumentHint(skill: { _meta?: Record<string, unknown> | undefined }): string | undefined {
  const value = skill._meta?.[argumentHintKey];
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

/** Records the argument hint in an open `_meta` bag, preserving every other entry. */
export function withSkillArgumentHintMeta(meta: Record<string, unknown> | undefined, argumentHint: string | undefined): Record<string, unknown> | undefined {
  if (argumentHint === undefined || argumentHint.trim().length === 0) {
    return meta;
  }
  return { ...(meta ?? {}), [argumentHintKey]: argumentHint };
}
