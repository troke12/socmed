import { NotImplementedError, type Platform, type PlatformAdapter } from "./types";

const registry = new Map<Platform, PlatformAdapter>();

export function registerAdapter(adapter: PlatformAdapter): void {
  registry.set(adapter.platform, adapter);
}

export function getAdapter(platform: Platform): PlatformAdapter {
  const a = registry.get(platform);
  if (!a) {
    return makeNotImplemented(platform);
  }
  return a;
}

function makeNotImplemented(platform: Platform): PlatformAdapter {
  const nope = (m: string) => () => Promise.reject(new NotImplementedError(`${platform}.${m}`));
  return {
    platform,
    beginOAuth: nope("beginOAuth"),
    completeOAuth: nope("completeOAuth"),
    refresh: nope("refresh"),
    publishPost: nope("publishPost"),
    deletePost: nope("deletePost"),
    fetchPostMetrics: nope("fetchPostMetrics"),
    fetchMentions: nope("fetchMentions"),
    fetchComments: nope("fetchComments"),
    postCommentReply: nope("postCommentReply"),
    likeTarget: nope("likeTarget"),
    verifyWebhookSignature: () => false,
    parseWebhookEvent: () => [],
  };
}
