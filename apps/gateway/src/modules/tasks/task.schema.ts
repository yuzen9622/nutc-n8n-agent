import { z } from 'zod';
export const taskAuthSchema=z.strictObject({taskId:z.uuid(),lease:z.uuid(),capability:z.string().regex(/^[A-Za-z0-9_-]{43}$/)});
export type TaskAuth=z.infer<typeof taskAuthSchema>;
export const toolSchema=taskAuthSchema.extend({
  kind:z.enum(['web','personal']),
  query:z.string().trim().min(1).max(500),
  params:z.record(z.string(),z.unknown()).optional(),
  semester:z.string().optional(),
  action:z.string().optional(),
  date:z.string().optional(),
  begin_sec:z.number().int().optional(),
  end_sec:z.number().int().optional(),
  leave_type:z.string().optional(),
  reason:z.string().optional(),
  to:z.string().optional(),
  subject:z.string().optional(),
  content:z.string().optional(),
}).strict();
export const completionSchema=taskAuthSchema.extend({output:z.string().max(12000),knowledgeObservations:z.array(z.string().max(64000)).max(5).default([])});
export const answerSchema=z.strictObject({answer:z.string().trim().min(1).max(3000),sourceIds:z.array(z.string().min(1).max(128)).max(10)});
export function parseAgentAnswer(output:string){
  const text=output.trim();
  const fenced=text.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i);
  if (fenced || text.startsWith('{') || text.endsWith('}') || text.includes('```')) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(fenced ? (fenced[1] ?? '') : text);
    } catch {
      throw new Error('INVALID_JSON');
    }
    return answerSchema.parse(parsed);
  }
  return answerSchema.parse({answer: text, sourceIds: []});
}
