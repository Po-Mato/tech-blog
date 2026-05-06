import { describe, expect, it, vi } from "vitest";

import {
  classifyGitFetchFailure,
  runGitFetchWithRetry,
} from "./automation-guard.mjs";

describe("automation guard", () => {
  it("classifies DNS fetch failures as retryable", () => {
    const failure = classifyGitFetchFailure(
      "fatal: unable to access 'https://github.com/Po-Mato/tech-blog.git/': Could not resolve host: github.com"
    );

    expect(failure).toEqual({
      retryable: true,
      reason: "network",
    });
  });

  it("does not retry authentication fetch failures", () => {
    const failure = classifyGitFetchFailure(
      "fatal: Authentication failed for 'https://github.com/Po-Mato/tech-blog.git/'"
    );

    expect(failure).toEqual({
      retryable: false,
      reason: "auth",
    });
  });

  it("retries transient fetch failures before succeeding", async () => {
    const runCommand = vi
      .fn()
      .mockResolvedValueOnce({
        status: 128,
        stderr: "fatal: Could not resolve host: github.com",
      })
      .mockResolvedValueOnce({ status: 0, stderr: "" });

    await expect(
      runGitFetchWithRetry({
        attempts: 2,
        delayMs: 0,
        runCommand,
      })
    ).resolves.toEqual({ attempts: 2 });

    expect(runCommand).toHaveBeenCalledTimes(2);
    expect(runCommand).toHaveBeenNthCalledWith(1, "git", ["fetch", "origin"]);
  });
});
