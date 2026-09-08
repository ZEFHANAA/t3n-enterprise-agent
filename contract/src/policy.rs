//! Policy threshold resolution.
//!
//! Thresholds are read from the tenant's `policies` KV map so an enterprise
//! can retune its own limits without rebuilding or re-registering the WASM.
//! Falls back to compiled-in defaults when a key is absent.

use alloc::string::String;

/// Default monthly payroll ceiling requiring multi-sig board approval.
pub const DEFAULT_SALARY_THRESHOLD_USD: u64 = 50_000;
/// Default single-disbursement capital outflow ceiling.
pub const DEFAULT_CAPITAL_OUTFLOW_THRESHOLD_USD: u64 = 250_000;
/// Hard floor: any bank account / IBAN shorter than this is invalid.
pub const MIN_BANK_ACCOUNT_LEN: usize = 10;
/// Jurisdictions that always require manual review.
pub const HIGH_RISK_JURISDICTION_PREFIXES: [&str; 3] = ["BZ", "PA", "SC"];

const KEY_SALARY_THRESHOLD: &str = "salary_threshold_usd";
const KEY_CAPITAL_OUTFLOW_THRESHOLD: &str = "capital_outflow_threshold_usd";

/// Resolved thresholds used by the evaluation engines.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Thresholds {
    pub salary_usd: u64,
    pub capital_outflow_usd: u64,
}

impl Default for Thresholds {
    fn default() -> Self {
        Self {
            salary_usd: DEFAULT_SALARY_THRESHOLD_USD,
            capital_outflow_usd: DEFAULT_CAPITAL_OUTFLOW_THRESHOLD_USD,
        }
    }
}

/// Load thresholds, preferring the tenant's KV map over compiled defaults.
///
/// On the native (test) target no host is available, so defaults are returned.
#[cfg(target_arch = "wasm32")]
pub fn load() -> Thresholds {
    Thresholds {
        salary_usd: read_u64(KEY_SALARY_THRESHOLD).unwrap_or(DEFAULT_SALARY_THRESHOLD_USD),
        capital_outflow_usd: read_u64(KEY_CAPITAL_OUTFLOW_THRESHOLD)
            .unwrap_or(DEFAULT_CAPITAL_OUTFLOW_THRESHOLD_USD),
    }
}

#[cfg(not(target_arch = "wasm32"))]
pub fn load() -> Thresholds {
    Thresholds::default()
}

/// Read a decimal u64 out of the `policies` map, tolerating whitespace.
#[cfg(target_arch = "wasm32")]
fn read_u64(key: &str) -> Option<u64> {
    let map_name = crate::map_name("policies");
    let raw = crate::host::interfaces::kv_store::get(&map_name, key.as_bytes()).ok()??;
    let text = String::from_utf8_lossy(&raw);
    text.trim().parse::<u64>().ok()
}

/// Mask a sensitive identifier, leaving only the last `visible` characters.
///
/// A value no longer than `visible` is fully masked — never partially leaking.
pub fn mask(value: &str, visible: usize) -> String {
    let trimmed = value.trim();
    if trimmed.len() <= visible {
        return "*".repeat(trimmed.len().max(4));
    }
    let hidden = "*".repeat(trimmed.len() - visible);
    alloc::format!("{}{}", hidden, &trimmed[trimmed.len() - visible..])
}

/// True when the jurisdiction code is on the manual-review list.
pub fn is_high_risk_jurisdiction(jurisdiction: &str) -> bool {
    let code = jurisdiction.trim().to_uppercase();
    HIGH_RISK_JURISDICTION_PREFIXES
        .iter()
        .any(|prefix| code.starts_with(prefix))
}
