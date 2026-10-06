import { z } from 'zod';
export const scenarios = ['public_success','public_no_source','schedule_success','absence_success','announcements_success','reauth_required','mixed_partial','provider_timeout','duplicate_event','ocr_failed','credential_invalid','knowledge_success','web_success','both_success','retrieval_retry','retrieval_exhausted','stale_knowledge','source_conflict','embedding_unavailable','unknown_intent','unknown_personal','repair_success','repair_failed','unknown_route','unknown_decision','rewrite_denied','session_expired','binding_prompt','clarify_prompt','unsupported_prompt'] as const;
export const demoSchema = z.object({scenario:z.enum(scenarios)}).strict();
export const emptySchema = z.object({}).strict();
const ref = z.string().regex(/^[a-z]+_[a-f0-9-]{36}$/);
export const operationSchema = z.object({operationId:ref}).strict();
export const stageSchemas = {
  prepare: operationSchema, knowledge: operationSchema.extend({queryRef:ref}), search: operationSchema.extend({queryRef:ref}),
  read: operationSchema.extend({searchRef:ref}), collect:operationSchema,
  assess:operationSchema.extend({evidenceRef:ref}), 'rewrite-query':operationSchema.extend({assessmentRef:ref}),
  generate:operationSchema.extend({evidenceRef:ref}), validate:operationSchema.extend({draftRef:ref}), repair:operationSchema.extend({draftRef:ref}),
  fallback:operationSchema.extend({reasonCode:z.enum(['insufficient','clarify','invalid','unsupported','budget_exhausted']).default('insufficient')}),
  render:operationSchema.extend({draftRef:ref}),
} as const;
export const personalSchemas = {
  'check-session':operationSchema, schedule:operationSchema, absence:operationSchema, announcements:operationSchema,
  render:operationSchema.extend({dataRef:ref}), 'login-prompt':operationSchema, 'unsupported-prompt':operationSchema,
} as const;
export const completeSchema = z.object({resultRefs:z.array(ref).min(1).max(2)}).strict();
export const failSchema = z.object({errorCode:z.enum(['UPSTREAM_FAILED','UNKNOWN_INTENT','WORKFLOW_FAILED'])}).strict();
export const errorSchema = z.object({workflowId:z.string().max(100),executionId:z.string().max(100),errorCode:z.literal('WORKFLOW_FAILED')}).strict();
export const syncStartSchema = z.object({scenario:z.enum(['all','updated','unchanged','withdrawn','failed']).default('all')}).strict();
export const syncSchema = z.object({syncRef:ref,sourceRef:ref.optional(),versionRef:ref.optional()}).strict();
export type Scenario = typeof scenarios[number];
export const contractSchemas = {demo:demoSchema,empty:emptySchema,complete:completeSchema,fail:failSchema,error:errorSchema,syncStart:syncStartSchema,sync:syncSchema,...Object.fromEntries(Object.entries(stageSchemas).map(([k,v])=>[`public/${k}`,v])),...Object.fromEntries(Object.entries(personalSchemas).map(([k,v])=>[`personal/${k}`,v]))};
