/**
 * Who decided a permission request, read from a confirmation's `_meta` as VS
 * Code reads it.
 *
 * Vendored from VS Code's `agentPermissionResponseMeta.ts`
 * (`AgentPermissionDecisionSource`, `IAgentPermissionResponseMeta`,
 * `readAgentPermissionResponseMeta`), with the decision source alone: the
 * sandbox path grant it reads beside it is a flag this host has no use for.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/meta/vscode/agentPermissionResponseMeta.ts#L6-L29
 */

export type AgentPermissionDecisionSource = 'human_response' | 'host_policy' | 'assisted_approval' | 'unattended_fallback';

export interface IAgentPermissionResponseMeta {
  readonly decisionSource?: AgentPermissionDecisionSource;
}

const decisionSourceKey = 'agentHost.permissionDecisionSource';

/** Reads client-supplied provenance from confirmation-action metadata. Unknown values omit attribution, not the permission decision. */
export function readAgentPermissionResponseMeta(source: { readonly _meta?: Record<string, unknown> }): IAgentPermissionResponseMeta {
  const decisionSource = source._meta?.[decisionSourceKey];
  switch (decisionSource) {
    case 'human_response':
    case 'host_policy':
    case 'assisted_approval':
    case 'unattended_fallback':
      return { decisionSource };
    default:
      return {};
  }
}
