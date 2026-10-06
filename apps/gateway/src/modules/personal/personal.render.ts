import type {PersonalData} from './personal.schema.js';
// School text is rendered locally. Nothing from these fields reaches the Agent.
const clean=(text:string)=>text.replace(/[\u0000-\u001f\u007f]/g,' ').trim();
export function renderPersonal(data:PersonalData){
 const title={schedule:'我的課表',absence:'我的缺曠紀錄',announcements:'校務公告'}[data.kind];
 if(!data.items.length)return `${title}\n校務系統目前沒有此項紀錄。`;
 const lines=data.kind==='schedule'?data.items.map(item=>`週${'一二三四五六日'[item.weekday-1]} ${clean(item.startTime)}–${clean(item.endTime)} ${clean(item.title)}${item.classroom?'｜'+clean(item.classroom):''}`)
  :data.kind==='absence'?data.items.map(item=>`${clean(item.courseName)}：${clean(item.absence)}${item.absenceDetail.length?'（'+item.absenceDetail.map(clean).join('；')+'）':''}`)
  :data.items.map(item=>`${clean(item.title)}｜${clean(item.publisher)}`);
 let result=title;let count=0;
 for(const line of lines){if(result.length+line.length+1>1250)break;result+='\n'+line;count++;}
 if(count<lines.length)result+='\n內容較多，完整紀錄請至校務系統查看。';
 return result;
}
