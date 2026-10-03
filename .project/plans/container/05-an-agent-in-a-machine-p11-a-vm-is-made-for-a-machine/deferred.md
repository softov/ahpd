---
title: A VM is made for a machine - deferred
date: 2026-10-02
---

What waits until the clone route has been used.

| What | Why it waits | Where it goes |
| --- | --- | --- |
| A libvirt VM on this host sharing the session's folder by virtiofs instead of a clone | Softov, 2026-10-02: "clone everywhere.. but leave open for future case with virtiofs on local libvirt" | unplanned |
| A Proxmox LXC container as a machine | a container is not a VM; it would be its own verbs under the `proxmox` runtime | unplanned |
