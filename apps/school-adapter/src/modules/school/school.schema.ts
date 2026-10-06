import {z} from 'zod';
const userId=z.string().regex(/^U[0-9a-f]{32}$/i);
export const schoolLoginSchema=z.object({userId,account:z.string().min(1).max(32).regex(/^[A-Za-z0-9]+$/),password:z.string().min(1).max(256)}).strict();
export const schoolQuerySchema=z.object({userId,action:z.enum(['schedule','absence','announcements'])}).strict();
export const schoolContracts={login:z.toJSONSchema(schoolLoginSchema),query:z.toJSONSchema(schoolQuerySchema)};
