import {loadBuffer,load} from 'cheerio';
import {SCHOOL} from '../../constants/school.js';
import {SchoolError} from '../../utils/school-error.js';
import {schoolUrl} from '../../utils/school-url.js';
export function schoolHtml(body:Buffer,contentType:string):string{
 if(!/^text\/html\b/i.test(contentType))throw new SchoolError('SCHOOL_HTML_REQUIRED');
 const charset=contentType.match(/charset\s*=\s*["']?([^\s;"']+)/i)?.[1];
 return loadBuffer(body,{encoding:{transportLayerEncodingLabel:charset}}).html();
}
export function loginTokens(html:string):Record<string,string>{
 const $=load(html);const view=$('input[name="__VIEWSTATE"]').attr('value');
 if(!view)throw new SchoolError('SCHOOL_LOGIN_PAGE_CHANGED');
 const result:Record<string,string>={__VIEWSTATE:view};
 for(const key of ['__EVENTVALIDATION','__VIEWSTATEGENERATOR']){const value=$(`input[name="${key}"]`).attr('value');if(value)result[key]=value;}
 return result;
}
export function portalLoginPage(html:string):boolean{return /name=["']ctl00\$ContentPlaceHolder1\$(Account|Password|ValidationCode)["']/i.test(html);}
export function loginOutcome(html:string):{kind:'success';aisUrl:string}|{kind:'captcha'|'credentials'|'locked'|'unknown'}{
 const $=load(html),text=$.text();
 if(/帳號(?:已被|已|被)(?:鎖定|停用)|登入失敗次數過多|too many (?:login )?attempts|account (?:is )?(?:locked|disabled)/i.test(text))return {kind:'locked'};
 if(/帳號(?:或)?(?:密碼|\/密碼)錯誤|帳號或密碼不正確|invalid (?:account|password)|account or password/i.test(text))return {kind:'credentials'};
 if(/驗證碼(?:輸入)?(?:錯誤|不正確)|(?:invalid|incorrect) (?:validation code|captcha)/i.test(text))return {kind:'captcha'};
 const links=$('a').filter((_,a)=>$(a).text().includes('學生管理系統')).map((_,a)=>$(a).attr('href')).get();
 if(links.length&&!portalLoginPage(html)){
  // The old portal can list legacy student systems before the current AIS entry.
  // Prefer the actual target system over a similarly named legacy bridge.
  const candidates=links.flatMap(link=>{try{return [new URL(link,SCHOOL.login)];}catch{return [];}});
  const selected=candidates.find(url=>url.origin==='https://ais.nutc.edu.tw'&&!url.username&&!url.password)
   ??candidates.find(url=>SCHOOL.studentEntryOrigins.has(url.origin)&&!url.username&&!url.password);
  if(!selected)throw new SchoolError('SCHOOL_AIS_LINK_DENIED');
  return {kind:'success',aisUrl:schoolUrl(selected.href).href};
 }
 return {kind:'unknown'};
}
export function assertStudentPage(html:string){
 if(portalLoginPage(html)||/請先登入|\/student\/Login.aspx|window\.top\.location/i.test(html))throw new SchoolError('SCHOOL_SESSION_EXPIRED');
 if(!load(html)('table.grid_view').length)throw new SchoolError('SCHOOL_PAGE_CHANGED');
}
