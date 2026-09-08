import { loadConfig } from "./config.js";
import { initializeT3nSession } from "./client.js";
import { T3nDataGuardAgent } from "./agent.js";
import { samplePayrollBatch, sampleVendorInvoices } from "./data.js";

async function main() {
  console.log(`
======================================================================
  ████████╗██████╗ ███╗   ██╗    ██████╗  █████╗ ████████╗ █████╗ 
  ╚══██╔══╝╚════██╗████╗  ██║    ██╔══██╗██╔══██╗╚══██╔══╝██╔══██╗
     ██║    █████╔╝██╔██╗ ██║    ██║  ██║███████║   ██║   ███████║
     ██║    ╚═══██╗██║╚██╗██║    ██║  ██║██╔══██║   ██║   ██╔══██║
     ██║   ██████╔╝██║ ╚████║    ██████╔╝██║  ██║   ██║   ██║  ██║
     ╚═╝   ╚═════╝ ╚═╝  ╚═══╝    ╚═════╝ ╚═╝  ╚═╝   ╚═╝   ╚═╝  ╚═╝
             ENTERPRISE CONFIDENTIAL COMPLIANCE & AUDIT AGENT
======================================================================
`);

  try {
    // 1. Load configuration
    console.log("[1/5] Loading Enterprise Environment Configuration...");
    const config = loadConfig();
    console.log(`  -> Cluster Target : ${config.environment}`);
    console.log(`  -> Configured DID : ${config.tenantDid}`);

    // 2. Connect and authenticate with T3N TEE enclave
    console.log("\n[2/5] Establishing Cryptographic Session with T3N Enclave...");
    const session = await initializeT3nSession(config);
    console.log(`  -> Handshake Status: VERIFIED`);
    console.log(`  -> Enclave Agent DID: ${session.authenticatedDid}`);
    console.log(`  -> Derived Eth Key  : ${session.derivedAddress}`);
    if (session.manifestFallbackUsed) {
      console.log(`  -> Trust Anchor Note: Opt-out fallback used (testnet manifest bug bypassed)`);
    }

    // 3. Initialize Enterprise Agent
    console.log("\n[3/5] Instantiating T3N DataGuard Autonomous Agent...");
    const agent = new T3nDataGuardAgent(session);
    console.log("  -> Agent Active & Ready for Confidential Workloads.");

    // 4. Execute Confidential Payroll Audit
    console.log("\n[4/5] Running Confidential Enterprise Payroll Audit Batch...");
    const payrollResults = await agent.auditPayrollBatch(samplePayrollBatch);

    console.log("\n--- PAYROLL AUDIT ATTESTATIONS ---");
    for (const item of payrollResults) {
      const { evaluation, attestation } = item;
      const statusTag =
        attestation.verdict === "APPROVED"
          ? " [APPROVED] "
          : attestation.verdict === "ESCALATE_TO_BOARD"
          ? " [ESCALATE] "
          : " [REJECTED] ";

      console.log(`\nRecord: ${evaluation.recordId} | ${evaluation.sanitizedSummary.employeeName}`);
      console.log(`  Status       : ${statusTag}`);
      console.log(`  Attestation  : ${attestation.attestationId}`);
      console.log(`  Proof Hash   : ${attestation.integrityHash.substring(0, 24)}...`);
      console.log(`  Masked PII   : SSN=${evaluation.sanitizedSummary.maskedSSN} | Bank=${evaluation.sanitizedSummary.maskedAccount}`);
      
      if (evaluation.violations.length > 0) {
        console.log(`  Violations   :`);
        for (const v of evaluation.violations) {
          console.log(`    - [${v.severity}] ${v.code}: ${v.description}`);
        }
      }
    }

    // 5. Execute Confidential Vendor Invoice Audit
    console.log("\n--- VENDOR INVOICE COMPLIANCE AUDIT ---");
    const vendorResults = await agent.auditVendorBatch(sampleVendorInvoices);

    for (const item of vendorResults) {
      const { evaluation, attestation } = item;
      const statusTag =
        attestation.verdict === "APPROVED"
          ? " [APPROVED] "
          : " [REJECTED] ";

      console.log(`\nVendor: ${evaluation.recordId} | ${evaluation.sanitizedSummary.companyName}`);
      console.log(`  Status       : ${statusTag}`);
      console.log(`  Attestation  : ${attestation.attestationId}`);
      console.log(`  Proof Hash   : ${attestation.integrityHash.substring(0, 24)}...`);
      console.log(`  Sanitized    : Amount=$${Number(evaluation.sanitizedSummary.invoiceAmountUSD).toLocaleString()} | Country=${evaluation.sanitizedSummary.country}`);
      
      if (evaluation.violations.length > 0) {
        console.log(`  Violations   :`);
        for (const v of evaluation.violations) {
          console.log(`    - [${v.severity}] ${v.code}: ${v.description}`);
        }
      }
    }

    // 6. Export Attestation Ledger
    console.log("\n[5/5] Exporting Cryptographically Signed Enterprise Audit Ledger...");
    const ledgerPath = await agent.exportAttestationLedger();
    console.log(`  -> Audit Ledger Exported Successfully to: ${ledgerPath}`);

    console.log(`
======================================================================
  [SUCCESS] All enterprise compliance batches processed & attested!
  Agent DID       : ${session.authenticatedDid}
  Security Posture: Enclave-Isolated Confidential Execution
  Handover Status : Ready for autonomous enterprise operations.
======================================================================
`);
  } catch (error: any) {
    console.error("\n[FATAL ERROR] Agent Execution Failed:", error?.message || error);
    process.exit(1);
  }
}

main();
