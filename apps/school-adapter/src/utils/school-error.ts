export type SchoolUrlDiagnostic={reason:'malformed'|'origin'|'userinfo'|'length';protocol:'http:'|'https:'|'other';host:string};
export class SchoolError extends Error {
  constructor(readonly code:string,readonly urlDiagnostic?:SchoolUrlDiagnostic){super(code);this.name='SchoolError';}
}
