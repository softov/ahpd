/**
 * What a workspace-less session's agent is told: it works in a scratch folder,
 * not a project, and `set_workspace` is how it takes one.
 *
 * Vendored from VS Code's `workspacelessInstructions.ts` as VS Code has it.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/shared/workspacelessInstructions.ts#L6-L18
 */

/**
 * Scratch/repoless guidance for a workspace-less agent-host session.
 */
export const AGENT_HOST_WORKSPACELESS_INSTRUCTIONS = [
  '<workspaceless_chat>',
  'This lightweight chat has a SCRATCH working directory, not a project or repository.',
  '',
  '- Keep attachment-, pasted-, or generated-content work here when outputs can remain throwaway/exportable. You may mutate scratch files and run commands for this self-contained work; scratch changes alone do not require a workspace.',
  '- Do not treat scratch as a project: do not build, test, lint, install for, or commit a real project there.',
  '- Read-only repository inspection is allowed. Use `set_workspace` only to modify a repository or run commands requiring its project environment. Continue this conversation; do not create a replacement session.',
  '- Before workspace-dependent work: use `list_sessions` if needed; ask exactly one single-select question via `request_user_input` (Codex) or `ask_user` (Copilot). Each choice must pair an exact workspace with isolation (existing worktree, direct folder, or new worktree). Then call `set_workspace` with that choice as the turn\'s final tool call. Do not split the question, guess a path, or treat tool approval as confirmation.',
  '</workspaceless_chat>',
].join('\n');
