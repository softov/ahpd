---
title: Check a node behind NAT that joins your daemon
plans:
  - plans/container/05-p10-a-host-joins-a-hub/plan.md
---

# Check a node behind NAT that joins your daemon

container/05-p10 is on main, and not in `v0.14.0`. A box behind NAT runs `ahpd join`, dials your daemon, and runs sessions for it. Your daemon is the hub, because a hub needs a users file. The node is any box behind NAT, such as the Windows VM.

## Set up

1. Restart your daemon on main. Stop it with Ctrl+C in its terminal, then run this in that terminal:

```bash
cd /github/ahpd && git pull --ff-only && pnpm install --frozen-lockfile
node --conditions development --import ./scripts/dev.mjs packages/server/src/main.ts --config-file /home/softov/.config/ahpd/config-dev.json
```

2. In a second terminal, add the node, and keep the token it prints:

```bash
cd /github/ahpd
ahpd() { node --conditions development --import ./scripts/dev.mjs packages/server/src/main.ts "$@" --config-file /home/softov/.config/ahpd/config-dev.json; }
ahpd node add box
```

3. On the node, build main and join, with the token in place of `<token>`:

```bash
git clone git@github.com:softov/ahpd.git ~/ahpd-check && cd ~/ahpd-check && pnpm install && pnpm build
mkdir -p ~/box && node packages/server/dist/main.js join ws://200.11.121.81:37537 --token <token> --workdir ~/box
```

## Steps

1. Check that a client lists the computer `node.box`.
2. Start a Claude session on `node.box`, and send one turn. Check that it answers.
3. Run `ahpd restart` in the second terminal on the hub. Check that the node connects again, and that the session continues its conversation.
4. Check that the node's up time is in `~/.config/ahpd/usage/`, as stretches charged to the host:

```bash
tail -3 ~/.config/ahpd/usage/$(date +%Y-%m)-computer.jsonl
```

5. Run `ahpd node rm box`. Check that the node's `join` ends, and that the hub refuses a new `join` with the same token.

## Reply

Write "pass", or say which step stopped.
