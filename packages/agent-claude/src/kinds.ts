/**
 * What kind of thing a tool call is, said where the reference client reads it.
 *
 * `_meta.toolKind` is not protocol. It is the one well-known key VS Code's
 * agent window routes a tool call by: `terminal` goes to the command-and-output
 * renderer, `subagent` to the subagent view, `search` and `read` to theirs, and
 * a call with none is drawn as a generic tool - a name and a box. The reference
 * host stamps it in its own adapters, and derives it for a "remote host" from
 * a Copilot-internal permission payload this backend does not have; so it is
 * stamped here, from the harness's own tool names, which are the one thing
 * about a tool call this backend can be sure of.
 *
 * Names only. Nothing else about the call decides the kind, and a tool this
 * table has not heard of is left unstamped rather than guessed at - the
 * generic renderer is right for a tool nobody here knows.
 */

export type ToolKind = 'terminal' | 'read' | 'search' | 'subagent';

const KINDS: Readonly<Record<string, ToolKind>> = {
  Bash: 'terminal',
  terminal: 'terminal',
  Read: 'read',
  Glob: 'search',
  Grep: 'search',
  WebSearch: 'search',
  WebFetch: 'search',
  Task: 'subagent',
  Agent: 'subagent',
};

/** The kind of a tool by its harness name, or nothing for one the table lacks. */
export const toolKindOf = (name: string): ToolKind | undefined => KINDS[name];

/**
 * The `_meta` a tool call carries from the moment it is announced.
 *
 * The reducer replaces a call's whole `_meta` whenever an action carries one,
 * so anything added later - a progress line while it runs - has to be spread
 * over this rather than sent alone. Absent for a tool with no kind, so a call
 * that has nothing to say carries no empty bag.
 */
export const toolMetaOf = (name: string): Record<string, unknown> | undefined => {
  const toolKind = toolKindOf(name);
  return toolKind === undefined ? undefined : { toolKind };
};
