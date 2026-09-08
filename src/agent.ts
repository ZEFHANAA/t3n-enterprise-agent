import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { T3nSession } from "./client.js";
import { EnterpriseComplianceEngine } from "./compliance-engine.js";
import {
  EmployeePayrollRecord,
  VendorInvoiceRecord,
  AuditEvaluationResult,
  CryptographicAttestation,
} from "./types.js";

export class T3nDataGuardAgent {
  private session: T3nSession;
  private engine: EnterpriseComplianceEngine;
  private attestations: CryptographicAttestation[] = [];

  constructor(session: T3nSession) {
    this.session = session;
    this.engine = new EnterpriseComplianceEngine();
  }

  public getAgentDid(): string {
    return this.session.authenticatedDid;
  }

  public getDerivedAddress(): string {
    return this.session.derivedAddress;
  }

  public getEnvironment(): string {
    return this.session.enclaveEnvironment;
  }

  /**
   * Generates a cryptographic SHA-256 fingerprint of the record and evaluation.
   */
  private generateIntegrityHash(data: unknown): string {
    return crypto.createHash("sha256").update(JSON.stringify(data)).digest("hex");
  }

  /**
   * Generates a verifiable attestation signed with the agent DID identity.
   */
  private createAttestation(
    recordId: string,
    evaluation: AuditEvaluationResult
  ): CryptographicAttestation {
    const integrityHash = this.generateIntegrityHash(evaluation);
    const timestamp = new Date().toISOString();

    let verdict: CryptographicAttestation["verdict"] = "APPROVED";
    if (!evaluation.passed) {
      const hasCritical = evaluation.violations.some((v) => v.severity === "CRITICAL");
      verdict = hasCritical ? "REJECTED" : "ESCALATE_TO_BOARD";
    }

    // Cryptographic signature proof payload simulating enclave signature
    const signaturePayload = `${this.session.authenticatedDid}:${recordId}:${verdict}:${integrityHash}:${timestamp}`;
    const enclaveSignatureProof = crypto
      .createHmac("sha256", this.session.derivedAddress)
      .update(signaturePayload)
      .digest("hex");

    const attestation: CryptographicAttestation = {
      attestationId: `ATT-${crypto.randomUUID()}`,
      agentDid: this.session.authenticatedDid,
      enclaveEnvironment: this.session.enclaveEnvironment,
      recordId,
      integrityHash,
      verdict,
      timestamp,
      enclaveSignatureProof,
    };

    this.attestations.push(attestation);
    return attestation;
  }

  /**
   * Audits a batch of employee payroll records.
   */
  public async auditPayrollBatch(
    records: EmployeePayrollRecord[]
  ): Promise<{ evaluation: AuditEvaluationResult; attestation: CryptographicAttestation }[]> {
    const results = [];
    for (const record of records) {
      const evaluation = this.engine.evaluatePayrollRecord(record);
      const attestation = this.createAttestation(record.id, evaluation);
      results.push({ evaluation, attestation });
    }
    return results;
  }

  /**
   * Audits a batch of vendor invoice payment records.
   */
  public async auditVendorBatch(
    records: VendorInvoiceRecord[]
  ): Promise<{ evaluation: AuditEvaluationResult; attestation: CryptographicAttestation }[]> {
    const results = [];
    for (const record of records) {
      const evaluation = this.engine.evaluateVendorInvoice(record);
      const attestation = this.createAttestation(record.vendorId, evaluation);
      results.push({ evaluation, attestation });
    }
    return results;
  }

  /**
   * Exports all attestations to an auditable enterprise ledger JSON.
   */
  public async exportAttestationLedger(outputPath?: string): Promise<string> {
    const filePath = outputPath || path.join(process.cwd(), "audit-ledger.json");
    const payload = {
      generatedByAgent: this.session.authenticatedDid,
      agentDerivedAddress: this.session.derivedAddress,
      enclaveEnvironment: this.session.enclaveEnvironment,
      totalAttestations: this.attestations.length,
      exportedAt: new Date().toISOString(),
      ledger: this.attestations,
    };

    await fs.writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");
    return filePath;
  }
}
