/**
 * The client-visible surface: no zod, no SDK, no node builtins.
 *
 * The compose form needs the tone list and the result shape. Importing
 * suggest.ts from a client component drags the Anthropic SDK — and node:fs /
 * node:path with it — into the browser bundle and fails the build; a dynamic
 * `await import` does not help, since webpack resolves the module graph
 * statically. Keeping zod out of this file too avoids shipping the validator to
 * the browser for a type it only reads.
 */
export const TONES = ["keep", "punchy", "professional", "friendly", "playful"] as const;
export type Tone = (typeof TONES)[number];

export interface Suggestion {
  captions: string[];
  hashtags: string[];
  notes: string;
}
