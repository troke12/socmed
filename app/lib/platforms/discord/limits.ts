// Discord rate limits are per-route with X-RateLimit-* headers.
// Global: 50 requests per second per bot.
// Posting to a channel: 5 messages per 5 seconds per channel.
export const DISCORD_LIMITS = {
  posts: { per5s: 5, perWindow: "channel" },
  global: { per1s: 50, perWindow: "bot" },
};
