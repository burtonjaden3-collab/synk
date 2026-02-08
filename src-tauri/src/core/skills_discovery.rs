use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use serde::Serialize;
use serde_json::Value;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillInfo {
    pub name: String,
    pub path: String,
    pub enabled: bool,
    pub description: Option<String>,
    pub source: String, // "settings" | "directory"
    pub exists: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillsDiscoveryResult {
    pub installed: Vec<SkillInfo>,
    pub recommended: Vec<String>,
    pub settings_path: String,
}

fn home_dir() -> Result<PathBuf> {
    if let Some(v) = std::env::var_os("HOME").filter(|v| !v.is_empty()) {
        return Ok(PathBuf::from(v));
    }
    if let Some(v) = std::env::var_os("USERPROFILE").filter(|v| !v.is_empty()) {
        return Ok(PathBuf::from(v));
    }
    anyhow::bail!("unable to resolve home directory (missing HOME/USERPROFILE)");
}

fn claude_dir() -> Result<PathBuf> {
    Ok(home_dir()?.join(".claude"))
}

fn settings_path() -> Result<PathBuf> {
    Ok(claude_dir()?.join("settings.json"))
}

fn skills_dir() -> Result<PathBuf> {
    Ok(claude_dir()?.join("skills"))
}

fn read_text_if_exists(path: &Path) -> Result<Option<String>> {
    match fs::read_to_string(path) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e).with_context(|| format!("read {}", path.display())),
    }
}

fn skill_description_from_skill_md(text: &str) -> Option<String> {
    // Heuristic: take the first non-empty, non-heading line as a short description.
    // If there isn't one, fall back to the first heading.
    let mut first_heading: Option<String> = None;
    for raw in text.lines() {
        let line = raw.trim();
        if line.is_empty() {
            continue;
        }
        if let Some(h) = line.strip_prefix('#') {
            if first_heading.is_none() {
                first_heading = Some(h.trim().trim_start_matches('#').trim().to_string());
            }
            continue;
        }
        // Skip common frontmatter-ish separators.
        if line == "---" {
            continue;
        }
        return Some(line.to_string());
    }
    first_heading
}

fn parse_settings_installed_skills(settings_json: &Value) -> Vec<SkillInfo> {
    let mut out = Vec::new();
    let Some(installed) = settings_json
        .get("skills")
        .and_then(|v| v.get("installed"))
        .and_then(|v| v.as_array())
    else {
        return out;
    };

    for item in installed {
        let Some(obj) = item.as_object() else { continue };
        let Some(name) = obj.get("name").and_then(|v| v.as_str()) else { continue };
        let path = obj
            .get("path")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let enabled = obj.get("enabled").and_then(|v| v.as_bool()).unwrap_or(true);
        let description = obj
            .get("description")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        let exists = (!path.is_empty()) && fs::metadata(&path).is_ok();

        out.push(SkillInfo {
            name: name.to_string(),
            path,
            enabled,
            description,
            source: "settings".to_string(),
            exists,
        });
    }

    out
}

fn scan_skills_directory() -> Result<Vec<SkillInfo>> {
    let dir = skills_dir()?;
    let mut out = Vec::new();
    let entries = match fs::read_dir(&dir) {
        Ok(v) => v,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(out),
        Err(e) => return Err(e).with_context(|| format!("read_dir {}", dir.display())),
    };

    for entry in entries {
        let entry = entry.with_context(|| format!("read_dir entry for {}", dir.display()))?;
        let meta = entry
            .metadata()
            .with_context(|| format!("metadata {}", entry.path().display()))?;
        if !meta.is_dir() {
            continue;
        }
        let path = entry.path();
        let name = match path.file_name().and_then(|s| s.to_str()) {
            Some(v) if !v.is_empty() => v.to_string(),
            _ => continue,
        };

        let desc = read_text_if_exists(&path.join("SKILL.md"))?
            .and_then(|t| skill_description_from_skill_md(&t));

        out.push(SkillInfo {
            name,
            path: path.to_string_lossy().to_string(),
            enabled: true,
            description: desc,
            source: "directory".to_string(),
            exists: true,
        });
    }

    Ok(out)
}

fn scan_project_recommended(project_path: &Path) -> Result<Vec<String>> {
    let mut out = BTreeSet::<String>::new();
    let path = project_path.join("CLAUDE.md");
    let Some(text) = read_text_if_exists(&path)? else {
        return Ok(Vec::new());
    };

    // Minimal parser: look for "use ... skill" patterns.
    for raw in text.lines() {
        let line = raw.trim();
        if line.is_empty() {
            continue;
        }
        let lower = line.to_lowercase();
        if !lower.contains("skill") {
            continue;
        }

        // Common forms:
        // - "Use the frontend-design skill for UI work"
        // - "- Use frontend-design skill"
        // - "Use frontend-design"
        //
        // We'll extract the token right before the word "skill" if present.
        if let Some(idx) = lower.find("skill") {
            let before = &line[..idx];
            // Split on whitespace/punct; last token is likely the skill name.
            let candidate = before
                .split(|c: char| c.is_whitespace() || c == '`' || c == '"' || c == '\'' || c == '*')
                .filter(|s| !s.is_empty())
                .last()
                .unwrap_or("");
            let candidate = candidate.trim_matches(|c: char| !c.is_ascii_alphanumeric() && c != '-' && c != '_');
            if !candidate.is_empty() {
                out.insert(candidate.to_string());
            }
        }
    }

    Ok(out.into_iter().collect())
}

pub fn discover_skills(project_path: Option<&Path>) -> Result<SkillsDiscoveryResult> {
    let settings_path = settings_path()?;
    let mut installed: Vec<SkillInfo> = Vec::new();

    if let Some(text) = read_text_if_exists(&settings_path)? {
        if let Ok(v) = serde_json::from_str::<Value>(&text) {
            installed = parse_settings_installed_skills(&v);
        }
    }

    // Merge in directory scan (fallback / discover missing).
    let dir_skills = scan_skills_directory()?;
    let mut seen = BTreeSet::<String>::new();
    for s in installed.iter() {
        seen.insert(s.name.clone());
    }
    for s in dir_skills {
        if seen.contains(&s.name) {
            continue;
        }
        installed.push(s);
    }

    installed.sort_by(|a, b| a.name.cmp(&b.name));

    let recommended = match project_path {
        Some(p) => scan_project_recommended(p).unwrap_or_default(),
        None => Vec::new(),
    };

    Ok(SkillsDiscoveryResult {
        installed,
        recommended,
        settings_path: settings_path.to_string_lossy().to_string(),
    })
}

pub fn set_skill_enabled(
    name: &str,
    enabled: bool,
    path: Option<&str>,
    description: Option<&str>,
) -> Result<()> {
    let settings_path = settings_path()?;
    if let Some(parent) = settings_path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("create dir {}", parent.display()))?;
    }

    let mut root: Value = match read_text_if_exists(&settings_path)? {
        Some(text) => serde_json::from_str(&text).unwrap_or_else(|_| Value::Object(Default::default())),
        None => Value::Object(Default::default()),
    };
    if !root.is_object() {
        root = Value::Object(Default::default());
    }

    // Ensure skills.installed exists and is an array.
    if !root.get("skills").is_some() {
        root["skills"] = Value::Object(Default::default());
    }
    if !root["skills"].get("installed").is_some() {
        root["skills"]["installed"] = Value::Array(Vec::new());
    }
    if !root["skills"]["installed"].is_array() {
        root["skills"]["installed"] = Value::Array(Vec::new());
    }

    let installed = root["skills"]["installed"]
        .as_array_mut()
        .expect("installed is array");

    let mut found = false;
    for item in installed.iter_mut() {
        let Some(obj) = item.as_object_mut() else { continue };
        let Some(n) = obj.get("name").and_then(|v| v.as_str()) else { continue };
        if n != name {
            continue;
        }
        obj.insert("enabled".to_string(), Value::Bool(enabled));
        if let Some(p) = path {
            obj.insert("path".to_string(), Value::String(p.to_string()));
        }
        if let Some(d) = description {
            obj.insert("description".to_string(), Value::String(d.to_string()));
        }
        found = true;
        break;
    }

    if !found {
        let default_path = path
            .map(|s| s.to_string())
            .unwrap_or_else(|| skills_dir().map(|d| d.join(name)).unwrap_or_default().to_string_lossy().to_string());
        let mut obj = serde_json::Map::new();
        obj.insert("name".to_string(), Value::String(name.to_string()));
        obj.insert("path".to_string(), Value::String(default_path));
        obj.insert("enabled".to_string(), Value::Bool(enabled));
        if let Some(d) = description {
            obj.insert("description".to_string(), Value::String(d.to_string()));
        }
        installed.push(Value::Object(obj));
    }

    let text = serde_json::to_string_pretty(&root).context("serialize settings.json")?;
    fs::write(&settings_path, format!("{text}\n"))
        .with_context(|| format!("write {}", settings_path.display()))?;
    Ok(())
}
