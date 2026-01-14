use std::fs;
use std::path::Path;

pub fn read_file_with_encoding(path: &Path) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|e| format!("Failed to read file: {}", e))?;

    if let Ok(content) = String::from_utf8(bytes.clone()) {
        return Ok(content);
    }

    let (decoded, _, had_errors) = encoding_rs::SHIFT_JIS.decode(&bytes);
    if had_errors {
        let (decoded_euc, _, had_errors_euc) = encoding_rs::EUC_JP.decode(&bytes);
        if !had_errors_euc {
            return Ok(decoded_euc.into_owned());
        }
        return Err("Failed to decode file: unsupported encoding".to_string());
    }

    Ok(decoded.into_owned())
}
