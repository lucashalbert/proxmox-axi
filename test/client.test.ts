import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fakeServer, run } from "./helpers.js";

const TOKEN = "root@pam!ci=s3cr3t-value";
const vms = Array.from({ length: 5 }, (_, i) => ({ vmid: 100 + i, name: `vm${i}`, status: "running", cpu: 0.1, notes: "n".repeat(300) }));
const UPID = "UPID:pve1:0001:0002:0003:qmstart:100:root@pam!ci:";
type Srv = Awaited<ReturnType<typeof fakeServer>>;
let srv: Srv;
let env: Record<string, string>;

beforeAll(async () => {
  srv = await fakeServer({
    "GET /version": { version: "9.0.1", release: "9.0" },
    "GET /nodes": [{ node: "pve1", status: "online", cpu: 0.02, mem: 100, uptime: 5, maxcpu: 4 }],
    "GET /nodes/pve1/qemu": vms,
    "GET /nodes/pve1/lxc": [],
    "GET /nodes/pve1/status": { uptime: 5, kversion: "x".repeat(900) },
    "POST /nodes/pve1/qemu/100/status/start": () => ({ body: UPID }),
    "GET /nodes/pve1/services": vms.map((v) => ({ service: v.name, desc: v.notes, state: "running" })),
    "PUT /nodes/pve1/qemu/100/config": null,
    "GET /nodes/pve1/storage": () => ({ status: 403, body: null }),
    "GET /nodes/pve1/capabilities": (s) => ({ body: [{ name: s.url }] }),
  });
  env = { PROXMOX_URL: srv.url, PROXMOX_API_TOKEN: TOKEN, PROXMOX_FINGERPRINT: srv.fingerprint, PROXMOX_NODE: "pve1" };
});
afterAll(() => srv.close());

describe("requests", () => {
  it("sends the API token header and a pinned TLS connection", async () => {
    srv.seen.length = 0;
    const r = await run(["get", "/version"], env);
    expect(r.code).toBe(0);
    expect(r.out).toContain("version: 9.0.1");
    expect(srv.seen[0].auth).toBe(`PVEAPIToken=${TOKEN}`);
  });

  it("builds the token from ID + SECRET and reads the config file (env wins)", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "pxa-")), "config");
    writeFileSync(file, `# c\nPROXMOX_URL=${srv.url}\nPROXMOX_API_TOKEN_ID="a@pam!b"\nPROXMOX_API_TOKEN_SECRET=zzz\nPROXMOX_FINGERPRINT=${srv.fingerprint}\n`);
    srv.seen.length = 0;
    await run(["get", "/version"], { PROXMOX_AXI_CONFIG: file });
    expect(srv.seen[0].auth).toBe("PVEAPIToken=a@pam!b=zzz");
    await run(["get", "/version"], { PROXMOX_AXI_CONFIG: file, PROXMOX_API_TOKEN: TOKEN });
    expect(srv.seen[1].auth).toBe(`PVEAPIToken=${TOKEN}`);
  });

  it("sends writes as a form body", async () => {
    srv.seen.length = 0;
    await run(["set", "/nodes/pve1/qemu/100/config", "--memory", "2048", "--name", "web"], env);
    expect(srv.seen[0]).toMatchObject({ method: "PUT", type: "application/x-www-form-urlencoded", url: "/api2/json/nodes/pve1/qemu/100/config" });
    expect(srv.seen[0].body).toBe("memory=2048&name=web");
  });

  it("--dry-run prints the request with the secret redacted and sends nothing", async () => {
    srv.seen.length = 0;
    const r = await run(["create", "/nodes/pve1/qemu/100/status/start", "--dry-run"], env);
    expect(srv.seen).toHaveLength(0);
    expect(r.out).toContain("method: POST");
    expect(r.out).toContain("<redacted>");
    expect(r.out).not.toContain("s3cr3t-value");
  });

  it("encodes path values and query parameters", async () => {
    const r = await run(["get", "/nodes/{node}/capabilities", "-n", "--node", "a b"], env);
    expect(r.out).toContain("/nodes/a%20b/capabilities");
  });
});

describe("TLS", () => {
  it("refuses a fingerprint mismatch before sending anything", async () => {
    srv.seen.length = 0;
    const r = await run(["get", "/version"], { ...env, PROXMOX_FINGERPRINT: "AA:BB:CC" });
    expect(r.code).toBe(1);
    expect(r.out).toContain("CONNECTION_ERROR");
    expect(r.out).toContain("PROXMOX_FINGERPRINT does not match");
    expect(srv.seen).toHaveLength(0);
  });

  it("rejects a self-signed cert without a pin, accepts it with --insecure or PROXMOX_INSECURE", async () => {
    const bare = { PROXMOX_URL: srv.url, PROXMOX_API_TOKEN: TOKEN };
    const denied = await run(["get", "/version"], bare);
    expect(denied.out).toContain("PROXMOX_FINGERPRINT");
    expect(denied.code).toBe(1);
    expect((await run(["get", "/version", "--insecure"], bare)).code).toBe(0);
    expect((await run(["get", "/version"], { ...bare, PROXMOX_INSECURE: "1" })).code).toBe(0);
  });

  it("asks for configuration instead of guessing", async () => {
    const r = await run(["get", "/version"], {});
    expect(r.code).toBe(1);
    expect(r.out).toContain("CONFIG_ERROR");
    expect(r.out).toContain("PROXMOX_API_TOKEN");
  });
});

describe("output", () => {
  it("shows a compact table with id-like columns first and a count when limited", async () => {
    const r = await run(["get", "/nodes/{node}/qemu", "--limit", "2"], env);
    expect(r.out).toMatch(/qemu\[2\]\{vmid,name,status,cpu,notes\}:/);
    expect(r.out).toContain("count: 2 of 5 total");
    expect(r.out).toContain("--limit 0");
    expect(r.out).not.toContain("n".repeat(121));
    expect(r.out).toContain("--full");
  });

  it("selects columns with --fields and expands text with --full", async () => {
    const f = await run(["get", "/nodes/{node}/services", "--fields", "service,desc", "--full"], env);
    expect(f.out).toContain("services[5]{service,desc}:");
    expect(f.out).toContain("n".repeat(300));
  });

  it("truncates long text in detail views and says how to see it all", async () => {
    const r = await run(["get", "/nodes/{node}/status"], env);
    expect(r.out).toContain("truncated, 900 chars total");
    expect(r.out).toContain("--full");
  });

  it("states empty results explicitly", async () => {
    expect((await run(["get", "/nodes/{node}/lxc"], env)).out).toContain("lxc: 0 results");
  });

  it("points at the task endpoints after an action returns a UPID", async () => {
    const r = await run(["create", "/nodes/pve1/qemu/100/status/start"], env);
    expect(r.out).toContain(`task: "${UPID}"`);
    expect(r.out).toContain("get /nodes/pve1/tasks/");
  });

  it("acknowledges writes that return nothing", async () => {
    expect((await run(["set", "/nodes/pve1/qemu/100/config", "--memory", "1024"], env)).out).toContain("result: ok");
  });

  it("translates HTTP errors", async () => {
    const r = await run(["get", "/nodes/{node}/storage"], env);
    expect(r.code).toBe(1);
    expect(r.out).toContain("HTTP_403");
    expect(r.out).toContain("lacks permission");
  });

  it("shows the dashboard with live nodes and next steps", async () => {
    const r = await run([], env);
    expect(r.out).toContain("(Proxmox VE 9.0.1)");
    expect(r.out).toMatch(/nodes\[1\]\{node,status,cpu,mem,uptime\}:/);
    expect(r.out).toContain("proxmox-axi ls /");
  });

  it("shows setup help on the dashboard when unconfigured", async () => {
    const r = await run([], {});
    expect(r.code).toBe(0);
    expect(r.out).toContain("server: not configured");
  });
});
