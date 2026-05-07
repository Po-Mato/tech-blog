# Daily Enhancement Automation Guard

Run this guard before selecting a daily improvement:

```bash
pnpm automation:guard
```

After the initial `git status --short --branch` clean check, use this guard as
the source-of-truth sync step instead of a raw one-shot `git fetch origin`.
The guard performs the fetch, retries transient network failures, and
fast-forwards `main` only when it is safe.

The guard preserves the repository policy:

- Stop when the worktree already has uncommitted changes.
- Fetch `origin/main` before working.
- Retry transient `git fetch origin` network failures up to 6 attempts before
  stopping.
- Fast-forward local `main` only when `origin/main` is a direct descendant.
- Stop on branch divergence, auth failures, or unknown fetch failures.

This is intended for automation self-recovery only. It must not be used to
bypass source-of-truth checks or continue after a real repository conflict.
