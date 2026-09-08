/**
 * Shared shapes. Field names use `snake_case` to match the Rust contract's
 * serde deserialisers — keeping the two in sync is a single-file concern.
 */

export interface EmployeePayrollRecord {
  id: string;
  full_name: string;
  national_id_or_ssn: string;
  department: string;
  salary_usd: number;
  bank_account: string;
  jurisdiction: string;
  sanction_check_clear: boolean;
}

export interface VendorInvoiceRecord {
  vendor_id: string;
  company_name: string;
  tax_registration_number: string;
  amount_usd: number;
  recipient_iban: string;
  country: string;
  is_sanction_listed: boolean;
}

export interface SanitizedSummary {
  entity_type: string;
  display_name: string;
  department?: string;
  country?: string;
  masked_identifier: string;
  masked_account: string;
  amount_usd?: number;
  jurisdiction?: string;
  tax_number_present?: boolean;
}

export interface ComplianceViolation {
  code: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  field: string;
  description: string;
}

export interface AuditEvaluationResult {
  record_id: string;
  entity: "payroll" | "vendor";
  passed: boolean;
  verdict: "APPROVED" | "REJECTED" | "ESCALATE_TO_BOARD";
  violations: ComplianceViolation[];
  sanitized_summary: SanitizedSummary;
  attestation: Record<string, unknown>;
}
