#!/usr/bin/env bash
# The checks a person's upgrade depends on, run against the image built here.
#
#   docker/test/smoke.sh ahpd:dev
#
# The state of a container is the volume at /home/ahpd: the token, the
# configuration and the sessions. Every check prints its name and stops the
# script when it fails. Nothing here binds 9187 on the host; each container gets
# an ephemeral loopback port.

set -euo pipefail

IMAGE=${1:-ahpd:dev}
SUFFIX="$$-$RANDOM"
VOLUME="ahpd-smoke-$SUFFIX"
RO_VOLUME="ahpd-smoke-$SUFFIX-ro"
CONTAINER="ahpd-smoke-$SUFFIX"
RO_CONTAINER="ahpd-smoke-$SUFFIX-ro"
# A volume that holds only an image-version, for the downgrade check.
VERSION_VOLUME="ahpd-smoke-$SUFFIX-version"
VERSION_CONTAINER="ahpd-smoke-$SUFFIX-version"
# The same volume, for the container a swap replaces. A restart policy is what
# carries `ahpd restart` back: the process exits and Docker starts it again.
POLICY=(--restart unless-stopped)

ROOT=$(cd "$(dirname "$0")/../.." && pwd)

cleanup() {
  docker rm -f "$CONTAINER" "$RO_CONTAINER" "$VERSION_CONTAINER" >/dev/null 2>&1 || true
  docker volume rm "$VOLUME" "$RO_VOLUME" "$VERSION_VOLUME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

say() { printf '%s\n' "$*"; }
fail() { printf '  failed: %s\n' "$*" >&2; exit 1; }

run_check() {
  say ""
  say "-- $1"
  shift
  "$@"
  say "   ok"
}

# Start the image on the smoke volume, with the first free loopback port.
start_container() {
  local name=$1
  shift
  docker run -d --name "$name" "${POLICY[@]}" \
    -p 127.0.0.1::9187 -v "$VOLUME:/home/ahpd" \
    "$@" "$IMAGE" >/dev/null
}

# The number of seconds to wait for a health status, which is generous because
# a fresh volume installs the default plugin from npm.
WAIT_SECONDS=${AHPD_SMOKE_WAIT:-300}

wait_healthy() {
  local name=$1 state health waited=0
  while [ "$waited" -lt "$WAIT_SECONDS" ]; do
    state=$(docker inspect --format '{{.State.Status}}' "$name" 2>/dev/null || true)
    case $state in
      exited|dead)
        docker logs "$name" 2>&1 | tail -n 40 >&2
        fail "$name stopped before it was healthy"
        ;;
    esac
    health=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$name" 2>/dev/null || true)
    case $health in
      healthy) return 0 ;;
      unhealthy)
        docker logs "$name" 2>&1 | tail -n 40 >&2
        fail "$name reported unhealthy"
        ;;
    esac
    sleep 2
    waited=$((waited + 2))
  done
  docker logs "$name" 2>&1 | tail -n 40 >&2
  fail "$name was not healthy after ${WAIT_SECONDS}s"
}

host_port() {
  local line
  line=$(docker port "$1" 9187/tcp | head -n 1)
  [ -n "$line" ] || fail "no host port is published for $1"
  printf '%s\n' "${line##*:}"
}

token_of() { docker exec "$1" cat /home/ahpd/.config/ahpd/connection-token; }

http_code() {
  curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$1"
}

# What must survive a restart, a removal and a swap: the token, the
# configuration and one file for each session.
state_of() {
  docker exec "$1" sh -c '
    cd /home/ahpd/.config/ahpd 2>/dev/null || exit 0
    for file in connection-token config.json; do
      if [ -f "$file" ]; then printf "%s " "$file"; sha256sum "$file" | cut -d" " -f1; fi
    done
    if [ -d sessions ]; then
      find sessions -type f | sort | while IFS= read -r file; do
        printf "%s " "$file"; sha256sum "$file" | cut -d" " -f1
      done
    fi
  '
}

# The last image that was released, as GHCR holds it: X.Y from npm, and no
# pre-release, which publishes no stable tag.
released_image() {
  local owner version
  command -v npm >/dev/null 2>&1 || return 1
  version=$(npm view @ahpd/server version 2>/dev/null) || return 1
  case $version in *-*) return 1 ;; esac
  owner=$(node -p 'require(process.argv[1]).repository.url.replace(/^git\+/, "").split("/")[3]' "$ROOT/packages/server/package.json" 2>/dev/null) || return 1
  printf 'ghcr.io/%s/ahpd:%s\n' "$(printf '%s' "$owner" | tr '[:upper:]' '[:lower:]')" "${version%.*}"
}

check_fresh_volume() {
  start_container "$CONTAINER"
  wait_healthy "$CONTAINER"
  local mode
  mode=$(docker exec "$CONTAINER" stat -c '%a' /home/ahpd/.config/ahpd/connection-token)
  [ "$mode" = '600' ] || fail "the token file is mode $mode, not 600"
}

check_token() {
  local port token code wrong
  port=$(host_port "$CONTAINER")
  token=$(token_of "$CONTAINER")
  code=$(http_code "http://127.0.0.1:$port/?tkn=$token")
  [ "$code" = '426' ] || fail "the token got $code, not 426"
  wrong=$(http_code "http://127.0.0.1:$port/?tkn=wrong-token")
  [ "$wrong" = '401' ] || fail "a wrong token got $wrong, not 401"
}

check_restart() {
  local token before after
  token=$(token_of "$CONTAINER")
  before=$(state_of "$CONTAINER")
  docker restart "$CONTAINER" >/dev/null
  wait_healthy "$CONTAINER"
  after=$(state_of "$CONTAINER")
  [ "$token" = "$(token_of "$CONTAINER")" ] || fail 'the token changed across a restart'
  [ "$before" = "$after" ] || fail "the state changed across a restart:
$before
--
$after"
}

# `docker exec ahpd restart` stops the process, and the restart policy starts it
# again. The container that answers afterwards is a new one, with the same
# volume.
check_exec_restart() {
  local token started
  token=$(token_of "$CONTAINER")
  started=$(docker inspect --format '{{.State.StartedAt}}' "$CONTAINER")
  docker exec "$CONTAINER" ahpd restart >/dev/null 2>&1 || true
  local waited=0
  while [ "$waited" -lt "$WAIT_SECONDS" ]; do
    if [ "$(docker inspect --format '{{.State.StartedAt}}' "$CONTAINER" 2>/dev/null || true)" != "$started" ]; then
      break
    fi
    sleep 2
    waited=$((waited + 2))
  done
  [ "$(docker inspect --format '{{.State.StartedAt}}' "$CONTAINER")" != "$started" ] \
    || fail 'ahpd restart did not restart the container'
  wait_healthy "$CONTAINER"
  [ "$token" = "$(token_of "$CONTAINER")" ] || fail 'the token changed across an ahpd restart'
}

check_new_container() {
  local token before after
  token=$(token_of "$CONTAINER")
  before=$(state_of "$CONTAINER")
  docker rm -f "$CONTAINER" >/dev/null
  start_container "$CONTAINER"
  wait_healthy "$CONTAINER"
  after=$(state_of "$CONTAINER")
  [ "$token" = "$(token_of "$CONTAINER")" ] || fail 'the token changed with a new container'
  [ "$before" = "$after" ] || fail "the state changed with a new container:
$before
--
$after"
}

# A plugin installed on the old image must load on the new one, because the
# entrypoint moves every plugin to the version the new image's sdk admits.
# Skipped while no released image exists, with the reason said.
check_upgrade() {
  local previous listed
  previous=${AHPD_PREVIOUS_IMAGE:-}
  if [ -z "$previous" ]; then
    if ! previous=$(released_image); then
      say '   skipped: no released image is known, so there is nothing to upgrade from'
      return 0
    fi
  fi
  if ! docker pull "$previous" >/dev/null 2>&1; then
    say "   skipped: $previous does not exist yet, so there is nothing to upgrade from"
    return 0
  fi

  # A volume of its own: the older image refuses one a newer image wrote.
  docker rm -f "$CONTAINER" >/dev/null
  docker volume rm "$VOLUME" >/dev/null
  start_container "$CONTAINER"
  wait_healthy "$CONTAINER"
  docker exec "$CONTAINER" ahpd plugin install @ahpd/webhook >/dev/null

  docker rm -f "$CONTAINER" >/dev/null
  start_container "$CONTAINER"
  wait_healthy "$CONTAINER"
  listed=$(docker exec "$CONTAINER" ahpd plugin list --json)
  printf '%s' "$listed" | node -e '
    const rows = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
    const found = rows.find((row) => row.name === "@ahpd/webhook");
    if (found === undefined) { console.error("the installed plugin is gone after the swap"); process.exit(1); }
    if (found.state !== "ready") { console.error(`the installed plugin is ${found.state} after the swap`); process.exit(1); }
  ' || fail 'the installed plugin did not load on the new image'
}

# The version ahpd says it is in this image.
image_version() { docker run --rm "$IMAGE" --version; }

# A fresh volume that holds only the image-version file, as an image of that
# version would have left it.
version_volume() {
  docker rm -f "$VERSION_CONTAINER" >/dev/null 2>&1 || true
  docker volume rm "$VERSION_VOLUME" >/dev/null 2>&1 || true
  docker run --rm -v "$VERSION_VOLUME:/home/ahpd" --entrypoint sh "$IMAGE" -c \
    'mkdir -p "$HOME/.config/ahpd" && printf "%s\n" "$1" > "$HOME/.config/ahpd/image-version"' sh "$1"
}

# A pre-release is lower than its release, so a pre-release image refuses a
# volume its release wrote. Skipped for a released image, which has no release
# above it of its own version.
check_prerelease_refuses_its_release() {
  local image release said
  image=$(image_version)
  case $image in
    *-*) ;;
    *) say "   skipped: $image is not a pre-release"; return 0 ;;
  esac
  release=${image%%-*}
  version_volume "$release"
  if said=$(timeout 120 docker run --name "$VERSION_CONTAINER" -v "$VERSION_VOLUME:/home/ahpd" "$IMAGE" 2>&1); then
    fail "the $image image started on a volume at $release"
  fi
  docker rm -f "$VERSION_CONTAINER" >/dev/null
  case $said in
    *'an older image does not start on a newer volume'*) ;;
    *) fail "the $image image stopped on a volume at $release, but not at the downgrade check: $said" ;;
  esac
}

# A volume a lower pre-release of the same version wrote starts this image,
# and then says this image's version. `X.Y.Z-0` is below every other
# pre-release of X.Y.Z, and below X.Y.Z itself.
check_lower_prerelease_starts() {
  local image lower written
  image=$(image_version)
  lower="${image%%-*}-0"
  if [ "$lower" = "$image" ]; then
    say "   skipped: no pre-release is lower than $image"
    return 0
  fi
  version_volume "$lower"
  docker run -d --name "$VERSION_CONTAINER" -p 127.0.0.1::9187 -v "$VERSION_VOLUME:/home/ahpd" "$IMAGE" >/dev/null
  wait_healthy "$VERSION_CONTAINER"
  written=$(docker exec "$VERSION_CONTAINER" cat /home/ahpd/.config/ahpd/image-version)
  [ "$written" = "$image" ] || fail "the volume says $written after the start, not $image"
  docker rm -f "$VERSION_CONTAINER" >/dev/null
}

check_pty() {
  # The call a terminal makes for its spawner. A result with `pty` is a
  # pseudoterminal, and the protocol then reports the terminal as isPty: true.
  docker exec "$CONTAINER" node --input-type=module -e '
    const { pty } = await import("/opt/ahpd/lib/node_modules/@ahpd/server/dist/pty.js");
    const found = await pty();
    if (found.pty === undefined) {
      console.error("node-pty did not load, so a terminal would be pipes");
      process.exit(1);
    }
  ' || fail 'a terminal is not a pseudoterminal in this image'
}

# The root filesystem read-only, with a writable /tmp: everything the daemon
# writes is in the volume, and this says so. A volume of its own, so it never
# shares a state file with the container above.
check_read_only() {
  docker run -d --name "$RO_CONTAINER" --read-only --tmpfs /tmp \
    -p 127.0.0.1::9187 -v "$RO_VOLUME:/home/ahpd" "$IMAGE" >/dev/null
  wait_healthy "$RO_CONTAINER"
  docker rm -f "$RO_CONTAINER" >/dev/null
}

say "Image: $IMAGE"
run_check 'a fresh volume gets healthy, and the token file is 0600' check_fresh_volume
run_check 'the token answers 426, and a wrong one 401' check_token
run_check 'a restart keeps the token and the state' check_restart
run_check 'ahpd restart brings the container back with the same token' check_exec_restart
run_check 'a new container on the same volume keeps the state' check_new_container
run_check 'an upgrade swaps the image and keeps the plugin' check_upgrade
run_check 'a pre-release image refuses a volume its release wrote' check_prerelease_refuses_its_release
run_check 'a volume a lower pre-release wrote starts the image' check_lower_prerelease_starts
run_check 'a terminal is a pseudoterminal' check_pty
run_check 'the image runs with a read-only root' check_read_only
say ''
say 'All checks passed.'
