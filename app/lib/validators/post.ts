import { z } from "zod";

const PostFields = z.object({
  kind: z.enum(["text", "image", "video", "carousel", "link"]),
  caption: z.string().max(5000).default(""),
  hashtags: z.string().max(2000).default(""),
  linkUrl: z.string().url().max(2000).optional().nullable(),
  mediaIds: z.array(z.number().int().positive()).max(10).default([]),
  scheduledFor: z.number().int().positive().optional().nullable(),
});

// accountId (single) and accountIds (fan-out) are both accepted. accountId is
// kept so existing callers and the update action keep working unchanged; the
// create route normalises the two into one list.
const PostTargets = PostFields.extend({
  accountId: z.number().int().positive().optional(),
  accountIds: z.array(z.number().int().positive()).min(1).max(20).optional(),
});

export const CreatePostBody = PostTargets.refine(
  (d) => d.accountId !== undefined || (d.accountIds?.length ?? 0) > 0,
  { message: "one of accountId or accountIds is required", path: ["accountIds"] },
);

// .partial() is only available on the plain object, not on the refined schema.
export const UpdatePostBody = PostTargets.partial().extend({
  status: z.enum(["draft", "scheduled", "archived"]).optional(),
});

export type CreatePostInput = z.infer<typeof CreatePostBody>;
export type UpdatePostInput = z.infer<typeof UpdatePostBody>;
