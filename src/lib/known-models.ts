import type { AiProviderId } from "./types";

// Curated starter list so new users can pick a reasonable model without knowing exact IDs.
// This is intentionally small and should match models we already reference elsewhere (defaults/pricing).
export const KNOWN_MODELS: Record<AiProviderId, string[]> = {
  anthropic: ["claude-sonnet-4-5-20250929", "claude-opus-4-6", "claude-haiku-4-5"],
  openai: ["gpt-4o", "o3-mini"],
  google: ["gemini-2.0-flash", "gemini-2.5-pro"],
  // Ollama is user/local-dependent; keep a couple of common examples.
  ollama: ["llama3.1", "qwen2.5-coder", "mistral"],
};

export function mergeModelLists(primary: string[], fallback: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const list of [primary, fallback]) {
    for (const m of list) {
      const v = (m ?? "").trim();
      if (!v) continue;
      if (seen.has(v)) continue;
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

