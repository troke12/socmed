import { z } from "zod";

export const CreatePostBody = z.object({
  accountId: z.number().int().positive(),
  kind: z.enum(["text", "image", "video", "carousel", "link"]),
  caption: z.string().max(5000).default(""),
  hashtags: z.string().max(2000).default(""),
  linkUrl: z.string().url().max(2000).optional().nullable(),
  mediaIds: z.array(z.number().int().positive()).max(10).default([]),
  scheduledFor: z.number().int().positive().optional().nullable(),
});

export const UpdatePostBody = CreatePostBody.partial().extend({
  status: z.enum(["draft", "scheduled", "archived"]).optional(),
});

export type CreatePostInput = z.infer<typeof CreatePostBody>;
export type UpdatePostInput = z.infer<typeof UpdatePostBody>;
