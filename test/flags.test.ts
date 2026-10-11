import { describe, expect, it } from "vitest";
import { run } from "./helpers.js";

const env = { PROXMOX_URL: "https://pve.test:8006", PROXMOX_API_TOKEN: "u@pam!t=sekrit", PROXMOX_NODE: "pve" };
const dry = (...args: string[]) => run([...args, "-n"], env);

describe("flag validation", () => {
  it("rejects a missing required flag with exit 2", async () => {
    const r = await dry("create", "/nodes/pve/qemu/100/clone");
    expect(r.code).toBe(2);
    expect(r.out).toContain("Missing required flag: --newid");
  });

  it("rejects unknown flags and lists the valid ones", async () => {
    const r = await dry("get", "/nodes/pve/qemu", "--bogus");
    expect(r.code).toBe(2);
    expect(r.out).toContain("Unknown flag --bogus");
    expect(r.out).toContain("--full");
  });

  it.each([
    [["--newid", "abc"], "expects an integer"],
    [["--newid", "5"], "must be >= 100"],
    [["--newid", "101", "--format", "zip"], "must be one of: raw, qcow2, vmdk"],
    [["--newid", "101", "--full", "maybe", "--name", "a"], "Unexpected argument maybe"],
    [["--newid", "101", "--newid", "102"], "given more than once"],
  ])("rejects %j", async (flags, msg) => {
    const r = await dry("create", "/nodes/pve/qemu/100/clone", ...flags);
    expect(r.code).toBe(2);
    expect(r.out).toContain(msg);
  });

  it("rejects a flag with no value", async () => {
    const r = await run(["create", "/nodes/pve/qemu/100/clone", "--newid"], env);
    expect(r.out).toContain("--newid needs a value");
  });

  it("encodes booleans as 1/0 in all spellings", async () => {
    for (const [flags, want] of [[["--full"], "1"], [["--full=0"], "0"], [["--full", "false"], "0"], [["--full", "yes"], "1"]] as const) {
      const r = await dry("create", "/nodes/pve/qemu/100/clone", "--newid", "101", ...flags);
      expect(r.out).toContain(`full: "${want}"`);
    }
  });

  it("accepts indexed names like net0 and repeated array flags", async () => {
    const a = await dry("create", "/nodes/pve/qemu", "--vmid", "999", "--net0", "virtio,bridge=vmbr0");
    expect(a.out).toMatch(/net0: "?virtio,bridge=vmbr0/);
    const b = await dry("create", "/cluster/notifications/endpoints/sendmail", "--name", "n", "--mailto", "a@x.org", "--mailto", "b@x.org");
    expect(b.out).toMatch(/mailto\[2\]: .*a@x.org.*b@x.org/);
  });

  it("fills {node} from PROXMOX_NODE, flags, or the path", async () => {
    expect((await dry("get", "/nodes/{node}/qemu")).out).toContain("/api2/json/nodes/pve/qemu");
    expect((await run(["get", "/nodes/{node}/qemu", "--node", "n2", "-n"], env)).out).toContain("/nodes/n2/qemu");
    expect((await run(["get", "/nodes/n3/qemu", "-n"], env)).out).toContain("/nodes/n3/qemu");
    const none = await run(["get", "/nodes/{node}/qemu", "-n"], { ...env, PROXMOX_NODE: "" });
    expect(none.code).toBe(2);
    expect(none.out).toContain("--node");
  });

  it("lets an endpoint's own dry-run parameter win over the local flag, and -n stays local", async () => {
    const r = await run(["create", "/nodes/pve/ceph/restart-bulk", "--service-type", "osd", "--dry-run", "-n"], env);
    expect(r.out).toContain("method: POST");
    expect(r.out).toContain('"dry-run": "1"');
  });

  it("explains a missing verb on a path", async () => {
    const r = await dry("delete", "/version");
    expect(r.code).toBe(2);
    expect(r.out).toContain("Available here: get");
  });

  it("points at valid segments for an unknown path", async () => {
    const r = await dry("get", "/nodes/pve/nope");
    expect(r.code).toBe(2);
    expect(r.out).toContain("Valid segments under /nodes/{node}");
  });
});
