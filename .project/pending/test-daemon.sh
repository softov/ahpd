# Start a test ahpd from origin/main, apart from your own daemon.
#
#   source /github/ahpd/.project/pending/test-daemon.sh [plugin ...]
#
# A plugin is a package name under packages/ (agent-claude, bot, push, ...) or
# a path inside the checkout (examples/canvas/plugin.json). With none, it loads
# agent-claude.
#
# What it makes:
#   checkout  /github/ahpd.worktrees/pending-check, detached at origin/main
#   folders   ~/ahpd-check/{config,state,data}, set as XDG_*_HOME in this shell
#   work dir  ~/ahpd-check/work, a git repository the daemon serves
#   daemon    ws://127.0.0.1:39200, token "check-token" in ~/ahpd-check/token
#   commands  `ahpd`, `ahpc` and `rpc` in this shell, all pointed at that daemon
#             (`rpc <method> '<params>'` sends one AHP request, see rpc.mjs)
#
# Stop it with `ahpd stop`. Close the shell to drop the XDG variables.
# It never touches ~/.config/ahpd, port 37537 or port 5180.

AHPD_CHECK=/github/ahpd.worktrees/pending-check
AHPD_CHECK_HOME=$HOME/ahpd-check

git -C /github/ahpd fetch -q origin || return 1
if [ -d "$AHPD_CHECK" ]; then
  git -C "$AHPD_CHECK" checkout -q --detach origin/main || return 1
else
  git -C /github/ahpd worktree add -q --detach "$AHPD_CHECK" origin/main || return 1
fi
(cd "$AHPD_CHECK" && pnpm install --frozen-lockfile --silent && pnpm build >/dev/null) || return 1

export XDG_CONFIG_HOME=$AHPD_CHECK_HOME/config
export XDG_STATE_HOME=$AHPD_CHECK_HOME/state
export XDG_DATA_HOME=$AHPD_CHECK_HOME/data
ahpd() { node "$AHPD_CHECK/packages/server/dist/main.js" "$@"; }
ahpc() { node /github/ahpc/dist/src/main.js --host ws://127.0.0.1:39200 --connection-token-file "$AHPD_CHECK_HOME/token" --no-update-check "$@"; }
rpc() { node "$AHPD_CHECK/.project/pending/rpc.mjs" "$@"; }

mkdir -p "$XDG_CONFIG_HOME/ahpd" "$AHPD_CHECK_HOME/work"
[ -d "$AHPD_CHECK_HOME/work/.git" ] || git -C "$AHPD_CHECK_HOME/work" init -q
echo check-token > "$AHPD_CHECK_HOME/token"

[ $# -eq 0 ] && set -- agent-claude
node -e '
  const [file, checkout, work, ...names] = process.argv.slice(1);
  const fs = require("fs");
  const config = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
  config.paths = [work];
  config.plugins = names.map((name) => name.includes("/") ? `${checkout}/${name}` : `${checkout}/packages/${name}`);
  fs.writeFileSync(file, JSON.stringify(config, null, 2) + "\n");
' "$XDG_CONFIG_HOME/ahpd/config.json" "$AHPD_CHECK" "$AHPD_CHECK_HOME/work" "$@"

ahpd stop >/dev/null 2>&1
ahpd start --port 39200 --connection-token-file "$AHPD_CHECK_HOME/token" || return 1
echo "Test daemon on ws://127.0.0.1:39200 at $(git -C "$AHPD_CHECK" rev-parse --short HEAD)."
echo "VS Code chat.remoteAgentHosts entry: { \"name\": \"ahpd-check\", \"address\": \"ws://127.0.0.1:39200\", \"connectionToken\": \"check-token\" }"
