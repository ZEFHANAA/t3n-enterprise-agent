export interface EmployeePayrollRecord {
  id: string;
  fullName: string;
  nationalIdOrSSN: string;
  department: string;
  salaryUSD: number;
  bankAccount: string;
  jurisdiction: string;
  sanctionCheckClear: boolean;
}

export interface VendorInvoiceRecord {
  vendorId: string;
  companyName: string;
  taxRegistrationNumber: string;
  amountUSD: number;
  recipientIban: string;
  country: string;
  isSanctionListed: boolean;
}

export interface ComplianceViolation {
  code: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  field: string;
  description: string;
}

export interface AuditEvaluationResult {
  recordId: string;
  entityType: "PAYROLL" | "VENDOR_INVOICE";
  passed: boolean;
  violations: ComplianceViolation[];
  sanitizedSummary: Record<string, unknown>;
  evaluatedAt: string;
}

export interface CryptographicAttestation {
  attestationId: string;
  agentDid: string;
  enclaveEnvironment: string;
  recordId: string;
  integrityHash: string;
  verdict: "APPROVED" | "REJECTED" | "ESCALATE_TO_BOARD";
  timestamp: string;
  enclaveSignatureProof: string;
}
