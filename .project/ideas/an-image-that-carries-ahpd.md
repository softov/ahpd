---
title: An image that carries ahpd
created: 2026-09-26
---

A cofold session in a computer runs in an `ahpd --stdio` started inside the machine, and today the machine gets that host from an image a person builds: `npm i -g @ahpd/server`, then `ahpd plugin install --no-enable` for each backend ([decision](../decisions/a-nested-host-image-installs-its-plugins-with-ahpd-plugin-install.md)).
That works, and it is an install process somebody has to write, keep in step with the outer host's version, and rebuild.

The ideal, in Softov's words (2026-09-26): "its desired a dock special for that... to just plug folder for code and all is ok.. no install process.. only git worktree or some folder sharing... this is the ideal".

So an image made for this purpose, published beside the packages, that already holds ahpd and the backends that run nested, at the protocol version of the host that starts it.
A machine made from it needs nothing installed: the only thing shared into it is the code, as a git worktree or a mounted folder, plus what an agent declares it needs (its config and keys, through `machine()`).
A profile would name that image and nothing else, and the `host` command would be its default.

## Open

- Who builds and publishes the image, and how its tag follows the release version so the inner host's protocol matches the outer's.
- Which backends it carries: every one that declares `runsNested`, or one image per backend.
- Whether the code arrives as a worktree the outer host makes and mounts, or as the session's folder mounted at the same path, which is what keeps cofold's transcript paths the same inside and out.
- How a KVM machine gets the same thing, since it has no image layer to carry it.
