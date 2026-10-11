import { describe, expect, it } from "vitest";
import { run } from "./helpers.js";

// Opt-in, read-only (GET) smoke test against a real server:
//   PROXMOX_LIVE=1 PROXMOX_AXI_CONFIG=<file> npm test
const env = { ...(process.env as Record<string, string>) };

describe.skipIf(!process.env.PROXMOX_LIVE)("live server (GET only)", () => {
  it("shows the dashboard", async () => {
    const r = await run([], env);
    expect(r.code).toBe(0);
    expect(r.out).toContain("Proxmox VE");
    expect(r.out).toContain("nodes[");
  });

  it("reads /version and /nodes", async () => {
    expect((await run(["get", "/version"], env)).out).toContain("release:");
    expect((await run(["get", "/nodes"], env)).out).toMatch(/nodes\[\d+\]/);
  });

  it("reads the default node's status", async () => {
    expect((await run(["get", "/nodes/{node}/status"], env)).out).toContain("status:");
  });
});
