use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use serde::Serialize;
use serde_json::Value;
use toml_edit::{ArrayOfTables, DocumentMut, Item, Table, Value as TomlValue};

use crate::core::agent_detection::AgentType;

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

fn codex_dir() -> Result<PathBuf> {
    Ok(home_dir()?.join(".codex"))
}

fn settings_path() -> Result<PathBuf> {
    Ok(claude_dir()?.join("settings.json"))
}

fn skills_dir() -> Result<PathBuf> {
    Ok(claude_dir()?.join("skills"))
}

fn codex_config_path() -> Result<PathBuf> {
    Ok(codex_dir()?.join("config.toml"))
}

fn codex_skills_dir() -> Result<PathBuf> {
    Ok(codex_dir()?.join("skills"))
}

fn read_text_if_exists(path: &Path) -> Result<Option<String>> {
    match fs::read_to_string(path) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e).with_context(|| format!("read {}", path.display())),
    }
}

fn expand_home_prefix(path: &str) -> PathBuf {
    if path == "~" {
        if let Ok(home) = home_dir() {
            return home;
        }
        return PathBuf::from(path);
    }
    if let Some(rest) = path.strip_prefix("~/") {
        if let Ok(home) = home_dir() {
            return home.join(rest);
        }
    }
    PathBuf::from(path)
}

fn normalized_skill_path_key(path: &str) -> String {
    let expanded = expand_home_prefix(path);
    // Prefer canonical paths for de-dupe so symlinked skill roots don't inflate counts.
    fs::canonicalize(&expanded)
        .unwrap_or(expanded)
        .to_string_lossy()
        .to_string()
}

fn skill_exists_on_disk(path: &str) -> bool {
    fs::metadata(expand_home_prefix(path)).is_ok()
}

fn claude_skill_config_path(path: &str) -> String {
    let p = Path::new(path);
    let is_skill_md = p
        .file_name()
        .and_then(|s| s.to_str())
        .is_some_and(|s| s.eq_ignore_ascii_case("SKILL.md"));
    if !is_skill_md {
        return path.to_string();
    }
    p.parent()
        .map(|pp| pp.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string())
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
        let Some(obj) = item.as_object() else {
            continue;
        };
        let Some(name) = obj.get("name").and_then(|v| v.as_str()) else {
            continue;
        };
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

        let exists = (!path.is_empty()) && skill_exists_on_disk(&path);

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

fn scan_skills_directory_roots(roots: &[PathBuf]) -> Result<Vec<SkillInfo>> {
    let mut out = Vec::new();
    for root in roots {
        out.extend(scan_skills_by_skill_md(root)?);
    }
    Ok(out)
}

fn codex_skill_name_from_path(path: &str) -> String {
    let p = Path::new(path);
    // Common case: ~/.codex/skills/<name>/SKILL.md
    if let Some(parent) = p.parent() {
        if let Some(fname) = p.file_name().and_then(|s| s.to_str()) {
            if fname.eq_ignore_ascii_case("SKILL.md") {
                if let Some(dir) = parent.file_name().and_then(|s| s.to_str()) {
                    if !dir.is_empty() {
                        return dir.to_string();
                    }
                }
            }
        }
    }
    // Fallback to basename.
    p.file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(path)
        .to_string()
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
                .rfind(|s| !s.is_empty())
                .unwrap_or("");
            let candidate = candidate
                .trim_matches(|c: char| !c.is_ascii_alphanumeric() && c != '-' && c != '_');
            if !candidate.is_empty() {
                out.insert(candidate.to_string());
            }
        }
    }

    Ok(out.into_iter().collect())
}

fn discover_claude_skills(project_path: Option<&Path>) -> Result<SkillsDiscoveryResult> {
    let settings_path = settings_path()?;
    let mut installed: Vec<SkillInfo> = Vec::new();

    if let Some(text) = read_text_if_exists(&settings_path)? {
        if let Ok(v) = serde_json::from_str::<Value>(&text) {
            installed = parse_settings_installed_skills(&v);
        }
    }

    // Merge in direct on-disk Claude skills to pick up newly added local skills.
    let dir_skills = scan_skills_directory_roots(&[skills_dir()?])?
        .into_iter()
        .map(|mut s| {
            s.path = claude_skill_config_path(&s.path);
            s
        })
        .collect::<Vec<_>>();

    let mut by_name = std::collections::HashMap::<String, usize>::new();
    for (idx, s) in installed.iter().enumerate() {
        by_name.insert(s.name.clone(), idx);
    }
    for s in dir_skills {
        if let Some(idx) = by_name.get(&s.name).copied() {
            let cur = installed
                .get_mut(idx)
                .expect("existing index should always be valid");
            // If settings has a stale path for this skill, prefer the live on-disk path.
            if !cur.exists && s.exists {
                cur.path = s.path.clone();
                cur.exists = true;
            }
            if cur.description.is_none() {
                cur.description = s.description.clone();
            }
            continue;
        }
        by_name.insert(s.name.clone(), installed.len());
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

fn parse_codex_config_installed_skills(doc: &DocumentMut) -> Vec<SkillInfo> {
    let mut out = Vec::new();
    let Some(skills) = doc.get("skills") else {
        return out;
    };
    let Some(config) = skills.get("config") else {
        return out;
    };
    let Some(arr) = config.as_array_of_tables() else {
        return out;
    };

    for tbl in arr.iter() {
        let path = tbl
            .get("path")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        if path.is_empty() {
            continue;
        }
        let enabled = tbl.get("enabled").and_then(|v| v.as_bool()).unwrap_or(true);
        let name = codex_skill_name_from_path(&path);

        let expanded = expand_home_prefix(&path);
        let exists = fs::metadata(&expanded).is_ok();
        let desc = read_text_if_exists(&expanded)
            .ok()
            .flatten()
            .and_then(|t| skill_description_from_skill_md(&t));

        out.push(SkillInfo {
            name,
            path,
            enabled,
            description: desc,
            source: "config".to_string(),
            exists,
        });
    }

    out
}

fn scan_skills_by_skill_md(root: &Path) -> Result<Vec<SkillInfo>> {
    let mut out = Vec::new();
    let entries = match fs::read_dir(root) {
        Ok(v) => v,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(out),
        Err(e) => return Err(e).with_context(|| format!("read_dir {}", root.display())),
    };

    for entry in entries {
        let entry = entry.with_context(|| format!("read_dir entry for {}", root.display()))?;
        let path = entry.path();
        let meta = entry
            .metadata()
            .with_context(|| format!("metadata {}", path.display()))?;

        if meta.is_dir() {
            // Recurse.
            out.extend(scan_skills_by_skill_md(&path)?);
            continue;
        }

        if !meta.is_file() {
            continue;
        }

        let fname = path.file_name().and_then(|s| s.to_str()).unwrap_or("");
        if !fname.eq_ignore_ascii_case("SKILL.md") {
            continue;
        }

        let name = path
            .parent()
            .and_then(|p| p.file_name())
            .and_then(|s| s.to_str())
            .unwrap_or("skill")
            .to_string();

        let desc = read_text_if_exists(&path)?.and_then(|t| skill_description_from_skill_md(&t));

        out.push(SkillInfo {
            name,
            path: path.to_string_lossy().to_string(),
            // Codex skills are effectively "on" when present unless config overrides them.
            enabled: true,
            description: desc,
            source: "directory".to_string(),
            exists: true,
        });
    }

    Ok(out)
}

fn discover_codex_skills() -> Result<SkillsDiscoveryResult> {
    let config_path = codex_config_path()?;
    let mut installed: Vec<SkillInfo> = Vec::new();

    // Source of truth: when Codex has explicit skills.config entries, use those.
    // This keeps the Skills tab fully centralized under provider config.
    if let Some(text) = read_text_if_exists(&config_path)? {
        if let Ok(doc) = text.parse::<DocumentMut>() {
            installed = parse_codex_config_installed_skills(&doc);
        }
    }

    // Fallback: if config has no explicit list, surface Codex-local skills on disk.
    if installed.is_empty() {
        installed.extend(scan_skills_directory_roots(&[codex_skills_dir()?])?);
    }

    // De-dupe by normalized path (not name) since names can collide.
    let mut seen_paths = BTreeSet::<String>::new();
    installed.retain(|s| {
        let key = normalized_skill_path_key(&s.path);
        seen_paths.insert(key)
    });

    // For config-backed lists, keep source stable in UI.
    let has_config_backing = installed.iter().any(|s| s.source == "config");
    if has_config_backing {
        for s in installed.iter_mut() {
            s.source = "config".to_string();
        }
    }

    installed.sort_by(|a, b| a.name.cmp(&b.name));

    Ok(SkillsDiscoveryResult {
        installed,
        recommended: Vec::new(),
        settings_path: config_path.to_string_lossy().to_string(),
    })
}

pub fn discover_skills(
    agent_type: AgentType,
    project_path: Option<&Path>,
) -> Result<SkillsDiscoveryResult> {
    match agent_type {
        AgentType::ClaudeCode => discover_claude_skills(project_path),
        AgentType::Codex | AgentType::Openrouter => discover_codex_skills(),
        // Gemini/Terminal don't have a wired "skills" integration yet; return empty.
        _ => Ok(SkillsDiscoveryResult {
            installed: Vec::new(),
            recommended: Vec::new(),
            settings_path: "(not supported for this agent)".to_string(),
        }),
    }
}

pub fn set_skill_enabled(
    name: &str,
    enabled: bool,
    path: Option<&str>,
    description: Option<&str>,
) -> Result<()> {
    let settings_path = settings_path()?;
    if let Some(parent) = settings_path.parent() {
        fs::create_dir_all(parent).with_context(|| format!("create dir {}", parent.display()))?;
    }

    let mut root: Value = match read_text_if_exists(&settings_path)? {
        Some(text) => {
            serde_json::from_str(&text).unwrap_or_else(|_| Value::Object(Default::default()))
        }
        None => Value::Object(Default::default()),
    };
    if !root.is_object() {
        root = Value::Object(Default::default());
    }

    // Ensure skills.installed exists and is an array.
    if root.get("skills").is_none() {
        root["skills"] = Value::Object(Default::default());
    }
    if root["skills"].get("installed").is_none() {
        root["skills"]["installed"] = Value::Array(Vec::new());
    }
    if !root["skills"]["installed"].is_array() {
        root["skills"]["installed"] = Value::Array(Vec::new());
    }

    let installed = root["skills"]["installed"]
        .as_array_mut()
        .expect("installed is array");

    let normalized_path = path.map(claude_skill_config_path);

    let mut found = false;
    for item in installed.iter_mut() {
        let Some(obj) = item.as_object_mut() else {
            continue;
        };
        let Some(n) = obj.get("name").and_then(|v| v.as_str()) else {
            continue;
        };
        if n != name {
            continue;
        }
        obj.insert("enabled".to_string(), Value::Bool(enabled));
        if let Some(p) = normalized_path.as_deref() {
            obj.insert("path".to_string(), Value::String(p.to_string()));
        }
        if let Some(d) = description {
            obj.insert("description".to_string(), Value::String(d.to_string()));
        }
        found = true;
        break;
    }

    if !found {
        let default_path = normalized_path.unwrap_or_else(|| {
            skills_dir()
                .map(|d| d.join(name))
                .unwrap_or_default()
                .to_string_lossy()
                .to_string()
        });
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

fn set_codex_skill_enabled(path: &str, enabled: bool) -> Result<()> {
    let config_path = codex_config_path()?;
    if let Some(parent) = config_path.parent() {
        fs::create_dir_all(parent).with_context(|| format!("create dir {}", parent.display()))?;
    }

    let mut doc: DocumentMut = match read_text_if_exists(&config_path)? {
        Some(text) => text
            .parse::<DocumentMut>()
            .unwrap_or_else(|_| DocumentMut::new()),
        None => DocumentMut::new(),
    };

    // Ensure [skills] exists.
    if doc.get("skills").is_none() {
        doc["skills"] = Item::Table(Table::new());
    }

    // Ensure skills.config exists as an array-of-tables.
    if doc["skills"].get("config").is_none() {
        doc["skills"]["config"] = Item::ArrayOfTables(ArrayOfTables::new());
    }

    let arr = doc["skills"]["config"]
        .as_array_of_tables_mut()
        .ok_or_else(|| anyhow::anyhow!("skills.config is not an array-of-tables"))?;

    let target_key = normalized_skill_path_key(path);
    let mut found = false;
    for tbl in arr.iter_mut() {
        let Some(p) = tbl.get("path").and_then(|v| v.as_str()) else {
            continue;
        };
        if normalized_skill_path_key(p) == target_key {
            tbl["enabled"] = Item::Value(TomlValue::from(enabled));
            found = true;
            break;
        }
    }

    if !found {
        let mut t = Table::new();
        t["path"] = Item::Value(TomlValue::from(path));
        t["enabled"] = Item::Value(TomlValue::from(enabled));
        arr.push(t);
    }

    fs::write(&config_path, doc.to_string())
        .with_context(|| format!("write {}", config_path.display()))?;
    Ok(())
}

pub fn set_skill_enabled_for_agent(
    agent_type: AgentType,
    name: &str,
    enabled: bool,
    path: Option<&str>,
    description: Option<&str>,
) -> Result<()> {
    match agent_type {
        AgentType::ClaudeCode => set_skill_enabled(name, enabled, path, description),
        AgentType::Codex | AgentType::Openrouter => {
            let Some(p) = path else {
                anyhow::bail!("codex skill toggles require a path");
            };
            set_codex_skill_enabled(p, enabled)
        }
        _ => anyhow::bail!("skills are not supported for this agent"),
    }
}
