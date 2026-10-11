// Writes skills/proxmox-axi/SKILL.md from src/skill.ts.
//   npm run build:skill             # write
//   npm run build:skill -- --check  # exit 1 if the committed file is stale
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createSkillMarkdown } from "../src/skill.js";

const target = new URL("../skills/proxmox-axi/SKILL.md", import.meta.url);
const expected = createSkillMarkdown();

if (process.argv.includes("--check")) {
  const actual = await readFile(target, "utf8").catch(() => null);
  if (actual !== expected) {
    console.error("skills/proxmox-axi/SKILL.md is stale. Run `npm run build:skill` and commit it.");
    process.exit(1);
  }
  console.log("skills/proxmox-axi/SKILL.md is up to date.");
} else {
  await mkdir(new URL("../skills/proxmox-axi/", import.meta.url), { recursive: true });
  await writeFile(target, expected);
  console.log("wrote skills/proxmox-axi/SKILL.md");
}
