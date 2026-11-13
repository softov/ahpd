---
title: The host's operations read plain, in the reader's language
status: implemented
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/kinds/operations.ts](../../../../packages/sdk/src/kinds/operations.ts) - where the shared function goes"
  - "[code://packages/sdk/src/agents/channel.ts#L1235-L1241](../../../../packages/sdk/src/agents/channel.ts#L1235-L1241) - the agent operations"
  - "[code://packages/sdk/src/connectors/channel.ts#L1737-L1766](../../../../packages/sdk/src/connectors/channel.ts#L1737-L1766) - the connector operations"
  - "[code://packages/sdk/src/tunnels/channel.ts#L315-L366](../../../../packages/sdk/src/tunnels/channel.ts#L315-L366) - the tunnel operations"
  - "[code://packages/sdk/src/clients/channel.ts#L112-L122](../../../../packages/sdk/src/clients/channel.ts#L112-L122) - the client operation"
  - "[code://packages/sdk/src/i18n/pt.json](../../../../packages/sdk/src/i18n/pt.json) - the host's Portuguese catalog"
  - "[code://packages/sdk/src/i18n/es.json](../../../../packages/sdk/src/i18n/es.json) - the host's Spanish catalog"
---

## Objective

Each host operation has plain English text, and each channel sends its operations in the reader's language. The agent and connector snapshots list their operations.

## Files

- `UPDATE: packages/sdk/src/kinds/operations.ts` - `operationsIn(operations, row, locale, catalogs?)`, which translates each label, description and confirmation.
- `UPDATE: packages/sdk/src/agents/channel.ts` - the new English, and the snapshot lists the operations in the reader's locale.
- `UPDATE: packages/sdk/src/connectors/channel.ts` - the same.
- `UPDATE: packages/sdk/src/tunnels/channel.ts` - plain verbs, descriptions, the question without the kind, the snapshot in the reader's locale, and `publishOperations` sent to each subscriber.
- `UPDATE: packages/sdk/src/clients/channel.ts` - the new English, and the snapshot in the reader's locale.
- `UPDATE: packages/sdk/src/i18n/pt.json`, `packages/sdk/src/i18n/es.json` - the `operations` keys.
- `UPDATE` the tests of the four channels, and `CREATE` one for `operationsIn`.

## The text

| Key | English | Portuguese | Spanish |
| --- | --- | --- | --- |
| `agent.enable.label` | Enable | Ativar | Activar |
| `agent.enable.description` | Turns the agent on again. | Ativa o agente de novo. | Activa el agente de nuevo. |
| `agent.pause.label` | Pause | Pausar | Pausar |
| `agent.pause.description` | Stops new sessions and new messages on this agent. | Bloqueia novas sessões e mensagens neste agente. | Bloquea nuevas sesiones y mensajes en este agente. |
| `agent.disable.label` | Disable | Desativar | Desactivar |
| `agent.disable.description` | Turns the agent off. Nobody can use it until it is on again. | Desativa o agente. Ninguém o usa até ele ser ativado de novo. | Desactiva el agente. Nadie puede usarlo hasta que se active de nuevo. |
| `agent.check.label` | Check | Verificar | Comprobar |
| `agent.check.description` | Checks that the agent can run on this host. | Verifica se o agente pode rodar neste host. | Comprueba si el agente puede ejecutarse en este host. |
| `agent.remove.label` | Remove | Remover | Eliminar |
| `agent.remove.description` | Ends the agent's sessions and deletes the agent. | Encerra as sessões do agente e o exclui. | Cierra las sesiones del agente y lo elimina. |
| `agent.remove.confirmation` | Remove this agent? Its sessions end, and the agent is deleted. | Remover este agente? As sessões dele terminam e ele é excluído. | ¿Eliminar este agente? Sus sesiones terminan y el agente se elimina. |
| `connector.enable.label` | Enable | Ativar | Activar |
| `connector.enable.description` | Turns the connector on and checks it. | Ativa o conector e o verifica. | Activa el conector y lo comprueba. |
| `connector.disable.label` | Disable | Desativar | Desactivar |
| `connector.disable.description` | Turns the connector off. Registers and calls through it stop. | Desativa o conector. Os registros e as chamadas por ele param. | Desactiva el conector. Los registros y las llamadas a través de él se detienen. |
| `connector.remove.label` | Remove | Remover | Eliminar |
| `connector.remove.description` | Deletes the connector and its saved credentials. | Exclui o conector e as credenciais salvas dele. | Elimina el conector y sus credenciales guardadas. |
| `connector.remove.confirmation` | Remove this connector? Its saved credentials are deleted too. | Remover este conector? As credenciais salvas dele também são excluídas. | ¿Eliminar este conector? Sus credenciales guardadas también se eliminan. |
| `tunnel.update.label` | Edit | Editar | Editar |
| `tunnel.update.description` | Changes this tunnel's settings. | Altera as configurações deste túnel. | Cambia la configuración de este túnel. |
| `tunnel.remove.label` | Remove | Remover | Eliminar |
| `tunnel.remove.description` | Deletes this tunnel. | Exclui este túnel. | Elimina este túnel. |
| `tunnel.remove.confirmation` | Remove this tunnel? Its address stops reaching this host. | Remover este túnel? O endereço dele deixa de chegar a este host. | ¿Eliminar este túnel? Su dirección deja de llegar a este host. |
| `tunnel.enable.label` | Enable | Ativar | Activar |
| `tunnel.enable.description` | Turns the tunnel on. | Ativa o túnel. | Activa el túnel. |
| `tunnel.disable.label` | Disable | Desativar | Desactivar |
| `tunnel.disable.description` | Turns the tunnel off. Its address stops reaching this host. | Desativa o túnel. O endereço dele deixa de chegar a este host. | Desactiva el túnel. Su dirección deja de llegar a este host. |
| `client.drop.label` | Drop | Desconectar | Desconectar |
| `client.drop.description` | Closes this connection. The client can connect again at once. | Fecha esta conexão. O cliente pode se conectar de novo na hora. | Cierra esta conexión. El cliente puede volver a conectarse enseguida. |
| `client.drop.confirmation` | Drop this client? Its connection closes now, and it can connect again. | Desconectar este cliente? A conexão fecha agora e ele pode se conectar de novo. | ¿Desconectar este cliente? Su conexión se cierra ahora y puede volver a conectarse. |

## Steps

1. Add `operationsIn` to `kinds/operations.ts`. It takes the operations, the row name, the locale and the plugin's catalogs, and translates each field at `operations.<row>.<name>.<field>`. `<name>` is the id after the last `/`. A field the operation does not have stays absent.
2. Change the English of each host operation to the table's English.
3. In the tunnel list, make the update and remove labels the plain verb.
4. Give update and remove a description, and make the remove question the table's.
5. In the agent and connector channels, wrap the records snapshot, as the tunnel and client channels do, and add `operations`.
6. In each of the four snapshots, send `operationsIn(..., handle.localeOf(client))`.
7. Send `x-ahpd-tunnels/operations` to each subscriber with `to`, in that subscriber's locale.
8. Add the `operations` keys to `pt.json` and `es.json`.
9. Test `operationsIn` with `pt`, `es`, `pt-BR` and no locale. Test one snapshot of each channel with `pt`.

## Validation

- A `pt` snapshot of `x-ahpd-agents://` has "Desativar" and "Desativa o agente. Ninguém o usa até ele ser ativado de novo." for `disable`.
- A snapshot with no locale has the English of the table.
- The tunnel list shows "Edit" and "Remove" as the update and remove labels for every kind.
- `pnpm typecheck`, and the sdk and server suites, pass.

## Resume

Implemented 2026-11-13. `withOperations` in `kinds/operations.ts` wraps the agent and connector lists, which had no wrapper. `tools/i18n-check.mjs` learned the `operations` block. See [implemented.md](implemented.md).
