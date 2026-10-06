export const PREFIX = '/internal/v1';
export const BODY_LIMIT = 16_384;
export const TASK_TTL_MS = 90_000;
export const RETENTION_MS = 86_400_000;
export const HTTP = { OK: 200, BAD_REQUEST: 400, UNAUTHORIZED: 401, FORBIDDEN: 403, NOT_FOUND: 404, CONFLICT: 409, TOO_LARGE: 413, INTERNAL: 500, UPSTREAM: 502 } as const;
export class Fault extends Error {
  constructor(public status: number, public code: string) { super(code); }
}
