import { AxiError } from "axi-sdk-js";
import { buildRequest, httpError, redacted, send, type Reply } from "./client.js";
import { CONFIG_HELP, type Config } from "./config.js";
import { parseFlags, pathNamesOf } from "./flags.js";
import { keyOf, shape } from "./output.js";
import { flagName, type Info, paramsOf, resolve, type SNode, VERB_OF, VERBS } from "./schema.js";

type Out = Record<string, unknown>;
const WRITE = (m: string) => m !== "GET";
const clipText = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 3)}...` : s);
const firstLine = (s = "", n = 80) => clipText(s.split(/\.\s/)[0].replace(/\s+/g, " "), n);
const verbsOf = (n: SNode) => Object.keys(n.info ?? {}).map((m) => VERB_OF[m]).join("|");
const bad = (msg: string, help: string[] = []) => new AxiError(msg, "VALIDATION_ERROR", help);

function typeText(p: { type?: string; enum?: string[]; minimum?: number; maximum?: number; items?: { type?: string } }): string {
  const t = p.type === "array" ? `${p.items?.type ?? "string"} (repeat flag)` : (p.type ?? "string");
  if (p.enum) return `${t} (${p.enum.join("|")})`;
  return p.minimum !== undefined || p.maximum !== undefined ? `${t} ${p.minimum ?? ""}-${p.maximum ?? ""}` : t;
}

function returnsText(info: Info): string {
  const r = info.returns;
  if (!r?.type) return "none";
  const props = (r.type === "array" ? r.items?.properties : r.properties) as object | undefined;
  const names = props ? Object.keys(props) : [];
  const shown = names.length ? `{${names.slice(0, 12).join(",")}${names.length > 12 ? ",..." : ""}}` : "";
  return `${r.type}${shown}`;
}

/** ["and",["perm","/vms/{vmid}",["VM.Audit"]],...] -> "/vms/{vmid}:VM.Audit and ..." */
function permText(p: NonNullable<Info["permissions"]>): string {
  const walk = (c: unknown): string => {
    if (!Array.isArray(c)) return String(c);
    if (c[0] === "perm") return `${c[1]}:${(c[2] as string[]).join("+")}`;
    if (c[0] === "and" || c[0] === "or") return `(${c.slice(1).map(walk).join(` ${c[0]} `)})`;
    return String(c[0]);
  };
  return p.check ? walk(p.check) : p.user === "all" ? "any authenticated user" : String(p.user ?? "");
}

export function endpointHelp(verb: string, template: string, info: Info, bound: Record<string, string>): Out {
  const params = paramsOf(info);
  const pathNames = pathNamesOf(template).filter((n) => !(n in bound));
  const rows = [
    ...pathNames.map((n) => ({
      flag: `--${n}`,
      required: n === "node" ? "yes (default: PROXMOX_NODE)" : "yes (or put the value in the path)",
      type: typeText(params[n] ?? {}),
      description: clipText(params[n]?.description ?? "path segment", 100),
    })),
    ...Object.entries(params)
      .filter(([k]) => !pathNamesOf(template).includes(k))
      .map(([k, p]) => ({
        flag: `--${flagName(k)}`,
        required: p.optional ? "no" : "yes",
        type: typeText(p),
        description: clipText((p.description ?? "") + (p.default !== undefined ? ` [default: ${p.default}]` : ""), 100),
      })),
  ];
  const required = rows.filter((r) => r.required.startsWith("yes")).map((r) => `${r.flag} <v>`).join(" ");
  return {
    usage: `proxmox-axi ${verb} ${template} ${required}`.trim() + " [flags]",
    description: info.description,
    method: WRITE(info.method) ? `${info.method} (changes server state; preview with --dry-run)` : info.method,
    returns: returnsText(info),
    ...(info.permissions ? { permissions: permText(info.permissions) } : {}),
    ...(info.allowtoken === 0 ? { token: "not allowed with API tokens (needs ticket auth)" } : {}),
    flags: rows,
    global: "-n/--dry-run (print request, send nothing; -n is always local), --fields a,b|all, --limit N (0=all), --full, --insecure",
  };
}

export const VERB_HELP: Record<string, string> = Object.fromEntries(
  Object.entries({ get: "GET: read", create: "POST: create / run an action (changes server state)", set: "PUT: update (changes server state)", delete: "DELETE: remove (destructive)" }).map(
    ([v, what]) => [
      v,
      `usage: proxmox-axi ${v} <path> [--param value ...] [--dry-run]\n${what}. <path> is an API path such as /nodes/{node}/qemu; {placeholders} become flags.\n` +
        `Run \`proxmox-axi ${v} <path> --help\` for the endpoint's flags, \`proxmox-axi ls [path]\` to browse paths.\n` +
        `examples:\n  proxmox-axi ${v} /nodes --help\n  proxmox-axi ${v} /version${v === "get" ? "" : " --dry-run"}\n`,
    ],
  ),
);

const ALREADY_STATUS = new Set([400, 409, 500]);
const ALREADY_RUNNING_MSG = /already running\b/i;
const ALREADY_STOPPED_MSG = /already stopped\b/i;

/** VM status action whose server error says the guest is already as requested (idempotent no-op). */
function isAlreadyInState(method: string, path: string, r: Reply): boolean {
  if (!WRITE(method) || !ALREADY_STATUS.has(r.status)) return false;
  const action = path.match(/\/status\/([^/]+)$/)?.[1];
  if (action === "start") return ALREADY_RUNNING_MSG.test(r.message);
  if (action === "stop" || action === "shutdown") return ALREADY_STOPPED_MSG.test(r.message);
  return false;
}

export async function callCommand(verb: string, args: string[], cfg: Config): Promise<Out | string> {
  const method = VERBS[verb];
  const path = args[0];
  if (!path || path === "--help") return VERB_HELP[verb] ?? "";
  if (!path.startsWith("/")) throw bad(`Expected an API path starting with /, got ${path}`, [`Run \`proxmox-axi ls /\` to browse paths`]);

  const r = resolve(path);
  const info = r.node.info?.[method];
  if (!info) {
    const have = verbsOf(r.node);
    throw bad(`${r.template} has no ${method} (${verb})`, [
      have ? `Available here: ${have}` : `Not an endpoint; run \`proxmox-axi ls ${r.template}\``,
    ]);
  }
  const rest = args.slice(1);
  if (rest.includes("--help")) return endpointHelp(verb, r.template, info, r.bound);

  const parsed = parseFlags(rest, info, pathNamesOf(r.template), r.bound, cfg.node);
  const conf = parsed.control.insecure ? { ...cfg, insecure: true } : cfg;
  const real = r.template
    .split("/")
    .map((s) => (s.startsWith("{") ? encodeURIComponent(parsed.path[s.slice(1, -1)]) : s))
    .join("/");
  const req = buildRequest(conf, method, real, parsed.wire);

  if (parsed.control.dryRun) {
    return { "dry-run": redacted(req), help: ["Run again without --dry-run to send the request"] };
  }
  const reply = await send(conf, req);
  if (reply.status >= 400) {
    if (isAlreadyInState(method, real, reply)) return { result: `no-op: already in requested state (${method} ${real}; HTTP ${reply.status}: ${reply.message})` };
    throw httpError(reply);
  }

  const help: string[] = [];
  const upid = typeof reply.data === "string" && reply.data.startsWith("UPID:") ? reply.data : undefined;
  if (upid) {
    const node = upid.split(":")[1];
    const task = `'/nodes/${node}/tasks/${upid}`; // single-quoted: UPIDs contain `!` and `:`
    help.push(`Run \`proxmox-axi get ${task}/status'\` to check the task`, `Run \`proxmox-axi get ${task}/log'\` for its log`);
    return { task: upid, help };
  }
  const s = shape(reply.data, { key: keyOf(r.template), ...parsed.control });
  const out: Out = { ...s.out };
  if (s.total !== undefined && s.total > (s.shown ?? 0)) {
    out.count = `${s.shown} of ${s.total} total`;
    help.push(`Run \`proxmox-axi ${verb} ${path} --limit 0\` for all ${s.total} rows`);
  }
  if (Array.isArray(reply.data) && s.total) help.push("Add `--fields a,b` to choose columns (`--fields all` for every column)");
  if (r.node.children?.length) help.push(`Run \`proxmox-axi ls ${path}\` for sub-resources`);
  if (s.clipped) help.push("Add `--full` for untruncated text");
  if (WRITE(method) && reply.data === null) out.result = `ok (${method} ${real})`;
  return help.length ? { ...out, help } : out;
}

function descendants(n: SNode): SNode[] {
  return (n.children ?? []).flatMap((c) => [c, ...descendants(c)]);
}

export function lsCommand(args: string[]): Out {
  const path = args[0]?.startsWith("/") ? args[0] : "/";
  const rest = args[0]?.startsWith("/") ? args.slice(1) : args;
  let all = false;
  let grep: string | undefined;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--all") all = true;
    else if (rest[i] === "--grep" && rest[i + 1] && !rest[i + 1].startsWith("-")) grep = rest[++i].toLowerCase();
    else if (rest[i] === "--grep") throw bad("--grep needs a value");
    else throw bad(`Unknown argument ${rest[i]} for \`ls\``, ["Valid: [path] --all --grep <text> (--help always allowed)"]);
  }
  const r = resolve(path);
  const nodes = all || grep ? descendants(r.node) : (r.node.children ?? []);
  const row = (n: SNode) => ({ path: n.path, verbs: verbsOf(n), summary: firstLine(n.info?.GET?.description ?? Object.values(n.info ?? {})[0]?.description) });
  const rows = nodes.map(row).filter((x) => !grep || `${x.path} ${x.summary}`.toLowerCase().includes(grep));
  const out: Out = { path: r.template, verbs: verbsOf(r.node) || "(none)" };
  out[grep ? "matches" : "paths"] = rows.length ? rows : grep ? `0 paths match "${grep}"` : "0 sub-paths (leaf)";
  const help = [`Run \`proxmox-axi get <path> --help\` (or create/set/delete) for an endpoint's flags`];
  if (!all && !grep && rows.length) help.push(`Run \`proxmox-axi ls ${path} --all\` for every nested path, or \`--grep <text>\` to search`);
  return { ...out, help };
}

export async function homeCommand(cfg: Config): Promise<Out> {
  if (!cfg.url || !cfg.token) return { server: "not configured", help: CONFIG_HELP };
  const fetchData = async (p: string) => {
    const reply = await send(cfg, buildRequest(cfg, "GET", p, {}));
    if (reply.status >= 400) throw httpError(reply);
    return reply.data;
  };
  const v = (await fetchData("/version")) as { version?: string; release?: string };
  const nodes = shape(await fetchData("/nodes"), { key: "nodes", limit: 100, full: false, fields: "node,status,cpu,mem,uptime" });
  return {
    server: `${cfg.url} (Proxmox VE ${v.version ?? "?"})`,
    ...(cfg.node ? { node: cfg.node } : {}),
    ...nodes.out,
    help: [
      "Run `proxmox-axi ls /` to browse the API, `proxmox-axi ls / --grep <text>` to search it",
      "Run `proxmox-axi get /nodes/{node}/qemu` to list VMs (node defaults to PROXMOX_NODE)",
      "Run `proxmox-axi <get|create|set|delete> <path> --help` for an endpoint's flags",
    ],
  };
}
