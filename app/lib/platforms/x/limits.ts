// Per-platform rate limits. Source: X API docs (2024).
// Token-bucket cost: 1 per post, 5 per search/mentions call.
export const X_LIMITS = {
  posts: { per24h: 50, perWindow: "user" },
  search: { per15m: 450, perWindow: "app" },
};
