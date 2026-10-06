import {load} from 'cheerio';
import {SCHOOL} from '../../constants/school.js';
import {SchoolError} from '../../utils/school-error.js';
import {schoolUrl} from '../../utils/school-url.js';

export function eportalTokens(html:string):{csrfToken:string;appId:string}{
 const $=load(html),csrfToken=$('meta[name="csrf-token"]').attr('content'),appId=$('#loginForm input[name="app_id"]').attr('value');
 if(!csrfToken||csrfToken.length>512||/[\r\n]/.test(csrfToken)||appId!==SCHOOL.studentAppId||!$('#loginForm input[name="login_name"]').length||!$('#loginForm input[name="password"]').length||!$('#loginForm input[name="verify_code"]').length)throw new SchoolError('SCHOOL_LOGIN_PAGE_CHANGED');
 return {csrfToken,appId};
}
export function eportalOutcome(body:Buffer,contentType:string):{kind:'success';url:string}|{kind:'captcha'|'credentials'|'locked'|'rejected'}{
 if(!/^application\/json\b/i.test(contentType))throw new SchoolError('SCHOOL_LOGIN_UNCONFIRMED');
 let data:unknown;try{data=JSON.parse(body.toString('utf8'));}catch{throw new SchoolError('SCHOOL_LOGIN_UNCONFIRMED');}
 if(!data||typeof data!=='object'||!('error' in data))throw new SchoolError('SCHOOL_LOGIN_UNCONFIRMED');
 const record=data as Record<string,unknown>;
 if(record.error===0&&typeof record.url==='string')return {kind:'success',url:schoolUrl(new URL(record.url,SCHOOL.portalOrigin).href).href};
 const message=typeof record.err_msg==='string'?record.err_msg:'';
 if(/帳號(?:已被|已|被)(?:鎖定|停用)|登入失敗次數過多|account (?:is )?(?:locked|disabled)/i.test(message))return {kind:'locked'};
 // Official login.php maps 2 to the account field, 3 to password and 4 to
 // captcha. Codes, rather than locale-dependent wording, drive classification.
 if(record.error===4)return {kind:'captcha'};
 if(record.error===2||record.error===3)return {kind:'credentials'};
 // 999999 asks the browser to reload (session/CSRF failure). Malformed replies
 // stay technical; other explicit nonzero login errors get a separate bounded
 // rejection counter, without asserting that the student's password is wrong.
 if(Number.isInteger(record.error)&&Number(record.error)>0&&record.error!==999999)return {kind:'rejected'};
 throw new SchoolError('SCHOOL_LOGIN_UNCONFIRMED');
}

// Decode only escaped slashes used by the official page, never evaluate school JS.
// This handler is limited to the observed authentication pages, not arbitrary HTML.
export function eportalNext(html:string,currentUrl:string):string|undefined{
 const current=schoolUrl(currentUrl);
 if(current.origin!==SCHOOL.portalOrigin||!['/login_check.php','/login_main.php'].includes(current.pathname))return;
 const $=load(html),script=$('script:not([src])').filter((_,e)=>!$(e).attr('type')).text();
 const routes=[...script.matchAll(/window\.location(?:\.href)?\s*=\s*(["'])([^"'\r\n]+)\1\s*;/g)];
 if(routes.length!==1)throw new SchoolError('SCHOOL_LOGIN_UNCONFIRMED');
 const next=schoolUrl(new URL(routes[0]![2]!.replace(/\\\//g,'/'),current).href);
 if(next.origin!==SCHOOL.portalOrigin||!['/token_auth.php','/redirect2app.php','/nutc_dashboard/'].includes(next.pathname))throw new SchoolError('SCHOOL_URL_DENIED');
 return next.href;
}
export function eportalAppAction(html:string):string{
 const $=load(html),scripts=$('script:not([src])').text();
 const action=scripts.match(/action\s*:\s*["']([A-Za-z_]{1,30})["']/)?.[1];
 const appId=scripts.match(/app_id\s*:\s*["']([^"']+)["']/)?.[1];
 if(action!=='get_redirect_url'||appId!==SCHOOL.studentAppId||!scripts.includes('/redirect2app.php'))throw new SchoolError('SCHOOL_LOGIN_UNCONFIRMED');
 return action;
}
