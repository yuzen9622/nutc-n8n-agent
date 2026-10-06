import { z } from 'zod';

// LINE may extend event objects; only explicitly selected fields are retained.
export const userIdSchema = z.string().regex(/^U[0-9a-f]{32}$/);
const source = z.object({ type: z.enum(['user', 'group', 'room']), userId: userIdSchema.optional() });
const event = z.object({
  type: z.string(), webhookEventId: z.string().min(1).max(128),
  timestamp: z.number().int().nonnegative(), source,
  message: z.object({ type: z.string(), text: z.string().max(2000).optional() }).optional(),
});
export const webhookSchema = z.object({ destination: userIdSchema, events: z.array(event).max(100) });
export const identitySchema = z.strictObject({ idToken: z.string().min(1).max(8192) });
export type LineEvent = z.infer<typeof event>;
