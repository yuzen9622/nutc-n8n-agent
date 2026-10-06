import {SchoolError} from '../../utils/school-error.js';
import {SCHOOL} from '../../constants/school.js';
export function assertCaptchaImage(body:Buffer,contentType:string){
 const mime=contentType.split(';')[0]?.trim().toLowerCase();
 // NUTC currently sends the non-standard "images/jpg" MIME; require JPEG bytes.
 const jpeg=body[0]===0xff && body[1]===0xd8 && body[2]===0xff;
 const png=body.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
 const gif=/^GIF8[79]a$/.test(body.subarray(0,6).toString('ascii'));
 if(body.length>SCHOOL.captchaLimit || !((jpeg && ['image/jpeg','image/jpg','images/jpg'].includes(mime??''))||(png && mime==='image/png')||(gif && mime==='image/gif')))throw new SchoolError('SCHOOL_CAPTCHA_INVALID');
}
