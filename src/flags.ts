import { AxiError } from "axi-sdk-js";
import { findParam, flagName, isParam, type Info, type Param, paramsOf } from "./schema.js";
import type { Wire } from "./client.js";

export type Control = { dryRun: boolean; full: boolean; insecure: boolean; fields?: string; limit: number };
export const DEFAULT_LIMIT = 100;

const TRUE = /^(1|true|yes|on)$/i;
const FALSE = /^(0|false|no|off)$/i;

const bad = (msg: string, help: string[]) => new AxiError(msg, "VALIDATION_ERROR", help);

function coerce(flag: string, spec: Param, raw: string): string {
  const type = spec.type === "array" ? (spec.items?.type ?? "string") : spec.type;
  if (type === "boolean") {
    if (TRUE.test(raw)) return "1";
    if (FALSE.test(raw)) return "0";
    throw bad(`--${flag} expects a boolean (1/0/true/false), got "${raw}"`, []);
  }
  if (type === "integer" || type === "number") {
    const n = Number(raw);
    if (raw.trim() === "" || !Number.isFinite(n) || (type === "integer" && !Number.isInteger(n))) {
      throw bad(`--${flag} expects ${type === "integer" ? "an integer" : "a number"}, got "${raw}"`, []);
    }
    if (spec.minimum !== undefined && n < spec.minimum) throw bad(`--${flag} must be >= ${spec.minimum}`, []);
    if (spec.maximum !== undefined && n > spec.maximum) throw bad(`--${flag} must be <= ${spec.maximum}`, []);
    return String(n);
  }
  if (spec.enum && !spec.enum.includes(raw)) {
    throw bad(`--${flag} must be one of: ${spec.enum.join(", ")}`, []);
  }
  if (spec.minLength !== undefined && raw.length < spec.minLength) throw bad(`--${flag} must be at least ${spec.minLength} chars`, []);
  if (spec.maxLength !== undefined && raw.length > spec.maxLength) throw bad(`--${flag} must be at most ${spec.maxLength} chars`, []);
  return raw; // ponytail: `pattern`/`format` are left to the server to enforce
}

export type Parsed = { wire: Wire; path: Record<string, string>; control: Control };

/**
 * Parse `--flag value` tokens against the endpoint schema. Path placeholders
 * (`{node}`) are flags too; `node` falls back to `defaultNode`.
 */
export function parseFlags(
  tokens: string[],
  info: Info,
  pathNames: string[],
  bound: Record<string, string>,
  defaultNode?: string,
): Parsed {
  const params = paramsOf(info);
  const control: Control = { dryRun: false, full: false, insecure: false, limit: DEFAULT_LIMIT };
  const wire: Wire = {};
  const path: Record<string, string> = { ...bound };
  const valid = () =>
    [...pathNames.filter((n) => !(n in bound)), ...Object.keys(params).filter((k) => !pathNames.includes(k))]
      .concat(["dry-run", "fields", "limit", "full", "insecure"].filter((k) => !(k in params)))
      .map((k) => `--${flagName(k)}`);

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok === "-n") {
      control.dryRun = true;
      continue;
    }
    if (!tok.startsWith("--")) throw bad(`Unexpected argument ${tok}`, ["Parameters are flags: --name value"]);
    const eq = tok.indexOf("=");
    const name = tok.slice(2, eq < 0 ? undefined : eq);
    let inline = eq < 0 ? undefined : tok.slice(eq + 1);
    const hit = findParam(params, name);
    const isPath = pathNames.includes(name);
    const apiOwned = !!hit || isPath;
    const spec: Param | undefined = hit?.spec ?? (isPath ? { type: "string" } : undefined);

    if (!apiOwned && (name === "dry-run" || name === "full" || name === "insecure")) {
      if (inline !== undefined || (tokens[i + 1] && /^(true|false|0|1)$/i.test(tokens[i + 1]))) {
        inline ??= tokens[++i];
        control[name === "dry-run" ? "dryRun" : name] = TRUE.test(inline);
      } else control[name === "dry-run" ? "dryRun" : name] = true;
      continue;
    }
    if (!apiOwned && (name === "fields" || name === "limit")) {
      let v = inline;
      if (v === undefined) v = tokens[i + 1];
      if (v === undefined || v.startsWith("-")) throw bad(`--${name} needs a value`, []);
      if (inline === undefined) i++;
      if (name === "fields") control.fields = v;
      else if (/^\d+$/.test(v)) control.limit = Number(v);
      else throw bad(`--limit expects a non-negative integer (0 = all), got "${v}"`, []);
      continue;
    }
    if (!spec) {
      throw bad(`Unknown flag --${name}`, [`Valid flags: ${valid().join(" ")} (--help always allowed)`]);
    }

    let value = inline;
    if (value === undefined) {
      if (spec.type === "boolean" && !/^(true|false|0|1|yes|no|on|off)$/i.test(tokens[i + 1] ?? "")) value = "1";
      else value = tokens[++i];
    }
    if (value === undefined || (inline === undefined && value.startsWith("--"))) throw bad(`--${name} needs a value`, []);
    const wired = coerce(name, spec, value);
    if (isPath) {
      path[name] = wired;
      continue;
    }
    if (spec.type !== "array" && wire[name]) throw bad(`--${name} given more than once`, []);
    (wire[name] ??= []).push(wired);
  }

  if (!path.node && pathNames.includes("node") && defaultNode) path.node = defaultNode;
  const missingPath = pathNames.filter((n) => !path[n]);
  const missing = [
    ...missingPath,
    ...Object.entries(params)
      .filter(([k, p]) => !p.optional && !pathNames.includes(k) && !wire[k])
      .map(([k]) => k),
  ];
  if (missing.length) {
    throw bad(
      `Missing required flag${missing.length > 1 ? "s" : ""}: ${missing.map((m) => `--${m}`).join(", ")}`,
      missingPath.includes("node") ? ["Set PROXMOX_NODE for a default node, or pass --node <name>"] : [],
    );
  }
  return { wire, path, control };
}

/** Placeholder names in a path template, in order. */
export const pathNamesOf = (template: string): string[] =>
  template.split("/").filter(isParam).map((s) => s.slice(1, -1));
