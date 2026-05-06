#!/usr/bin/env node

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const transientFetchPatterns = [
  /could not resolve host/i,
  /temporary failure in name resolution/i,
  /failed to connect/i,
  /connection timed out/i,
  /operation timed out/i,
  /network is unreachable/i,
  /connection reset/i,
  /tls connection/i,
  /http\/2 stream/i,
  /the requested url returned error: 5\d\d/i,
];

const authFailurePatterns = [
  /authentication failed/i,
  /repository not found/i,
  /permission denied/i,
  /could not read username/i,
];

export function classifyGitFetchFailure(message = "") {
  if (authFailurePatterns.some((pattern) => pattern.test(message))) {
    return { retryable: false, reason: "auth" };
  }

  if (transientFetchPatterns.some((pattern) => pattern.test(message))) {
    return { retryable: true, reason: "network" };
  }

  return { retryable: false, reason: "unknown" };
}

export function runCommand(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("close", (status) => {
      resolve({ status, stdout, stderr });
    });

    child.on("error", (error) => {
      resolve({ status: 1, stdout, stderr: error.message });
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function runGitFetchWithRetry({
  attempts = 3,
  delayMs = 2000,
  runCommand: execute = runCommand,
  log = () => {},
} = {}) {
  let lastResult;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = await execute("git", ["fetch", "origin"]);
    lastResult = result;

    if (result.status === 0) {
      return { attempts: attempt };
    }

    const classification = classifyGitFetchFailure(result.stderr);
    const canRetry = classification.retryable && attempt < attempts;

    log(
      `git fetch origin failed on attempt ${attempt}/${attempts}: ${classification.reason}`
    );

    if (!canRetry) {
      break;
    }

    await sleep(delayMs);
  }

  const error = new Error(
    `git fetch origin failed after ${attempts} attempt(s): ${lastResult?.stderr ?? ""}`.trim()
  );
  error.result = lastResult;
  throw error;
}

async function assertCleanWorktree() {
  const status = await runCommand("git", ["status", "--short", "--branch"]);

  if (status.status !== 0) {
    throw new Error(`git status failed: ${status.stderr}`);
  }

  const dirtyLines = status.stdout
    .split("\n")
    .filter((line) => line.trim() && !line.startsWith("##"));

  if (dirtyLines.length > 0) {
    throw new Error(
      `worktree has uncommitted changes before automation work:\n${dirtyLines.join("\n")}`
    );
  }
}

async function isAncestor(ancestor, descendant) {
  const result = await runCommand("git", [
    "merge-base",
    "--is-ancestor",
    ancestor,
    descendant,
  ]);
  return result.status === 0;
}

export async function runSourceOfTruthGuard() {
  await assertCleanWorktree();
  const fetchResult = await runGitFetchWithRetry({ log: console.warn });

  const localHead = await runCommand("git", ["rev-parse", "HEAD"]);
  const originHead = await runCommand("git", ["rev-parse", "origin/main"]);

  if (localHead.status !== 0 || originHead.status !== 0) {
    throw new Error("could not resolve local HEAD or origin/main");
  }

  const localSha = localHead.stdout.trim();
  const originSha = originHead.stdout.trim();

  if (localSha === originSha) {
    return { fetchAttempts: fetchResult.attempts, updated: false };
  }

  if (await isAncestor("HEAD", "origin/main")) {
    const merge = await runCommand("git", ["merge", "--ff-only", "origin/main"]);

    if (merge.status !== 0) {
      throw new Error(`fast-forward merge failed: ${merge.stderr}`);
    }

    return { fetchAttempts: fetchResult.attempts, updated: true };
  }

  throw new Error(
    `local main diverged from origin/main; stop automation. local=${localSha} origin=${originSha}`
  );
}

async function main() {
  try {
    const result = await runSourceOfTruthGuard();
    console.log(
      `source-of-truth guard passed: fetchAttempts=${result.fetchAttempts} updated=${result.updated}`
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
