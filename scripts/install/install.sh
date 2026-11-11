#!/usr/bin/env bash
#
# Install ahpd with one line:
#
#   curl -fsSL https://ahpio.com/ahpd/install.sh | bash
#
# Then uninstall it with:
#
#   curl -fsSL https://ahpio.com/ahpd/install.sh | bash -s -- --uninstall
#
# The flags, and the AHPD_* variable each one reads when a pipe cannot pass it:
#
#   --version <v>   AHPD_VERSION     the package version, latest when omitted
#   --package <p>   AHPD_PACKAGE     the package, @ahpd/server by default
#   --runtime <r>   AHPD_RUNTIME     node or bun
#   --yes           AHPD_YES         update an installed ahpd without asking
#   --no-onboard    AHPD_NO_ONBOARD  do not run ahpd configure
#   --dry-run       AHPD_DRY_RUN     print each step and change nothing
#   --verbose       AHPD_VERBOSE     print each command before it runs
#   --help          AHPD_HELP        print this help
#   --uninstall     AHPD_UNINSTALL   remove what the install put there
#   --purge         AHPD_PURGE       with --uninstall, remove the configuration
#
# The script installs into the person's home folder and never needs sudo. It
# reads a question from /dev/tty, because a piped script reads stdin from the
# pipe, and it stops with the command when there is no terminal to ask on.

set -euo pipefail

# The comment the install writes above its PATH line, and the only line the
# uninstall removes. A person reading their rc file finds the line by it.
MARKER='# added by the ahpd install script'

# Where nvm and Bun are installed from. Both are the commands their own
# documentation gives for a script that cannot ask a person to run one.
NVM_INSTALL_URL='https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.8/install.sh'
BUN_INSTALL_URL='https://bun.com/install'

PACKAGE="${AHPD_PACKAGE:-@ahpd/server}"
VERSION="${AHPD_VERSION:-}"
RUNTIME="${AHPD_RUNTIME:-node}"

NO_ONBOARD=0
DRY_RUN=0
VERBOSE=0
HELP=0
UNINSTALL=0
PURGE=0
YES=0

NODE=''
NPM=''
BUN=''
BIN=''
PREFIX=''
AHPD=''

on() {
  case "${1:-}" in
    ''|0|false|FALSE|no|NO) return 1 ;;
    *) return 0 ;;
  esac
}

if on "${AHPD_NO_ONBOARD:-}"; then NO_ONBOARD=1; fi
if on "${AHPD_DRY_RUN:-}"; then DRY_RUN=1; fi
if on "${AHPD_VERBOSE:-}"; then VERBOSE=1; fi
if on "${AHPD_HELP:-}"; then HELP=1; fi
if on "${AHPD_UNINSTALL:-}"; then UNINSTALL=1; fi
if on "${AHPD_PURGE:-}"; then PURGE=1; fi
if on "${AHPD_YES:-}"; then YES=1; fi

say() { printf 'ahpd: %s\n' "$*"; }
warn() { printf 'ahpd: %s\n' "$*" >&2; }
fail() { local code="$1"; shift; printf 'ahpd: %s\n' "$*" >&2; exit "$code"; }

# One command, printed instead of run under --dry-run, and named under
# --verbose. A command that fails is the caller's to read: `run_cmd` in an `if`
# is a step whose failure the script goes on from.
run_cmd() {
  if [ "$DRY_RUN" -eq 1 ]; then
    say "would run: $*"
    return 0
  fi
  if [ "$VERBOSE" -eq 1 ]; then
    printf 'ahpd: %s\n' "$*" >&2
  fi
  "$@"
}

usage() {
  cat <<'EOF'
Install ahpd with one line:

  curl -fsSL https://ahpio.com/ahpd/install.sh | bash

A flag passes through the pipe after `bash -s --`, and every flag also reads an
AHPD_* variable, because a PowerShell pipe cannot pass parameters at all.

  --version <v>   install this version of the package (AHPD_VERSION)
  --package <p>   install this package (AHPD_PACKAGE, @ahpd/server by default)
  --runtime <r>   node or bun (AHPD_RUNTIME)
  --yes           update an installed ahpd without asking (AHPD_YES)
  --no-onboard    do not run ahpd configure (AHPD_NO_ONBOARD)
  --dry-run       print each step and change nothing (AHPD_DRY_RUN)
  --verbose       print each command before it runs (AHPD_VERBOSE)
  --help          print this help (AHPD_HELP)
  --uninstall     stop the daemon, remove the package and the PATH line (AHPD_UNINSTALL)
  --purge         with --uninstall, also remove the configuration (AHPD_PURGE)

The script installs into your home folder and never needs sudo.
EOF
}

need() {
  if [ "$#" -lt 2 ]; then
    fail 2 "$1 needs a value."
  fi
}

parse_args() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --version)
        need "$@"
        VERSION="$2"
        shift 2
        ;;
      --version=*)
        VERSION="${1#*=}"
        shift
        ;;
      --package)
        need "$@"
        PACKAGE="$2"
        shift 2
        ;;
      --package=*)
        PACKAGE="${1#*=}"
        shift
        ;;
      --runtime)
        need "$@"
        RUNTIME="$2"
        shift 2
        ;;
      --runtime=*)
        RUNTIME="${1#*=}"
        shift
        ;;
      --yes)
        YES=1
        shift
        ;;
      --no-onboard)
        NO_ONBOARD=1
        shift
        ;;
      --dry-run)
        DRY_RUN=1
        shift
        ;;
      --verbose)
        VERBOSE=1
        shift
        ;;
      --help|-h)
        HELP=1
        shift
        ;;
      --uninstall)
        UNINSTALL=1
        shift
        ;;
      --purge)
        PURGE=1
        shift
        ;;
      --)
        shift
        if [ "$#" -gt 0 ]; then
          fail 2 "Unexpected argument: $1."
        fi
        ;;
      -*)
        fail 2 "Unknown flag: $1."
        ;;
      *)
        fail 2 "Unexpected argument: $1."
        ;;
    esac
  done

  case "$RUNTIME" in
    node|bun) ;;
    *) fail 2 "Unknown runtime: $RUNTIME. Use node or bun." ;;
  esac

  if [ "$PURGE" -eq 1 ] && [ "$UNINSTALL" -eq 0 ]; then
    fail 2 "--purge needs --uninstall."
  fi
}

# Claude Code's rule: an install into the home folder has no reason to be root,
# and a root process leaves files the person cannot edit. A root shell that was
# not reached through sudo, as a container's is, is left alone.
refuse_sudo() {
  if [ "$(id -u)" -eq 0 ] && [ -n "${SUDO_USER:-}" ]; then
    fail 1 "Do not run this with sudo: it installs into your home folder. Run it as $SUDO_USER."
  fi
}

interactive() {
  if [ ! -t 1 ]; then
    return 1
  fi
  if ( : < /dev/tty ) 2>/dev/null; then
    return 0
  fi
  return 1
}

ask_prompt() { printf '%s [Y/n] ' "$1" >&2; }

ask_yes() {
  local answer=''
  ask_prompt "$1"
  if ! IFS= read -r answer < /dev/tty; then
    answer=''
  fi
  case "$answer" in
    n|N|no|NO) return 1 ;;
    *) return 0 ;;
  esac
}

node_version() {
  local value
  value="$("$1" --version 2>/dev/null)" || return 1
  printf '%s\n' "${value#v}"
}

# Node 22.18 is the floor of `engines.node` in packages/server/package.json and
# in the workspace root.
node_fits() {
  local value major minor rest
  value="$(node_version "$1")" || return 1
  major="${value%%.*}"
  rest="${value#*.}"
  minor="${rest%%.*}"
  case "$major" in
    ''|*[!0-9]*) return 1 ;;
  esac
  case "$minor" in
    ''|*[!0-9]*) minor=0 ;;
  esac
  if [ "$major" -gt 22 ]; then return 0; fi
  if [ "$major" -eq 22 ] && [ "$minor" -ge 18 ]; then return 0; fi
  return 1
}

# The first line a program prints for --version, or nothing when it cannot be
# read. `head` closes the pipe, so pipefail needs the failure handled here.
first_line() {
  local value
  value="$("$1" --version 2>/dev/null | head -n 1)" || value=''
  printf '%s\n' "$value"
}

# The version an installed ahpd prints, without the `v` a person may have put
# there. An ahpd that cannot say is one this script will not replace.
ahpd_version() {
  local value
  value="$(first_line "$1")"
  printf '%s\n' "${value#v}"
}

# The version the install moves to: the one --version named, or the newest the
# registry has for the package.
target_version() {
  local value
  if [ -n "$VERSION" ]; then
    printf '%s\n' "${VERSION#v}"
    return 0
  fi
  value="$("$NPM" view "$PACKAGE" version 2>/dev/null | head -n 1)" || value=''
  printf '%s\n' "${value#v}"
}

# The file a path really is: npm links <prefix>/bin/ahpd into the package folder
# it installed, and the prefix is the part before /lib/node_modules/ there.
# `readlink -f` is not on every macOS, so the links are followed by hand.
real_path() {
  local path="$1" link dir
  while [ -L "$path" ]; do
    link="$(readlink "$path" 2>/dev/null)" || break
    case "$link" in
      /*) path="$link" ;;
      *) path="$(dirname "$path")/$link" ;;
    esac
  done
  dir="$(cd -P "$(dirname "$path")" 2>/dev/null && pwd)" || return 1
  printf '%s/%s\n' "$dir" "$(basename "$path")"
}

# The npm prefix an ahpd was installed into. A real path outside an npm
# package folder, as a Bun install or a hand-copied command gives, has no
# prefix to read.
ahpd_prefix() {
  local real
  real="$(real_path "$1")" || return 1
  case "$real" in
    */lib/node_modules/*) printf '%s\n' "${real%%/lib/node_modules/*}" ;;
    *) return 1 ;;
  esac
}

# The update is the person's to allow: it changes an ahpd that is already
# installed, and where. --yes and AHPD_YES answer for them; a run with no
# terminal has nobody to ask, so it stops unless one of them was given.
confirm_update() {
  local old="$1" new="$2"
  say "ahpd $old is installed at $PREFIX."
  if [ "$YES" -eq 1 ]; then
    return 0
  fi
  # Nothing is changed under --dry-run, so the question is printed and the
  # walk through the steps goes on.
  if [ "$DRY_RUN" -eq 1 ]; then
    ask_prompt "Update it to $new?"
    return 0
  fi
  if ! interactive; then
    ask_prompt "Update it to $new?"
    fail 1 "There is no terminal to answer on. Run this again with --yes to update ahpd $old at $PREFIX to $new."
  fi
  if ! ask_yes "Update it to $new?"; then
    fail 1 "Left ahpd $old at $PREFIX as it is."
  fi
}

# The update is done when the `ahpd` the shell finds prints the new version. An
# old ahpd earlier on the PATH, or a second one in another folder, is what this
# stops on: that is the install that looked done and left the old version in
# place.
check_installed_version() {
  local want="$1" found seen
  if [ "$DRY_RUN" -eq 1 ]; then
    say "would check: ahpd --version prints $want"
    return 0
  fi
  # The PATH first, as the update found it, then the bin folder it went into:
  # a shell that has not read the PATH line yet still has that ahpd.
  found="$(command -v ahpd 2>/dev/null || true)"
  if [ -z "$found" ] && [ -x "$BIN/ahpd" ]; then
    found="$BIN/ahpd"
  fi
  if [ -z "$found" ]; then
    fail 1 "ahpd $want was installed at $PREFIX, but ahpd is not on the PATH. Add $BIN to the PATH and run this again."
  fi
  seen="$(ahpd_version "$found")"
  if [ "$seen" != "$want" ]; then
    fail 1 "ahpd at $found prints ${seen:-no version}, not $want. That is a second ahpd: remove it, or put $PREFIX first on the PATH."
  fi
  say "ahpd $want is installed at $found."
}

# One runtime line, in the words `ahpd configure` uses: what is there, the
# version `--version` printed, and whether ahpd runs on it.
runtime_line() {
  local name="$1" program="$2" path version
  path="$(command -v "$program" 2>/dev/null)" || {
    printf '%s not found\n' "$name"
    return 0
  }
  version="$(first_line "$path")"
  if [ -z "$version" ]; then
    printf '%s at %s (could not read its version)\n' "$name" "$path"
    return 0
  fi
  case "$program" in
    node)
      if node_fits "$path"; then
        printf 'Node %s (runs ahpd)\n' "$version"
      else
        printf 'Node %s (ahpd does not run on it; it needs Node 22.18 or newer)\n' "$version"
      fi
      ;;
    deno) printf 'Deno %s (runs ahpd; each plugin it loads needs an npm: spec)\n' "$version" ;;
    *) printf '%s %s (runs ahpd)\n' "$name" "$version" ;;
  esac
}

# What this machine has, before anything is installed: a person whose install
# stops sees which runtime was missing or too old.
runtimes() {
  runtime_line Node node
  runtime_line Bun bun
  runtime_line Deno deno
}

# The node on PATH first, then the newest one nvm holds. A node on PATH that is
# too old is not the answer, so nvm is still read.
find_node() {
  local one dir
  if one="$(command -v node 2>/dev/null)"; then
    if node_fits "$one"; then
      printf '%s\n' "$one"
      return 0
    fi
  fi
  dir="${NVM_DIR:-$HOME/.nvm}/versions/node"
  if [ ! -d "$dir" ]; then
    return 1
  fi
  for one in $(ls -1 "$dir" 2>/dev/null | sort -rV); do
    if [ -x "$dir/$one/bin/node" ] && node_fits "$dir/$one/bin/node"; then
      printf '%s\n' "$dir/$one/bin/node"
      return 0
    fi
  done
  return 1
}

node_hint() {
  printf 'Node 22.18 or later is required. Install it with nvm:\n' >&2
  printf '  curl -o- %s | bash\n' "$NVM_INSTALL_URL" >&2
  printf '  nvm install 22\n' >&2
}

ensure_node() {
  local found
  if found="$(find_node)"; then
    NODE="$found"
  else
    if [ "$DRY_RUN" -eq 1 ]; then
      say "Node 22.18 or later is not on the PATH. It would be installed with nvm:"
      printf '  curl -o- %s | bash\n' "$NVM_INSTALL_URL"
      printf '  nvm install 22\n'
      exit 0
    fi
    if ! interactive; then
      node_hint
      exit 1
    fi
    if ! ask_yes 'Node 22.18 or later is needed. Install it with nvm now?'; then
      node_hint
      exit 1
    fi
    say 'Installing nvm and Node 22.'
    run_cmd sh -c "curl -o- '$NVM_INSTALL_URL' | bash"
    export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
    if [ ! -f "$NVM_DIR/nvm.sh" ]; then
      fail 1 "nvm did not install into $NVM_DIR."
    fi
    # shellcheck disable=SC1091
    . "$NVM_DIR/nvm.sh"
    run_cmd nvm install 22
    if ! found="$(find_node)"; then
      fail 1 "Node 22.18 or later is still not on the PATH after the install."
    fi
    NODE="$found"
  fi

  NPM="$(dirname "$NODE")/npm"
  if [ ! -x "$NPM" ]; then
    NPM="$(command -v npm 2>/dev/null || true)"
  fi
  if [ -z "$NPM" ]; then
    fail 1 "npm was not found beside $NODE."
  fi
}

ensure_bun() {
  BUN="$(command -v bun 2>/dev/null || true)"
  if [ -z "$BUN" ]; then
    fail 1 "Bun is not on the PATH. Install it with: curl -fsSL $BUN_INSTALL_URL | bash"
  fi
  BIN="${BUN_INSTALL:-$HOME/.bun}/bin"
}

# npm's global folder when the person can write to it, and ~/.npm-global when
# they cannot: a global install under /usr/local is one npm refuses, and sudo is
# not how the install answers that. The folder is handed to npm with --prefix
# and the npm configuration is left as the person has it.
resolve_prefix() {
  local prefix
  prefix="$("$NPM" prefix -g 2>/dev/null || true)"
  if [ -z "$prefix" ]; then
    prefix="$("$NPM" config get prefix 2>/dev/null || true)"
  fi
  if [ -z "$prefix" ] || [ ! -d "$prefix" ] || [ ! -w "$prefix" ]; then
    say "The global npm prefix is not writable; using $HOME/.npm-global."
    prefix="$HOME/.npm-global"
    if [ "$DRY_RUN" -eq 0 ]; then
      mkdir -p "$prefix/bin"
    fi
  fi
  PREFIX="$prefix"
  BIN="$prefix/bin"
}

# npm 11.16 is where --allow-scripts arrived. A node-pty that npm does not build
# leaves terminals on pipes, which the daemon already handles.
npm_allows_scripts() {
  local value major minor rest
  value="$("$NPM" --version 2>/dev/null)" || return 1
  major="${value%%.*}"
  rest="${value#*.}"
  minor="${rest%%.*}"
  case "$major" in
    ''|*[!0-9]*) return 1 ;;
  esac
  case "$minor" in
    ''|*[!0-9]*) minor=0 ;;
  esac
  if [ "$major" -gt 11 ]; then return 0; fi
  if [ "$major" -eq 11 ] && [ "$minor" -ge 16 ]; then return 0; fi
  return 1
}

package_spec() {
  if [ -n "$VERSION" ]; then
    printf '%s@%s\n' "$PACKAGE" "$VERSION"
  else
    printf '%s\n' "$PACKAGE"
  fi
}

# A node-pty that did not build is a warning, because the package is optional
# and the install is what a person came for.
warn_pty() {
  case "$1" in
    *node-pty*) ;;
    *) return 0 ;;
  esac
  case "$1" in
    *gyp*|*"build error"*|*"command failed"*) ;;
    *) return 0 ;;
  esac
  warn 'node-pty did not build; terminals will use pipes.'
  case "$(uname -s)" in
    Darwin) warn 'Run xcode-select --install, then run this again.' ;;
    *) warn 'Install python3, make and a C++ compiler, then run this again.' ;;
  esac
}

install_package() {
  local target args output status
  target="$(package_spec)"

  if [ "$RUNTIME" = bun ]; then
    run_cmd "$BUN" add -g "$target"
    return 0
  fi

  # The prefix is named here rather than as an npm setting: the script changes
  # the folder it installs into, not the person's npm configuration.
  args=(install -g --prefix "$PREFIX" --no-fund --no-audit)
  if npm_allows_scripts; then
    args+=(--allow-scripts=node-pty)
  fi
  args+=("$target")

  if [ "$DRY_RUN" -eq 1 ]; then
    say "would run: $NPM ${args[*]}"
    return 0
  fi

  status=0
  output="$("$NPM" "${args[@]}" 2>&1)" || status=$?
  if [ -n "$output" ]; then
    printf '%s\n' "$output"
  fi
  warn_pty "$output"
  if [ "$status" -eq 0 ]; then
    return 0
  fi
  # An ahpd from an earlier install is no reason to call a failed install a
  # success: it is how a script ran to its end and left the old version there.
  fail 1 "npm install failed with exit code $status."
}

shell_name() {
  local value="${SHELL:-}"
  printf '%s\n' "${value##*/}"
}

rc_path() {
  # A container often has no SHELL, so an unset one falls to ~/.profile.
  case "$(shell_name)" in
    zsh) printf '%s\n' "$HOME/.zshrc" ;;
    bash) printf '%s\n' "$HOME/.bashrc" ;;
    fish) printf '%s\n' "${XDG_CONFIG_HOME:-$HOME/.config}/fish/config.fish" ;;
    *) printf '%s\n' "$HOME/.profile" ;;
  esac
}

path_line() {
  if [ "$(shell_name)" = fish ]; then
    printf 'fish_add_path %s\n' "$BIN"
  else
    printf 'export PATH="%s:$PATH"\n' "$BIN"
  fi
}

# The file a login shell of this kind reads. A desktop session that starts
# through the login shell, as GNOME does, reads it too. fish reads config.fish
# in every shell, so it has none.
login_path() {
  local file
  case "$(shell_name)" in
    fish) return 1 ;;
    zsh) printf '%s\n' "$HOME/.zprofile" ;;
    bash)
      # A login bash reads only the first of these that exists.
      for file in "$HOME/.bash_profile" "$HOME/.bash_login"; do
        if [ -f "$file" ]; then
          printf '%s\n' "$file"
          return 0
        fi
      done
      printf '%s\n' "$HOME/.profile"
      ;;
    *) printf '%s\n' "$HOME/.profile" ;;
  esac
}

# Every file this script can write its PATH line into, under any shell.
path_files() {
  printf '%s\n' \
    "$HOME/.bashrc" \
    "$HOME/.zshrc" \
    "${XDG_CONFIG_HOME:-$HOME/.config}/fish/config.fish" \
    "$HOME/.profile" \
    "$HOME/.bash_profile" \
    "$HOME/.bash_login" \
    "$HOME/.zprofile"
}

has_marker() {
  [ -f "$1" ] && grep -Fq "$MARKER" "$1"
}

# Writes the marker and the line into a file that has no marker yet. Fails
# when there is nothing to write.
add_path_line() {
  local file="$1" line="$2"
  if has_marker "$file"; then
    return 1
  fi
  if [ "$DRY_RUN" -eq 1 ]; then
    say "would add $BIN to PATH in $file"
    return 0
  fi
  mkdir -p "$(dirname "$file")"
  printf '\n%s\n%s\n' "$MARKER" "$line" >> "$file"
  say "Added $BIN to PATH in $file."
}

write_path() {
  local rc login file marked=0
  rc="$(rc_path)"
  login="$(login_path || true)"
  if [ "$login" = "$rc" ]; then
    login=''
  fi
  # A prefix that is already on the PATH, as /usr/local is in a container,
  # needs no line of its own. One that is there through a line of this script
  # still gets the line in the files that lack it, so an update of an older
  # install adds the login file.
  case ":$PATH:" in
    *":$BIN:"*)
      while IFS= read -r file; do
        if has_marker "$file"; then
          marked=1
        fi
      done <<EOF
$(path_files)
EOF
      if [ "$marked" -eq 0 ]; then
        return 0
      fi
      ;;
  esac
  add_path_line "$rc" "$(path_line)" || true
  if [ -n "$login" ] && add_path_line "$login" "$(printf 'export PATH="%s:$PATH"' "$BIN")"; then
    say 'Desktop apps find ahpd from your next login.'
  fi
}

remove_path() {
  local file temp
  while IFS= read -r file; do
    if ! has_marker "$file"; then
      continue
    fi
    if [ "$DRY_RUN" -eq 1 ]; then
      say "would remove the PATH line from $file"
      continue
    fi
    temp="$file.ahpd.$$"
    awk -v marker="$MARKER" 'skip { skip=0; next } $0 == marker { skip=1; next } { print }' "$file" > "$temp"
    # Written back into the file rather than moved over it, so a linked file
    # stays a link and keeps its mode.
    cat "$temp" > "$file"
    rm -f "$temp"
    say "Removed the PATH line from $file."
  done <<EOF
$(path_files)
EOF
}

purge_config() {
  local dir
  dir="${XDG_CONFIG_HOME:-$HOME/.config}/ahpd"
  if [ "$DRY_RUN" -eq 1 ]; then
    say "would remove $dir"
    return 0
  fi
  if [ -d "$dir" ]; then
    rm -rf "$dir"
    say "Removed $dir."
  fi
}

# The one command that is ahpd in this machine, in this order: the bin folder
# this install wrote into, then the PATH.
resolve_ahpd() {
  if [ -n "$BIN" ] && [ -x "$BIN/ahpd" ]; then
    printf '%s\n' "$BIN/ahpd"
    return 0
  fi
  command -v ahpd 2>/dev/null
}

# Where daemon/31 writes the file that says a service exists. A daemon that a
# manager holds also records `service` in its record, which is what `ahpd
# status --json` reads.
service_file() {
  case "$(uname -s)" in
    Linux) printf '%s\n' "${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/ahpd.service" ;;
    Darwin) printf '%s\n' "$HOME/Library/LaunchAgents/dev.ahpd.daemon.plist" ;;
    *) printf '\n' ;;
  esac
}

service_installed() {
  local file
  file="$(service_file)"
  if [ -n "$file" ] && [ -f "$file" ]; then
    return 0
  fi
  if [ -z "$AHPD" ]; then
    return 1
  fi
  case "$("$AHPD" status --json 2>/dev/null || true)" in
    *'"service"'*) return 0 ;;
  esac
  return 1
}

daemon_running() {
  if [ -z "$AHPD" ]; then
    return 1
  fi
  "$AHPD" status --json >/dev/null 2>&1
}

do_install() {
  local had_ahpd=0 ahpd='' old='' new='' at=''

  # Before the runtime check, so a stop names what this machine has. Under
  # --dry-run too, where the lines are the same ones.
  runtimes

  if [ "$RUNTIME" = bun ]; then
    ensure_bun
  else
    ensure_node

    # An ahpd on the PATH is updated where it is, before a prefix is chosen:
    # the prefix that holds this ahpd is the one the update goes into, and a
    # second copy in another folder is what left the old version in the shell.
    # With none on the PATH, the prefix is chosen first, and an ahpd already in
    # its bin folder - a shell that has not read the PATH line yet, such as a
    # login shell that skips ~/.bashrc - gets the same check.
    ahpd="$(command -v ahpd 2>/dev/null || true)"
    if [ -z "$ahpd" ]; then
      resolve_prefix
      if [ -x "$BIN/ahpd" ]; then
        ahpd="$BIN/ahpd"
      fi
    fi
    if [ -n "$ahpd" ]; then
      old="$(ahpd_version "$ahpd")"
      if [ -z "$old" ]; then
        fail 1 "$ahpd did not print a version for --version, so this script will not replace it."
      fi
      new="$(target_version)"
      if [ -z "$new" ]; then
        fail 1 "Could not read the newest version of $PACKAGE from npm. Run npm view $PACKAGE version to see why."
      fi
      PREFIX="$(ahpd_prefix "$ahpd" || true)"
      at="${PREFIX:-$ahpd}"
      if [ "$old" = "$new" ]; then
        say "ahpd $old is installed at $at, already at $new. Nothing to update."
        exit 0
      fi
      if [ -z "$PREFIX" ]; then
        fail 1 "ahpd $old is at $ahpd, which is not a folder npm installed it in. Remove it there, or update it the way it was installed."
      fi
      if [ ! -w "$PREFIX" ]; then
        fail 1 "ahpd $old is at $PREFIX, which is not writable. Update it yourself, or install it into a folder of your own."
      fi
      BIN="$PREFIX/bin"
      confirm_update "$old" "$new"
    fi
  fi

  if ahpd="$(resolve_ahpd || true)"; then
    if [ -n "$ahpd" ]; then
      had_ahpd=1
    fi
  fi

  install_package

  # Only an update has a version to check: the first install has no ahpd to
  # compare with, and the paths it writes are the ones it just chose.
  if [ -n "$new" ]; then
    check_installed_version "$new"
  fi

  write_path

  # An upgrade reloads the plugins and says how to pick the new version up. The
  # daemon is never restarted here: it may be serving a turn.
  if [ "$had_ahpd" -eq 1 ]; then
    ahpd="$(resolve_ahpd || true)"
    if [ -n "$ahpd" ]; then
      if ! run_cmd "$ahpd" plugin update all; then
        warn 'ahpd plugin update all failed; the installed plugins stay as they are.'
      fi
    fi
    say 'Run ahpd restart to load the new version and its plugins.'
  fi

  # The questions read /dev/tty, because this script's stdin is the pipe it
  # came in on. Without a terminal there is nobody to ask.
  if [ "$NO_ONBOARD" -eq 0 ] && interactive; then
    ahpd="$(resolve_ahpd || true)"
    if [ -n "$ahpd" ]; then
      run_cmd "$ahpd" configure < /dev/tty
    else
      warn 'ahpd is not on the PATH; run ahpd configure yourself.'
    fi
  fi

  say 'Next: ahpd service install'
}

do_uninstall() {
  local found target bun prefix

  if [ "$RUNTIME" = bun ]; then
    BIN="${BUN_INSTALL:-$HOME/.bun}/bin"
  else
    if found="$(find_node)"; then
      NODE="$found"
      NPM="$(dirname "$NODE")/npm"
      if [ ! -x "$NPM" ]; then
        NPM="$(command -v npm 2>/dev/null || true)"
      fi
    fi
  fi

  AHPD="$(command -v ahpd 2>/dev/null || true)"
  # The package name, not the version: npm removes what is installed, and a
  # version the person named may be the one an upgrade replaced.
  target="$PACKAGE"

  # The service goes first: a manager that still holds the daemon would start
  # it again after the package is gone.
  if [ -n "$AHPD" ] && service_installed; then
    if ! run_cmd "$AHPD" service uninstall; then
      warn 'ahpd service uninstall failed; the service may still be installed.'
    fi
  fi

  if daemon_running; then
    if ! run_cmd "$AHPD" stop; then
      fail 1 'ahpd stop failed; nothing was removed.'
    fi
  fi

  if [ "$RUNTIME" = bun ]; then
    bun="$(command -v bun 2>/dev/null || true)"
    if [ -z "$bun" ]; then
      fail 1 'Bun is not on the PATH.'
    fi
    run_cmd "$bun" remove -g "$target"
  else
    if [ -z "${NPM:-}" ]; then
      fail 1 'npm was not found. Install Node 22.18 or later, then run this again.'
    fi
    # The prefix that holds the package, which for an install under
    # ~/.npm-global is not npm's own.
    if [ -n "$AHPD" ] && prefix="$(ahpd_prefix "$AHPD")"; then
      run_cmd "$NPM" uninstall -g --prefix "$prefix" "$target"
    else
      run_cmd "$NPM" uninstall -g "$target"
    fi
  fi

  remove_path

  if [ "$PURGE" -eq 1 ]; then
    purge_config
  else
    say "Kept ${XDG_CONFIG_HOME:-$HOME/.config}/ahpd and its plugins."
  fi
  # The npm prefix and its line in ~/.npmrc stay: another package may be under
  # the same prefix, and the file is the person's.
  if [ -f "$HOME/.npmrc" ] && grep -Fq 'prefix=' "$HOME/.npmrc" 2>/dev/null; then
    say "Kept the npm prefix in $HOME/.npmrc."
  fi
  say 'Done.'
}

main() {
  parse_args "$@"
  if [ "$HELP" -eq 1 ]; then
    usage
    return 0
  fi
  refuse_sudo
  if [ "$UNINSTALL" -eq 1 ]; then
    do_uninstall
    return 0
  fi
  do_install
}

# A test sources this file with AHPD_INSTALL_NO_RUN=1, then calls `main` with
# the flags it wants, so the flags and every step are the ones a person gets.
if [ "${AHPD_INSTALL_NO_RUN:-0}" != "1" ]; then
  main "$@"
fi
