import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { VERSION } from "../src/version.js";

describe("bin", () => {
  it("version matches package.json and answers without loading the CLI", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    expect(VERSION).toBe(pkg.version);
    const out = execFileSync("npx", ["tsx", "bin/proxmox-axi.ts", "--version"], { encoding: "utf8" });
    expect(out.trim()).toBe(VERSION);
  });
});
