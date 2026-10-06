import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {SchoolClient} from '../dist/apps/school-adapter/src/modules/school/school.client.js';
import {SCHOOL} from '../dist/apps/school-adapter/src/constants/school.js';
import {assertCaptchaImage} from '../dist/apps/school-adapter/src/modules/school/captcha.parse.js';
const imageName='node:24.14.0-bookworm-slim@sha256:d8e448a56fc63242f70026718378bd4b00f8c82e78d20eefb199224a4d8e33d8';
const client=new SchoolClient(),signal=AbortSignal.timeout(10000),started=Date.now();
const report={checkedAt:new Date().toISOString(),image:imageName,containerNetwork:'none',accountSubmitted:false,passwordSubmitted:false,schoolLoginPost:false};
try{
 await client.fetch(SCHOOL.login,signal);
 const captcha=await client.fetch(SCHOOL.captcha,signal);assertCaptchaImage(captcha.body,captcha.contentType);
 // Only anonymous image bytes enter the isolated Linux process through stdin.
 // No .env, cookies, host home directory, student data or credentials are mounted.
 const source=`import {LocalOcr} from '/app/dist/apps/school-adapter/src/modules/school/ocr.provider.js';
const image=Buffer.from(${JSON.stringify(captcha.body.toString('base64'))},'base64');
try {const code=await new LocalOcr().recognize(image,AbortSignal.timeout(25000));console.log(JSON.stringify({platform:process.platform,arch:process.arch,fiveCharacters:/^[A-Za-z0-9]{5}$/.test(code)}));}catch(error){console.log(JSON.stringify({error:error.code??'OCR_FAILED'}));process.exitCode=1;}`;
 const output=execFileSync('docker',['run','--rm','-i','--network','none','--read-only','--memory','768m','--cpus','2','--cap-drop','ALL','--security-opt','no-new-privileges','--user','node','-v',`${resolve('dist')}:/app/dist:ro`,'-v',`${resolve('node_modules')}:/app/node_modules:ro`,'-w','/app',imageName,'node','--input-type=module'],{input:source,encoding:'utf8',timeout:30000,stdio:['pipe','pipe','pipe']});
 Object.assign(report,JSON.parse(output.trim()));report.status=report.fiveCharacters?'pass':'ocr-format-rejected';
}catch(error){report.status='failed';try{const result=JSON.parse(String(error.stdout??'').trim());if(/^[A-Z_]+$/.test(result.error??''))report.code=result.error;}catch{}process.exitCode=1;}
finally{await client.jar.removeAllCookies();report.elapsedMs=Date.now()-started;report.ocrCorrectness='not-submitted; format only';writeFileSync('docs/verification/school-ocr-linux.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));}
