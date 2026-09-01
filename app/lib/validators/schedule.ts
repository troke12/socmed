import { z } from "zod";
import { isValidCron, isValidTimezone } from "@/lib/schedule/cron";

export const CreateScheduleBody = z.object({
  accountId: z.number().int().positive(),
  name: z.string().min(1).max(200),
  cronExpr: z
    .string()
    .min(1)
    .max(200)
    .refine(isValidCron, "not a valid 5-field cron expression"),
  timezone: z
    .string()
    .min(1)
    .max(100)
    .refine(isValidTimezone, "not a known IANA timezone")
    .default("UTC"),
  // The post this rule clones on every run. Null means the rule creates an empty
  // draft, which is only useful as a placeholder — the UI always sends one.
  templatePostId: z.number().int().positive().optional().nullable(),
  enabled: z.boolean().default(true),
});

export const UpdateScheduleBody = CreateScheduleBody.partial().extend({
  id: z.number().int().positive(),
});

export type CreateScheduleInput = z.infer<typeof CreateScheduleBody>;
export type UpdateScheduleInput = z.infer<typeof UpdateScheduleBody>;
