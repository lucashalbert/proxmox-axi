// Refresh src/apidoc.json from the pve-docs API viewer (or a local apidoc.js).
//   npm run update-schema [-- <url-or-file>]
import { readFile, writeFile } from "node:fs/promises";

const SRC = process.argv[2] ?? "https://pve.proxmox.com/pve-docs/api-viewer/apidoc.js";
const js = /^https?:/.test(SRC) ? await (await fetch(SRC)).text() : await readFile(SRC, "utf8");
const m = /^const apiSchema = (\[[\s\S]*?^\])\s*;/m.exec(js);
if (!m) throw new Error(`no apiSchema array in ${SRC}`);
const tree = JSON.parse(m[1]);
await writeFile(new URL("../src/apidoc.json", import.meta.url), JSON.stringify(tree));
const count = (n: { children?: unknown[] }): number =>
  1 + ((n.children ?? []) as { children?: unknown[] }[]).reduce((a, c) => a + count(c), 0);
console.log(`wrote src/apidoc.json (${tree.reduce((a: number, n: { children?: unknown[] }) => a + count(n), 0)} paths)`);
