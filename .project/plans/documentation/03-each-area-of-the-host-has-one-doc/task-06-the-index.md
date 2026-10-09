---
title: The docs folder has an index
status: implemented
depends: [task-01-authentication.md, task-02-host-and-automations.md, task-03-sessions-and-chats.md, task-04-terminals-and-tools.md, task-05-resources-and-usage.md]
layer: "docs"
refs:
  - "[code://.project/plans/documentation/00-documentation.md](../00-documentation.md) - the domain reference lists the docs"
---

## Objective

`docs/README.md` lists every doc with one line on what it covers, and the domain reference lists the same.

## Files

- `CREATE: docs/README.md`.
- `UPDATE: .project/plans/documentation/00-documentation.md` - its Contracts list every doc.
- `UPDATE: README.md` - links `docs/README.md`.

## Steps

1. Write one line per doc.
2. Update the domain reference and the root README.

## Validation

- Every file in `docs/` has a line, and every link resolves.

## Resume

`docs/README.md` is written, 28 lines: two sentences on what `docs/` is (one file per area, each stating what is true today and linking the decision behind a choice rather than repeating its reasoning) and a table with one row per file, `README.md` itself included, every file in `docs/` named and no file left out. The twenty rows and the twenty files in the folder are the same twenty, checked with `ls docs/ | wc -l` against the row count.

`.project/plans/documentation/00-documentation.md` was updated: its opening line said "four documents with one job each", which stopped being true several plans ago, and now says one file per area with a second line naming `docs/README.md` as the index. Its Contracts list named four docs; it now names every one of the twenty, `docs/README.md` first and the root `README.md`, `REFERENCE.md` and `UPSTREAM.md` kept where they were.

`README.md` gained one line under `# Documentation` pointing at `docs/README.md`, so the shortlist below it is read as a shortlist rather than as the set. The shortlist's `docs/COMPUTER.md` row said "Disposable computers (Docker and KVM)", which the code contradicts: `runtime` accepts `docker` alone (`packages/computer/src/plugin.ts`'s `optionsSchema`), `docs/COMPUTER.md` opens with "Docker is the only runtime today", and `docs/PLUGINS.md:1077-1079` says the scheme is one package rather than `@ahpd/computer-docker` with `@ahpd/computer-kvm` beside it. The row now reads "(Docker)", and where KVM does appear - a hypervisor inside a container, reached with `--device /dev/kvm` - is left as `docs/COMPUTER.md` has it.

Every link in `docs/README.md` resolves: the twenty rows point at the twenty files in the folder, and the closing line at `../README.md`, `../REFERENCE.md` and `../.project/decisions/`, all of which exist.
