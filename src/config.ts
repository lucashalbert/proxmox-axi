import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type Config = {
  url?: string;
  token?: string;
  fingerprint?: string;
  insecure: boolean;
  node?: string;
};

export const CONFIG_HELP = [
  "Set PROXMOX_URL, PROXMOX_API_TOKEN (user@realm!id=secret) and PROXMOX_FINGERPRINT (or PROXMOX_INSECURE=1)",
  "Or put those KEY=VALUE lines in ~/.config/proxmox-axi/config (override with PROXMOX_AXI_CONFIG=<file>)",
];

function readEnvFile(file: string): Record<string, string> {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return {};
  }
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/^(["'])(.*)\1$/, "$2");
  }
  return out;
}

/** Environment variables override the config file. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const file = env.PROXMOX_AXI_CONFIG ?? join(env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "proxmox-axi", "config");
  const e = { ...readEnvFile(file), ...env };
  const token =
    e.PROXMOX_API_TOKEN ??
    (e.PROXMOX_API_TOKEN_ID && e.PROXMOX_API_TOKEN_SECRET
      ? `${e.PROXMOX_API_TOKEN_ID}=${e.PROXMOX_API_TOKEN_SECRET}`
      : undefined);
  return {
    url: e.PROXMOX_URL?.replace(/\/+$/, "").replace(/\/api2\/json$/, ""),
    token,
    fingerprint: e.PROXMOX_FINGERPRINT,
    insecure: /^(1|true|yes)$/i.test(e.PROXMOX_INSECURE ?? ""),
    node: e.PROXMOX_NODE,
  };
}
