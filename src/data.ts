import type { EmployeePayrollRecord, VendorInvoiceRecord } from "./types.js";

/**
 * Sample enterprise records.
 *
 * Field names intentionally match the Rust contract's deserialisers exactly
 * (`snake_case`), so a rename here must be mirrored in `contract/src/engine.rs`.
 * These records carry raw PII on purpose — that is the whole point: they are
 * submitted into the enclave and only masked summaries come back out.
 */
export const samplePayrollBatch: EmployeePayrollRecord[] = [
  {
    id: "EMP-2026-0811",
    full_name: "Elena Rostova",
    national_id_or_ssn: "982-12-8821",
    department: "Distributed Systems Engineering",
    salary_usd: 14500,
    bank_account: "CH93-0000-8812-3391-4421",
    jurisdiction: "CH-ZURICH",
    sanction_check_clear: true,
  },
  {
    id: "EMP-2026-0943",
    full_name: "Arthur Pendelton",
    national_id_or_ssn: "331-45-7790",
    department: "Executive Strategy",
    salary_usd: 125000, // breaches the 50k automated payroll ceiling
    bank_account: "CY88-0021-4491-0002-1198",
    jurisdiction: "CY-NICOSIA",
    sanction_check_clear: true,
  },
  {
    id: "EMP-2026-1002",
    full_name: "Viktor Vanev",
    national_id_or_ssn: "771-88-0012",
    department: "Security Operations",
    salary_usd: 9800,
    bank_account: "RO44-9912-3301-1120-4491",
    jurisdiction: "RO-BUCHAREST",
    sanction_check_clear: false, // AML / sanctions screening failure
  },
];

export const sampleVendorInvoices: VendorInvoiceRecord[] = [
  {
    vendor_id: "VND-ACME-CLOUD",
    company_name: "Acme Cloud Infrastructure AG",
    tax_registration_number: "CHE-112.449.102-MWST",
    amount_usd: 48500,
    recipient_iban: "DE89-3704-0044-0532-0130-00",
    country: "DE",
    is_sanction_listed: false,
  },
  {
    vendor_id: "VND-SHADOW-OPS",
    company_name: "Oasis Blackbox Ltd",
    tax_registration_number: "", // missing tax identifier
    amount_usd: 850000, // breaches the 250k disbursement ceiling
    recipient_iban: "BZ99-0012-9934-2201-4412-00",
    country: "BZ", // high-risk jurisdiction
    is_sanction_listed: true, // OFAC sanction hit
  },
];
