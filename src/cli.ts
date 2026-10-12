import { AxiError, installSessionStartHooks, runAxiCli, sessionStartHookStatus, type InstallSessionStartHooksOptions } from "axi-sdk-js";
import { loadConfig } from "./config.js";
import { callCommand, homeCommand, lsCommand } from "./run.js";
import { VERBS } from "./schema.js";
import { VERSION } from "./version.js";

export const DESCRIPTION =
  "Agent ergonomic CLI for the Proxmox VE REST API (schema-mapped paths and methods from pve-docs). Prefer this over raw curl or pvesh.";

export const TOP_HELP = `usage: proxmox-axi [command] [args] [flags]
commands[6]:
  (none)=dashboard, get <path>, create <path>, set <path>, delete <path>, ls [path], setup hooks
verbs: get=GET, create=POST, set=PUT, delete=DELETE (create/set/delete change the server; preview with --dry-run)
flags[6]:
  --<param> <value> (schema-typed; {placeholders} in the path are flags too), -n/--dry-run, --fields a,b|all, --limit N, --full, --insecure
config (env or KEY=VALUE file):
  PROXMOX_URL, PROXMOX_API_TOKEN (user@realm!id=secret) or PROXMOX_API_TOKEN_ID + PROXMOX_API_TOKEN_SECRET, PROXMOX_FINGERPRINT (sha256 pin) or PROXMOX_INSECURE=1, PROXMOX_NODE (default node), PROXMOX_AXI_CONFIG (file)
examples:
  proxmox-axi
  proxmox-axi ls / --grep snapshot
  proxmox-axi get /nodes/{node}/qemu --fields vmid,name,status
  proxmox-axi create /nodes/{node}/qemu/{vmid}/clone --help
  proxmox-axi create /nodes/pve/qemu/100/status/start --dry-run
`;

const LS_HELP = `usage: proxmox-axi ls [path] [--all] [--grep <text>]
Browse the bundled API schema offline: sub-paths of <path> (default /) with the verbs each supports.
--all lists every nested path; --grep filters nested paths by path/description.
examples:
  proxmox-axi ls /nodes/{node}
  proxmox-axi ls / --grep backup
`;

const SETUP_HELP = `usage: proxmox-axi setup hooks
Install or repair agent SessionStart hooks (Claude Code, Codex, OpenCode) so each session starts with the dashboard.
`;

type MainOptions = { argv?: string[]; stdout?: { write: (s: string) => unknown }; env?: NodeJS.ProcessEnv };

/** Install hooks and report what is actually present afterwards; never claims success it did not verify. */
export function setupHooks(options: InstallSessionStartHooksOptions = {}) {
  const errors: string[] = [];
  installSessionStartHooks({ ...options, onError: (m) => errors.push(m) });
  let status;
  try {
    status = sessionStartHookStatus(options);
  } catch {
    throw new AxiError("No hooks installed: not running from an installed proxmox-axi binary", "VALIDATION_ERROR", ["Install with `npm i -g proxmox-axi`, then run `proxmox-axi setup hooks`"]);
  }
  const agents = { "Claude Code": status.claude, Codex: status.codex, OpenCode: status.opencode };
  const installed = Object.entries(agents).filter(([, a]) => a.installed).map(([n]) => n);
  if (errors.length || installed.length === 0) {
    throw new AxiError(`Hooks not fully installed${installed.length ? ` (installed: ${installed.join(", ")})` : ""}`, "RUNTIME_ERROR", errors.length ? errors : ["No agent hook was written"]);
  }
  return { hooks: `installed (${installed.join(", ")})`, help: ["Restart your agent session to get the dashboard at start"] };
}

export async function main(options: MainOptions = {}): Promise<void> {
  const cfg = () => loadConfig(options.env);
  const verbCmds = Object.fromEntries(Object.keys(VERBS).map((v) => [v, (args: string[]) => callCommand(v, args, cfg())]));
  await runAxiCli({
    ...(options.argv ? { argv: options.argv } : {}),
    ...(options.stdout ? { stdout: options.stdout } : {}),
    description: DESCRIPTION,
    version: VERSION,
    topLevelHelp: TOP_HELP,
    home: () => homeCommand(cfg()),
    getCommandHelp: (c) => ({ ls: LS_HELP, setup: SETUP_HELP })[c],
    commands: {
      ...verbCmds,
      ls: (args) => lsCommand(args),
      setup: (args) => {
        if (args.length !== 1 || args[0] !== "hooks") {
          throw new AxiError("Unknown setup action", "VALIDATION_ERROR", ["Run `proxmox-axi setup hooks`"]);
        }
        return setupHooks();
      },
    },
  });
}
