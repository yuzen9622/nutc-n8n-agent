import type {IncomingMessage,ServerResponse} from 'node:http';
import {SchoolError} from './school-error.js';
export function reply(res:ServerResponse,status:number,value:unknown){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));}
export async function body(req:IncomingMessage):Promise<unknown>{
 if(!req.headers['content-type']?.startsWith('application/json'))throw new SchoolError('JSON_REQUIRED');
 const chunks:Buffer[]=[];let length=0;
 for await(const chunk of req){const part=Buffer.from(chunk);length+=part.length;if(length>8192)throw new SchoolError('REQUEST_TOO_LARGE');chunks.push(part);}
 return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
