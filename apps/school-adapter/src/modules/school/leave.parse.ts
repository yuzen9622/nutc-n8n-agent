import {load} from 'cheerio';

export interface AbsenceNoteRecord {
  id: number;
  appliedAt: string;
  type: string;
  courseInfo: string;
  reason: string;
  teacherStatus: string;
  finalStatus: string;
  remark: string;
}

export function parseAbsenceNotes(html: string): AbsenceNoteRecord[] {
  const $ = load(html);
  const result: AbsenceNoteRecord[] = [];

  $('table.grid_view tr[data-key]').each((_, el) => {
    const tds = $(el).find('td');
    const id = Number($(el).attr('data-key')) || 0;

    const descCell = $(tds[2]);
    const fullText = descCell.text().trim();
    const typeMatch = fullText.match(/\[(.+?)\]/);
    const type = typeMatch && typeMatch[1] ? typeMatch[1] : '';
    const courseInfo = descCell.find('i').text().trim();

    const descHtml = descCell.html() ?? '';
    const brParts = descHtml.split(/<br\s*\/?>/i);
    const reason = brParts[1] ? load(brParts[1]).text().trim() : '';

    result.push({
      id,
      appliedAt: $(tds[1]).text().trim(),
      type,
      courseInfo,
      reason,
      teacherStatus: $(tds[3]).text().trim(),
      finalStatus: $(tds[4]).text().trim(),
      remark: $(tds[5]).text().trim(),
    });
  });

  return result;
}

export {leaveDateSchema as leaveDate} from '../../../../shared/leave-contract.js';
import {leaveDateSchema,type LeaveSelection} from '../../../../shared/leave-contract.js';
import {z} from 'zod';
export type LeaveRow={ccid:number;sec:number;name:string};
function parseJson<S extends z.ZodType>(text:string,schema:S):z.output<S> {try{return schema.parse(JSON.parse(text));}catch{throw Error('LEAVE_JSON_INVALID');}}
const integerString=z.string().regex(/^[1-9]\d*$/).transform(Number).refine(Number.isSafeInteger);
const wireRow=z.strictObject({ccid:integerString,sec:integerString.refine(n=>n<=14),cls_name:z.string().trim().min(1).max(200)});
export function parseLeaveClasses(body:string):LeaveRow[]{
 const outer=parseJson(body,z.strictObject({d:z.string()}));
 const events=parseJson(outer.d,z.array(z.strictObject({type:z.enum(['cust_handler','function']),script:z.null(),func:z.string().nullable(),args:z.array(z.unknown()).max(4)})).min(1).max(10));
 const handlers=events.filter(e=>e.type==='cust_handler');
 if(handlers.length!==1||handlers[0]!.args.length!==1||typeof handlers[0]!.args[0]!=='string'||events.some(e=>e.type==='function'&&(e.func!=='ajax_done'||e.args.length!==1||e.args[0]!==1)))throw Error('LEAVE_CLASSES_INVALID');
 const rows=parseJson(handlers[0]!.args[0],z.array(wireRow).max(100)).map(r=>({ccid:r.ccid,sec:r.sec,name:r.cls_name}));
 if(new Set(rows.map(r=>`${r.ccid}:${r.sec}`)).size!==rows.length)throw Error('LEAVE_CLASSES_INVALID');
 return rows;
}
export class LeaveSelectionError extends Error {
 readonly courses:Array<{period:number;name:string}>;
 constructor(rows:LeaveRow[]){super('LEAVE_NEED_SELECTION');this.courses=rows.map(r=>({period:r.sec,name:r.name})).slice(0,14);}
}
export function selectLeaveRows(rows:LeaveRow[],selection:LeaveSelection):LeaveRow[]{
 const periods=selection.mode==='range'?Array.from({length:selection.end_sec-selection.begin_sec+1},(_,i)=>selection.begin_sec+i):selection.mode==='periods'?selection.periods:undefined;
 const selected=rows.filter(r=>periods?periods.includes(r.sec):r.sec<=4).sort((a,b)=>a.sec-b.sec);
 if(!selected.length||new Set(selected.map(r=>r.sec)).size!==selected.length||selected.length!==(periods?.length??(selection.mode==='morning_count'?selection.count:0)))throw new LeaveSelectionError(rows);
 return selected;
}
export function parseLeaveForm(html:string){
 const $=load(html);if(/請先登入|\/student\/Login\.aspx/i.test(html)||$('form').length!==1||$('form').attr('method')?.toLowerCase()!=='post')throw Error('LEAVE_FORM_INVALID');
 if($('form').attr('action')||$('input[type="file"][required],input[type="file"][aria-required="true"]').length)throw Error('LEAVE_FORM_UNSUPPORTED');
 for(const name of ['anid','date','date1','detail','dropped','begin_sec','end_sec','reason','update'])if($(`[name="${name}"]`).length!==1)throw Error('LEAVE_FORM_INVALID');
 const types:Record<string,number>={};
 $('select[name="an_type"] option').each((_,o)=>{const name=$(o).text().trim(),value=$(o).attr('value')??'';if(!name||!/^\d+$/.test(value))return;if(types[name]!==undefined||!Number.isSafeInteger(Number(value))||Number(value)<=0)throw Error('LEAVE_FORM_INVALID');types[name]=Number(value);});
 if(!Object.keys(types).length||$('[name="anid"]').val()!=='0'||! /function\s+opDone\s*\(\s*msg\s*\)\s*\{[^}]*setWindowReturnValue\s*\(\s*true\s*\)[^}]*window\.xclose\s*\(\s*\)/.test(html))throw Error('LEAVE_FORM_INVALID');
 const hidden:Record<string,string>={};$('input[type="hidden"]').each((_,e)=>{const name=$(e).attr('name');if(name)hidden[name]=String($(e).val()??'');});
 return {types,hidden};
}
export function buildLeaveSubmissionPayload(input:{date:string;an_type:number;reason:string;detail:Array<[number,number]>;hidden:Record<string,string>}):Record<string,string>{
 const date=leaveDateSchema.parse(input.date),reason=z.string().trim().min(1).max(500).parse(input.reason);
 const detail=z.array(z.tuple([z.number().int().positive().safe(),z.number().int().min(1).max(14)])).min(1).max(14).parse(input.detail);
 if(new Set(detail.map(r=>r[1])).size!==detail.length)throw Error('LEAVE_DETAIL_INVALID');
 const code=z.number().int().positive().safe().parse(input.an_type),periods=detail.map(r=>r[1]);
 return {...input.hidden,anid:'0',date,date1:date,detail:JSON.stringify(detail),begin_sec:String(Math.min(...periods)),end_sec:String(Math.max(...periods)),an_type:String(code),reason,dropped:'0',consecutive:'0',begin_date:'',end_date:'',update:'儲 存'};
}
const OP_DONE_ACCEPTED=new Set(['完成','申請完成','送出完成','儲存完成','新增完成','請假申請完成','請假完成','假單送出完成','申請已完成','申請成功','送出成功','儲存成功','新增成功','請假申請成功']);
const OP_DONE_REJECTED=/未|不|無法|失敗|錯誤|拒絕|重複|衝突|已存在|禁止|逾期|超過|異常|取消|失效|請先|請重新/;
const SCRIPT_CALL={
 // The form posts into an iframe, so the live response calls the opener's callback: parent.opDone('新增成功。').
 opDone:/^\s*(?:parent\.)?opDone\(\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\s*\);?\s*$/,
 alert:/^\s*alert\(\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\s*\);?\s*$/,
};
function scriptMessage(script:string,callee:keyof typeof SCRIPT_CALL):string|undefined{
 const m=SCRIPT_CALL[callee].exec(script);if(!m)return undefined;
 const literal=m[1]!;if(literal.startsWith('"')){try{const v=JSON.parse(literal);return typeof v==='string'?v:undefined;}catch{return undefined;}}
 const inner=literal.slice(1,-1);return inner.includes('\\')?undefined:inner;
}
export function parseLeaveCreateResponse(html:string):{state:'accepted'|'rejected'|'unknown';code:string}{
 const $=load(html);
 if(/請先登入|\/student\/Login\.aspx/i.test(html))return {state:'unknown',code:'LEAVE_SESSION_LOST'};
 const error=$('#lblMsg').text().trim();
 if(/未儲存|非本學期|失敗|錯誤/.test(error))return {state:'rejected',code:'LEAVE_UPSTREAM_REJECTED'};
 // Invocation, not a function declaration, and never evaluate school JavaScript.
 const scripts=$('script').map((_,e)=>$(e).html()??'').get();
 const calls=scripts.map(s=>scriptMessage(s,'opDone')).filter((v):v is string=>v!==undefined);
 // A bare alert() page (e.g. 「參數錯誤 !」) is the school refusing the form; it can only ever reject, never accept.
 const alerts=scripts.map(s=>scriptMessage(s,'alert')).filter((v):v is string=>v!==undefined);
 if(!calls.length&&alerts.length===1&&OP_DONE_REJECTED.test(alerts[0]!))return {state:'rejected',code:'LEAVE_UPSTREAM_REJECTED'};
 if(calls.length!==1)return {state:'unknown',code:'LEAVE_RESPONSE_UNKNOWN'};
 // opDone is only a UI callback: the message itself must be an explicit completion, otherwise it is not proof.
 const message=calls[0]!.trim().replace(/[。.!！\s]+$/u,'');
 if(OP_DONE_REJECTED.test(message))return {state:'rejected',code:'LEAVE_UPSTREAM_REJECTED'};
 return OP_DONE_ACCEPTED.has(message)?{state:'accepted',code:'LEAVE_RESPONSE_ACCEPTED'}:{state:'unknown',code:'LEAVE_RESPONSE_UNKNOWN'};
}
export function parseLeaveRecordSummary(html:string):AbsenceNoteRecord[]{
 const $=load(html);if(/請先登入|\/student\/Login\.aspx/i.test(html)||$('table.grid_view').length!==1)throw Error('LEAVE_RECORDS_INCOMPLETE');
 // Only a single complete list is currently supported. Pagination is a pre-POST hard stop.
 if($('a[href*="_p="],a[href*="page="],.pager').length)throw Error('LEAVE_RECORDS_INCOMPLETE');
 const rows=parseAbsenceNotes(html);if(rows.length>500||rows.some(r=>!Number.isSafeInteger(r.id)||r.id<=0)||new Set(rows.map(r=>r.id)).size!==rows.length)throw Error('LEAVE_RECORDS_INVALID');
 return rows;
}
const detailRow=z.object({ccid:integerString,sec:integerString.refine(n=>n<=14),checked:z.literal('1').optional()});
// Saved records render empty inputs; the school fills them via script: `var details = {date:[rows]}` (checked rows are
// the leave periods) and `$(':input[name="x"]').val('...')`. Read those literals only; never evaluate school JavaScript.
export function parseLeaveRecordDetail(html:string){
 const $=load(html);if(/請先登入|\/student\/Login\.aspx/i.test(html))throw Error('LEAVE_DETAIL_INVALID');
 const scripts=$('script').map((_,e)=>$(e).html()??'').get().join('\n');
 const declared=[...scripts.matchAll(/^\s*var details = (\{.*\});\s*$/gm)];if(declared.length!==1)throw Error('LEAVE_DETAIL_INVALID');
 const days=Object.entries(parseJson(declared[0]![1]!,z.record(z.string(),z.array(detailRow).max(14))));if(days.length!==1)throw Error('LEAVE_DETAIL_INVALID');
 const date=leaveDateSchema.parse(days[0]![0]);
 const tuples=days[0]![1].filter(r=>r.checked==='1').map(r=>[r.ccid,r.sec] as [number,number]);if(!tuples.length)throw Error('LEAVE_DETAIL_INVALID');
 const assigned:Record<string,string>={};
 for(const m of scripts.matchAll(/^\s*\$\(':input\[name="(an_type|reason)"\]'\)\.val\('([^'\\]*)'\);\s*$/gm)){if(assigned[m[1]!]!==undefined)throw Error('LEAVE_DETAIL_INVALID');assigned[m[1]!]=m[2]!;}
 const code=assigned.an_type??'';if(!/^\d+$/.test(code)||assigned.reason===undefined)throw Error('LEAVE_DETAIL_INVALID');
 const type=$(`select[name="an_type"] option[value="${code}"]`);if(type.length!==1)throw Error('LEAVE_DETAIL_INVALID');
 return {date,tuples,type:type.text().trim(),reason:assigned.reason.trim()};
}
