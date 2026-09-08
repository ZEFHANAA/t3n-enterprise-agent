//! Compliance evaluation — pure logic, no host calls, unit-testable natively.
//!
//! This module is deliberately host-free so `cargo test --lib` can exercise
//! every rule on the native target without an enclave.

use alloc::string::String;
use alloc::vec::Vec;
use alloc::format;

use crate::policy::{self, Thresholds, MIN_BANK_ACCOUNT_LEN};
use serde::{Deserialize, Serialize};

/// Which kind of enterprise record is being audited.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Entity {
    Payroll,
    Vendor,
}

/// A single policy breach found during evaluation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Violation {
    pub code: String,
    pub severity: String,
    pub field: String,
    pub description: String,
}

/// PII-free projection of a record — safe to persist and to log.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SanitizedSummary {
    pub entity_type: String,
    pub display_name: String,
    pub department: Option<String>,
    pub country: Option<String>,
    pub masked_identifier: String,
    pub masked_account: String,
    pub amount_usd: Option<u64>,
    pub jurisdiction: Option<String>,
    pub tax_number_present: Option<bool>,
}

/// Result of evaluating one record inside the enclave.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Evaluation {
    pub record_id: String,
    pub entity: Entity,
    pub passed: bool,
    pub violations: Vec<Violation>,
    pub sanitized_summary: SanitizedSummary,
}

/// Payroll record — carries raw PII, never persisted.
#[derive(Debug, Clone, Deserialize)]
pub struct PayrollRecord {
    pub id: String,
    pub full_name: String,
    pub national_id_or_ssn: String,
    pub department: String,
    pub salary_usd: u64,
    pub bank_account: String,
    pub jurisdiction: String,
    pub sanction_check_clear: bool,
}

/// Vendor invoice record — carries raw PII, never persisted.
#[derive(Debug, Clone, Deserialize)]
pub struct VendorRecord {
    pub vendor_id: String,
    pub company_name: String,
    pub tax_registration_number: String,
    pub amount_usd: u64,
    pub recipient_iban: String,
    pub country: String,
    pub is_sanction_listed: bool,
}

/// Top-level contract input.
#[derive(Debug, Clone, Deserialize)]
pub struct AuditRequest {
    pub entity: Entity,
    pub record: serde_json::Value,
}

/// Derive the overall verdict from the collected violations.
///
/// Any CRITICAL breach is a hard reject; anything else escalates to a human.
pub fn verdict_of(evaluation: &Evaluation) -> String {
    if evaluation.passed {
        return "APPROVED".into();
    }
    if evaluation
        .violations
        .iter()
        .any(|v| v.severity == "CRITICAL")
    {
        return "REJECTED".into();
    }
    "ESCALATE_TO_BOARD".into()
}

/// Evaluate a payroll record.
pub fn evaluate_payroll(record: &PayrollRecord, t: &Thresholds) -> Evaluation {
    let mut violations = Vec::new();

    if !record.sanction_check_clear {
        violations.push(Violation {
            code: "AML-SANCTION-ALERT".into(),
            severity: "CRITICAL".into(),
            field: "sanction_check_clear".into(),
            description: "Employee failed automated AML / sanction screening.".into(),
        });
    }

    if record.salary_usd > t.salary_usd {
        violations.push(Violation {
            code: "PAYROLL-THRESHOLD-ANOMALY".into(),
            severity: "HIGH".into(),
            field: "salary_usd".into(),
            description: format!(
                "Salary (${}) exceeds the automated payroll threshold (${}) without multi-sig board approval.",
                record.salary_usd, t.salary_usd
            ),
        });
    }

    if record.bank_account.trim().len() < MIN_BANK_ACCOUNT_LEN {
        violations.push(Violation {
            code: "INVALID-IBAN-STRUCTURE".into(),
            severity: "MEDIUM".into(),
            field: "bank_account".into(),
            description: "Recipient bank account or IBAN format is incomplete or invalid.".into(),
        });
    }

    if policy::is_high_risk_jurisdiction(&record.jurisdiction) {
        violations.push(Violation {
            code: "HIGH-RISK-JURISDICTION".into(),
            severity: "MEDIUM".into(),
            field: "jurisdiction".into(),
            description: format!(
                "Jurisdiction '{}' requires manual compliance review.",
                record.jurisdiction
            ),
        });
    }

    Evaluation {
        record_id: record.id.clone(),
        entity: Entity::Payroll,
        passed: violations.is_empty(),
        violations,
        sanitized_summary: SanitizedSummary {
            entity_type: "PAYROLL".into(),
            display_name: record.full_name.clone(),
            department: Some(record.department.clone()),
            country: None,
            masked_identifier: policy::mask(&record.national_id_or_ssn, 4),
            masked_account: policy::mask(&record.bank_account, 4),
            amount_usd: Some(record.salary_usd),
            jurisdiction: Some(record.jurisdiction.clone()),
            tax_number_present: None,
        },
    }
}

/// Evaluate a vendor invoice record.
pub fn evaluate_vendor(record: &VendorRecord, t: &Thresholds) -> Evaluation {
    let mut violations = Vec::new();

    if record.is_sanction_listed {
        violations.push(Violation {
            code: "VENDOR-OFAC-SANCTIONED".into(),
            severity: "CRITICAL".into(),
            field: "is_sanction_listed".into(),
            description:
                "Vendor entity or jurisdiction is present on the active OFAC sanction blacklist."
                    .into(),
        });
    }

    if record.tax_registration_number.trim().is_empty() {
        violations.push(Violation {
            code: "TAX-IDENTIFIER-MISSING".into(),
            severity: "HIGH".into(),
            field: "tax_registration_number".into(),
            description:
                "Vendor invoice lacks a verified national corporate tax registration identifier."
                    .into(),
        });
    }

    if record.amount_usd > t.capital_outflow_usd {
        violations.push(Violation {
            code: "CAPITAL-OUTFLOW-THRESHOLD".into(),
            severity: "HIGH".into(),
            field: "amount_usd".into(),
            description: format!(
                "Invoice amount (${}) exceeds the automated disbursement limit (${}).",
                record.amount_usd, t.capital_outflow_usd
            ),
        });
    }

    if policy::is_high_risk_jurisdiction(&record.country) {
        violations.push(Violation {
            code: "HIGH-RISK-JURISDICTION".into(),
            severity: "MEDIUM".into(),
            field: "country".into(),
            description: format!(
                "Vendor country '{}' requires manual compliance review.",
                record.country
            ),
        });
    }

    Evaluation {
        record_id: record.vendor_id.clone(),
        entity: Entity::Vendor,
        passed: violations.is_empty(),
        violations,
        sanitized_summary: SanitizedSummary {
            entity_type: "VENDOR_INVOICE".into(),
            display_name: record.company_name.clone(),
            department: None,
            country: Some(record.country.clone()),
            masked_identifier: policy::mask(&record.tax_registration_number, 4),
            masked_account: policy::mask(&record.recipient_iban, 4),
            amount_usd: Some(record.amount_usd),
            jurisdiction: None,
            tax_number_present: Some(!record.tax_registration_number.trim().is_empty()),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn payroll() -> PayrollRecord {
        PayrollRecord {
            id: "EMP-1".into(),
            full_name: "Elena Rostova".into(),
            national_id_or_ssn: "982-12-8821".into(),
            department: "Engineering".into(),
            salary_usd: 14_500,
            bank_account: "CH93-0000-8812-3391-4421".into(),
            jurisdiction: "CH-ZURICH".into(),
            sanction_check_clear: true,
        }
    }

    fn vendor() -> VendorRecord {
        VendorRecord {
            vendor_id: "VND-1".into(),
            company_name: "Acme Cloud AG".into(),
            tax_registration_number: "CHE-112.449.102-MWST".into(),
            amount_usd: 48_500,
            recipient_iban: "DE89-3704-0044-0532-0130-00".into(),
            country: "DE".into(),
            is_sanction_listed: false,
        }
    }

    #[test]
    fn clean_payroll_passes() {
        let e = evaluate_payroll(&payroll(), &Thresholds::default());
        assert!(e.passed, "unexpected violations: {:?}", e.violations);
        assert_eq!(verdict_of(&e), "APPROVED");
    }

    #[test]
    fn clean_vendor_passes() {
        let e = evaluate_vendor(&vendor(), &Thresholds::default());
        assert!(e.passed, "unexpected violations: {:?}", e.violations);
        assert_eq!(verdict_of(&e), "APPROVED");
    }

    #[test]
    fn salary_over_threshold_escalates() {
        let mut r = payroll();
        r.salary_usd = 125_000;
        let e = evaluate_payroll(&r, &Thresholds::default());
        assert!(!e.passed);
        assert_eq!(verdict_of(&e), "ESCALATE_TO_BOARD");
        assert!(e.violations.iter().any(|v| v.code == "PAYROLL-THRESHOLD-ANOMALY"));
    }

    #[test]
    fn sanction_hit_is_critical_rejection() {
        let mut r = payroll();
        r.sanction_check_clear = false;
        let e = evaluate_payroll(&r, &Thresholds::default());
        assert_eq!(verdict_of(&e), "REJECTED");
        assert!(e.violations.iter().any(|v| v.severity == "CRITICAL"));
    }

    #[test]
    fn vendor_ofac_hit_is_rejected() {
        let mut r = vendor();
        r.is_sanction_listed = true;
        let e = evaluate_vendor(&r, &Thresholds::default());
        assert_eq!(verdict_of(&e), "REJECTED");
    }

    #[test]
    fn missing_tax_id_and_outflow_escalate() {
        let mut r = vendor();
        r.tax_registration_number = String::new();
        r.amount_usd = 850_000;
        let e = evaluate_vendor(&r, &Thresholds::default());
        assert_eq!(verdict_of(&e), "ESCALATE_TO_BOARD");
        assert_eq!(e.violations.len(), 2);
    }

    #[test]
    fn high_risk_jurisdiction_flags_review() {
        let mut r = vendor();
        r.country = "BZ".into();
        let e = evaluate_vendor(&r, &Thresholds::default());
        assert!(!e.passed);
        assert!(e.violations.iter().any(|v| v.code == "HIGH-RISK-JURISDICTION"));
    }

    #[test]
    fn short_iban_is_invalid() {
        let mut r = payroll();
        r.bank_account = "CH93".into();
        let e = evaluate_payroll(&r, &Thresholds::default());
        assert!(e.violations.iter().any(|v| v.code == "INVALID-IBAN-STRUCTURE"));
    }

    #[test]
    fn thresholds_are_configurable() {
        let t = Thresholds { salary_usd: 10_000, capital_outflow_usd: 40_000 };
        let e = evaluate_payroll(&payroll(), &t);
        assert!(!e.passed, "14_500 should breach a 10_000 threshold");
    }

    #[test]
    fn summary_never_leaks_raw_pii() {
        let e = evaluate_payroll(&payroll(), &Thresholds::default());
        let s = &e.sanitized_summary;
        assert!(!s.masked_identifier.contains("982-12"), "SSN leaked: {}", s.masked_identifier);
        assert!(!s.masked_account.contains("8812"), "IBAN leaked: {}", s.masked_account);
        assert!(s.masked_identifier.ends_with("8821"));
        assert!(s.masked_account.ends_with("4421"));
    }

    #[test]
    fn short_values_are_fully_masked() {
        assert_eq!(policy::mask("12", 4), "****");
        assert!(!policy::mask("99", 4).contains("99"));
    }
}
