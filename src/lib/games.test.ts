import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs/promises", () => ({
  default: {
    readdir: vi.fn(),
    readFile: vi.fn(),
  },
}));

import fs from "node:fs/promises";
import { getGameByDate, getGameDates } from "./games";

const mockedFs = vi.mocked(fs);

describe("games utilities", () => {
  beforeEach(() => {
    mockedFs.readdir.mockReset();
    mockedFs.readFile.mockReset();
  });

  it("returns empty array when games directory is missing", async () => {
    mockedFs.readdir.mockRejectedValueOnce(new Error("ENOENT"));

    await expect(getGameDates()).resolves.toEqual([]);
  });

  it("filters invalid filenames and sorts dates descending", async () => {
    const files = [
      "2026-03-01.json",
      "2026-03-03.json",
      "README.md",
      "2026-03-02.json",
      "2026-3-04.json",
    ];

    mockedFs.readdir.mockResolvedValueOnce(files);

    await expect(getGameDates()).resolves.toEqual([
      "2026-03-03",
      "2026-03-02",
      "2026-03-01",
    ]);
  });

  it("returns null when a date file cannot be read", async () => {
    mockedFs.readFile.mockRejectedValueOnce(new Error("ENOENT"));

    await expect(getGameByDate("2026-03-08")).resolves.toBeNull();
  });

  it("parses and returns a valid game json payload", async () => {
    mockedFs.readFile.mockResolvedValueOnce(
      JSON.stringify({
        date: "2026-03-08",
        type: "phaser",
        template: "dodger",
        title: "Daily Dodger",
        seed: 20260308,
        stagePack: "classic",
        difficulty: 3,
        theme: "neon",
      })
    );

    await expect(getGameByDate("2026-03-08")).resolves.toMatchObject({
      date: "2026-03-08",
      type: "phaser",
      template: "dodger",
      title: "Daily Dodger",
    });
  });
});
