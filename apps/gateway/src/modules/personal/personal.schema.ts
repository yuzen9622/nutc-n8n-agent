import {z} from 'zod';
const text=z.string().max(2000);
export const personalDataSchema=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('schedule'),items:z.array(z.object({weekday:z.number().int().min(1).max(7),periods:z.array(z.number().int().min(1).max(13)).max(13),startTime:text,endTime:text,title:text,teacher:text,className:text,classroom:text.optional()})).max(200)}),
 z.object({kind:z.literal('absence'),items:z.array(z.object({courseName:text,absence:text,absenceDetail:z.array(text).max(100),semester:text})).max(200)}),
 z.object({kind:z.literal('announcements'),items:z.array(z.object({title:text,publisher:text,category:text})).max(20)}),
 z.object({
  kind:z.literal('grades'),
  semester:text.optional(),
  availableSemesters:z.array(text).max(50).optional(),
  totalScore:z.number().nullable().optional(),
  conductScore:text.nullable().optional(),
  classRank:z.number().int().nullable().optional(),
  items:z.array(z.object({name:text,type:text,credits:z.number(),score:text.nullable()})).max(200)
 }),
 z.object({
  kind:z.literal('leave_notes'),
  items:z.array(z.object({appliedAt:text,type:text,courseInfo:text,reason:text,teacherStatus:text,finalStatus:text,remark:text.optional()})).max(100)
 }),
 z.object({
  kind:z.literal('leave_apply'),
  success:z.boolean(),
  message:text,
  details:z.object({date:text,beginSec:z.number().int(),endSec:z.number().int(),typeName:text,reason:text})
 }),
 z.object({
  kind:z.literal('send_mail'),
  success:z.boolean(),
  message:text,
  details:z.object({to:text,subject:text})
 })
]);
export type PersonalData=z.infer<typeof personalDataSchema>;
export type PersonalAction=PersonalData['kind'];
