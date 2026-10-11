import { execFileSync } from "node:child_process";
import { X509Certificate } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import https from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { main } from "../src/cli.js";

export type Seen = { method: string; url: string; auth?: string; type?: string; body: string };
type Handler = (seen: Seen) => { status?: number; body: unknown };

/** HTTPS server with a throwaway self-signed cert; records every request it receives. */
export async function fakeServer(routes: Record<string, Handler | unknown>) {
  const dir = mkdtempSync(join(tmpdir(), "pxa-"));
  const [key, crt] = [join(dir, "k.pem"), join(dir, "c.pem")];
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", crt, "-subj", "/CN=localhost", "-days", "2"], { stdio: "ignore" });
  const cert = readFileSync(crt);
  const seen: Seen[] = [];
  const server = https.createServer({ key: readFileSync(key), cert }, (req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const s: Seen = { method: req.method!, url: req.url!, auth: req.headers.authorization, type: req.headers["content-type"], body };
      seen.push(s);
      const route = routes[`${s.method} ${s.url.replace("/api2/json", "")}`];
      const out = typeof route === "function" ? (route as Handler)(s) : { body: route };
      res.statusCode = out?.status ?? (route === undefined ? 404 : 200);
      res.end(JSON.stringify(out?.body === undefined ? {} : { data: out.body }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return {
    url: `https://127.0.0.1:${(server.address() as AddressInfo).port}`,
    fingerprint: new X509Certificate(cert).fingerprint256,
    seen,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

/** Run the CLI in-process; returns stdout and exit code. */
export async function run(argv: string[], env: Record<string, string> = {}) {
  let out = "";
  process.exitCode = undefined;
  await main({
    argv,
    stdout: { write: (s: string) => (out += s) },
    env: { PROXMOX_AXI_CONFIG: "/nonexistent", ...env },
  });
  const code = Number(process.exitCode ?? 0);
  process.exitCode = undefined;
  return { out, code };
}
