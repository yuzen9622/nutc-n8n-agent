import type {SchoolClient} from './school.client.js';
import {SCHOOL} from '../../constants/school.js';
import {SchoolError} from '../../utils/school-error.js';
import {assertParsedRows} from './student.parse.js';
import {assertStudentPage,schoolHtml} from './login.parse.js';
import {parseSchedule} from './schedule.parse.js';
import {parseAbsences} from './absence.parse.js';
import {parseLastPageNumber,parseAnnouncementList} from './announcement.parse.js';
import {computeAverageScore,normalizeSemester,parseHistoryGrades,parseHistoryGradeSummaries} from './grade.parse.js';
import {buildLeaveSubmissionPayload,normalizeLeaveType,parseAbsenceNotes} from './leave.parse.js';
import {buildMailSendForm,parseGenMailPath,parseHiddenInputs,type ComposeDefaults} from './mail.parse.js';

export type StudentAction='schedule'|'absence'|'announcements'|'grades'|'leave_notes'|'leave_apply'|'send_mail';

export class StudentService {
 async query(client:SchoolClient,action:'schedule',params?:Record<string,unknown>,signal?:AbortSignal):Promise<{kind:'schedule',items:ReturnType<typeof parseSchedule>}>;
 async query(client:SchoolClient,action:'absence',params?:Record<string,unknown>,signal?:AbortSignal):Promise<{kind:'absence',items:ReturnType<typeof parseAbsences>}>;
 async query(client:SchoolClient,action:'announcements',params?:Record<string,unknown>,signal?:AbortSignal):Promise<{kind:'announcements',items:ReturnType<typeof parseAnnouncementList>}>;
 async query(client:SchoolClient,action:'grades',params?:Record<string,unknown>,signal?:AbortSignal):Promise<{kind:'grades',semester?:string,availableSemesters:string[],totalScore:number|null,conductScore:string|null,classRank:number|null,items:ReturnType<typeof parseHistoryGrades>[string]}>;
 async query(client:SchoolClient,action:'leave_notes',params?:Record<string,unknown>,signal?:AbortSignal):Promise<{kind:'leave_notes',items:ReturnType<typeof parseAbsenceNotes>}>;
 async query(client:SchoolClient,action:'leave_apply',params?:Record<string,unknown>,signal?:AbortSignal):Promise<{kind:'leave_apply',success:boolean,message:string,details:{date:string,beginSec:number,endSec:number,typeName:string,reason:string}}>;
 async query(client:SchoolClient,action:'send_mail',params?:Record<string,unknown>,signal?:AbortSignal):Promise<{kind:'send_mail',success:boolean,message:string,details:{to:string,subject:string}}>;
 async query(client:SchoolClient,action:StudentAction,params?:Record<string,unknown>,signal?:AbortSignal):Promise<any>;
 async query(client:SchoolClient,action:StudentAction,params:Record<string,unknown>={},signal=AbortSignal.timeout(12000)){
  if(action==='schedule'||action==='absence'||action==='announcements'){
   const url=action==='schedule'?SCHOOL.schedule:action==='absence'?SCHOOL.absence:SCHOOL.home;
   const response=await client.fetch(url,signal);let html=schoolHtml(response.body,response.contentType);assertStudentPage(html);
   if(action==='schedule'){const items=parseSchedule(html);assertParsedRows(html,items.length);return {kind:action,items};}
   if(action==='absence'){const items=parseAbsences(html);assertParsedRows(html,items.length);return {kind:action,items};}
   const page=parseLastPageNumber(html);
   if(page>1){const last=await client.fetch(`${SCHOOL.home}?_p=${page}`,signal);html=schoolHtml(last.body,last.contentType);assertStudentPage(html);}
   const items=parseAnnouncementList(html,page);assertParsedRows(html,items.length);return {kind:action,items:items.slice(0,20)};
  }

  if(action==='grades'){
   const requestedSem=normalizeSemester(typeof params.semester==='string'?params.semester:undefined);
   const url=requestedSem?`${SCHOOL.historyScores}?semester=${encodeURIComponent(requestedSem)}`:SCHOOL.historyScores;
   const response=await client.fetch(url,signal);const html=schoolHtml(response.body,response.contentType);assertStudentPage(html);
   const historyGrades=parseHistoryGrades(html);const summaries=parseHistoryGradeSummaries(html);
   const availableSemesters=Object.keys(historyGrades).sort();

   let targetSem=requestedSem;
   if(!targetSem||!historyGrades[targetSem]){
    const latestEntry=[...availableSemesters].reverse().find(sem=>(historyGrades[sem]??[]).some(g=>g.score!==null));
    targetSem=latestEntry??availableSemesters.at(-1);
   }

   const targetCourses=targetSem?(historyGrades[targetSem]??[]):[];
   const summary=targetSem?summaries[targetSem]:undefined;
   const totalScore=computeAverageScore(targetCourses);

   return {
    kind:'grades' as const,
    semester:targetSem,
    availableSemesters,
    totalScore:summary?.totalScore??totalScore,
    conductScore:summary?.conductScore??null,
    classRank:summary?.classRank??null,
    items:targetCourses,
   };
  }

  if(action==='leave_notes'){
   const response=await client.fetch(SCHOOL.absenceNotes,signal);const html=schoolHtml(response.body,response.contentType);assertStudentPage(html);
   const items=parseAbsenceNotes(html);return {kind:'leave_notes' as const,items};
  }

  if(action==='leave_apply'){
   const date=typeof params.date==='string'?params.date:'';
   const reason=typeof params.reason==='string'?params.reason:'';
   const beginSec=typeof params.begin_sec==='number'?params.begin_sec:typeof params.beginSec==='number'?params.beginSec:1;
   const endSec=typeof params.end_sec==='number'?params.end_sec:typeof params.endSec==='number'?params.endSec:beginSec;
   const typeInfo=normalizeLeaveType(params.leave_type??params.an_type??params.type);

   if(!date||!reason){
    return {
     kind:'leave_apply' as const,
     success:false,
     message:'請假資訊不完整，請提供請假日期（YYYY/MM/DD）與請假事由。',
     details:{date,beginSec,endSec,typeName:typeInfo.name,reason},
    };
   }

   const payloadObj=buildLeaveSubmissionPayload({
    date,
    date1:typeof params.date1==='string'?params.date1:date,
    begin_sec:beginSec,
    end_sec:endSec,
    an_type:typeInfo.code,
    reason,
    consecutive:typeof params.consecutive==='number'?params.consecutive:1,
   });

   const formBody=new URLSearchParams(payloadObj);
   const response=await client.fetch(SCHOOL.absenceNoteCreate,signal,formBody,{referer:SCHOOL.absenceNotes});
   const html=schoolHtml(response.body,response.contentType);
   if(/請先登入|\/student\/Login.aspx/i.test(html))throw new SchoolError('SCHOOL_SESSION_EXPIRED');

   return {
    kind:'leave_apply' as const,
    success:response.status>=200&&response.status<400,
    message:'請假申請單已成功送出。',
    details:{date,beginSec,endSec,typeName:typeInfo.name,reason},
   };
  }

  if(action==='send_mail'){
   const to=typeof params.to==='string'?params.to:typeof params.recipient==='string'?params.recipient:'';
   const subject=typeof params.subject==='string'?params.subject:'';
   const content=typeof params.content==='string'?params.content:'';

   if(!to||!subject||!content){
    return {
     kind:'send_mail' as const,
     success:false,
     message:'信件資訊不完整，請提供收件人信箱（to）、信件主旨（subject）與信件內容（content）。',
     details:{to,subject},
    };
   }

   let composeDefaults:ComposeDefaults={
    cpid:'',
    crumb:'',
    fromText:'student@nutc.edu.tw',
    referer:SCHOOL.webmailGenMail,
   };

   try{
    const subRes=await client.fetch(SCHOOL.webmailSubmenu,signal);
    const subHtml=schoolHtml(subRes.body,subRes.contentType);
    const genPath=parseGenMailPath(subHtml);
    const genUrl=genPath?new URL(genPath,SCHOOL.webmailSubmenu).href:SCHOOL.webmailGenMail;

    const genRes=await client.fetch(genUrl,signal,undefined,{referer:SCHOOL.webmailSubmenu});
    const genHtml=schoolHtml(genRes.body,genRes.contentType);
    const hidden=parseHiddenInputs(genHtml);
    composeDefaults={
     cpid:hidden.cpid??'',
     crumb:hidden.crumb??'',
     fromText:hidden.FromText||hidden.fromText||'student@nutc.edu.tw',
     referer:genUrl,
    };
   }catch{
    // fallback defaults
   }

   const mailForm=buildMailSendForm({to,subject,content,cc:typeof params.cc==='string'?params.cc:undefined},composeDefaults);
   const sendRes=await client.fetch(SCHOOL.webmailSend,signal,new URLSearchParams(mailForm),{referer:composeDefaults.referer});
   const sendHtml=schoolHtml(sendRes.body,sendRes.contentType);
   if(/webmail session expired|請重新登入/i.test(sendHtml))throw new SchoolError('SCHOOL_SESSION_EXPIRED');

   return {
    kind:'send_mail' as const,
    success:sendRes.status>=200&&sendRes.status<400,
    message:'信件已成功透過學校 Webmail 發送。',
    details:{to,subject},
   };
  }

  throw new SchoolError('SCHOOL_URL_DENIED');
 }
}
