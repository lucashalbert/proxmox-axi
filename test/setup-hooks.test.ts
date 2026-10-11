import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { setupHooks } from "../src/cli.js";
import { run } from "./helpers.js";

describe("setup hooks", () => {
  it("does not claim installed when run from source (no marker)", async () => {
    const { out, code } = await run(["setup", "hooks"]);
    expect(code).not.toBe(0);
    expect(out).not.toContain("installed (");
    expect(out).toContain("No hooks installed");
  });

  it("reports the agents it actually wrote", () => {
    const homeDir = mkdtempSync(join(tmpdir(), "pxa-home-"));
    const res = setupHooks({ homeDir, marker: "proxmox-axi", execPath: "/x/dist/bin/proxmox-axi.js", shouldInstall: () => true });
    expect(res.hooks).toMatch(/^installed \(.*Claude Code/);
  });

  it("passes write errors through instead of reporting installed", () => {
    expect(() => setupHooks({ homeDir: "/dev/null/nope", marker: "proxmox-axi", execPath: "/x/dist/bin/proxmox-axi.js", shouldInstall: () => true })).toThrow(/not fully installed/);
  });
});
