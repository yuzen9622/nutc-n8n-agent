export type OwnerBootstrapResult='created'|'existing';
export interface OwnerFetchResponse {
  ok:boolean;
  body?:{cancel?:()=>Promise<void>}|null;
  json():Promise<unknown>;
}
export type OwnerFetch=(url:string,init:{method:string;headers?:Record<string,string>;body?:string;redirect:'error';signal:AbortSignal})=>Promise<OwnerFetchResponse>;
export interface BootstrapOwnerOptions {
  env?:Record<string,string|undefined>;
  fetch?:OwnerFetch;
  sleep?:(ms:number,signal?:AbortSignal)=>Promise<void>;
  now?:()=>number;
  signal?:AbortSignal;
  claimAttempt?:()=>boolean;
  clearAttempt?:()=>void;
}
export interface CheckOwnerHealthOptions {
  fetch?:OwnerFetch;
  readMarker?:()=>string;
}
export const OWNER_ORIGIN:string;
export const READY_MARKER:string;
export const ATTEMPT_MARKER:string;
export const ERROR_CODES:readonly string[];
export class OwnerBootstrapError extends Error {code:string;constructor(code:string);}
export function safeErrorCode(error:unknown):string;
export function bootstrapOwner(options?:BootstrapOwnerOptions):Promise<OwnerBootstrapResult>;
export function checkOwnerHealth(options?:CheckOwnerHealthOptions):Promise<boolean>;
