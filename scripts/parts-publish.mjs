#!/usr/bin/env node
/**
 * Every part image, and the joined image of them all, built from the
 * Dockerfiles this checkout writes, at the tags a daemon run from it asks for.
 *
 * The release workflow runs it with `--push`, which builds each image for both
 * platforms a machine runs on and pushes it to the registry the computer
 * package names, where every host pulls it: VS Code's build produces each agent
 * SDK once per release and uploads it for every host to download at first use.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/build/agent-sdk/README.md#L1-L5
 *
 * A tag already in the registry is left as it is, as VS Code's upload leaves an
 * SDK already published: the tag names the versions and the Dockerfile, so the
 * image under it is the one this would build.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/build/agent-sdk/README.md#L52
 *
 * `--push` also writes the digest of each image it pushed or found published,
 * by the tag a host asks for, to `packages/computer/images/digests.json`, or
 * to the file `--digests` names. The release packs that file into
 * `@ahpd/computer`, and a host pulls each image by its digest, so a tag pushed
 * again with other content is not what a host runs. The file is never
 * committed: a checkout has none, and pulls by tag.
 *
 * `--local` builds each image on this host's Docker, for a checkout whose part
 * Dockerfiles moved since the last release: a daemon run from it finds them by
 * their tags and pulls nothing. With neither flag every image is built for both
 * platforms and nothing is pushed, which is the release's rehearsal.
 *
 * Usage, with the resolver and the condition that read the plugin's own source:
 *   node --conditions development --import ./scripts/dev.mjs scripts/parts-publish.mjs [--push [--digests <file>] | --local]
 *
 * Exit status is 1 when an image did not build or has no digest after its push,
 * and 2 for a refusal of the arguments.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const USAGE = `Every part image and the joined image, built at the tags a daemon from this checkout asks for.

  node --conditions development --import ./scripts/dev.mjs scripts/parts-publish.mjs           build for both platforms, push nothing
  node --conditions development --import ./scripts/dev.mjs scripts/parts-publish.mjs --push    build for both platforms, push what is not there, and write each digest
  node --conditions development --import ./scripts/dev.mjs scripts/parts-publish.mjs --local   build on this host's Docker

  --digests <file>   with --push, where the digests are written; packages/computer/images/digests.json by default`;

const argv = process.argv.slice(2);
const digestsAt = argv.indexOf('--digests');
const flags = argv.filter((_, at) => digestsAt === -1 || (at !== digestsAt && at !== digestsAt + 1));
if (
  flags.some((one) => one !== '--push' && one !== '--local')
  || (flags.includes('--push') && flags.includes('--local'))
  || (digestsAt !== -1 && (argv[digestsAt + 1] === undefined || !flags.includes('--push')))
) {
  process.stderr.write(`${USAGE}\n`);
  process.exit(2);
}
const push = flags.includes('--push');
const local = flags.includes('--local');
/** Where `--push` writes the digests, which `@ahpd/computer` ships beside its versions file. */
const digestsFile = digestsAt === -1
  ? fileURLToPath(new URL('../packages/computer/images/digests.json', import.meta.url))
  : argv[digestsAt + 1];

const { ahpdSourceOf, contextOf, dockerfileOf, hashOf, joinedDockerfile, lockOf, readParts, registryOf, tagOf } = await import('../packages/computer/src/parts.ts');
const { dockerRuntime } = await import('../packages/computer/src/runtime.ts');

/** The platforms a machine runs on, which are the downloads every archive part names. */
const PLATFORMS = 'linux/amd64,linux/arm64';

/**
 * The repository the computer package names, as the label that links each
 * image's package to it, so the package takes the repository's access.
 * https://docs.github.com/en/packages/learn-github-packages/configuring-a-packages-access-control-and-visibility
 */
const named = new URL(JSON.parse(readFileSync(new URL('../packages/computer/package.json', import.meta.url), 'utf8')).repository.url);
const repository = `https://${named.hostname}${named.pathname.endsWith('.git') ? named.pathname.slice(0, -'.git'.length) : named.pathname}`;

const registry = registryOf();
const parts = readParts();
const docker = dockerRuntime({ command: 'docker', label: 'ahpd.computer=1' });

/** Whether the registry holds an image, which a manifest it answers for says. */
const published = (reference) => spawnSync('docker', ['buildx', 'imagetools', 'inspect', reference], { stdio: 'ignore' }).status === 0;

/**
 * The digest of the image the registry holds at `reference`: the digest of its
 * manifest, which for an image of two platforms is the index both are listed
 * in, so a pull by it picks this host's platform. `undefined` when the
 * registry answers none, or one that is not a sha256.
 * https://docs.docker.com/reference/cli/docker/buildx/imagetools/inspect/#format
 */
const digestOf = (reference) => {
  const said = spawnSync('docker', ['buildx', 'imagetools', 'inspect', reference, '--format', '{{json .Manifest}}'], { encoding: 'utf8' });
  if (said.status !== 0) return undefined;
  try {
    const digest = JSON.parse(said.stdout).digest;
    return typeof digest === 'string' && /^sha256:[0-9a-f]{64}$/.test(digest) ? digest : undefined;
  }
  catch {
    return undefined;
  }
};

/** The digest of each image `--push` left published, by the tag a host asks for. */
const digests = new Map();

/** Keep the digest of a published image, or fail the run for one with none. */
const keepDigest = (image, remote) => {
  const digest = digestOf(remote);
  if (digest === undefined) {
    process.stdout.write(`${image.name} has no digest: the registry answered none for ${remote}\n`);
    return false;
  }
  digests.set(image.tag, digest);
  return true;
};

// Each part after the parts it requires, so `node` is there before what copies it in.
const ordered = [];
const visit = (id) => {
  if (ordered.includes(id)) return;
  for (const need of parts.find((one) => one.id === id)?.requires ?? []) visit(need);
  ordered.push(id);
};
for (const one of parts) visit(one.id);

/**
 * Each image this publishes, in the order it is built: its name in a line,
 * its tag, the tags of the images it copies in, and its build context.
 */
const images = [];
const tags = new Map();
for (const id of ordered) {
  const part = parts.find((one) => one.id === id);
  const source = part.kind === 'ahpd' ? await ahpdSourceOf((line) => { process.stdout.write(`${line}\n`); }) : undefined;
  const lock = lockOf(part);
  const file = dockerfileOf(part, source, lock);
  const tag = tagOf(part, source?.hash, file);
  tags.set(id, tag);
  // A part with npm packages is built from its two files, and a checkout's own
  // ahpd part from the tarballs it packed.
  images.push({
    name: id,
    tag,
    required: (part.requires ?? []).map((need) => tags.get(need)),
    context: contextOf(file, source?.from === 'workspace' ? [...source.tarballs, ...source.plugins] : lock ?? []),
  });
}

/*
 * The joined image, every part copied in by the tag it is published at, at
 * the tag a host whose parts all loaded at those tags asks for, so a runtime
 * that cannot mount image parts pulls it with them. Its base is pinned by
 * digest in its Dockerfile.
 */
const ahpd = parts.some((one) => one.kind === 'ahpd') ? await ahpdSourceOf() : undefined;
const joined = joinedDockerfile(parts, tags);
images.push({
  name: 'the joined image',
  tag: `ahpd-agents:${hashOf(ahpd?.hash, parts, parts.map((one) => one.id), joined)}`,
  required: [...tags.values()],
  context: contextOf(joined),
});

const unbuilt = new Set();
let failed = false;
for (const image of images) {
  // An image that copies in one that did not build is not built either.
  const without = image.required.filter((one) => unbuilt.has(one));
  if (without.length > 0) {
    process.stdout.write(`${image.name} not built: it copies in ${without.join(', ')}, which did not build\n`);
    unbuilt.add(image.tag);
    failed = true;
    continue;
  }

  if (local) {
    if (await docker.hasImage(image.tag)) {
      process.stdout.write(`${image.tag} was already there\n`);
      continue;
    }
    try {
      await docker.buildImage(image.tag, image.context);
      process.stdout.write(`${image.tag} built\n`);
    }
    catch (error) {
      process.stdout.write(`${image.name} not built: ${error.message}\n`);
      unbuilt.add(image.tag);
      failed = true;
    }
    continue;
  }

  const remote = `${registry}/${image.tag}`;
  if (published(remote)) {
    process.stdout.write(`${remote} is already published\n`);
    if (push && !keepDigest(image, remote)) failed = true;
    continue;
  }
  // An image another is copied into is copied in by its tag, which here is
  // the registry's image of that tag, since a builder of two platforms holds
  // no image of this host's.
  const missing = push ? [] : image.required.filter((one) => !published(`${registry}/${one}`));
  if (missing.length > 0) {
    process.stdout.write(`${image.name} is not rehearsed: it copies in ${missing.map((one) => `${registry}/${one}`).join(', ')}, not published yet\n`);
    continue;
  }
  const built = spawnSync('docker', [
    'buildx', 'build',
    '--platform', PLATFORMS,
    '--label', `org.opencontainers.image.source=${repository}`,
    '--tag', remote,
    ...image.required.flatMap((one) => ['--build-context', `${one}=docker-image://${registry}/${one}`]),
    ...(push ? ['--push'] : []),
    '-',
  ], { input: image.context, stdio: ['pipe', 'inherit', 'inherit'] });
  if (built.status === 0) {
    process.stdout.write(`${remote} ${push ? 'pushed' : 'built'}\n`);
    if (push && !keepDigest(image, remote)) failed = true;
  }
  else {
    process.stdout.write(`${image.name} not built: docker buildx build exited ${built.status ?? built.signal}\n`);
    unbuilt.add(image.tag);
    failed = true;
  }
}

// What a host pulls by: every image this run left published, sorted by tag so
// two runs over the same registry write the same bytes. Written on a failed run
// too, for what it did publish, though the release stops on that run.
if (push) {
  const sorted = Object.fromEntries([...digests].sort(([one], [two]) => one.localeCompare(two)));
  writeFileSync(digestsFile, `${JSON.stringify(sorted, null, 2)}\n`);
  process.stdout.write(`${digests.size} digests written to ${digestsFile}\n`);
}
process.exit(failed ? 1 : 0);
