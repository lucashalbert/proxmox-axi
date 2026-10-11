import http from "node:http";
import https from "node:https";
import tls from "node:tls";
import { AxiError } from "axi-sdk-js";
import type { Config } from "./config.js";
import { CONFIG_HELP } from "./config.js";

export type Wire = Record<string, string[]>;
export type Req = { method: string; url: string; auth: string; body?: string };

const TIMEOUT_MS = 30_000;
const SECRET = /(^|[-_])(password|secret|token|key)([-_]|$)/i;
const hex = (s: string) => s.replace(/[^0-9a-f]/gi, "").toUpperCase();

/** Query string for GET/DELETE, form body for POST/PUT. Arrays repeat the key. */
export function buildRequest(cfg: Config, method: string, path: string, wire: Wire): Req {
  const qs = new URLSearchParams(Object.entries(wire).flatMap(([k, vs]) => vs.map((v) => [k, v])));
  const text = qs.toString();
  const hasBody = method === "POST" || method === "PUT";
  const base = `${cfg.url ?? "https://<PROXMOX_URL>"}/api2/json${path}`;
  return {
    method,
    url: !hasBody && text ? `${base}?${text}` : base,
    auth: `PVEAPIToken=${cfg.token ?? ""}`,
    body: hasBody ? text : undefined,
  };
}

/** Repeated keys become arrays. */
function bodyObject(body: string): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [k, v] of new URLSearchParams(body)) {
    const prev = out[k];
    const value = SECRET.test(k) ? "<redacted>" : v;
    out[k] = prev === undefined ? value : Array.isArray(prev) ? [...prev, value] : [prev, value];
  }
  return out;
}

function redactedUrl(raw: string): string {
  const q = raw.indexOf("?");
  if (q < 0) return raw;
  const params = new URLSearchParams(raw.slice(q + 1));
  for (const [k] of params) {
    if (SECRET.test(k)) params.set(k, "<redacted>");
  }
  return `${raw.slice(0, q)}?${params}`;
}

function redactAuth(auth: string): string {
  return auth.replace(/=[^=]*$/, "=<redacted>");
}

/** Request as printed by --dry-run: the token secret never leaves the process. */
export function redacted(req: Req): Record<string, unknown> {
  const body = req.body ? bodyObject(req.body) : undefined;
  return {
    method: req.method,
    url: redactedUrl(req.url),
    authorization: redactAuth(req.auth),
    ...(body ? { body } : {}),
  };
}

/** Pin by SHA-256 fingerprint: no request bytes are written until the cert matches. */
function pinnedAgent(fingerprint: string): https.Agent {
  const agent = new https.Agent();
  agent.createConnection = ((opts: tls.ConnectionOptions, cb: (e: Error | null, s?: tls.TLSSocket) => void) => {
    const sock = tls.connect({ ...opts, rejectUnauthorized: false });
    sock.once("error", (e) => cb(e));
    sock.once("secureConnect", () => {
      if (hex(sock.getPeerCertificate().fingerprint256 ?? "") === hex(fingerprint)) return cb(null, sock);
      sock.destroy();
      cb(new Error("TLS fingerprint mismatch"));
    });
  }) as never;
  return agent;
}

export type Reply = { status: number; message: string; data: unknown };

export function send(cfg: Config, req: Req): Promise<Reply> {
  if (!cfg.url || !cfg.token) {
    throw new AxiError("Server URL or API token not configured", "CONFIG_ERROR", CONFIG_HELP);
  }
  const url = new URL(req.url);
  const secure = url.protocol === "https:";
  const headers: Record<string, string> = { Authorization: req.auth, Accept: "application/json" };
  if (req.body !== undefined) headers["Content-Type"] = "application/x-www-form-urlencoded";
  const options: https.RequestOptions = { method: req.method, headers, timeout: TIMEOUT_MS };
  if (secure && cfg.fingerprint) options.agent = pinnedAgent(cfg.fingerprint);
  else if (secure && cfg.insecure) options.rejectUnauthorized = false;
  return new Promise((resolve, reject) => {
    const r = (secure ? https : http).request(url, options, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let json: { data?: unknown; errors?: Record<string, string>; message?: string } = {};
        try {
          json = JSON.parse(text);
        } catch {
          /* non-JSON body: fall back to status text */
        }
        const detail = Object.entries(json.errors ?? {}).map(([k, v]) => `${k}: ${v}`);
        const message = [res.statusMessage, json.message?.trim(), ...detail].filter(Boolean).join("; ");
        resolve({ status: res.statusCode ?? 0, message, data: json.data });
      });
    });
    r.on("timeout", () => r.destroy(new Error("request timed out")));
    r.on("error", (e: NodeJS.ErrnoException) => reject(connectionError(e, cfg)));
    r.end(req.body);
  });
}

function connectionError(e: NodeJS.ErrnoException, cfg: Config): AxiError {
  const tlsFail = /certificate|self[- ]signed/i.test(`${e.code} ${e.message}`);
  const help = tlsFail
    ? ["Pin the server certificate with PROXMOX_FINGERPRINT=<sha256>, or set PROXMOX_INSECURE=1 to skip verification"]
    : /fingerprint/.test(e.message)
      ? ["PROXMOX_FINGERPRINT does not match the server certificate; re-check it or the host"]
      : [`Check PROXMOX_URL (${cfg.url}) is reachable`];
  return new AxiError(`Cannot reach server: ${e.message}`, "CONNECTION_ERROR", help);
}

export function httpError(r: Reply): AxiError {
  const hint: Record<number, string> = {
    401: "Check the API token (PROXMOX_API_TOKEN) is valid and not expired",
    403: "The token lacks permission for this path; see `--help` for the required permission, and check token privilege separation",
    501: "This path/method is not implemented on this server version (the bundled schema may be newer)",
  };
  return new AxiError(`HTTP ${r.status}: ${r.message}`, `HTTP_${r.status}`, hint[r.status] ? [hint[r.status]] : []);
}
