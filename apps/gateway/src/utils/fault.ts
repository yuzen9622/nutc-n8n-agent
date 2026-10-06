export class Fault extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}
