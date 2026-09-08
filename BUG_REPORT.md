# Bug Report — Terminal 3 (T3N) ADK

Filed while building **T3N DataGuard** for the T3 enterprise-agent challenge.
Every finding below is **reproducible on testnet**, includes the verbatim error,
and states the workaround actually shipped in this repo.

**Environment**

| | |
|---|---|
| SDK | `@terminal3/t3n-sdk` v5.12.0 |
| Cluster | `setEnvironment("testnet")` |
| Tenant DID | `did:t3n:9ebdbf487df3bb3529010e85f337d9f2f6461bb0` |
| Node | `cn-api.sg.testnet.t3n.terminal3.io` |
| Platform | Ubuntu 22.04, Node 18+, Rust 1.98.1 (`wasm32-wasip2`) |

Severity is my own assessment of impact on a developer building on T3N.

---

## Bug 1 — `fetchTrustedManifest("testnet")` rejects the live manifest as malformed

**Severity: High** — blocks the documented Quickstart path on testnet.

The documented way to obtain a trust anchor fails, even though the endpoint
returns syntactically valid JSON.

**Reproduce**

```ts
import { setEnvironment, fetchTrustedManifest } from "@terminal3/t3n-sdk";
setEnvironment("testnet");
await fetchTrustedManifest("testnet");   // throws
```

**Verbatim error**

```
Trust manifest at https://cn-api.sg.testnet.t3n.terminal3.io/api/trust-manifest is malformed.
```

**Expected** — the manifest parses and yields a usable trust anchor (or the
error names the specific field/predicate that failed).

**Diagnosis** — `curl` against the same URL returns well-formed JSON, so this is
a **client-side validation** failure, not a server or network fault. The message
does not say *which* field is wrong, so the cause could not be narrowed further.

**Workaround shipped** — `src/session.ts` falls back to
`{ unsafe_trust_server: true }` when manifest fetch fails, and prints a notice
on every run so the degraded posture is visible instead of silent:

```
-> Trust anchor : unsafe opt-out (testnet manifest bug — see README)
```

**Suggested fix** — include the failing field/predicate in the message, or ship
a manifest matching the SDK's schema. Note this is a **testnet-only**
workaround: `unsafe_trust_server` must not reach production.

---

## Bug 2 — `contracts.register()` rejects a redeploy at the same version

**Severity: Medium** — breaks idempotent redeploys and any CI that redeploys.

**Verbatim error**

```
RPC Error: contract version invalid: version 0.1.0 is not higher than current version 0.1.0
[ef6525e0-c79e-46e6-9b86-0e3374f54251]
```

**Expected** — re-registering identical WASM at an identical version is a no-op,
or returns the existing registration.

**Impact** — naive scripts crash on their second run. Worse, the failure happens
*after* the WASM upload, so it is easy to be left in a half-registered state.

**Workaround shipped** — `deployContract()` in `src/tenant.ts` reads the
deployed version first, then registers at a strictly higher version via
`bumpPatch()`; on a fresh tenant it registers `CONTRACT_VERSION` as-is. The
resolved `name@version` is returned and pinned by callers, so `execute()` always
targets the build that was just deployed.

**Suggested fix** — make same-version re-registration idempotent, or expose an
explicit `registerOrReplace`.

---

## Bug 3 — Re-registration allocates a new `contract_id`, orphaning existing KV map ACLs

**Severity: Medium** — silent data-path breakage after any redeploy.

KV maps are created with `writers`/`readers` bound to a **numeric**
`contract_id`. Re-registering (per Bug 2) mints a **new** `contract_id`, so the
existing maps' ACLs keep pointing at the stale id.

**Expected** — ACLs follow the contract identity across versions, or the SDK
documents that they must be re-granted.

**Impact** — after a redeploy, the contract's `kv` reads fail with
`AccessDenied`. Confusing, because nothing about the *code* changed.

**Workaround shipped** — on redeploy, `deployContract()` calls
`tenant.maps.update(tail, { writers, readers })` to re-grant both `policies` and
`ledger` to the new id.

**Suggested fix** — bind map ACLs to a stable contract identity rather than the
per-version numeric id, or re-point ACLs automatically on re-registration.

---

## Bug 4 — "map already exists" is unstructured lowercase free text

**Severity: Low** — error handling cannot be written reliably.

**Verbatim error**

```
RPC Error: map already exists
```

**Expected** — a typed error (e.g. `MapAlreadyExistsError`) or a stable machine
-readable code.

**Impact** — the natural guard,
`if (err.message.includes("MapAlreadyExists"))`, **silently fails to match**
because the platform lowercases the text. This is what broke the first full run
in this project.

**Workaround shipped** — matched case-insensitively:

```ts
if (/already\s+exists/i.test(message)) { await tenant.maps.update(tail, aclPatch()); }
```

**Suggested fix** — expose error codes instead of prose.

---

## Bug 5 — `version: "latest"` is accepted by the type system but rejected by the server

**Severity: Low** — a documented-looking value that cannot work.

`ContractExecuteInput.version` is typed `string`, and `"latest"` is the obvious
way to call whatever is currently deployed. The server rejects it.

**Reproduce**

```ts
await tenant.contracts.execute(CONTRACT_TAIL, {
  version: "latest",
  functionName: "audit-record",
  input: {},
});
```

**Verbatim error**

```
RPC Error: Invalid action request: Invalid semver format: latest at line 1 column 109
[3912c4cd-d4ab-4134-88cb-b127d1ceb593]
```

**Expected** — either `"latest"` resolves to the deployed version, or the type is
narrowed to a semver-validated branded string so this fails at compile time.

**Workaround shipped** — `deployContract()` returns the exact deployed version
and `auditRecord()` takes it as a parameter, so callers pin a concrete semver.

---

## What worked well

Worth stating explicitly, since this is otherwise a list of complaints:

- Authentication and the WASM handshake are smooth — `npm run quickstart`
  reached a real tenant DID on the first attempt.
- Executing Rust/WASM inside the enclave, including KV reads and writes,
  behaved exactly as documented once the ACLs above were correct.
- Contract invocation error messages are clear and correctly namespaced, e.g.
  `tenant contract z:<tid>:no-such-contract-tail not registered`.
- The typed surface in `index.d.ts` is genuinely good — reading it answered
  most integration questions without leaving the editor.
