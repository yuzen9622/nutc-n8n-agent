import {z} from 'zod';
export const leaveDateSchema=z.string().regex(/^\d{4}[-/]\d{2}[-/]\d{2}$/).refine(s=>{const [y,m,d]=s.split(/[-/]/).map(Number);const date=new Date(Date.UTC(y!,m!-1,d));return date.getUTCFullYear()===y&&date.getUTCMonth()===m!-1&&date.getUTCDate()===d;}).transform(s=>s.replaceAll('-','/'));
const period=z.number().int().min(1).max(14);
export const leaveSelectionSchema=z.union([
 z.strictObject({mode:z.literal('morning_count'),count:z.number().int().min(1).max(4)}),
 z.strictObject({mode:z.literal('range'),begin_sec:period,end_sec:period}).refine(s=>s.end_sec>=s.begin_sec),
 z.strictObject({mode:z.literal('periods'),periods:z.array(period).min(1).max(14)}).refine(s=>new Set(s.periods).size===s.periods.length)
]);
// Names only. Codes are exclusively discovered from the authenticated form.
export const leavePreviewIntentSchema=z.strictObject({date:leaveDateSchema,leave_type:z.enum(['心理假','心理調適假','事假','病假']).transform(s=>s==='心理假'?'心理調適假':s),reason:z.string().trim().min(1).max(500),selection:leaveSelectionSchema});
export type LeaveIntent=z.infer<typeof leavePreviewIntentSchema>;
export type LeaveSelection=z.infer<typeof leaveSelectionSchema>;
export const leaveAuthSchema=z.strictObject({taskId:z.uuid(),lease:z.uuid(),capability:z.string().regex(/^[A-Za-z0-9_-]{43}$/)});
export type LeaveAuth=z.infer<typeof leaveAuthSchema>;
export const leaveRpcSchema=z.discriminatedUnion('operation',[
 z.strictObject({auth:leaveAuthSchema,operation:z.literal('preview'),intent:leavePreviewIntentSchema}),
 z.strictObject({auth:leaveAuthSchema,operation:z.literal('confirm')})
]);
export const leaveReceiptSchema=z.strictObject({state:z.enum(['pending','validation','need_selection','expired','cancelled','consumed','rejected','ambiguous','succeeded']),code:z.string().regex(/^[A-Z_]{1,64}$/),date:leaveDateSchema.optional(),leaveType:z.string().max(100).optional(),reason:z.string().max(500).optional(),courses:z.array(z.strictObject({period:period,name:z.string().min(1).max(200)})).max(14).optional()});
export type LeaveReceipt=z.infer<typeof leaveReceiptSchema>;
export const leaveReplySchema=z.strictObject({receipt:leaveReceiptSchema,sessionId:z.uuid(),previewId:z.uuid().optional()});
export type LeaveReply=z.infer<typeof leaveReplySchema>;
export const LEAVE_AMBIGUOUS='結果尚無法確認，請至校務後台查看；系統不會自動再次送出。';
export const LEAVE_FALLBACK='本次請假尚未取得可確認的結果；請至校務後台查看，系統不會自動再次送出。';
export function isLeaveQuery(query:string){return /^leave(?:_|:|\s|$)/i.test(query)||/"leave/i.test(query);}
