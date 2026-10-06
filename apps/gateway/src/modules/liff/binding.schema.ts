import {z} from 'zod';
export const bindingSchema=z.strictObject({account:z.string().regex(/^[A-Za-z0-9]{1,32}$/),password:z.string().min(1).max(256)});
