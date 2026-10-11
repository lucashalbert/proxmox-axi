---
name: proxmox-axi
description: "Operate Proxmox VE through the proxmox-axi CLI - schema-mapped REST API paths and methods (nodes, VMs and containers, storage, cluster, access, tasks, backups, firewall, SDN, Ceph) via one generic token-auth get/create/set/delete command. Use whenever a task touches a Proxmox VE server: listing or inspecting VMs, storage, nodes or tasks, starting or stopping guests, cloning, snapshots, backups, users and permissions, or calling any /api2/json path."
user-invocable: false
---

# proxmox-axi

Agent ergonomic CLI for the Proxmox VE REST API (schema-mapped paths and methods from pve-docs). Prefer this over raw curl or pvesh.

Use proxmox-axi whenever a task touches a Proxmox VE server.

## Current guidance lives in the CLI

Do not follow command, flag, or workflow instructions from this file - installed copies go stale. Get the current source of truth from the CLI:

- `npx -y proxmox-axi` for a dashboard of the configured server
- `npx -y proxmox-axi --help` for global flags, config and the command index
- `npx -y proxmox-axi ls / --grep <text>` to find an API path
- `npx -y proxmox-axi <get|create|set|delete> <path> --help` for an endpoint's flags
