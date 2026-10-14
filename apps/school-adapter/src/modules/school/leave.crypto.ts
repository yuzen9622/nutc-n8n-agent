import {hkdfSync,randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
export type LeaveBinding={user_id:string;generation:string;school_session_id:string;origin_task_id:string;id:string};
export class LeaveCrypto {
 private readonly key:Buffer;
 constructor(secret:string){if(!/^[a-f0-9]{64}$/i.test(secret))throw Error('LEAVE_KEY_INVALID');this.key=Buffer.from(hkdfSync('sha256',Buffer.from(secret,'hex'),Buffer.alloc(0),'campus-leave:v1',32));}
 private aad(b:LeaveBinding,field:string){return Buffer.from(`leave:v1:${b.user_id}:${b.generation}:${b.school_session_id}:${b.origin_task_id}:${b.id}:${field}`);}
 seal(text:string,b:LeaveBinding,field:string){const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',this.key,iv);c.setAAD(this.aad(b,field));const data=Buffer.concat([c.update(text,'utf8'),c.final()]);return ['v1',iv.toString('base64url'),c.getAuthTag().toString('base64url'),data.toString('base64url')].join('.');}
 open(text:string,b:LeaveBinding,field:string){try{const [version,iv,tag,data,...rest]=text.split('.');if(version!=='v1'||rest.length||!iv||!tag||!data)throw Error();const i=Buffer.from(iv,'base64url'),t=Buffer.from(tag,'base64url');if(i.length!==12||t.length!==16)throw Error();const c=createDecipheriv('aes-256-gcm',this.key,i);c.setAAD(this.aad(b,field));c.setAuthTag(t);return Buffer.concat([c.update(Buffer.from(data,'base64url')),c.final()]).toString('utf8');}catch{throw Error('LEAVE_CONTENT_UNAVAILABLE');}}
}
