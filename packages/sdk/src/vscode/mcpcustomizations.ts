/**
 * The MCP servers a session's customizations hold, and the id of the one a
 * server name names, as VS Code reads them.
 *
 * Vendored from VS Code's `mcpCustomizationController.ts`
 * (`findMcpChildId`, `getMcpServerCustomizations`). The adaptation is this
 * package's: a customization is read as the protocol's record it is on the
 * wire, a `type` of `mcpServer` and its `children`, where VS Code types it
 * with its `Customization` union.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/shared/mcpCustomizationController.ts#L688-L710
 */

import type { Bag } from '../types/common.js';

/**
 * Convenience helper: given a flat list of customization entries, returns the
 * id of the first MCP child customization whose name matches `serverName`.
 */
export function findMcpChildId(customizations: readonly Bag[], serverName: string): string | undefined {
  const id = getMcpServerCustomizations(customizations).find((server) => server.name === serverName)?.id;
  return typeof id === 'string' ? id : undefined;
}

export function getMcpServerCustomizations(customizations: readonly Bag[]): readonly Bag[] {
  const result: Bag[] = [];
  for (const top of customizations) {
    if (top.type === 'mcpServer') {
      result.push(top);
    } else {
      for (const child of Array.isArray(top.children) ? top.children as Bag[] : []) {
        if (child.type === 'mcpServer') {
          result.push(child);
        }
      }
    }
  }
  return result;
}
