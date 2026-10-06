import type { IncomingMessage, ServerResponse } from 'node:http';
import { Fault } from '../../utils/fault.js';
import { json, readRaw } from '../../utils/http.js';
import { verifySignature } from './line.provider.js';
import { webhookSchema, identitySchema } from './line.schema.js';
import type { LineService } from './line.service.js';

export class LineController {
  constructor(private readonly service: LineService, private readonly secret: string, private readonly destination: string, private readonly publicOrigin?:string) {}
  async webhook(req: IncomingMessage, res: ServerResponse) {
    const raw = await readRaw(req), signature = req.headers['x-line-signature'];
    if (!verifySignature(raw,typeof signature === 'string' ? signature : undefined,this.secret)) throw new Fault(401,'INVALID_SIGNATURE');
    const body = webhookSchema.parse(JSON.parse(raw.toString('utf8')));
    if (body.destination !== this.destination) throw new Fault(403,'DESTINATION_DENIED');
    await this.service.receive(body.events);
    json(res,200,{ accepted:true });
  }
  async identity(req: IncomingMessage, res: ServerResponse) {
    if(!this.publicOrigin) throw new Fault(503,'LIFF_NOT_CONFIGURED');
    if(req.headers.origin!==this.publicOrigin) throw new Fault(403,'ORIGIN_DENIED');
    if(!req.headers['content-type']?.startsWith('application/json')) throw new Fault(415,'JSON_REQUIRED');
    const body = identitySchema.parse(JSON.parse((await readRaw(req)).toString('utf8')));
    // Never trust client-submitted userId, decoded JWT claims, or liff.getProfile().
    await this.service.identity(body.idToken);
    json(res,200,{ verified:true });
  }
}
