import { z } from "zod";
import { getContentRules } from "@platforms/content-rules";
import { getPlatform, type PlatformId } from "@/lib/platform-meta";
import { aiConfig } from "./config";
import type { Suggestion, Tone } from "./shapes";

export { TONES } from "./shapes";
export type { Tone, Suggestion } from "./shapes";

// Lives here rather than in shapes.ts so zod stays out of the browser bundle.
// Structurally identical to the Suggestion interface; the compile fails if they
// drift, because parse() is typed against this schema and returns Suggestion.
export const SuggestionSchema = z.object({
  captions: z.array(z.string()).min(1).max(3),
  hashtags: z.array(z.string()).max(15),
  notes: z.string(),
});

export interface SuggestInput {
  caption: string;
  hashtags?: string;
  linkUrl?: string;
  platforms: PlatformId[];
  tone: Tone;
}

export class AiNotConfiguredError extends Error {
  constructor() {
    super("AI suggestions are not configured on this install");
    this.name = "AiNotConfiguredError";
  }
}

export class AiRefusedError extends Error {
  constructor(public readonly category: string | null) {
    super("the model declined to rewrite this caption");
    this.name = "AiRefusedError";
  }
}

/**
 * The tightest limit among the selected platforms, so a suggestion is usable on
 * all of them rather than only the most generous one.
 */
function tightestLimit(platforms: PlatformId[]): { limit: number; platform: PlatformId } | null {
  let best: { limit: number; platform: PlatformId } | null = null;
  for (const p of platforms) {
    const rules = getContentRules(p);
    if (!rules.textLimit) continue;
    if (!best || rules.textLimit < best.limit) best = { limit: rules.textLimit, platform: p };
  }
  return best;
}

function buildPrompt(input: SuggestInput): string {
  const names = input.platforms.map((p) => getPlatform(p)?.name ?? p);
  const tightest = tightestLimit(input.platforms);
  const lines: string[] = [];

  lines.push(`Target platforms: ${names.length ? names.join(", ") : "unspecified"}.`);
  if (tightest) {
    const unit = getContentRules(tightest.platform).textUnit;
    lines.push(
      `Every caption must fit within ${tightest.limit} ${unit} — that is ${
        getPlatform(tightest.platform)?.name ?? tightest.platform
      }'s limit, the strictest of the selected platforms.`,
    );
  }
  if (input.tone !== "keep") {
    lines.push(`Rewrite in a ${input.tone} tone.`);
  } else {
    lines.push("Keep the author's existing tone and voice.");
  }
  if (input.linkUrl) {
    lines.push(`The post links to ${input.linkUrl}. Do not put the URL in the caption; it is added separately.`);
  }
  lines.push("");
  lines.push("Current caption:");
  lines.push(input.caption.trim() || "(empty — write one from the hashtags and link)");
  if (input.hashtags?.trim()) {
    lines.push("");
    lines.push(`Current hashtags: ${input.hashtags.trim()}`);
  }
  return lines.join("\n");
}

const SYSTEM = [
  "You help a social media manager polish their own posts before publishing.",
  "",
  "Return two or three caption options and a set of hashtags.",
  "- Keep the author's meaning and any factual claims exactly as they are. Do not invent",
  "  products, statistics, dates, prices or quotes that are not in the input.",
  "- Respect the character limit given. A caption over the limit is useless.",
  "- Hashtags: return them without the leading '#', lowercase, no duplicates, most",
  "  relevant first. Prefer a handful of specific tags over a wall of generic ones.",
  "- If the caption is already good, say so in notes and return it close to unchanged",
  "  rather than padding it with filler.",
  "- notes is one short sentence for the author about what you changed and why.",
].join("\n");

export async function suggest(input: SuggestInput): Promise<Suggestion> {
  const config = aiConfig();
  if (!config.apiKey) throw new AiNotConfiguredError();

  // Imported lazily so an install without a key never loads the SDK.
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const { zodOutputFormat } = await import("@anthropic-ai/sdk/helpers/zod");

  const client = new Anthropic({ apiKey: config.apiKey });

  const response = await client.messages.parse({
    model: config.model,
    // Captions are short by definition, and this call sits in front of someone
    // waiting in the compose form.
    max_tokens: 2000,
    // Routine short-form generation on a latency-sensitive path: low effort is
    // where this workload sits, not a cost compromise on quality.
    output_config: {
      effort: "low",
      format: zodOutputFormat(SuggestionSchema),
    },
    system: SYSTEM,
    messages: [{ role: "user", content: buildPrompt(input) }],
  });

  // A safety decline arrives as HTTP 200, so stop_reason has to be checked
  // before reading content.
  if (response.stop_reason === "refusal") {
    throw new AiRefusedError(response.stop_details?.category ?? null);
  }
  if (!response.parsed_output) {
    throw new Error("the model returned a response that did not match the expected shape");
  }

  return normalise(response.parsed_output, input);
}

/**
 * Post-processing the model should not be trusted to do perfectly: strip stray
 * '#' prefixes, dedupe, and drop any caption that came back over the limit
 * anyway rather than showing the author something the platform will reject.
 */
export function normalise(raw: Suggestion, input: SuggestInput): Suggestion {
  const tightest = tightestLimit(input.platforms);
  const seen = new Set<string>();
  const hashtags: string[] = [];
  for (const tag of raw.hashtags) {
    const clean = tag.trim().replace(/^#+/, "").toLowerCase();
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    hashtags.push(clean);
  }

  const captions = raw.captions
    .map((c) => c.trim())
    .filter((c) => c.length > 0)
    .filter((c) => !tightest || c.length <= tightest.limit);

  return {
    // If the limit filter removed everything, fall back to the untrimmed set so
    // the author sees something and can judge for themselves.
    captions: captions.length > 0 ? captions : raw.captions.map((c) => c.trim()).filter(Boolean),
    hashtags,
    notes: raw.notes.trim(),
  };
}
