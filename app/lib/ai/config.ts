/**
 * AI suggestions are optional and off unless a key is present.
 *
 * Requires an Anthropic API key, which costs money per call, so nothing here
 * runs implicitly — the operator has to configure it, and the UI hides the
 * feature entirely when they have not.
 */
export interface AiConfig {
  apiKey: string | null;
  model: string;
}

// Opus 5. Not chosen for cost — chosen because caption rewriting for a specific
// platform's limits is a judgement task, and the effort level below is where the
// cost/latency tuning belongs.
export const DEFAULT_MODEL = "claude-opus-5";

export function aiConfig(): AiConfig {
  // SOCMED_ prefix first so this install's key is separable from anything else
  // on the host, then the SDK's own conventional variable.
  const apiKey = process.env.SOCMED_ANTHROPIC_API_KEY?.trim() || process.env.ANTHROPIC_API_KEY?.trim() || null;
  return {
    apiKey,
    model: process.env.SOCMED_AI_MODEL?.trim() || DEFAULT_MODEL,
  };
}

export function aiEnabled(): boolean {
  return aiConfig().apiKey !== null;
}
