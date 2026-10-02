---
title: A machine writes its up time - deferred
date: 2026-10-02
---

- **Charging the sessions inside a machine.** The decision expects it once remote sessions arrive; it would be a new decision and a change to this meter.
- **A crash loses the open stretch.** A stretch is written when it ends, so a daemon that dies mid-stretch loses it. Periodic checkpoints, or reading the runtime's own start time against the last record, would close the gap.
- **A machine stopped outside ahpd.** A container that exits on its own, or is stopped with `docker stop`, keeps its stretch open until the plugin next stops or removes it or the daemon stops, so it is charged for time it was down. Watching Docker's events for the container would close it when it stops.
