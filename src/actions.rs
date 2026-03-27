use std::path::Path;

use anyhow::Context;
use serde::{Deserialize, Serialize};
use tokio::io::AsyncReadExt;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActionItem {
    pub label: String,
    #[serde(default)]
    pub command: Option<String>,
    #[serde(default)]
    pub r#type: Option<String>,
    #[serde(default)]
    pub submenu: Option<Vec<ActionItem>>,
}

pub async fn load_actions(path: Option<&str>) -> anyhow::Result<Vec<ActionItem>> {
    let Some(path) = path else {
        return Ok(Vec::new());
    };

    let content = if path == "-" {
        let mut stdin = tokio::io::stdin();
        let mut buf = Vec::new();
        stdin
            .read_to_end(&mut buf)
            .await
            .context("failed to read actions from stdin")?;
        String::from_utf8(buf).context("stdin actions were not valid utf-8")?
    } else {
        tokio::fs::read_to_string(Path::new(path))
            .await
            .with_context(|| format!("failed to read actions file: {path}"))?
    };

    let actions = serde_json::from_str(&content).context("invalid actions json")?;
    Ok(actions)
}
