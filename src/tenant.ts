/**
 * Tenant-scoped helpers: KV maps, contract registration, and contract calls.
 *
 * One role per function, one file for all tenant wiring — adding a new map or
 * contract means editing here, not threading opcodes through `index.ts`.
 */

import { readFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

import { TenantClient, getContractVersion, getNodeUrl } from "@terminal3/t3n-sdk";
import type { T3nSession } from "./session.js";

/** Local (non-versioned) name of the compliance contract inside the tenant. */
export const CONTRACT_TAIL = "dataguard-compliance";
export const CONTRACT_VERSION = "0.1.0";

const thisDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Bump the patch component of a `MAJOR.MINOR.PATCH` string.
 *
 * Registration rejects a version that is not strictly higher than the one
 * already deployed, so every redeploy must carry a fresh version. Isolated
 * here because the rule is easy to trip over otherwise.
 */
export function bumpPatch(version: string): string {
  const [major, minor, patch] = version.split(".").map(Number);
  if ([major, minor, patch].some(Number.isNaN)) {
    throw new Error(`Unparseable contract version: ${version}`);
  }
  return `${major}.${minor}.${patch + 1}`;
}

/** Filesystem path to the built WASM component. */
export function wasmArtifactPath(): string {
  return path.join(
    thisDir,
    "..",
    "contract",
    "target",
    "wasm32-wasip2",
    "release",
    "z_dataguard_compliance.wasm"
  );
}

/**
 * Build a TenantClient around the session's own DID — the node admits exactly
 * that DID as the tenant in `idx:_tenants`.
 */
export async function buildTenantClient(session: T3nSession): Promise<TenantClient> {
  const { getNodeUrl } = await import("@terminal3/t3n-sdk");
  const tenant = new TenantClient({
    t3n: session.client,
    baseUrl: getNodeUrl(),
    tenantDid: session.did,
  });
  // Smoke check: throws when the DID was never admitted as a tenant.
  await tenant.tenant.me();
  return tenant;
}

export interface DeployResult {
  /** Canonical name `z:<tid>:<tail>`. */
  contractName: string;
  /** Numeric id assigned at registration (needed for map ACLs). */
  contractId: number;
  version: string;
  wasmBytes: number;
}

/**
 * Create the `policies` and `ledger` maps if missing, then register the WASM.
 *
 * Idempotent across runs. Registration rejects a version that is not strictly
 * higher than the deployed one, so on a redeploy we bump the patch component;
 * on a fresh tenant we register `CONTRACT_VERSION` as-is. Either way the exact
 * deployed version is returned so callers pin it.
 *
 * Both maps are `private` and contract-scoped: as the owner we seed via the
 * control plane, and the contract reads/writes them from inside the enclave.
 */
export async function deployContract(tenant: TenantClient): Promise<DeployResult> {
  const wasmBytes = await readFile(wasmArtifactPath());
  const canonicalName = tenant.canonicalName(CONTRACT_TAIL);

  // Step 1 — what is deployed? An unregistered name yields null.
  let deployedVersion: string | null = null;
  try {
    deployedVersion = await getContractVersion(getNodeUrl(), canonicalName);
  } catch {
    deployedVersion = null;
  }

  // Step 2 — register at a strictly-higher version, or reuse what is deployed.
  let version = CONTRACT_VERSION;
  let contractId: number | null = null;
  let contractName = canonicalName;

  if (deployedVersion === null) {
    const registered = await tenant.contracts.register({
      tail: CONTRACT_TAIL,
      version,
      wasm: new Uint8Array(wasmBytes),
    });
    contractId = registered.contract_id;
    contractName = registered.name;
  } else {
    version = bumpPatch(deployedVersion);
    const registered = await tenant.contracts.register({
      tail: CONTRACT_TAIL,
      version,
      wasm: new Uint8Array(wasmBytes),
    });
    contractId = registered.contract_id;
    contractName = registered.name;
  }

  // Step 3 — private maps readable/writable only by THIS contract build.
  // A re-registration allocates a NEW numeric contract_id, so on redeploy the
  // existing maps must be re-granted to it — otherwise their ACLs keep pointing
  // at the stale id and the new build's kv reads fail with AccessDenied.
  const mapSpec = (tail: string) => ({
    tail,
    visibility: "private" as const,
    writers: { only: [contractId as number] },
    readers: { only: [contractId as number] },
  });
  const aclPatch = () => ({
    writers: { only: [contractId as number] },
    readers: { only: [contractId as number] },
  });
  // The platform reports this as "map already exists" (lowercase, free text),
  // so the match is case-insensitive and does not depend on an error class.
  for (const tail of ["policies", "ledger"]) {
    try {
      await tenant.maps.create(mapSpec(tail));
    } catch (error) {
      const message = String((error as Error)?.message ?? error);
      if (/already\s+exists/i.test(message)) {
        await tenant.maps.update(tail, aclPatch());
      } else {
        throw error;
      }
    }
  }

  return {
    contractName,
    contractId: contractId as number,
    version,
    wasmBytes: wasmBytes.length,
  };
}

/** Seed audit thresholds into the `policies` map (owner control-plane write). */
export async function seedPolicies(
  tenant: TenantClient,
  opts?: { salaryThresholdUsd?: number; capitalOutflowThresholdUsd?: number }
): Promise<void> {
  const salary = String(opts?.salaryThresholdUsd ?? 50_000);
  const outflow = String(opts?.capitalOutflowThresholdUsd ?? 250_000);
  await tenant.maps.entrySet("policies", "salary_threshold_usd", salary);
  await tenant.maps.entrySet("policies", "capital_outflow_threshold_usd", outflow);
}

export interface ContractCallResult {
  record_id: string;
  entity: string;
  passed: boolean;
  verdict: string;
  violations: Array<{ code: string; severity: string; description: string }>;
  sanitized_summary: Record<string, unknown>;
  attestation: Record<string, unknown>;
}

/**
 * Invoke `audit-record` on the registered contract.
 *
 * Direct (self) call: the tenant principal invokes its own contract by local
 * `tail`, so no member-delegation grant is needed (and the contract needs no
 * egress hosts). The canonical `z:<tid>:<tail>` is resolved by the node.
 */
export async function auditRecord(
  tenant: TenantClient,
  record: { entity: "payroll" | "vendor"; record: Record<string, unknown> },
  version: string = CONTRACT_VERSION
): Promise<ContractCallResult> {
  const raw: unknown = await tenant.contracts.execute(CONTRACT_TAIL, {
    version,
    functionName: "audit-record",
    input: record,
  });
  // `execute` returns the decoded payload for tenant contracts.
  const out = (
    typeof raw === "string" ? JSON.parse(raw as string) : raw
  ) as ContractCallResult;
  return out;
}
