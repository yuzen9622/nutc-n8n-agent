import type {IncomingMessage,ServerResponse} from 'node:http';
import type {SchoolService} from './school.service.js';
import {schoolLoginSchema,schoolQuerySchema} from './school.schema.js';
import {leaveRpcSchema} from '../../../../shared/leave-contract.js';
import type {LeaveService} from './leave.service.js';
import {body,reply} from '../../utils/http.js';
export class SchoolController {
 constructor(private readonly service:SchoolService,private readonly leaves?:LeaveService){}
 async leave(req:IncomingMessage,res:ServerResponse){const input=leaveRpcSchema.parse(await body(req));if(!this.leaves)throw Error('LEAVE_UNAVAILABLE');reply(res,200,{data:input.operation==='preview'?await this.leaves.preview(input.auth,input.intent):await this.leaves.confirm(input.auth)});}
 async login(req:IncomingMessage,res:ServerResponse){const input=schoolLoginSchema.parse(await body(req));reply(res,200,{data:await this.service.login(input.userId,input.account,input.password)});}
 async query(req:IncomingMessage,res:ServerResponse){const input=schoolQuerySchema.parse(await body(req));reply(res,200,{data:await this.service.query(input.userId,input.action,input.params)});}
}
