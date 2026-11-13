#!/bin/sh
# What a container runs before ahpd: seed the volume's plugins, move them to
# the version the image asks for, and then let ahpd replace this shell.
#
# The image holds @ahpd/server and nothing else. Everything that changes is in
# the volume at /home/ahpd: the plugin root is the configuration directory, and
# image-version is the version that last wrote to that volume.
#
# Each step names itself, so a start that stops says which step stopped it.

set -eu

CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/ahpd"
VERSION_FILE="$CONFIG_DIR/image-version"
DEFAULT_PLUGINS='@ahpd/web'
# Where the image installed @ahpd/server, whose semver the downgrade check
# reads versions with.
SERVER_DIR='/opt/ahpd/lib/node_modules/@ahpd/server'

STEP='start'
fail() {
  printf 'ahpd: %s failed: %s\n' "$STEP" "$1" >&2
  exit 1
}

# A command other than run is ahpd's own, and is not a start of the daemon:
# `docker run <image> --version` reads as ahpd without touching the volume.
if [ "$#" -eq 0 ] || [ "$1" != 'run' ]; then
  exec ahpd "$@"
fi

STEP='the image version'
image=$(ahpd --version) || fail 'ahpd --version'
[ -n "$image" ] || fail 'ahpd --version printed nothing'

volume=$(cat "$VERSION_FILE" 2>/dev/null || true)

STEP='the downgrade check'
# The versions are read as semver, with the server's own semver, so a
# pre-release is lower than its release: a volume at 0.15.0-rc.1 starts the
# 0.15.0 image. A version semver cannot read stops the start by name.
if [ -n "$volume" ] && [ "$volume" != "$image" ] && [ "${AHPD_ALLOW_DOWNGRADE:-}" != '1' ]; then
  # The script is JavaScript, and its `${...}` are its own template literals.
  # shellcheck disable=SC2016
  order=$(node -e '
    const [server, image, volume] = process.argv.slice(1);
    const semver = require(require.resolve("semver", { paths: [server] }));
    if (semver.valid(image) === null) { console.log(`the image version ${image} is not a version`); process.exit(1); }
    if (semver.valid(volume) === null) { console.log(`the volume version ${volume} is not a version`); process.exit(1); }
    console.log(semver.lt(image, volume) ? "older" : "newer");
  ' "$SERVER_DIR" "$image" "$volume") || fail "$order"
  if [ "$order" = 'older' ]; then
    printf 'ahpd: this image is %s and the volume was written by %s; an older image does not start on a newer volume. Set AHPD_ALLOW_DOWNGRADE=1 to start it anyway.\n' "$image" "$volume" >&2
    exit 1
  fi
fi

# Unset means the web UI, which is what a first start should have; empty means
# no plugin at all. A list takes commas or spaces.
if [ -n "${AHPD_PLUGINS+set}" ]; then
  plugins=$AHPD_PLUGINS
else
  plugins=$DEFAULT_PLUGINS
fi
plugins=$(printf '%s' "$plugins" | tr ',' ' ')

STEP='the plugin list'
listed=$(ahpd plugin list --json) || fail 'ahpd plugin list --json'
# The names are unquoted on purpose: they are words to split, and a package
# name holds no character a shell expands.
# shellcheck disable=SC2086
missing=$(printf '%s' "$listed" | node -e '
  const rows = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
  const have = new Set(rows.map((row) => row.name));
  for (const name of process.argv.slice(1)) if (!have.has(name)) console.log(name);
' $plugins) || fail 'reading the plugin list'

STEP='the plugin install'
for plugin in $missing; do
  ahpd plugin install "$plugin" || fail "ahpd plugin install $plugin"
done

# A plugin follows the sdk of the image it runs on, so an image version that
# differs from the volume's moves every plugin before the daemon loads one.
if [ "$volume" != "$image" ]; then
  STEP='the plugin update'
  ahpd plugin update all || fail 'ahpd plugin update all'

  STEP='the image version file'
  mkdir -p "$CONFIG_DIR" || fail "creating $CONFIG_DIR"
  printf '%s\n' "$image" > "$VERSION_FILE.new" || fail "writing $VERSION_FILE"
  mv "$VERSION_FILE.new" "$VERSION_FILE" || fail "moving $VERSION_FILE into place"
fi

STEP='the daemon'
exec ahpd "$@"
