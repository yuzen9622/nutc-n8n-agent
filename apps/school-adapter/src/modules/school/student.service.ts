import type {SchoolClient} from './school.client.js';
import {SCHOOL} from '../../constants/school.js';
import {assertParsedRows} from './student.parse.js';
import {assertStudentPage,schoolHtml} from './login.parse.js';
import {parseSchedule} from './schedule.parse.js';
import {parseAbsences} from './absence.parse.js';
import {parseLastPageNumber,parseAnnouncementList} from './announcement.parse.js';
export type StudentAction='schedule'|'absence'|'announcements';
export class StudentService {
 async query(client:SchoolClient,action:StudentAction,signal=AbortSignal.timeout(8000)){
  const url=action==='schedule'?SCHOOL.schedule:action==='absence'?SCHOOL.absence:SCHOOL.home;
  const response=await client.fetch(url,signal);let html=schoolHtml(response.body,response.contentType);assertStudentPage(html);
  if(action==='schedule'){const items=parseSchedule(html);assertParsedRows(html,items.length);return {kind:action,items};}
  if(action==='absence'){const items=parseAbsences(html);assertParsedRows(html,items.length);return {kind:action,items};}
  const page=parseLastPageNumber(html);
  if(page>1){const last=await client.fetch(`${SCHOOL.home}?_p=${page}`,signal);html=schoolHtml(last.body,last.contentType);assertStudentPage(html);}
  const items=parseAnnouncementList(html,page);assertParsedRows(html,items.length);return {kind:action,items:items.slice(0,20)};
 }
}
