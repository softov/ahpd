---
title: The pull request pill and the worktree's files come back in VS Code 1.140 - deferred
date: 2026-10-02
---

- **A test for the refusals in `link`.** A target whose parent is a symlink, or not a folder, is refused as the reference refuses it, but no real input reaches it: a candidate is an ancestor of a git-ignored file, and its parents in a fresh worktree are folders git checked out. The checks stay; they are read by hand.
- **`worktreeSymlinkFolders` as a string.** Only the array is read. If ahpc or ahpapp offer the key and send a comma-separated string, read it as `worktreeIncludeFiles` is read.
- **ahpc and ahpapp send `worktreeIncludeFiles` as a list.** The host reads both; moving the clients is their own change.
