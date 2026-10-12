// Run by semantic-release (prepare): keep src/version.ts equal to package.json.
import { writeFileSync } from "node:fs";

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version ?? "")) throw new Error(`invalid version: ${version}`);
writeFileSync(new URL("../src/version.ts", import.meta.url), `export const VERSION = "${version}";\n`);
