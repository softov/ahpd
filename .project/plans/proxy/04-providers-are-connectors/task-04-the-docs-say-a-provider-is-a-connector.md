---
title: The docs say a provider is a connector
status: done
depends: [task-03-the-proxy-routes-through-connectors.md]
layer: "docs"
refs:
  - "[code://docs/server/PROXY.md](../../../../docs/server/PROXY.md) - the proxy guide, with its routing and refusal sections"
  - "[code://docs/server/CONFIGURE.md](../../../../docs/server/CONFIGURE.md) - the configuration guide"
  - "[code://docs/plugins/PLUGINS.md#L501](../../../../docs/plugins/PLUGINS.md#L501) - the adapter section, which gets `provider` and `models`"
  - "[code://.project/plans/proxy/00-proxy.md](../../00-proxy.md) - the proxy domain, which names the built-ins as contracts"
---

## Objective

The docs say that a provider is a connector, and how to add one.
They name the four adapters, the owner order and the refusal of `modelProxy.providers`.
Softov has the steps to move his own file before he restarts.

## Files

- `UPDATE: docs/server/PROXY.md` - a section on adding a provider, the owner order, the four adapters and the move from `providers`.
- `UPDATE: docs/server/CONFIGURE.md` - remove `modelProxy.providers`, and point at PROXY.md.
- `UPDATE: docs/plugins/PLUGINS.md:501` - the `models` capability and `Adapter.provider`.
- `UPDATE: .project/plans/proxy/00-proxy.md` - the contracts and the runtime path with connectors.
- `CREATE: .project/pending/proxy-04-move-config-dev.md` - the steps to move `providers.local` and the keys of `config-dev.json` to connectors.

## Steps

1. Write "Adding a provider" in PROXY.md, with one example put for `openrouter` and one for `openai-compatible`.
2. Write the owner order: the caller's own, the scope team's, then the host's, and a connector id for one endpoint.
3. Write the move from `providers`: one connector for each entry, and `{ "fromEnv": "<NAME>" }` for a key in a daemon variable.
4. Replace the routing section's mention of keys in the environment with connectors.
5. Remove `modelProxy.providers` from CONFIGURE.md.
6. Add the `models` capability and `provider` to the adapter section of PLUGINS.md.
7. Update `00-proxy.md` for the new contracts and runtime path.
8. Write the pending file with the steps to move `config-dev.json`.
9. Include these steps: remove `providers`, and put a `local` connector at `http://127.0.0.1:1234/v1`.
10. Include one host connector for each key.
11. Run `lint-prose` on each `.project` file you change.

## Validation

- `rg -n "OPENROUTER_API_KEY|modelProxy.providers" docs` finds only the move section.
- The gate passes: `pnpm -s typecheck && pnpm -s build && pnpm -s boundary && pnpm -s test`.
- By hand: Softov follows the pending file and his daemon starts with the proxy working.

## Resume

- **Done so far:** `docs/server/PROXY.md` has "Adding a provider", "Whose connector serves a call" and "Moving from `modelProxy.providers`". Its routing, refusal, models list and record sections name connectors. `docs/server/CONFIGURE.md` points at those sections. `docs/plugins/PLUGINS.md` lists `models` among the capability types and documents `provider(connector)`. `.project/plans/proxy/00-proxy.md` has the four adapters, the owner order and the channel in its contracts and runtime path. `.project/pending/proxy-04-move-config-dev.md` has Softov's steps.
- **Next action:** none for this task. Softov moves `config-dev.json` before the restart, and curates the four icons.
- **Open questions:** none.
- **Watch out for:** the move section is the only place in `docs` that writes the vendor key variables. `docs/server/CONFIGURE.md` names `modelProxy.providers` only to say the start refuses it.
