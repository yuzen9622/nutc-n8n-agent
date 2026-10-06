import type {LineProvider} from '../line/line.provider.js';
import type {BindingRepository} from './binding.repository.js';
import type {SchoolProvider} from './school.provider.js';
import {Fault} from '../../utils/fault.js';
export class BindingService {
 constructor(private readonly repository:Pick<BindingRepository,'issue'|'authorize'>,private readonly line:Pick<LineProvider,'verifyIdentity'>,private readonly school?:Pick<SchoolProvider,'bind'>){}
 async identity(idToken:string){return this.repository.issue(await this.line.verifyIdentity(idToken));}
 async bind(token:string,csrf:string,account:string,password:string){
  const owner=await this.repository.authorize(token,csrf);
  if(!this.school)throw new Fault(503,'SCHOOL_NOT_CONFIGURED');
  await this.school.bind(owner,account,password);
  // A revoked or rotated browser session cannot report a late binding as successful.
  await this.repository.authorize(token,csrf);
 }
}
