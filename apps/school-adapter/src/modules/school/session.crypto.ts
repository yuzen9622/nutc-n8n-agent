import {createCipheriv,createDecipheriv,createHmac,randomBytes} from 'node:crypto';
import {SchoolError} from '../../utils/school-error.js';
export class SessionCrypto {
 private readonly key:Buffer;
 constructor(key:string,private readonly accountKey:string){
  if(!/^[a-f0-9]{64}$/i.test(key)||accountKey.length<32||key===accountKey)throw new SchoolError('SCHOOL_CRYPTO_CONFIG_INVALID');
  this.key=Buffer.from(key,'hex');
 }
 accountHash(account:string){return createHmac('sha256',this.accountKey).update(account.toLowerCase()).digest('hex');}
 seal(value:string,owner:string,id:string):string{
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.key,iv);cipher.setAAD(Buffer.from(`school-session:v1:${owner}:${id}`));
  const ciphertext=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);
  return ['v1',iv.toString('base64url'),cipher.getAuthTag().toString('base64url'),ciphertext.toString('base64url')].join('.');
 }
 open(value:string,owner:string,id:string):string{
  try{
   const parts=value.split('.');if(parts.length!==4||parts[0]!=='v1')throw Error();
   const iv=Buffer.from(parts[1]!,'base64url'),tag=Buffer.from(parts[2]!,'base64url');if(iv.length!==12||tag.length!==16)throw Error();
   const decipher=createDecipheriv('aes-256-gcm',this.key,iv);decipher.setAAD(Buffer.from(`school-session:v1:${owner}:${id}`));decipher.setAuthTag(tag);
   return Buffer.concat([decipher.update(Buffer.from(parts[3]!,'base64url')),decipher.final()]).toString('utf8');
  }catch{throw new SchoolError('SCHOOL_SESSION_INVALID');}
 }
}
