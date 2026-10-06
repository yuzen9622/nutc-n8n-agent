import {writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {SchoolClient} from '../dist/apps/school-adapter/src/modules/school/school.client.js';
import {loginTokens,loginOutcome,schoolHtml,portalLoginPage} from '../dist/apps/school-adapter/src/modules/school/login.parse.js';
import {assertCaptchaImage} from '../dist/apps/school-adapter/src/modules/school/captcha.parse.js';
import {LocalOcr} from '../dist/apps/school-adapter/src/modules/school/ocr.provider.js';
import {SCHOOL} from '../dist/apps/school-adapter/src/constants/school.js';
const client=new SchoolClient(),started=Date.now(),signal=AbortSignal.timeout(30_000);
const report={checkedAt:new Date().toISOString(),accountSubmitted:false,passwordSubmitted:false,schoolLoginPost:false};
try{
 const page=await client.fetch(SCHOOL.login,signal),html=schoolHtml(page.body,page.contentType);
 assert(portalLoginPage(html));assert(loginTokens(html).__VIEWSTATE);assert.equal(loginOutcome(html).kind,'unknown');
 report.loginForm=true;
 const image=await client.fetch(SCHOOL.captcha,signal);report.captchaContentType=image.contentType;assertCaptchaImage(image.body,image.contentType);
 const code=await new LocalOcr().recognize(image.body,signal);
 report.localOcrFiveCharacters=/^[A-Za-z0-9]{5}$/.test(code);
 report.ocrCorrectness='not-submitted; format only';
 report.status=report.localOcrFiveCharacters?'pass':'ocr-format-rejected';
}catch(error){report.status='failed';report.code=/^[A-Z_]+$/.test(error?.message??'')?error.message:'SMOKE_FAILED';process.exitCode=1;}
finally{await client.jar.removeAllCookies();report.elapsedMs=Date.now()-started;writeFileSync('docs/verification/school-anonymous.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));}
