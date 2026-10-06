import {assertCaptchaImage} from './captcha.parse.js';
import {randomInt} from 'node:crypto';
import {SCHOOL} from '../../constants/school.js';
import {SchoolError} from '../../utils/school-error.js';
import {schoolUrl} from '../../utils/school-url.js';
import {SchoolClient} from './school.client.js';
import {assertStudentPage,loginOutcome,loginTokens,schoolHtml} from './login.parse.js';
import {eportalTokens,eportalOutcome,eportalNext,eportalAppAction} from './eportal.parse.js';
export type CaptchaReader=(image:Buffer,signal:AbortSignal)=>Promise<string>;
export class SchoolLoginService {
 constructor(private readonly recognize:CaptchaReader,private readonly createClient=()=>new SchoolClient(),private readonly entryUrl:string=SCHOOL.portalEntry){}
 async login(account:string,password:string,outerSignal?:AbortSignal):Promise<SchoolClient>{
  const deadline=AbortSignal.timeout(SCHOOL.loginDeadlineMs),signal=outerSignal?AbortSignal.any([deadline,outerSignal]):deadline;
  const client=this.createClient();
  try{
   const first=await client.fetch(this.entryUrl,signal),firstHtml=schoolHtml(first.body,first.contentType);
   if(!firstHtml.includes('__VIEWSTATE'))return await this.loginEportal(client,firstHtml,account,password,signal);
   // Retain the known legacy protocol for regression / a school rollback only.
   let tokens=loginTokens(firstHtml);
   for(let round=0;round<SCHOOL.maxCaptchaRounds;round++){
    signal.throwIfAborted();
    const image=await client.fetch(SCHOOL.captcha,signal);
    assertCaptchaImage(image.body,image.contentType);
    const captcha=(await this.recognize(image.body,signal)).trim();
    signal.throwIfAborted();
    // Invalid OCR never submits the student's password to the school.
    if(!/^[A-Za-z0-9]{5}$/.test(captcha))continue;
    const body=new URLSearchParams({...tokens,'ctl00$ContentPlaceHolder1$Account':account,'ctl00$ContentPlaceHolder1$Password':password,'ctl00$ContentPlaceHolder1$ValidationCode':captcha,'ctl00$ContentPlaceHolder1$Login.x':String(randomInt(0,50)),'ctl00$ContentPlaceHolder1$Login.y':String(randomInt(0,50))});
    const response=await client.fetch(SCHOOL.login,signal,body),html=schoolHtml(response.body,response.contentType),outcome=loginOutcome(html);
    if(outcome.kind==='credentials')throw new SchoolError('SCHOOL_CREDENTIALS_REJECTED');
    if(outcome.kind==='locked')throw new SchoolError('SCHOOL_ACCOUNT_LOCKED');
    if(outcome.kind==='success'){
     const entry=await client.fetch(outcome.aisUrl,signal);
     const home=await client.fetch(SCHOOL.home,signal),homeHtml=schoolHtml(home.body,home.contentType);
     // Origin and structural booleans only; never tickets, query strings or student HTML.
     console.info(JSON.stringify({event:'school_login_route',entryOrigin:new URL(outcome.aisUrl).origin,landingOrigin:new URL(entry.url).origin,homeOrigin:new URL(home.url).origin,hasGrid:/class=["'][^"']*grid_view/.test(homeHtml),hasLoginRedirect:/window\.top\.location|\/student\/Login.aspx/i.test(homeHtml)}));
     assertStudentPage(homeHtml);
     return client;
    }
    if(outcome.kind!=='captcha')throw new SchoolError('SCHOOL_LOGIN_UNCONFIRMED');
    if(round+1<SCHOOL.maxCaptchaRounds)tokens=loginTokens(html);
   }
   throw new SchoolError('SCHOOL_CAPTCHA_FAILED');
  }catch(error){await client.jar.removeAllCookies();if(error instanceof SchoolError)throw error;throw new SchoolError(signal.aborted?'SCHOOL_TIMEOUT':'SCHOOL_UNAVAILABLE');}
 }
 private async loginEportal(client:SchoolClient,html:string,account:string,password:string,signal:AbortSignal):Promise<SchoolClient>{
  let tokens=eportalTokens(html);
  for(let round=0;round<SCHOOL.maxCaptchaRounds;round++){
   signal.throwIfAborted();
   const image=await client.fetch(`${SCHOOL.portalCaptcha}?action=getCode&from=login&refresh=1&t=${Date.now()}`,signal);
   assertCaptchaImage(image.body,image.contentType);
   const captcha=(await this.recognize(image.body,signal)).trim();
   signal.throwIfAborted();if(!/^[A-Za-z0-9]{4}$/.test(captcha))continue;
   const verified=await client.fetch(SCHOOL.portalCaptcha,signal,new URLSearchParams({action:'verifyCode',from:'login',code:captcha}));
   const result=verified.body.toString('utf8');
   if(['error','expire','empty'].includes(result))continue;
   if(result!=='valid')throw new SchoolError('SCHOOL_LOGIN_UNCONFIRMED');
   const response=await client.fetch(SCHOOL.portalLogin,signal,new URLSearchParams({loginCheck:'1',app_id:tokens.appId,login_name:account,password,verify_code:captcha,fromAjax:'1'}),{csrfToken:tokens.csrfToken,referer:SCHOOL.portalEntry});
   const outcome=eportalOutcome(response.body,response.contentType);
   if(outcome.kind==='credentials')throw new SchoolError('SCHOOL_CREDENTIALS_REJECTED');
   if(outcome.kind==='locked')throw new SchoolError('SCHOOL_ACCOUNT_LOCKED');
   if(outcome.kind==='rejected')throw new SchoolError('SCHOOL_AUTHENTICATION_REJECTED');
   if(outcome.kind==='captcha'){
    if(round+1<SCHOOL.maxCaptchaRounds){const page=await client.fetch(SCHOOL.portalEntry,signal);tokens=eportalTokens(schoolHtml(page.body,page.contentType));}
    continue;
   }
   if(outcome.kind!=='success')throw new SchoolError('SCHOOL_LOGIN_UNCONFIRMED');
   const target=schoolUrl(outcome.url);
   if(target.origin!==SCHOOL.portalOrigin||target.pathname!=='/login_check.php')throw new SchoolError('SCHOOL_URL_DENIED');
   let entry=await client.fetch(target.href,signal);
   for(let hop=0;hop<4;hop++){
    const next=eportalNext(schoolHtml(entry.body,entry.contentType),entry.url);
    if(!next)break;
    entry=await client.fetch(next,signal);
   }
   // The dashboard's observed student module is NUTC_6401. Launch only that app.
   if(schoolUrl(entry.url).origin!==SCHOOL.portalOrigin||schoolUrl(entry.url).pathname!=='/redirect2app.php')throw new SchoolError('SCHOOL_LOGIN_UNCONFIRMED');
   const action=eportalAppAction(schoolHtml(entry.body,entry.contentType));
   const redirect=await client.fetch(`${SCHOOL.portalOrigin}/redirect2app.php`,signal,new URLSearchParams({action,app_id:SCHOOL.studentAppId}));
   const app=eportalOutcome(redirect.body,redirect.contentType);
   if(app.kind!=='success'||schoolUrl(app.url).origin!=='https://ais.nutc.edu.tw')throw new SchoolError('SCHOOL_LOGIN_UNCONFIRMED');
   await client.fetch(app.url,signal);
   const home=await client.fetch(SCHOOL.home,signal);assertStudentPage(schoolHtml(home.body,home.contentType));
   console.info(JSON.stringify({event:'school_login_confirmed',protocol:'eportal',aisHomeVerified:true}));
   return client;
  }
  throw new SchoolError('SCHOOL_CAPTCHA_FAILED');
 }
}
