use crate::domain::model::{AuditLog, AnonPlan};
use crate::infrastructure::pdf_writer;
use hmac::{Hmac, Mac};
use sha2::{Sha256, Digest};
use hex;
use dotenv::dotenv;
use std::env;

// Create alias for HMAC-SHA256
type HmacSha256 = Hmac<Sha256>;

#[tauri::command]
pub fn create_audit_report(final_content: String, applied_plan: AnonPlan) -> Result<String, String> {
    let mut hasher = Sha256::new();
    hasher.update(final_content.as_bytes());
    let hash = hex::encode(hasher.finalize());

    let rules_list: Vec<String> = if !applied_plan.replacements.is_empty() {
        applied_plan.replacements.iter()
            .map(|r| format!("{} -> {} ({})", r.original, r.replacement, r.reason))
            .collect()
    } else {
        applied_plan.global_rules.keys().cloned().collect()
    };

    let log = AuditLog {
        task_context: applied_plan.task_name,
        applied_rules: rules_list,
        user_overrides: vec![],
        privacy_score: 0.95, // Mock score
        data_hash: hash,
        timestamp: "2024-01-01T12:00:00Z".to_string(), // Mock timestamp to avoid dependency issues if chrono missing
        signature: None,
    };

    generate_report(log)
}

#[tauri::command]
pub fn generate_report(mut log: AuditLog) -> Result<String, String> {
    // Generate signature if missing
    if log.signature.is_none() {
        dotenv().ok();
        let secret_key = env::var("ANONYMED_HMAC_KEY")
            .map_err(|_| "ANONYMED_HMAC_KEY not set".to_string())?;
        let mut mac = HmacSha256::new_from_slice(secret_key.as_bytes())
            .map_err(|e| format!("HMAC invalid length: {}", e))?;

        let data_to_sign = format!("{}{}{}", log.task_context, log.data_hash, log.timestamp);
        mac.update(data_to_sign.as_bytes());

        let result = mac.finalize();
        let signature = hex::encode(result.into_bytes());
        log.signature = Some(signature);
    }

    // In Phase 1+2, serialize to JSON
    let json_report = serde_json::to_string_pretty(&log).map_err(|e| e.to_string())?;

    // Call infrastructure to write PDF (Mocked call)
    pdf_writer::write_report();

    Ok(json_report)
}

#[tauri::command]
pub fn generate_public_notice(log: AuditLog) -> Result<String, String> {
    // Generate APPI Article 43 Notice Text with "Method of Provision"
    let notice = format!(
        "【匿名加工情報の作成と提供に関する公表】\n\n\
        当院は、以下の目的で匿名加工情報を作成し、第三者へ提供いたします。\n\n\
        1. 利用目的: {}\n\
        2. 加工した情報の項目:\n   - 氏名、住所、生年月日等の特定の個人を識別できる記述等を削除または置換\n\
        3. 提供の方法: 暗号化された通信経路による電子伝送 (HTTPS/TLS)\n\n\
        (作成日時: {})\n\
        (ログ署名: {})",
        log.task_context,
        log.timestamp,
        log.signature.unwrap_or_else(|| "署名なし".to_string())
    );
    Ok(notice)
}
