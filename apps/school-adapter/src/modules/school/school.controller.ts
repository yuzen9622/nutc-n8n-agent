import type {IncomingMessage,ServerResponse} from 'node:http';
import type {SchoolService} from './school.service.js';
import {schoolLoginSchema,schoolQuerySchema} from './school.schema.js';
import {body,reply} from '../../utils/http.js';
export class SchoolController {
 constructor(private readonly service:SchoolService){}
 async login(req:IncomingMessage,res:ServerResponse){const input=schoolLoginSchema.parse(await body(req));reply(res,200,{data:await this.service.login(input.userId,input.account,input.password)});}
 async query(req:IncomingMessage,res:ServerResponse){const input=schoolQuerySchema.parse(await body(req));reply(res,200,{data:await this.service.query(input.userId,input.action,input.params)});}
}
