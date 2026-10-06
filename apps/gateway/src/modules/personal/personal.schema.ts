import {z} from 'zod';
const text=z.string().max(2000);
export const personalDataSchema=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('schedule'),items:z.array(z.object({weekday:z.number().int().min(1).max(7),periods:z.array(z.number().int().min(1).max(13)).max(13),startTime:text,endTime:text,title:text,teacher:text,className:text,classroom:text.optional()})).max(200)}),
 z.object({kind:z.literal('absence'),items:z.array(z.object({courseName:text,absence:text,absenceDetail:z.array(text).max(100),semester:text})).max(200)}),
 z.object({kind:z.literal('announcements'),items:z.array(z.object({title:text,publisher:text,category:text})).max(20)})
]);
export type PersonalData=z.infer<typeof personalDataSchema>;
export type PersonalAction=PersonalData['kind'];
