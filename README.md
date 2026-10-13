# proxmox-axi

Agent-ergonomic ([AXI](https://github.com/kunchenguid/axi)) CLI for the Proxmox VE REST API. One generic engine builds the command tree from the bundled pve-docs schema, mapping every path and method (GET, POST, PUT, DELETE). Output is [TOON](https://toonformat.dev/): compact, with counts, truncation notes and next-step hints.

## Install

```sh
npx -y proxmox-axi            # dashboard
npm i -g proxmox-axi          # or install globally
```

Agent integration (pick either): `proxmox-axi setup hooks` (session-start dashboard for Claude Code, Codex, OpenCode) or `npx skills add lucashalbert/proxmox-axi --skill proxmox-axi`.

## Configure

Environment variables, or `KEY=VALUE` lines in `~/.config/proxmox-axi/config` (or the file named by `PROXMOX_AXI_CONFIG`). Environment wins over the file.

| Variable | Meaning |
| --- | --- |
| `PROXMOX_URL` | `https://host:8006` (a trailing `/api2/json` is fine) |
| `PROXMOX_API_TOKEN` | `user@realm!tokenid=secret`, or set `PROXMOX_API_TOKEN_ID` + `PROXMOX_API_TOKEN_SECRET` |
| `PROXMOX_FINGERPRINT` | SHA-256 fingerprint to pin a self-signed certificate (nothing is sent unless it matches) |
| `PROXMOX_INSECURE` | `1` to skip TLS verification (or pass `--insecure`) |
| `PROXMOX_NODE` | default for the `{node}` path segment |

Token auth only; ticket/password login is not implemented. The bundled schema includes five endpoints that Proxmox marks as not callable with API tokens: `POST /access/ticket`, `PUT /access/password`, `POST /access/tfa/{userid}`, `DELETE /access/tfa/{userid}/{id}`, and `PUT /access/tfa/{userid}/{id}`. Their endpoint help says so.

## Use

```sh
proxmox-axi ls / --grep snapshot                         # find paths (offline, from the schema)
proxmox-axi ls /nodes/{node}/qemu/{vmid}                 # browse sub-paths and their verbs
proxmox-axi get /nodes/{node}/qemu --fields vmid,name,status
proxmox-axi get /nodes/pve/qemu/100/config               # literal values work too
proxmox-axi create /nodes/{node}/qemu/{vmid}/clone --vmid 100 --newid 101 --name web --dry-run
proxmox-axi create /nodes/pve/qemu/100/clone --help      # flags, types, required, permissions
```

Verbs: `get`=GET, `create`=POST, `set`=PUT, `delete`=DELETE. `create`, `set` and `delete` change the server; `delete` is destructive. Preview any call with `-n`/`--dry-run`: it prints the method, URL and body, redacting Authorization and parameter values named like password, secret, token or key, and sends nothing. (`-n` always means dry-run locally; `--dry-run` yields to an endpoint's own `dry-run` parameter.)

- Path placeholders (`{node}`, `{vmid}`) are flags: `--vmid 100`. `{node}` falls back to `PROXMOX_NODE`.
- Parameters are flags named as in the API (`--newid`, `--net0`). Types, enums, ranges, lengths and required-ness come from the schema and are checked before any request; `pattern`/`format` are left to the server. Booleans: `--full`, `--full=0`, `--full false`. Arrays: repeat the flag.
- Output: lists default to 4 columns (id-like first); `--fields a,b|all` picks columns, `--limit N` (default 100, `0` = all), `--full` disables text truncation. VM status actions the server rejects as already done (starting a running VM, stopping or shutting down a stopped one) exit 0 with a `no-op` result. An endpoint that defines a parameter with one of these names (for example `full`, `limit`) takes it as its own.
- Unknown flags, bad values and missing required flags exit 2 with the valid flags listed; other API errors exit 1.
- Task-returning calls (UPID) print the follow-up `get` commands for status and log.

## Schema

`src/apidoc.json` is the pve-docs `apidoc.js` tree (454 path nodes, 680 methods: 342 GET, 175 POST, 84 PUT, 79 DELETE) as plain JSON. Refresh it with `npm run update-schema [-- <url-or-file>]`.

Checked against a live PVE 9.2 server with read-only GETs (182 endpoints reachable without extra parameters; 145 answered 200, the rest were permission-denied for the test token or backed by services not installed, such as Ceph):

- A few directory indexes differ: `/nodes/{node}` omits `execute` and `vncwebsocket`, `/cluster/metrics` omits `export`, `/cluster/sdn/route-maps` omits `entries`; the schema lists them, the live index does not.
- Live responses carry fields the schema does not document on many list endpoints (for example `type`, `maxdisk` on `/nodes`; `altnames` on `/nodes/{node}/network`), and index entries have `name` where `returns` is empty. Output shows whatever the server sent.
- `/cluster/nextid` and `/cluster/config/apiversion` are typed `integer` but come back as strings; `/cluster/config/totem` is typed `object` but is `null` outside a cluster.
- Schema quirks handled: `name[n]` parameters (`net0`, `scsi1`), `allOf`/`oneOf` parameter sets (flattened, `oneOf` members optional), and path placeholders that lack a parameter entry.

## Releases

Releases are automated by [semantic-release](https://github.com/semantic-release/semantic-release) (`.github/workflows/release.yml`), which runs after CI passes on `main`. It picks the next SemVer from [Conventional Commits](https://www.conventionalcommits.org/), updates `CHANGELOG.md`, `package.json`, `package-lock.json` and `src/version.ts`, pushes a `chore(release): <version> [skip ci]` bot commit and a `v<version>` tag to `main`, publishes to npm and creates a GitHub release.

- `feat:` -> minor; `fix:` and `perf:` -> patch; `!` after the type (`feat!:`) or a `BREAKING CHANGE:` footer -> major. Other types (`docs`, `chore`, `test`, `ci`, `refactor`) do not release.
- PRs are squash-merged, so the **PR title must be a conventional commit message**; CI (commitlint) checks the title and commits.
- npm publishing uses trusted publishing (OIDC) with provenance; no npm token is stored. One-time setup on npmjs.com: package settings -> Trusted Publisher -> GitHub Actions, repository `lucashalbert/proxmox-axi`, workflow filename `release.yml`.
- 0.1.0 was published manually (tagged `v0.1.0`); semantic-release takes over from there.

## Development

```sh
npm install
npm test                      # fake HTTPS server + bundled schema; needs openssl
npm run build                 # tsc, copies the schema into dist
npm run build:skill           # regenerate skills/proxmox-axi/SKILL.md (-- --check in CI)
PROXMOX_LIVE=1 PROXMOX_AXI_CONFIG=<file> npm test   # opt-in read-only (GET) smoke test against a real server
```

MIT
