---
title: Check ahpd on macOS
plans: []
---

# Check ahpd on macOS

Nobody has run ahpd on macOS. These checks cover what differs from Linux: the install, the native terminal binding, signals, the folders, and what the host says about the machine. Run them on one Mac, Apple silicon if you have one.

## Set up

On the Mac:

```bash
npm i -g @softov/ahpc
git clone git@github.com:softov/ahpd.git ~/ahpd-check && cd ~/ahpd-check && pnpm install && pnpm build
echo check-token > /tmp/ahpd-token
export XDG_CONFIG_HOME=/tmp/ahpd-chk
alias ahpd="node $HOME/ahpd-check/packages/server/dist/main.js"
mkdir -p ~/ahpd-work && git -C ~/ahpd-work init -q && ahpd paths add ~/ahpd-work
node -e 'const fs=require("fs"),f="/tmp/ahpd-chk/ahpd/config.json",c=JSON.parse(fs.readFileSync(f,"utf8"));c.plugins=[process.env.HOME+"/ahpd-check/packages/agent-claude"];fs.writeFileSync(f,JSON.stringify(c,null,2)+"\n")'
```

Write down any error from `node-pty` in `pnpm install`.

## The install from npm

1. In a new shell, without the alias and the `XDG_CONFIG_HOME` of *Set up*, run `npm i -g @ahpd/server`.
2. Run `ahpd --version`.
3. Run `ahpd configure`, and choose the three agent plugins.
4. Check that each plugin is in `~/.config/ahpd/node_modules`, and that `ahpd plugin list` shows each one loaded.
5. Run `ahpd plugin remove @ahpd/agent-pi`, and check that it is gone from the list and from `config.json`.

## Start, status and stop

1. Run `ahpd start --port 39111 --connection-token-file /tmp/ahpd-token`.
2. Check that `ahpd status --json` shows the pid and the folder.
3. Open a session with ahpc: `ahpc --host ws://127.0.0.1:39111 --connection-token-file /tmp/ahpd-token`.
4. Start a turn, then run `ahpd stop`.
5. Check that `daemon.log` shows `stopping` and then `stopped`, and that `ahpd status --json` prints `{"running":false}`.

## Restart

1. Start the daemon as above, and start a turn.
2. Run `ahpd restart`. It must print `A turn is running in <session>; it restarts once the turns end, or at once with --force.` and exit 0, and the log must say `restart parked (SIGHUP): ...`. Let the turn end, then check that the log says `restart: the turns have ended, stopping`, and that the successor comes up.
3. Start a turn again, and run `ahpd restart --force`. The log must say `restart: stopping (SIGUSR2)`, and the successor must come up.
4. Check that the session resumes with its earlier conversation.

## Terminals

1. In a session, open a terminal from ahpc or VS Code.
2. Run `echo $SHELL` and `ls` in it. The output must come back, with colors.
3. Resize the window, and check that the terminal follows.
4. If `node-pty` failed to install, check that the log says why, and that the daemon still serves sessions.

## The machine the host reports

1. Connect VS Code to the daemon as a remote agent host.
2. Check that VS Code offers the host for a session. It reads the platform as `macos`.
3. Run `ahpc --host ws://127.0.0.1:39111 --connection-token-file /tmp/ahpd-token agents`, and check that the Claude backend lists its models.

## Worktrees

1. In a git folder, start a session that makes a worktree.
2. Check that the worktree is made, and that its folder links resolve.

## Reply

Write "pass" for each section, or what you saw. A failed section becomes a problem or a task.
