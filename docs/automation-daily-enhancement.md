# Daily Enhancement Automation Guard

Run this guard before selecting a daily improvement:

```bash
pnpm automation:guard
```

The guard preserves the repository policy:

- Stop when the worktree already has uncommitted changes.
- Fetch `origin/main` before working.
- Retry transient `git fetch origin` network failures before stopping.
- Fast-forward local `main` only when `origin/main` is a direct descendant.
- Stop on branch divergence, auth failures, or unknown fetch failures.

This is intended for automation self-recovery only. It must not be used to
bypass source-of-truth checks or continue after a real repository conflict.
