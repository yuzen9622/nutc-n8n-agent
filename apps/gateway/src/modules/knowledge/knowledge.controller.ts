import {createHash,timingSafeEqual} from 'node:crypto';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {z} from 'zod';
import {readRaw,json} from '../../utils/http.js';
import {Fault} from '../../utils/fault.js';
import type {KnowledgeService} from './knowledge.service.js';
export class KnowledgeController {
  constructor(private readonly service:KnowledgeService,private readonly token:string){}
  async handle(path:'prepare'|'publish',req:IncomingMessage,res:ServerResponse){
    const value=req.headers['x-campus-service'],hash=(s:string)=>createHash('sha256').update(s).digest();
    if(typeof value!=='string'||!timingSafeEqual(hash(value),hash(this.token)))throw new Fault(401,'SERVICE_DENIED');
    const body=JSON.parse((await readRaw(req)).toString('utf8'));
    if(path==='prepare'){z.strictObject({}).parse(body);json(res,200,await this.service.prepare());}
    else {const {batchId}=z.strictObject({batchId:z.uuid()}).parse(body);json(res,200,await this.service.publish(batchId));}
  }
}
