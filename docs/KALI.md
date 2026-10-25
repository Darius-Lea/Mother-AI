# Kali-compatible security tool bridge

Mother's first-release preview is **not** Kali Linux, a complete penetration-testing suite, or proof that a device is secure. It does not bundle Kali's entire package collection. Security work combines maintained tools, correct configuration, authorization, operator expertise, and verification of findings.

The bridge detects `nmap`, `nikto`, and `sqlmap` using bounded version commands on the computer running Mother's server. Nikto and sqlmap are inventory-only in this preview. A reported version means the program responded to a version check; it does not certify its integrity or enable all its features.

## Implemented operation

An installed Nmap can perform one authorized single-host TCP connect check with a fixed argument profile:

```text
nmap -sT -Pn --unprivileged --max-retries 1 --host-timeout 30s --top-ports 20 HOST
```

IPv6 literal targets add the fixed `-6` option. A target must be a single hostname or literal address. URLs, CIDR blocks, ranges, lists, command flags, and shell syntax are rejected. The operation uses no shell, raw-socket elevation, OS detection, script execution, exploitation, or user-supplied arguments.

The owner first confirms permission and requests a plan, then reviews and explicitly approves it. Plans expire after five minutes and are single-use. Execution is bounded to 45 seconds and 256 KiB of output. Only one check can run at once, with a maximum of ten accepted runs per minute. Actual exit status, timeout, truncation and standard error remain visible; a failed command never becomes a successful scan result.

No network scan was run during development validation. Tests use mocked processes to exercise command arguments, consent, execution boundaries, expiry, timeout, limits and failures. The current cloud host has no supported tools installed.

## API integration

Mount `createKaliRouter()` from `server/kali.js` at `/api/security`, behind Mother's owner/session gate. Do not expose it through external-app grants or a public unauthenticated server.

- `GET /api/security/capabilities`: bounded version inventory and actual tool availability. `?refresh=true` bypasses the short inventory cache.
- `POST /api/security/plan`: `{ "tool":"nmap", "target":"owned-host.example", "authorizationConfirmed":true }` returns a reviewed plan; no network check runs yet.
- `POST /api/security/plans/PLAN_ID/run`: `{ "approved":true }` executes only that saved, unexpired plan and returns captured process results.

Call `router.shutdown()` when the hosting server quits so its own child processes are terminated. The model cannot call arbitrary commands, and a conversation is not permission to run a tool.

## Separate Kali environments

For broader authorized work, maintain a separate Kali VM or container using official Kali sources and its signed package repositories. It requires compatible host hardware, storage, maintenance and appropriate isolation. Tools should remain behind explicit task-specific adapters; adding a package is not equivalent to safely integrating all its commands into an assistant.

`containers/kali/Dockerfile` provides an optional **minimal Nmap image**, not the entire Kali tool collection. It preserves normal APT signature and TLS checks, runs as an unprivileged user, and defaults to displaying Nmap's version. It has not been built in this cloud. It is a separately operated developer tool image, not automatically connected to Mother's host-tool bridge. Installing it does not make Mother control Docker or obtain elevated system access.

Phones and tablets can use Mother's responsive interface to request approved operations on a compatible host. This does not install desktop Kali tools into iOS or Android, provide universal device access, or make the mobile client a standalone neural security appliance.
