---
title: A tunnel kind's own operations read plain
status: implemented
depends: [01]
layer: "sdk, tunnel-devtunnel"
refs:
  - "[code://packages/sdk/src/plugins/plugins.ts#L658-L669](../../../../packages/sdk/src/plugins/plugins.ts#L658-L669) - the fold of the tunnel kinds"
  - "[code://packages/sdk/src/plugins/plugins.ts#L504](../../../../packages/sdk/src/plugins/plugins.ts#L504) - an agent keeps its plugin's catalogs"
  - "[code://packages/sdk/src/types/tunnels.ts#L203-L206](../../../../packages/sdk/src/types/tunnels.ts#L203-L206) - `ServedTunnelKind`"
  - "[code://packages/tunnel-devtunnel/src/kind.ts#L121-L152](../../../../packages/tunnel-devtunnel/src/kind.ts#L121-L152) - the Dev Tunnel's own operations"
  - "[code://packages/tunnel-devtunnel/i18n/pt.json](../../../../packages/tunnel-devtunnel/i18n/pt.json) - the Dev Tunnel plugin's Portuguese catalog"
---

## Objective

A tunnel kind keeps its plugin's catalogs, and the tunnel list sends the kind's own operations in the reader's language. The Dev Tunnel's four operations have plain English, Portuguese and Spanish.

## Files

- `UPDATE: packages/sdk/src/types/tunnels.ts` - `ServedTunnelKind.catalogs`.
- `UPDATE: packages/sdk/src/plugins/plugins.ts` - the fold puts the plugin's catalogs on each tunnel kind.
- `UPDATE: packages/sdk/src/tunnels/channel.ts` - a kind's operations and its create are translated with the kind's catalogs.
- `UPDATE: packages/tunnel-devtunnel/src/kind.ts` - the new English.
- `UPDATE: packages/tunnel-devtunnel/i18n/pt.json`, `packages/tunnel-devtunnel/i18n/es.json` - the `operations` keys, and the kind's title and description.
- `UPDATE` the tests of the fold and the tunnel list.

## The text

| Key | English | Portuguese | Spanish |
| --- | --- | --- | --- |
| `start.label` | Start | Iniciar | Iniciar |
| `start.description` | Starts the tunnel, so its address reaches this host. | Inicia o túnel, para que o endereço dele chegue a este host. | Inicia el túnel para que su dirección llegue a este host. |
| `stop.label` | Stop | Parar | Detener |
| `stop.description` | Stops the tunnel. Its address stops reaching this host. | Para o túnel. O endereço dele deixa de chegar a este host. | Detiene el túnel. Su dirección deja de llegar a este host. |
| `restart.label` | Restart | Reiniciar | Reiniciar |
| `restart.description` | Connects the tunnel again. Its address stays the same. | Reconecta o túnel. O endereço continua o mesmo. | Vuelve a conectar el túnel. La dirección sigue siendo la misma. |
| `anonymous.label` | Anonymous access | Acesso anônimo | Acceso anónimo |
| `anonymous.description` | Lets people who are not signed in to this account reach the tunnel. | Permite que pessoas sem login nesta conta acessem o túnel. | Permite que personas sin sesión en esta cuenta accedan al túnel. |

The kind's create keeps its title and description. Its catalog key is `operations.create.label` and `operations.create.description`, with the title and description the plugin's catalog already has in `meta`.

## Steps

1. Add `catalogs?: Catalogs` to `ServedTunnelKind`.
2. In the fold, set `catalogs` from the contribution's `i18n`, as for an agent.
3. In the tunnel list, translate a kind's operations with `operationsIn` and the kind's catalogs first. A kind's own operation reads `operations.<name>` in its plugin's catalog. A host operation reads `operations.tunnel.<name>` in the host's.
4. Change the English of the Dev Tunnel's four operations to the table's.
5. Add the `operations` keys to the plugin's `pt.json` and `es.json`.
6. Test the fold: a tunnel kind from a plugin with catalogs keeps them.
7. Test the tunnel list: a `pt` snapshot has "Iniciar" and its description for a Dev Tunnel row.

## Validation

- A `pt` snapshot of `x-ahpd-tunnels://` with the Dev Tunnel plugin has the four operations in Portuguese.
- `pnpm typecheck`, and the sdk and tunnel-devtunnel suites, pass.

## Resume

Implemented 2026-11-13, with task 01. The plugin's `pt` and `es` catalogs also have `operations.create`. See [implemented.md](implemented.md).
