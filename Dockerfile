# syntax=docker/dockerfile:1

# The ahpd image: @ahpd/server from this checkout, run by a person who has
# Docker and nothing else.
#
# Three stages. `pack` builds and packs the workspace the way release.yml does,
# `install` puts the server and its sibling packages into a prefix with
# node-pty compiled, and `runtime` carries that prefix and none of the
# toolchain. The same build serves `docker build .` from a checkout and
# `docker build https://github.com/softov/ahpd.git#<ref>` from Git.

ARG NODE_IMAGE=node:22-bookworm-slim

# 1. Pack -------------------------------------------------------------------
#
# pnpm packs, never npm: these packages depend on each other with `workspace:^`
# and only pnpm rewrites that to a real range on the way out.
FROM ${NODE_IMAGE} AS pack

# A corepack that asks before it downloads pnpm would stop a build with no
# terminal to answer it.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0

WORKDIR /src

COPY . .

RUN corepack enable \
 && pnpm install --frozen-lockfile \
 && pnpm build \
 && mkdir -p /out \
 && pnpm -r exec pnpm pack --pack-destination /out

# 2. Install ----------------------------------------------------------------
#
# node-pty is an optional dependency of @ahpd/server and builds from source
# here, so the image has the compiler the install needs.
FROM ${NODE_IMAGE} AS install

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

COPY --from=pack /out /tmp/pack

# npm 12 skips install scripts by default, so node-pty's build runs only when
# the flag that allows it is passed. npm 11.16 is the first that knows the
# flag; an older npm runs the script anyway and is given no flag it would
# refuse. This is the rule selfupdate.ts applies to the update it runs.
RUN set -eu; \
    allow=''; \
    version=$(npm --version); \
    major=${version%%.*}; \
    rest=${version#*.}; \
    minor=${rest%%.*}; \
    if [ "$major" -gt 11 ] || { [ "$major" -eq 11 ] && [ "$minor" -ge 16 ]; }; then \
      allow='--allow-scripts=node-pty'; \
    fi; \
    echo "npm $version, allow-scripts: ${allow:-no}"; \
    npm install -g --prefix /opt/ahpd $allow \
      /tmp/pack/ahpd-server-*.tgz /tmp/pack/ahpd-sdk-*.tgz

# 3. Runtime ----------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime

# uid 1000 is the first ordinary user on a Linux host, so a folder a person
# owns there is writable here without a chown. Compose `user:` sets another.
ARG AHPD_UID=1000
ARG VERSION=dev
ARG REVISION=unknown
ARG SOURCE=https://github.com/softov/ahpd

LABEL org.opencontainers.image.title="ahpd" \
      org.opencontainers.image.description="An Agent Host Protocol server for Claude, pi, ACP agents and any agent a plugin adds" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}" \
      org.opencontainers.image.source="${SOURCE}"

# git and ssh for the computers and the sessions; bash for the shells a session
# runs; tini as PID 1, so a stop reaches ahpd and a dead child is reaped;
# procps for `ps` in a session.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      git bash ca-certificates openssh-client tini procps \
 && rm -rf /var/lib/apt/lists/*

# The base image's `node` user, under the name this image runs as.
RUN groupmod -n ahpd node \
 && usermod -l ahpd -d /home/ahpd -m node \
 && usermod -u "${AHPD_UID}" ahpd \
 && mkdir -p /home/ahpd/.npm-global/bin /work \
 && chown -R ahpd:ahpd /home/ahpd /work

# root owns the code. A session that writes here would change the image rather
# than the volume, and a container that writes its own program is one whose
# next start disagrees with what was built.
COPY --from=install /opt/ahpd /opt/ahpd

# The script is the repository's file, copied rather than installed, so the
# image and the checkout run the same one. root owns it beside the code.
COPY --chmod=0755 docker/entrypoint.sh /opt/ahpd/entrypoint.sh

ENV PATH=/opt/ahpd/bin:/home/ahpd/.npm-global/bin:$PATH \
    NPM_CONFIG_PREFIX=/home/ahpd/.npm-global \
    AHPD_SERVICE=container

WORKDIR /work
VOLUME ["/home/ahpd"]
EXPOSE 9187
USER ahpd

# A daemon that is recorded is one a client can reach. With no record the
# command exits non-zero, which is the unhealthy answer.
HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=3 \
  CMD ahpd status --json

ENTRYPOINT ["tini", "--", "/opt/ahpd/entrypoint.sh"]

# 0.0.0.0 inside the container reaches only whoever publishes the port, and it
# forces a token. The token lives in the volume and is read from a file, so it
# is never a flag in `docker inspect`.
CMD ["run", "--host", "0.0.0.0", "--port", "9187", \
     "--connection-token-file", "/home/ahpd/.config/ahpd/connection-token", \
     "--path", "/work", "--no-cwd"]
