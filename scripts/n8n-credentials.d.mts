export interface InternalCredential {
  id:string;
  name:string;
  type:string;
  data:Record<string,string|number>;
}
export function buildInternalCredentials(env:Record<string,string|undefined>):InternalCredential[];
