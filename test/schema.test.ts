import { describe, expect, it } from "vitest";
import { callCommand, endpointHelp } from "../src/run.js";
import { paramsOf, resolve, root, VERB_OF, type SNode } from "../src/schema.js";
import { pathNamesOf } from "../src/flags.js";

const endpoints: { node: SNode; method: string }[] = [];
(function walk(n: SNode) {
  for (const m of Object.keys(n.info ?? {})) endpoints.push({ node: n, method: m });
  n.children?.forEach(walk);
})(root());

/** Smallest valid value for a required parameter. */
function sample(spec: ReturnType<typeof paramsOf>[string]): string {
  if (spec.enum) return spec.enum[0];
  if (spec.type === "boolean") return "1";
  if (spec.type === "integer" || spec.type === "number") return String(spec.minimum ?? 1);
  return "x".repeat(spec.minLength ?? 1);
}

describe("bundled schema", () => {
  it("covers every PVE method", () => {
    expect(endpoints.length).toBeGreaterThan(600);
    expect(new Set(endpoints.map((e) => e.method))).toEqual(new Set(["GET", "POST", "PUT", "DELETE"]));
  });

  it("resolves every path to its own node", () => {
    for (const { node } of endpoints) expect(resolve(node.path).node).toBe(node);
  });

  it("renders help for every endpoint", () => {
    for (const { node, method } of endpoints) {
      const help = endpointHelp(VERB_OF[method], node.path, node.info![method], {});
      expect(help.usage).toContain(node.path);
    }
  });

  it("builds a valid dry-run request for every path and method", async () => {
    const cfg = { url: "https://pve.test:8006", token: "u@pam!t=s", insecure: false };
    for (const { node, method } of endpoints) {
      const info = node.info![method];
      const params = paramsOf(info);
      const names = pathNamesOf(node.path);
      const val = (n: string) => sample(params[n] ?? {});
      const flags = [
        ...names.flatMap((n) => [`--${n}`, val(n)]),
        ...Object.entries(params)
          .filter(([k, p]) => !p.optional && !names.includes(k))
          .flatMap(([k, p]) => [`--${k}`, sample(p)]),
        "-n",
      ];
      const out = (await callCommand(VERB_OF[method], [node.path, ...flags], cfg)) as { "dry-run": { method: string; url: string } };
      const path = node.path.replace(/\{([^}]+)\}/g, (_, n) => encodeURIComponent(val(n)));
      expect(out["dry-run"].method).toBe(method);
      expect(out["dry-run"].url.startsWith(`https://pve.test:8006/api2/json${path}`)).toBe(true);
    }
  });
});
