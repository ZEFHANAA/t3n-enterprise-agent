/**
 * T3N DataGuard — confidential enterprise compliance & audit agent.
 *
 * Flow: authenticate as the tenant → ensure the TEE contract is deployed →
 * seed policy thresholds → run each record through the enclave → export a
 * verifiable ledger of the returned attestations.
 *
 * The sample records never leave this process except as the PII-free payloads
 * the contract returns, so the terminal output is safe to screenshot.
 */

import "dotenv/config";

import { mkdir, writeFile } from "fs/promises";
import path from "path";

import type { T3nSession } from "./session.js";
import { createTenantSession } from "./session.js";
import { readEnvironment } from "./env.js";
import {
  CONTRACT_TAIL,
  CONTRACT_VERSION,
  auditRecord,
  buildTenantClient,
  deployContract,
  seedPolicies,
  type ContractCallResult,
} from "./tenant.js";
import { samplePayrollBatch, sampleVendorInvoices } from "./data.js";

const REPORT_DIR = "reports";

interface AuditOutcome {
  record_id: string;
  entity: string;
  verdict: string;
  passed: boolean;
  violations: Array<{ code: string; severity: string; description: string }>;
  sanitized_summary: Record<string, unknown>;
  attestation: Record<string, unknown>;
}

function banner(): void {
  console.log(`
======================================================================
  ████████╗██████╗ ███╗   ██╗    ██████╗  █████╗ ████████╗ █████╗
  ╚══██╔══╝╚════██╗████╗  ██║    ██╔══██╗██╔══██╗╚══██╔══╝██╔══██╗
     ██║    █████╔╝██╔██╗ ██║    ██║  ██║███████║   ██║   ███████║
     ██║    ╚═══██╗██║╚██╗██║    ██║  ██║██╔══██║   ██║   ██╔══██║
     ██║   ██████╔╝██║ ╚████║    ██████╔╝██║  ██║   ██║   ██║  ██║
     ╚═╝   ╚═════╝ ╚═╝  ╚═══╝    ╚═════╝ ╚═╝  ╚═╝   ╚═╝   ╚═╝  ╚═╝
             ENTERPRISE CONFIDENTIAL COMPLIANCE & AUDIT AGENT
======================================================================`);
}

function printOutcome(outcome: AuditOutcome, label: string, name: string): void {
  const tag =
    outcome.verdict === "APPROVED"
      ? "[APPROVED]"
      : outcome.verdict === "ESCALATE_TO_BOARD"
      ? "[ESCALATE]"
      : "[REJECTED]";

  console.log(`\n${label}: ${outcome.record_id} | ${name}`);
  console.log(`  Status      : ${tag}`);
  const hash = (outcome.attestation?.integrity_hash as string) ?? "";
  console.log(`  Proof Hash  : ${hash.substring(0, 24)}...`);
  const amount = outcome.sanitized_summary?.amount_usd;
  if (amount !== undefined) {
    console.log(`  Amount      : $${Number(amount).toLocaleString()}`);
  }
  const maskedId = outcome.sanitized_summary?.masked_identifier as string | undefined;
  const maskedAcct = outcome.sanitized_summary?.masked_account as string | undefined;
  if (maskedId || maskedAcct) {
    console.log(`  Masked PII  : ID=${maskedId} | Account=${maskedAcct}`);
  }
  if (outcome.violations.length > 0) {
    console.log("  Violations  :");
    for (const v of outcome.violations) {
      console.log(`    - [${v.severity}] ${v.code}: ${v.description}`);
    }
  }
}

async function main(): Promise<void> {
  banner();

  const environment = readEnvironment();
  console.log(`\n[1/5] Loading configuration...`);
  console.log(`  -> Cluster target : ${environment}`);

  console.log(`\n[2/5] Establishing authenticated session with T3N...`);
  const session: T3nSession = await createTenantSession();
  console.log(`  -> Tenant DID     : ${session.did}`);
  console.log(`  -> Eth address    : ${session.address}`);
  if (session.manifestFallbackUsed) {
    console.log(`  -> Trust anchor   : unsafe opt-out (testnet manifest bug — see README)`);
  }

  console.log(`\n[3/5] Deploying TEE contract into the tenant namespace...`);
  const tenant = await buildTenantClient(session);
  const deployment = await deployContract(tenant);
  await seedPolicies(tenant);
  console.log(`  -> Contract       : ${deployment.contractName}@${deployment.version}`);
  console.log(`  -> Contract ID    : ${deployment.contractId}`);
  console.log(`  -> WASM size      : ${deployment.wasmBytes} bytes`);
  console.log(`  -> Maps ready     : z:<tid>:policies, z:<tid>:ledger`);

  console.log(`\n[4/5] Running confidential compliance audits inside the enclave...`);
  const outcomes: AuditOutcome[] = [];

  for (const record of samplePayrollBatch) {
    const result: ContractCallResult = await auditRecord(
      tenant,
      { entity: "payroll", record: { ...record } as unknown as Record<string, unknown> },
      deployment.version
    );
    const outcome = result as AuditOutcome;
    outcomes.push(outcome);
    printOutcome(outcome, "Employee", String(outcome.sanitized_summary?.display_name ?? ""));
  }

  for (const record of sampleVendorInvoices) {
    const result: ContractCallResult = await auditRecord(
      tenant,
      { entity: "vendor", record: { ...record } as unknown as Record<string, unknown> },
      deployment.version
    );
    const outcome = result as AuditOutcome;
    outcomes.push(outcome);
    printOutcome(outcome, "Vendor", String(outcome.sanitized_summary?.display_name ?? ""));
  }

  console.log(`\n[5/5] Exporting signed audit ledger...`);
  const approved = outcomes.filter((o) => o.verdict === "APPROVED").length;
  const escalated = outcomes.filter((o) => o.verdict === "ESCALATE_TO_BOARD").length;
  const rejected = outcomes.filter((o) => o.verdict === "REJECTED").length;

  const payload = {
    generatedByAgent: session.did,
    contract: {
      name: deployment.contractName,
      tail: CONTRACT_TAIL,
      version: deployment.version,
      id: deployment.contractId,
    },
    enclaveEnvironment: environment,
    totals: { approved, escalated, rejected, processed: outcomes.length },
    exportedAt: new Date().toISOString(),
    ledger: outcomes,
  };

  await mkdir(REPORT_DIR, { recursive: true });
  const outFile = path.join(REPORT_DIR, "audit-ledger.json");
  await writeFile(outFile, JSON.stringify(payload, null, 2), "utf8");

  console.log(`  -> Ledger written : ${outFile}`);
  console.log(`  -> Approved ${approved} | Escalated ${escalated} | Rejected ${rejected}`);
  console.log(`
======================================================================
  [SUCCESS] Every record was evaluated inside the T3N TEE enclave.
  Agent DID        : ${session.did}
  Contract         : ${deployment.contractName}@${deployment.version}
  Security posture : PII stayed in the enclave; only masked verdicts left.
======================================================================`);
}

main().catch((error: unknown) => {
  console.error("\n[FATAL] Agent run failed:", (error as Error)?.message ?? error);
  process.exit(1);
});
