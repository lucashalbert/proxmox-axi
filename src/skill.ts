import { DESCRIPTION } from "./cli.js";

export const SKILL_DESCRIPTION =
  "Operate Proxmox VE through the proxmox-axi CLI - every REST API path and method (nodes, VMs and containers, storage, " +
  "cluster, access, tasks, backups, firewall, SDN, Ceph) via one generic get/create/set/delete command. " +
  "Use whenever a task touches a Proxmox VE server: listing or inspecting VMs, storage, nodes or tasks, starting or " +
  "stopping guests, cloning, snapshots, backups, users and permissions, or calling any /api2/json path.";

/** Discovery stub: installed copies go stale, so guidance lives in the CLI. */
export function createSkillMarkdown(): string {
  return `---
name: proxmox-axi
description: ${JSON.stringify(SKILL_DESCRIPTION)}
user-invocable: false
---

# proxmox-axi

${DESCRIPTION}

Use proxmox-axi whenever a task touches a Proxmox VE server.

## Current guidance lives in the CLI

Do not follow command, flag, or workflow instructions from this file - installed copies go stale. Get the current source of truth from the CLI:

- \`npx -y proxmox-axi\` for a dashboard of the configured server
- \`npx -y proxmox-axi --help\` for global flags, config and the command index
- \`npx -y proxmox-axi ls / --grep <text>\` to find an API path
- \`npx -y proxmox-axi <get|create|set|delete> <path> --help\` for an endpoint's flags
`;
}
