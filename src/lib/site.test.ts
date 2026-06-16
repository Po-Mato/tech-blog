import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { site } from "./site";

describe("site metadata", () => {
  it("points social preview metadata at a deployed public asset", () => {
    expect(site.ogImage).toMatch(/^\/[^/].+/);
    expect(fs.existsSync(path.join(process.cwd(), "public", site.ogImage))).toBe(true);
  });
});
