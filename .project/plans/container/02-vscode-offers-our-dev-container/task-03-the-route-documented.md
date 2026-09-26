---
title: The route to VS Code's dev container flow is documented
status: todo
depends: [task-01-the-tunnel-route-tried-by-hand.md]
layer: "docs"
refs:
  - "[code://docs/CONTAINERS.md](../../../../docs/CONTAINERS.md) - the page a person reads about dev containers"
  - "[code://packages/tunnel-devtunnel/README.md](../../../../packages/tunnel-devtunnel/README.md) - where the tunnel is set up"
---

## Objective

A person reading `docs/CONTAINERS.md` knows that VS Code offers a dev container only on a host connected through a Dev Tunnel (or SSH or WSL), which two settings turn it on, and that Docker is needed on the ahpd host, not on the machine running VS Code.

## Files

- `UPDATE: docs/CONTAINERS.md` - a "From VS Code" section.
- `UPDATE: packages/tunnel-devtunnel/README.md` - one line pointing at it.

## Steps

1. Write the section from task 01's result: the settings, the connect command, where the option appears, and that it is made at the first send.
2. Say that a host added by URL is never offered the flow, and that a local folder is launched by VS Code with the local Docker.

## Validation

- The section's steps followed from scratch reach "Use Dev Container".
- No em dash, no hard wrap.

## Resume
