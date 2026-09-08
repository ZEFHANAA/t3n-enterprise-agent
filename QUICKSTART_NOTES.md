# Quickstart completion notes

Step-by-step evidence that the
[T3N ADK Quickstart](https://docs.terminal3.io/developers/adk/get-started/quickstart)
was completed on this machine.

## 1. Claim API key + test credits

Self-serve claim page: `https://www.terminal3.io/claim-page` (no waitlist).
API key stored in this machine's untracked `.env` as `T3N_API_KEY`.

## 2. Run `npm run quickstart` (`quickstart.ts`)

Mirrors the documented script: `setEnvironment("testnet")` →
`loadWasmComponent()` → `eth_get_address()` → `T3nClient` handshake →
`authenticate()`.

Actual output, verified live on testnet:

```
Loading WASM cryptographic component...
Derived Ethereum address: 0xe4d2806f621effbe5a3dbcd51a8562ecd5922b76
Using trust anchor...
Executing cryptographic handshake with T3N enclave...
Handshake successful!
Authenticating DID with T3N network...
==========================================
SUCCESS! Connected as: did:t3n:9ebdbf487df3bb3529010e85f337d9f2f6461bb0
==========================================
```

**Deviations from the docs (both filed in `BUG_REPORT.md`)**

1. `fetchTrustedManifest("testnet")` throws
   `Trust manifest at .../api/trust-manifest is malformed.` even though the
   endpoint returns valid JSON. Workaround: `unsafe_trust_server: true`
   (**testnet only** — see `src/session.ts`, falls back automatically and
   prints a notice).
2. Trust anchor type needs `as const` under `tsc --strict` (`quickstart.ts:26`).

## 3. Beyond quickstart (Walkthrough)

This repo continues past the Quickstart into the full Walkthrough:

| Walkthrough step | Evidence |
|---|---|
| 1. Write contract (Rust) | `contract/src/lib.rs`, `engine.rs`, `policy.rs`, `contract/wit/` |
| 2. Build contract (WASM) | `npm run build:contract` → 205 KB artifact (target `wasm32-wasip2`) |
| 3. Register contract | `deployContract()` in `src/tenant.ts` → `dataguard-compliance@0.1.3`, id 948 (status `active`) |
| 4. Invoke contract | `npm start` → 5 records audited in-enclave (2 APPROVED, 1 ESCALATE, 2 REJECTED) |
| 5. Test | `npm run test:contract` → 16/16 Rust unit tests pass; threshold-override + ledger re-read verified live |
