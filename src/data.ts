import { EmployeePayrollRecord, VendorInvoiceRecord } from "./types.js";

export const samplePayrollBatch: EmployeePayrollRecord[] = [
  {
    id: "EMP-2026-0811",
    fullName: "Elena Rostova",
    nationalIdOrSSN: "982-12-8821",
    department: "Distributed Systems Engineering",
    salaryUSD: 14500,
    bankAccount: "CH93-0000-8812-3391-4421",
    jurisdiction: "CH-ZURICH",
    sanctionCheckClear: true,
  },
  {
    id: "EMP-2026-0943",
    fullName: "Arthur Pendelton",
    nationalIdOrSSN: "331-45-7790",
    department: "Executive Strategy",
    salaryUSD: 125000, // Policy violation: Salary anomaly (> $50,000 threshold without board signature)
    bankAccount: "CY88-0021-4491-0002-1198",
    jurisdiction: "CY-NICOSIA",
    sanctionCheckClear: true,
  },
  {
    id: "EMP-2026-1002",
    fullName: "Viktor Vanev",
    nationalIdOrSSN: "771-88-0012",
    department: "Security Operations",
    salaryUSD: 9800,
    bankAccount: "RO44-9912-3301-1120-4491",
    jurisdiction: "RO-BUCHAREST",
    sanctionCheckClear: false, // Policy violation: Sanction check failed
  },
];

export const sampleVendorInvoices: VendorInvoiceRecord[] = [
  {
    vendorId: "VND-ACME-CLOUD",
    companyName: "Acme Cloud Infrastructure AG",
    taxRegistrationNumber: "CHE-112.449.102-MWST",
    amountUSD: 48500,
    recipientIban: "DE89-3704-0044-0532-0130-00",
    country: "DE",
    isSanctionListed: false,
  },
  {
    vendorId: "VND-SHADOW-OPS",
    companyName: "Oasis Blackbox Ltd",
    taxRegistrationNumber: "", // Policy violation: Missing tax registration
    amountUSD: 850000, // Policy violation: High-risk capital outflow (> $250k)
    recipientIban: "BZ99-0012-9934-2201-4412-00",
    country: "BZ",
    isSanctionListed: true, // Critical violation: OFAC sanction hit
  },
];
