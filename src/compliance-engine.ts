import {
  EmployeePayrollRecord,
  VendorInvoiceRecord,
  ComplianceViolation,
  AuditEvaluationResult,
} from "./types.js";

export class EnterpriseComplianceEngine {
  /**
   * Masks sensitive PII (Bank account, SSN, Tax ID) for GDPR / Confidentiality.
   */
  public static maskSensitiveString(value: string, visibleTrailingChars = 4): string {
    if (!value || value.length <= visibleTrailingChars) return "****";
    const maskedPart = "*".repeat(value.length - visibleTrailingChars);
    const visiblePart = value.slice(-visibleTrailingChars);
    return `${maskedPart}${visiblePart}`;
  }

  /**
   * Audits an employee payroll record inside the confidential enclave.
   */
  public evaluatePayrollRecord(record: EmployeePayrollRecord): AuditEvaluationResult {
    const violations: ComplianceViolation[] = [];

    // Rule 1: Sanction / AML Screening
    if (!record.sanctionCheckClear) {
      violations.push({
        code: "AML-SANCTION-ALERT",
        severity: "CRITICAL",
        field: "sanctionCheckClear",
        description: "Employee failed automated AML / Sanction screening.",
      });
    }

    // Rule 2: Salary Anomaly Ceiling (Enterprise Threshold $50,000 / month)
    if (record.salaryUSD > 50000) {
      violations.push({
        code: "PAYROLL-THRESHOLD-ANOMALY",
        severity: "HIGH",
        field: "salaryUSD",
        description: `Salary ($${record.salaryUSD.toLocaleString()}) exceeds automated payroll threshold ($50,000) without multi-sig board approval.`,
      });
    }

    // Rule 3: Valid Bank Account Structure
    if (!record.bankAccount || record.bankAccount.length < 10) {
      violations.push({
        code: "INVALID-IBAN-STRUCTURE",
        severity: "MEDIUM",
        field: "bankAccount",
        description: "Recipient bank account or IBAN format is incomplete or invalid.",
      });
    }

    return {
      recordId: record.id,
      entityType: "PAYROLL",
      passed: violations.length === 0,
      violations,
      sanitizedSummary: {
        employeeName: record.fullName,
        department: record.department,
        maskedSSN: EnterpriseComplianceEngine.maskSensitiveString(record.nationalIdOrSSN),
        maskedAccount: EnterpriseComplianceEngine.maskSensitiveString(record.bankAccount),
        salaryApproved: record.salaryUSD <= 50000,
        jurisdiction: record.jurisdiction,
      },
      evaluatedAt: new Date().toISOString(),
    };
  }

  /**
   * Audits a vendor invoice payment against enterprise AML / tax standards.
   */
  public evaluateVendorInvoice(record: VendorInvoiceRecord): AuditEvaluationResult {
    const violations: ComplianceViolation[] = [];

    // Rule 1: OFAC / Sanction Blacklist
    if (record.isSanctionListed) {
      violations.push({
        code: "VENDOR-OFAC-SANCTIONED",
        severity: "CRITICAL",
        field: "isSanctionListed",
        description: "Vendor entity or jurisdiction is present on active OFAC sanction blacklist.",
      });
    }

    // Rule 2: Tax Registration Mandatory Check
    if (!record.taxRegistrationNumber || record.taxRegistrationNumber.trim() === "") {
      violations.push({
        code: "TAX-IDENTIFIER-MISSING",
        severity: "HIGH",
        field: "taxRegistrationNumber",
        description: "Vendor invoice lacks a verified national corporate tax registration identifier.",
      });
    }

    // Rule 3: High-Value Capital Outflow ($250,000 limit)
    if (record.amountUSD > 250000) {
      violations.push({
        code: "CAPITAL-OUTFLOW-THRESHOLD",
        severity: "HIGH",
        field: "amountUSD",
        description: `Invoice amount ($${record.amountUSD.toLocaleString()}) exceeds the automated disbursement limit ($250,000).`,
      });
    }

    return {
      recordId: record.vendorId,
      entityType: "VENDOR_INVOICE",
      passed: violations.length === 0,
      violations,
      sanitizedSummary: {
        companyName: record.companyName,
        country: record.country,
        maskedIban: EnterpriseComplianceEngine.maskSensitiveString(record.recipientIban),
        invoiceAmountUSD: record.amountUSD,
        taxNumberPresent: Boolean(record.taxRegistrationNumber),
      },
      evaluatedAt: new Date().toISOString(),
    };
  }
}
