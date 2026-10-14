import {LEAVE_AMBIGUOUS,LEAVE_FALLBACK,type LeaveReceipt} from '../../../../shared/leave-contract.js';
import type {PersonalData} from './personal.schema.js';
// School text is rendered locally. Nothing from these fields reaches the Agent.
const clean=(text:string)=>text.replace(/[\u0000-\u001f\u007f]/g,' ').trim();

function formatList(title:string,lines:string[],emptyMsg='校務系統目前沒有此項紀錄。'):string{
 if(!lines.length)return `${title}\n${emptyMsg}`;
 let result=title;let count=0;
 for(const line of lines){if(result.length+line.length+1>1250)break;result+='\n'+line;count++;}
 if(count<lines.length)result+='\n內容較多，完整紀錄請至校務系統查看。';
 return result;
}

export function renderLeaveOutcome(receipt:LeaveReceipt):string{
 if(receipt.state==='pending'){
  if(!receipt.date||!receipt.leaveType||!receipt.reason||!receipt.courses?.length)throw Error('LEAVE_RECEIPT_INVALID');
  const reply=`請假預覽｜尚未送出\n日期：${receipt.date}\n${receipt.courses.map(c=>`第${c.period}節｜${clean(c.name)}`).join('\n')}\n假別：${clean(receipt.leaveType)}\n事由：${clean(receipt.reason)}\n請於下一則訊息只回覆「確認送出」`;
  if(reply.length>4500)throw Error('LEAVE_RECEIPT_TOO_LONG');return reply;
 }
 if(receipt.state==='succeeded')return '請假申請已送出，已確認校務後台新增對應紀錄；尚待老師與生輔組審核。';
 if(receipt.state==='ambiguous')return LEAVE_AMBIGUOUS;
 if(receipt.state==='rejected')return '校務系統拒絕本次申請，未確認新增紀錄；系統不會自動再次送出。';
 if(receipt.state==='need_selection')return '當天實際可請假課程無法唯一符合要求，尚未送出。請指定實際節次後重新取得預覽。'+(receipt.courses?.length?'\n'+receipt.courses.map(c=>`第${c.period}節｜${clean(c.name)}`).join('\n'):'');
 if(receipt.state==='validation')return '請假資料或校務回應無法驗證，尚未送出。請檢查日期、假別、事由與節次。';
 if(['expired','cancelled','consumed'].includes(receipt.state))return '沒有可確認的有效預覽，或已消耗；本次未再次送出。請至校務後台核對。';
 return LEAVE_FALLBACK;
}
export function renderPersonal(data:PersonalData):string{
 if(data.kind==='schedule'){
  const lines=data.items.map(item=>`週${'一二三四五六日'[item.weekday-1]} ${clean(item.startTime)}–${clean(item.endTime)} ${clean(item.title)}${item.classroom?'｜'+clean(item.classroom):''}`);
  return formatList('我的課表',lines);
 }
 if(data.kind==='absence'){
  const lines=data.items.map(item=>`${clean(item.courseName)}：${clean(item.absence)}${item.absenceDetail.length?'（'+item.absenceDetail.map(clean).join('；')+'）':''}`);
  return formatList('我的缺曠紀錄',lines);
 }
 if(data.kind==='announcements'){
  const lines=data.items.map(item=>`${clean(item.title)}｜${clean(item.publisher)}`);
  return formatList('校務公告',lines);
 }
 if(data.kind==='grades'){
  const title=`我的成績${data.semester?'（'+clean(data.semester)+'學期）':''}`;
  const lines:string[]=[];
  if(data.totalScore!==null&&data.totalScore!==undefined)lines.push(`學期平均：${data.totalScore}分`);
  if(data.conductScore&&data.conductScore!=='無成績'&&data.conductScore!=='----')lines.push(`操行成績：${clean(data.conductScore)}`);
  if(data.classRank!==null&&data.classRank!==undefined)lines.push(`班級排名：第${data.classRank}名`);
  for(const item of data.items){
   const scoreText=item.score&&item.score!=='-1'&&item.score!=='無成績'&&item.score!=='----'?`${clean(item.score)}分`:'尚無成績';
   lines.push(`${clean(item.name)}：${scoreText}（${item.credits}學分｜${clean(item.type)}）`);
  }
  if(data.availableSemesters?.length){
   lines.push(`可查詢學期：${data.availableSemesters.join('、')}`);
  }
  return formatList(title,lines,'校務系統目前沒有成績紀錄。');
 }
 if(data.kind==='leave_notes'){
  const lines=data.items.map(item=>`[${clean(item.type)}] ${clean(item.courseInfo)}｜事由：${clean(item.reason)}｜審核：導師[${clean(item.teacherStatus)}] 生輔組[${clean(item.finalStatus)}]`);
  return formatList('我的請假紀錄',lines,'目前沒有請假紀錄。');
 }
 if(data.kind==='leave_apply')return '請先取得請假預覽，再於下一則訊息確認。';
 if(data.kind==='send_mail'){
  if(!data.success)return `信件發送失敗\n${clean(data.message)}`;
  return `信件發送成功\n收件人：${clean(data.details.to)}\n主旨：${clean(data.details.subject)}\n已成功透過學校 Webmail 發送。`;
 }
 return '校務系統目前沒有此項紀錄。';
}
