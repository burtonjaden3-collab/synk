use std::collections::HashMap;
use std::fs;

use regex::Regex;
use serde::{Deserialize, Serialize};
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager};

use crate::core::agent_detection::AgentType;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CostSource {
    Mcp,
    OutputParsed,
    Heuristic,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionCostSnapshot {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub total_cost: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    pub source: CostSource,
}

#[derive(Debug, Clone, Copy)]
struct ModelPricing {
    input_per_million: f64,
    output_per_million: f64,
}

impl ModelPricing {
    const fn new(input_per_million: f64, output_per_million: f64) -> Self {
        Self {
            input_per_million,
            output_per_million,
        }
    }
}

pub struct CostTracker {
    agent_type: AgentType,
    model: Option<String>,
    parsed_input_tokens: Option<u64>,
    parsed_output_tokens: Option<u64>,
    parsed_total_cost: Option<f64>,
    heuristic_input_chars: u64,
    heuristic_output_chars: u64,
    line_buf: String,
    pricing_by_provider: HashMap<String, HashMap<String, ModelPricing>>,
    last_snapshot: Option<SessionCostSnapshot>,
    re_model: Regex,
    re_total_cost: Regex,
    re_session_cost: Regex,
    re_cost_generic: Regex,
    re_usage_cost: Regex,
    re_total_tokens_io: Regex,
    re_input_tokens: Regex,
    re_output_tokens: Regex,
    re_gemini_io: Regex,
    re_codex_usage: Regex,
}

impl CostTracker {
    pub fn new(agent_type: AgentType, initial_model: Option<String>, app: &AppHandle) -> Self {
        Self {
            agent_type,
            model: initial_model,
            parsed_input_tokens: None,
            parsed_output_tokens: None,
            parsed_total_cost: None,
            heuristic_input_chars: 0,
            heuristic_output_chars: 0,
            line_buf: String::new(),
            pricing_by_provider: read_pricing_table(app),
            last_snapshot: None,
            re_model: Regex::new(r"(?i)(?:using model|model):\s*([A-Za-z0-9._:-]+)")
                .expect("invalid regex"),
            re_total_cost: Regex::new(r"(?i)total cost:\s*\$([0-9]+(?:\.[0-9]+)?)")
                .expect("invalid regex"),
            re_session_cost: Regex::new(r"(?i)session cost:\s*\$([0-9]+(?:\.[0-9]+)?)")
                .expect("invalid regex"),
            re_cost_generic: Regex::new(r"(?i)(?:estimated\s+)?cost:\s*\$([0-9]+(?:\.[0-9]+)?)")
                .expect("invalid regex"),
            re_usage_cost: Regex::new(r"(?i)usage:.*?\$([0-9]+(?:\.[0-9]+)?)")
                .expect("invalid regex"),
            re_total_tokens_io: Regex::new(
                r"(?i)total tokens:\s*([\d,]+)\s*input,\s*([\d,]+)\s*output",
            )
            .expect("invalid regex"),
            re_input_tokens: Regex::new(r"(?i)input tokens:\s*([\d,]+)").expect("invalid regex"),
            re_output_tokens: Regex::new(r"(?i)output tokens:\s*([\d,]+)")
                .expect("invalid regex"),
            re_gemini_io: Regex::new(r"\[(\d+)\s+input tokens,\s*(\d+)\s+output tokens\]")
                .expect("invalid regex"),
            re_codex_usage: Regex::new(
                r"(?i)usage:\s*([\d,]+)\s*prompt\s*\+\s*([\d,]+)\s*completion\s*=\s*([\d,]+)\s*total tokens",
            )
            .expect("invalid regex"),
        }
    }

    pub fn ingest_input(&mut self, input: &str) {
        if self.agent_type == AgentType::Terminal || input.is_empty() {
            return;
        }
        self.heuristic_input_chars = self
            .heuristic_input_chars
            .saturating_add(input.chars().count() as u64);
    }

    pub fn ingest_output_bytes(&mut self, bytes: &[u8]) -> bool {
        if self.agent_type == AgentType::Terminal || bytes.is_empty() {
            return false;
        }

        let text = String::from_utf8_lossy(bytes);
        self.heuristic_output_chars = self
            .heuristic_output_chars
            .saturating_add(text.chars().count() as u64);

        for ch in text.chars() {
            if ch == '\n' || ch == '\r' {
                if !self.line_buf.is_empty() {
                    let line = std::mem::take(&mut self.line_buf);
                    self.parse_line(line.trim());
                }
                continue;
            }
            self.line_buf.push(ch);
            if self.line_buf.len() > 4096 {
                let line = std::mem::take(&mut self.line_buf);
                self.parse_line(line.trim());
            }
        }

        let next = self.snapshot();
        if snapshot_changed(&self.last_snapshot, &next) {
            self.last_snapshot = next;
            return self.last_snapshot.is_some();
        }
        false
    }

    pub fn snapshot(&self) -> Option<SessionCostSnapshot> {
        if self.agent_type == AgentType::Terminal {
            return None;
        }

        let heuristic_input_tokens = chars_to_tokens(self.heuristic_input_chars);
        let heuristic_output_tokens = chars_to_tokens(self.heuristic_output_chars);
        let input_tokens = self.parsed_input_tokens.unwrap_or(heuristic_input_tokens);
        let output_tokens = self.parsed_output_tokens.unwrap_or(heuristic_output_tokens);

        let parsed = self.parsed_total_cost.is_some()
            || self.parsed_input_tokens.is_some()
            || self.parsed_output_tokens.is_some();
        let has_signal = parsed || input_tokens > 0 || output_tokens > 0;
        if !has_signal {
            return None;
        }

        let source = if parsed {
            CostSource::OutputParsed
        } else {
            CostSource::Heuristic
        };
        let model = self.model.clone();
        let total_cost = self.parsed_total_cost.unwrap_or_else(|| {
            let rates = self.pricing_for(model.as_deref());
            estimate_cost(input_tokens, output_tokens, rates)
        });

        Some(SessionCostSnapshot {
            input_tokens,
            output_tokens,
            total_cost,
            model,
            source,
        })
    }

    fn parse_line(&mut self, line: &str) {
        if line.is_empty() {
            return;
        }

        if let Some(caps) = self.re_model.captures(line) {
            if let Some(m) = caps.get(1) {
                self.model = Some(m.as_str().trim().to_string());
            }
        }

        if let Some(caps) = self.re_total_cost.captures(line) {
            if let Some(v) = parse_f64(caps.get(1).map(|m| m.as_str()).unwrap_or_default()) {
                self.bump_parsed_total_cost(v);
            }
        }
        if let Some(caps) = self.re_session_cost.captures(line) {
            if let Some(v) = parse_f64(caps.get(1).map(|m| m.as_str()).unwrap_or_default()) {
                self.bump_parsed_total_cost(v);
            }
        }
        if let Some(caps) = self.re_cost_generic.captures(line) {
            if let Some(v) = parse_f64(caps.get(1).map(|m| m.as_str()).unwrap_or_default()) {
                self.bump_parsed_total_cost(v);
            }
        }
        if let Some(caps) = self.re_usage_cost.captures(line) {
            if let Some(v) = parse_f64(caps.get(1).map(|m| m.as_str()).unwrap_or_default()) {
                self.bump_parsed_total_cost(v);
            }
        }

        if let Some(caps) = self.re_total_tokens_io.captures(line) {
            let in_tok = parse_u64(caps.get(1).map(|m| m.as_str()).unwrap_or_default());
            let out_tok = parse_u64(caps.get(2).map(|m| m.as_str()).unwrap_or_default());
            if let Some(v) = in_tok {
                self.bump_parsed_input(v);
            }
            if let Some(v) = out_tok {
                self.bump_parsed_output(v);
            }
        }
        if let Some(caps) = self.re_input_tokens.captures(line) {
            if let Some(v) = parse_u64(caps.get(1).map(|m| m.as_str()).unwrap_or_default()) {
                self.bump_parsed_input(v);
            }
        }
        if let Some(caps) = self.re_output_tokens.captures(line) {
            if let Some(v) = parse_u64(caps.get(1).map(|m| m.as_str()).unwrap_or_default()) {
                self.bump_parsed_output(v);
            }
        }

        // Gemini response-level usage.
        if let Some(caps) = self.re_gemini_io.captures(line) {
            let in_tok = parse_u64(caps.get(1).map(|m| m.as_str()).unwrap_or_default());
            let out_tok = parse_u64(caps.get(2).map(|m| m.as_str()).unwrap_or_default());
            if let Some(v) = in_tok {
                self.add_parsed_input(v);
            }
            if let Some(v) = out_tok {
                self.add_parsed_output(v);
            }
        }

        // Codex response-level usage.
        if let Some(caps) = self.re_codex_usage.captures(line) {
            let prompt = parse_u64(caps.get(1).map(|m| m.as_str()).unwrap_or_default());
            let completion = parse_u64(caps.get(2).map(|m| m.as_str()).unwrap_or_default());
            if let Some(v) = prompt {
                self.add_parsed_input(v);
            }
            if let Some(v) = completion {
                self.add_parsed_output(v);
            }
        }
    }

    fn bump_parsed_total_cost(&mut self, next: f64) {
        self.parsed_total_cost = Some(self.parsed_total_cost.unwrap_or(0.0).max(next));
    }

    fn bump_parsed_input(&mut self, next: u64) {
        self.parsed_input_tokens = Some(self.parsed_input_tokens.unwrap_or(0).max(next));
    }

    fn bump_parsed_output(&mut self, next: u64) {
        self.parsed_output_tokens = Some(self.parsed_output_tokens.unwrap_or(0).max(next));
    }

    fn add_parsed_input(&mut self, delta: u64) {
        self.parsed_input_tokens = Some(self.parsed_input_tokens.unwrap_or(0).saturating_add(delta));
    }

    fn add_parsed_output(&mut self, delta: u64) {
        self.parsed_output_tokens = Some(self.parsed_output_tokens.unwrap_or(0).saturating_add(delta));
    }

    fn pricing_for(&self, model: Option<&str>) -> ModelPricing {
        let Some(provider) = provider_for_agent(self.agent_type) else {
            return ModelPricing::new(0.0, 0.0);
        };
        let Some(models) = self.pricing_by_provider.get(provider) else {
            return default_pricing(provider);
        };
        if models.is_empty() {
            return default_pricing(provider);
        }

        if let Some(m) = model {
            if let Some(p) = models.get(m) {
                return *p;
            }

            let m_lc = m.to_ascii_lowercase();
            if let Some((_, p)) = models
                .iter()
                .find(|(k, _)| k.to_ascii_lowercase() == m_lc)
            {
                return *p;
            }

            if let Some((_, p)) = models
                .iter()
                .find(|(k, _)| m_lc.starts_with(&k.to_ascii_lowercase()))
            {
                return *p;
            }
        }

        models
            .values()
            .next()
            .copied()
            .unwrap_or_else(|| default_pricing(provider))
    }
}

fn provider_for_agent(agent_type: AgentType) -> Option<&'static str> {
    match agent_type {
        AgentType::ClaudeCode => Some("anthropic"),
        AgentType::GeminiCli => Some("google"),
        AgentType::Codex => Some("openai"),
        AgentType::Openrouter => Some("openai"),
        AgentType::Terminal => None,
    }
}

fn default_pricing(provider: &str) -> ModelPricing {
    match provider {
        "anthropic" => ModelPricing::new(3.0, 15.0),
        "google" => ModelPricing::new(0.10, 0.40),
        "openai" => ModelPricing::new(2.50, 10.0),
        _ => ModelPricing::new(0.0, 0.0),
    }
}

fn estimate_cost(input_tokens: u64, output_tokens: u64, pricing: ModelPricing) -> f64 {
    let input_m = input_tokens as f64 / 1_000_000.0;
    let output_m = output_tokens as f64 / 1_000_000.0;
    input_m * pricing.input_per_million + output_m * pricing.output_per_million
}

fn chars_to_tokens(chars: u64) -> u64 {
    if chars == 0 {
        return 0;
    }
    // Rough heuristic used when the agent doesn't print explicit usage.
    (chars.saturating_add(3)) / 4
}

fn parse_u64(raw: &str) -> Option<u64> {
    let clean: String = raw.chars().filter(|c| c.is_ascii_digit()).collect();
    if clean.is_empty() {
        return None;
    }
    clean.parse::<u64>().ok()
}

fn parse_f64(raw: &str) -> Option<f64> {
    raw.trim().parse::<f64>().ok()
}

fn snapshot_changed(prev: &Option<SessionCostSnapshot>, next: &Option<SessionCostSnapshot>) -> bool {
    match (prev, next) {
        (None, None) => false,
        (Some(_), None) | (None, Some(_)) => true,
        (Some(a), Some(b)) => {
            a.input_tokens != b.input_tokens
                || a.output_tokens != b.output_tokens
                || (a.total_cost - b.total_cost).abs() > 0.000_01
                || a.model != b.model
                || a.source != b.source
        }
    }
}

fn read_pricing_table(app: &AppHandle) -> HashMap<String, HashMap<String, ModelPricing>> {
    let mut out: HashMap<String, HashMap<String, ModelPricing>> = HashMap::new();

    let Ok(path) = app
        .path()
        .resolve("synk/pricing.json", BaseDirectory::Config)
    else {
        return out;
    };

    let Ok(text) = fs::read_to_string(path) else {
        return out;
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) else {
        return out;
    };
    let Some(root) = value.as_object() else {
        return out;
    };

    for (provider, models_val) in root {
        let Some(models_obj) = models_val.as_object() else {
            continue;
        };
        let mut models: HashMap<String, ModelPricing> = HashMap::new();
        for (model, rates_val) in models_obj {
            let Some(rates_obj) = rates_val.as_object() else {
                continue;
            };
            let input = rates_obj.get("input").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let output = rates_obj.get("output").and_then(|v| v.as_f64()).unwrap_or(0.0);
            models.insert(model.clone(), ModelPricing::new(input, output));
        }
        if !models.is_empty() {
            out.insert(provider.clone(), models);
        }
    }

    out
}
