# Handover — T3N DataGuard

**Decision: hand over to Terminal 3.** I'm not set up to operate a compliance
product for enterprise customers post-challenge; T3 already has the startup
program, listing page, and customer relationships to make this useful. Handing
it over puts it where it can actually be maintained and adopted.

## What you're receiving

| Item | Location |
|---|---|
| Enclave contract (Rust → WASM) | `contract/src/{lib,engine,policy}.rs` |
| WIT interface + host imports | `contract/wit/` |
| Operator CLI (auth → deploy → audit → export) | `src/index.ts` |
| All platform wiring (maps, register, invoke) | `src/tenant.ts` |
| Session + trust anchor | `src/session.ts` |
| Live-verified output | `reports/audit-ledger.json` |
| Platform bugs + workarounds | `BUG_REPORT.md` |

Deployed on testnet as
`z:9ebdbf487df3bb3529010e85f337d9f2f6461bb0:dataguard-compliance` (v0.1.3).

## Handover process (3 steps)

**1. Key + tenant rotation.**
The testnet API key used for development lives only in this machine's
untracked `.env`; it was never committed. Delete it, then issue the
maintainer's own key at the claim page and set `T3N_API_KEY`. Register under a
Terminal-3-owned tenant — the contract is code-only and carries no tenant
state, so it ports across tenants unchanged.

**2. One-command redeploy.**
```bash
rustup target add wasm32-wasip2
npm install
npm run build:contract   # Rust → WASM
npm start                # registers (auto-bumps version) + seeds + audits
```
`deployContract()` is idempotent: it reads the deployed version, bumps the
patch component, creates-or-updates the `policies`/`ledger` map ACLs, and
prints the resolved contract name@version. Re-running is safe.

**3. Change policy without touching code.**
Thresholds live in the private `policies` KV map and are read per-call by the
contract. `seedPolicies(tenant, { salaryThresholdUsd: 50000 })` updates them —
no rebuild, no redeploy. Verified live: dropping the salary cap to $5k
correctly flipped a verdict to `ESCALATE_TO_BOARD`.

## Known constraints to inherit

- **Trust anchor**: `unsafe_trust_server: true` on testnet, because
  `fetchTrustedManifest` rejects the live manifest (Bug 1). **Remove this before
  production** — switch to the real manifest on a cluster where it parses.
- **Version bumps are mandatory**: the platform rejects a non-increasing
  contract version. Any CI that redeploys must go through `deployContract()`,
  not a raw `contracts.register()`.
- **Sanction/jurisdiction lists are hardcoded** in `engine.rs`. For production,
  move them to a KV map seeded by a feed; the engine reads thresholds from KV
  already, so the pattern is established.
- **PII masking is in-contract**, so the masking rule travels with the WASM.
  Audit any change to `sanitize_*` as a compliance change, not a refactor.

## What I'd build next

1. Move sanction/jurisdiction lists into a KV map with a signed feed.
2. Publish a contract descriptor + register it publicly so other tenants can
   invoke it under their own delegation.
3. Add a delegated-invocation path for external member DIDs — currently the
   owner invokes its own contract directly.
4. Real enclave attestation binding in the ledger entry (see README "Security
   posture" for what is and isn't currently proven).
