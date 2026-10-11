import { readFileSync } from "node:fs";
import { AxiError } from "axi-sdk-js";

export type Param = {
  type?: string;
  optional?: number;
  description?: string;
  enum?: string[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  default?: unknown;
  items?: { type?: string };
};
type Params = { properties?: Record<string, Param>; allOf?: Params[]; oneOf?: Params[] };
export type Info = {
  method: string;
  description: string;
  parameters?: Params;
  returns?: { type?: string; description?: string; properties?: object; items?: { properties?: object } };
  permissions?: { check?: unknown[]; user?: string };
  allowtoken?: number;
};
export type SNode = { path: string; info?: Record<string, Info>; children?: SNode[] };

export const VERBS: Record<string, string> = {
  get: "GET",
  create: "POST",
  post: "POST",
  set: "PUT",
  put: "PUT",
  delete: "DELETE",
};
export const VERB_OF: Record<string, string> = { GET: "get", POST: "create", PUT: "set", DELETE: "delete" };

let tree: SNode | undefined;
/** Virtual root above /cluster, /nodes, ... */
export function root(): SNode {
  tree ??= {
    path: "",
    children: JSON.parse(readFileSync(new URL("./apidoc.json", import.meta.url), "utf8")),
  };
  return tree;
}

const last = (path: string) => path.slice(path.lastIndexOf("/") + 1);
export const isParam = (seg: string) => /^\{.+\}$/.test(seg);

export type Resolved = { node: SNode; bound: Record<string, string>; template: string; unbound: string[] };

/** Walk /a/b/c through the tree; literal segments win, else bind to the {param} child. */
export function resolve(path: string): Resolved {
  let node = root();
  const bound: Record<string, string> = {};
  const unbound: string[] = [];
  const segs = path.split("/").filter(Boolean);
  for (const seg of segs) {
    const kids = node.children ?? [];
    const next =
      kids.find((c) => last(c.path) === seg) ?? kids.find((c) => isParam(last(c.path)));
    if (!next) {
      const here = node.path || "/";
      const valid = kids.map((c) => last(c.path)).join(", ") || "(none)";
      throw new AxiError(`No such path ${path}`, "VALIDATION_ERROR", [
        `Valid segments under ${here}: ${valid}`,
        `Run \`proxmox-axi ls ${here}\` to explore`,
      ]);
    }
    const name = last(next.path);
    if (isParam(name)) {
      const key = name.slice(1, -1);
      if (isParam(seg)) unbound.push(key);
      else bound[key] = seg;
    }
    node = next;
  }
  return { node, bound, template: node.path || "/", unbound };
}

/** Flattened parameters for a method: allOf merged, oneOf branches merged as optional. */
export function paramsOf(info: Info): Record<string, Param> {
  const out: Record<string, Param> = {};
  const add = (p: Params | undefined, optional: boolean): void => {
    if (!p) return;
    for (const [k, v] of Object.entries(p.properties ?? {})) out[k] ??= optional ? { ...v, optional: 1 } : v;
    p.allOf?.forEach((x) => add(x, optional));
    p.oneOf?.forEach((x) => add(x, true));
  };
  add(info.parameters, false);
  return out;
}

/** `net[n]` style names match any `net<digits>` flag. */
export function findParam(params: Record<string, Param>, name: string): { key: string; spec: Param } | undefined {
  if (params[name]) return { key: name, spec: params[name] };
  for (const [k, spec] of Object.entries(params)) {
    if (k.endsWith("[n]") && new RegExp(`^${k.slice(0, -3).replace(/\W/g, "\\$&")}\\d+$`).test(name)) {
      return { key: name, spec };
    }
  }
  return undefined;
}

export const flagName = (key: string) => key.replace("[n]", "<N>");
