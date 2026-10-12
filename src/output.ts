const CELL_MAX = 120;
const TEXT_MAX = 500;
const FIRST = ["id", "vmid", "node", "name", "storage", "volid", "upid", "userid", "status", "type", "state", "content"];
const MAX_COLS = 4; // AXI principle 2: 3-4 fields per list item; --fields/--full for more

type Row = Record<string, unknown>;
export type Shaped = { out: Record<string, unknown>; clipped: boolean; total?: number; shown?: number };

const isObj = (v: unknown): v is Row => typeof v === "object" && v !== null && !Array.isArray(v);
const isScalar = (v: unknown) => v === null || typeof v !== "object";

/** Output key: last literal path segment (`/nodes/{node}/qemu` -> qemu). */
export function keyOf(template: string): string {
  const seg = template.split("/").filter((s) => s && !s.startsWith("{")).pop() ?? "data";
  return seg.replace(/[^A-Za-z0-9_-]/g, "_");
}

function clip(v: unknown, max: number, full: boolean, state: { clipped: boolean }): unknown {
  if (typeof v === "string" && !full && v.length > max) {
    state.clipped = true;
    return `${v.slice(0, max)}... (truncated, ${v.length} chars total)`;
  }
  if (Array.isArray(v)) return v.map((x) => clip(x, max, full, state));
  if (isObj(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clip(x, max, full, state)]));
  return v;
}

/** Id-like columns first, then the first scalar keys, capped. */
function defaultColumns(rows: Row[]): string[] {
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r).filter((k) => isScalar(r[k]))))];
  const first = FIRST.filter((k) => keys.includes(k));
  return [...first, ...keys.filter((k) => !first.includes(k))].slice(0, MAX_COLS);
}

export function shape(data: unknown, o: { key: string; fields?: string; limit: number; full: boolean }): Shaped {
  const state = { clipped: false };
  const pick = (r: Row, cols: string[]) => Object.fromEntries(cols.map((c) => [c, r[c] ?? null]));
  const wanted = o.fields && o.fields !== "all" ? o.fields.split(",").map((s) => s.trim()) : undefined;

  if (Array.isArray(data) && data.every(isObj) && data.length > 0) {
    const rows = o.limit > 0 ? data.slice(0, o.limit) : data;
    const cols = wanted ?? (o.fields === "all" ? [...new Set(rows.flatMap(Object.keys))] : defaultColumns(rows));
    const cells = rows.map((r) =>
      Object.fromEntries(
        Object.entries(pick(r, cols)).map(([k, v]) => [k, clip(isScalar(v) ? v : JSON.stringify(v), CELL_MAX, o.full, state)]),
      ),
    );
    return { out: { [o.key]: cells }, clipped: state.clipped, total: data.length, shown: rows.length };
  }
  if (Array.isArray(data)) {
    if (data.length === 0) return { out: { [o.key]: "0 results" }, clipped: false, total: 0, shown: 0 };
    const rows = o.limit > 0 ? data.slice(0, o.limit) : data;
    return { out: { [o.key]: clip(rows, TEXT_MAX, o.full, state) }, clipped: state.clipped, total: data.length, shown: rows.length };
  }
  if (isObj(data)) {
    const body = wanted ? pick(data, wanted) : data;
    return { out: { [o.key]: clip(body, TEXT_MAX, o.full, state) }, clipped: state.clipped };
  }
  if (data === null || data === undefined) return { out: { result: "ok" }, clipped: false };
  return { out: { [o.key]: clip(data, TEXT_MAX, o.full, state) }, clipped: state.clipped };
}
