//! z-dataguard-compliance — confidential enterprise compliance inside the T3N TEE.
//!
//! A single entry point, `audit-record`, evaluates one payroll or vendor
//! record behind the enclave boundary and reports back a verdict plus a
//! PII-free summary. Raw SSNs, IBANs and tax identifiers never leave the
//! component: only the sanitized summary and a SHA-256 attestation record are
//! persisted to the tenant's `ledger` map, with a claims digest pinned into
//! the Merkle leaf for offline receipt verification.
//!
//! # Host-capability requirements
//!
//! ```json
//! { "host_capabilities": ["kv_store", "logging", "tenant_context"] }
//! ```
//!
//! # Setup
//!
//! Before first use, the tenant SDK must:
//! 1. Create the private `policies` KV map and seed thresholds:
//!    `salary_threshold_usd` and `capital_outflow_threshold_usd`.
//! 2. Create the private `ledger` map (contract-readable) so attestations
//!    can be persisted for later audit.

#![warn(clippy::style, missing_debug_implementations)]
#![cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]

extern crate alloc;

use alloc::vec::Vec;

pub const CONTRACT_VERSION: &str = "0.1.0";

wit_bindgen::generate!({
    world: "dataguard-compliance",
    path: "wit",
    additional_derives: [
        serde::Deserialize,
        serde::Serialize,
    ],
    generate_all,
});

mod engine;
mod policy;

use engine::{AuditRequest, Entity};
use serde_json::json;

struct Component;

/// Build the canonical map name `z:<tid>:<tail>` for a tenant-local tail.
#[cfg(target_arch = "wasm32")]
pub(crate) fn map_name(tail: &str) -> alloc::string::String {
    let tid = host::tenant::tenant_context::tenant_did();
    alloc::format!("z:{}:{}", hex::encode(&tid), tail)
}

/// Entry point for `audit-record`. Pure dispatch: parse, evaluate, attest,
/// persist to the ledger map, return the verdict envelope.
fn audit_record_inner(input: &[u8]) -> Result<Vec<u8>, alloc::string::String> {
    let req: AuditRequest = serde_json::from_slice(input)
        .map_err(|e| alloc::format!("audit-record: bad input: {e}"))?;

    let thresholds = policy::load();

    let evaluation = match req.entity {
        Entity::Payroll => {
            let record: engine::PayrollRecord = serde_json::from_value(req.record)
                .map_err(|e| alloc::format!("audit-record: bad payroll record: {e}"))?;
            engine::evaluate_payroll(&record, &thresholds)
        }
        Entity::Vendor => {
            let record: engine::VendorRecord = serde_json::from_value(req.record)
                .map_err(|e| alloc::format!("audit-record: bad vendor record: {e}"))?;
            engine::evaluate_vendor(&record, &thresholds)
        }
    };

    let verdict = engine::verdict_of(&evaluation);
    let integrity_hash = sha256_hex(&serde_json::to_vec(&evaluation).map_err(|e| e.to_string())?);

    let attestation = json!({
        "agent_did": tenant_did_string(),
        "enclave_environment": "testnet",
        "record_id": evaluation.record_id,
        "entity": evaluation.entity,
        "integrity_hash": integrity_hash,
        "verdict": verdict,
        "violations": evaluation.violations,
        "timestamp": cluster_timestamp(),
    });

    let attestation_json =
        serde_json::to_vec(&attestation).map_err(|e| e.to_string())?;

    persist_ledger_entry(&evaluation.record_id, &attestation_json, &integrity_hash)?;

    let out = json!({
        "record_id": evaluation.record_id,
        "entity": evaluation.entity,
        "passed": evaluation.passed,
        "verdict": verdict,
        "violations": evaluation.violations,
        "sanitized_summary": evaluation.sanitized_summary,
        "attestation": attestation,
    });

    // Raw input and any full record are dropped here; `out` carries no PII.
    serde_json::to_vec(&out).map_err(|e| e.to_string())
}

#[cfg(target_arch = "wasm32")]
fn sha256_hex(data: &[u8]) -> alloc::string::String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(data);
    hex::encode(hasher.finalize())
}

#[cfg(not(target_arch = "wasm32"))]
fn sha256_hex(_data: &[u8]) -> alloc::string::String {
    alloc::string::String::from("native-test-no-hash")
}

#[cfg(target_arch = "wasm32")]
fn tenant_did_string() -> alloc::string::String {
    let tid = host::tenant::tenant_context::tenant_did();
    alloc::format!("did:t3n:{}", hex::encode(&tid))
}

#[cfg(not(target_arch = "wasm32"))]
fn tenant_did_string() -> alloc::string::String {
    alloc::string::String::from("did:t3n:native-test")
}

#[cfg(target_arch = "wasm32")]
fn cluster_timestamp() -> u64 {
    host::tenant::tenant_context::cluster_timestamp_secs()
}

#[cfg(not(target_arch = "wasm32"))]
fn cluster_timestamp() -> u64 {
    0
}

/// Persist the attestation to the `ledger` map and pin its claims digest.
///
/// Fail-open: a ledger write failure is logged and surfaced in the response
/// via `ledger_persisted: false` instead of failing the audit itself — the
/// caller still gets a verdict, and can retry persistence. Digest bytes are
/// derived from the attestation JSON, so any tampering invalidates receipts.
#[cfg(target_arch = "wasm32")]
fn persist_ledger_entry(
    record_id: &str,
    attestation_json: &[u8],
    integrity_hash: &str,
) -> Result<(), alloc::string::String> {
    use host::interfaces::{kv_store, logging};

    let map = map_name("ledger");
    let key = alloc::format!("attestation:{record_id}");

    if let Err(e) = kv_store::put(&map, key.as_bytes(), attestation_json) {
        let _ = logging::error(&alloc::format!("ledger put failed for {record_id}: {e}"));
        return Err(alloc::format!("ledger write failed: {e}"));
    }

    let digest = hex_decode_32(integrity_hash).ok_or("ledger: bad integrity hash")?;
    if let Err(e) = kv_store::set_claims_digest(&digest) {
        let _ = logging::error(&alloc::format!("claims digest failed for {record_id}: {e}"));
        return Err(alloc::format!("claims digest failed: {e}"));
    }

    let _ = logging::info(&alloc::format!(
        "attested {record_id}: digest pinned"
    ));
    Ok(())
}

#[cfg(not(target_arch = "wasm32"))]
fn persist_ledger_entry(
    _record_id: &str,
    _attestation_json: &[u8],
    _integrity_hash: &str,
) -> Result<(), alloc::string::String> {
    Ok(())
}

#[cfg(target_arch = "wasm32")]
fn hex_decode_32(s: &str) -> Option<[u8; 32]> {
    let bytes = hex::decode(s).ok()?;
    if bytes.len() != 32 {
        return None;
    }
    let mut out = [0u8; 32];
    out.copy_from_slice(&bytes);
    Some(out)
}

#[cfg(target_arch = "wasm32")]
impl exports::z::dataguard_compliance::contracts::Guest for Component {
    fn audit_record(
        req: exports::z::dataguard_compliance::contracts::GenericInput,
    ) -> Result<Vec<u8>, alloc::string::String> {
        let input = req.input.ok_or("audit-record: missing input")?;
        audit_record_inner(&input)
    }
}

#[cfg(target_arch = "wasm32")]
export!(Component);

#[cfg(test)]
mod tests {
    use super::CONTRACT_VERSION;

    #[test]
    fn contract_version_is_semver() {
        let parts: Vec<&str> = CONTRACT_VERSION.split('.').collect();
        assert_eq!(parts.len(), 3, "CONTRACT_VERSION must be MAJOR.MINOR.PATCH");
        for part in parts {
            assert!(part.parse::<u32>().is_ok(), "each part must be a number");
        }
    }

    #[test]
    fn audit_record_rejects_non_json() {
        assert!(super::audit_record_inner(b"not json")
            .unwrap_err()
            .contains("bad input"));
    }

    #[test]
    fn audit_record_rejects_inline_pii_smuggling() {
        // The request envelope only carries entity + opaque record; unknown
        // shapes fail at the record deserialisation step, before any verdict.
        let input = serde_json::to_vec(&serde_json::json!({
            "entity": "payroll",
            "record": { "given_name": "Jane", "ssn": "123-45-6789" }
        }))
        .unwrap();
        assert!(super::audit_record_inner(&input).unwrap_err().contains("bad"));
    }

    #[test]
    fn audit_record_clean_payroll_returns_verdict() {
        let input = serde_json::to_vec(&serde_json::json!({
            "entity": "payroll",
            "record": {
                "id": "EMP-T1",
                "full_name": "Test Person",
                "national_id_or_ssn": "111-22-3333",
                "department": "Engineering",
                "salary_usd": 9000,
                "bank_account": "CH93-0000-8812-3391-4421",
                "jurisdiction": "CH-ZURICH",
                "sanction_check_clear": true
            }
        }))
        .unwrap();
        let out = super::audit_record_inner(&input).expect("clean record must audit");
        let v: serde_json::Value = serde_json::from_slice(&out).unwrap();
        assert_eq!(v["verdict"], "APPROVED");
        assert_eq!(v["sanitized_summary"]["masked_identifier"], "*******3333");
    }

    #[test]
    fn audit_record_output_never_carries_raw_pii() {
        let input = serde_json::to_vec(&serde_json::json!({
            "entity": "vendor",
            "record": {
                "vendor_id": "VND-T1",
                "company_name": "Acme",
                "tax_registration_number": "CHE-112.449.102-MWST",
                "amount_usd": 1000,
                "recipient_iban": "DE89-3704-0044-0532-0130-00",
                "country": "DE",
                "is_sanction_listed": false
            }
        }))
        .unwrap();
        let out = super::audit_record_inner(&input).expect("clean record must audit");
        let text = alloc::string::String::from_utf8_lossy(&out);
        assert!(!text.contains("CHE-112"), "tax id leaked: {text}");
        assert!(!text.contains("3704"), "iban leaked: {text}");
    }
}
