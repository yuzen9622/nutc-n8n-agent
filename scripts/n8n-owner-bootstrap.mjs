import {readFileSync, rmSync, writeFileSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import {pathToFileURL} from 'node:url';

export const OWNER_ORIGIN = 'http://127.0.0.1:5678';
export const READY_MARKER = '/tmp/campus-n8n-owner-ready';
// Non-secret marker on the persistent n8n volume: survives container restarts so a POST is never blindly resent.
export const ATTEMPT_MARKER = '/home/node/.n8n/.campus-owner-setup-attempt';
export const ERROR_CODES = Object.freeze([
  'N8N_OWNER_ENV_REQUIRED',
  'N8N_OWNER_SETTINGS_INVALID',
  'N8N_OWNER_SETUP_FAILED',
  'N8N_OWNER_SETUP_REVIEW_REQUIRED',
  'N8N_OWNER_BOOTSTRAP_TIMEOUT',
  'N8N_OWNER_BOOTSTRAP_ABORTED',
  'N8N_OWNER_BOOTSTRAP_FAILED',
]);
const BOOTSTRAP_DEADLINE_MS = 300_000;
const REQUEST_TIMEOUT_MS = 3_000;
const HEALTH_TIMEOUT_MS = 1_500;
const RETRY_DELAY_MS = 500;

export class OwnerBootstrapError extends Error {
  constructor(code) {
    super(code);
    this.name = 'OwnerBootstrapError';
    this.code = code;
  }
}

export function safeErrorCode(error) {
  return error instanceof OwnerBootstrapError && ERROR_CODES.includes(error.code)
    ? error.code
    : 'N8N_OWNER_BOOTSTRAP_FAILED';
}

function discard(response) {
  try {
    void response?.body?.cancel?.().catch(() => {});
  } catch {
    // The body is intentionally never consumed.
  }
}

// Races the request against its abort signal so a non-cooperative fetch cannot hang bootstrap.
async function send(fetchImpl, path, init, timeoutMs, outerSignal) {
  const signal = outerSignal
    ? AbortSignal.any([outerSignal, AbortSignal.timeout(timeoutMs)])
    : AbortSignal.timeout(timeoutMs);
  let onAbort;
  const aborted = new Promise((_, reject) => {
    onAbort = () => reject(new Error('aborted'));
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, {once: true});
  });
  try {
    return await Promise.race([
      fetchImpl(`${OWNER_ORIGIN}${path}`, {...init, redirect: 'error', signal}),
      aborted,
    ]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

async function settingsFlag(fetchImpl, timeoutMs, signal) {
  let response;
  try {
    response = await send(fetchImpl, '/rest/settings', {method: 'GET'}, timeoutMs, signal);
    if (!response.ok) {
      discard(response);
      throw 0;
    }
    const flag = (await response.json())?.data?.userManagement?.showSetupOnFirstLoad;
    if (typeof flag !== 'boolean') throw 0;
    return flag;
  } catch {
    if (signal?.aborted) throw new OwnerBootstrapError('N8N_OWNER_BOOTSTRAP_ABORTED');
    throw new OwnerBootstrapError('N8N_OWNER_SETTINGS_INVALID');
  }
}

// Atomic exclusive create; resolves false when an earlier attempt already left the marker.
function claimAttemptMarker() {
  try {
    writeFileSync(ATTEMPT_MARKER, 'attempted', {flag: 'wx', mode: 0o600});
    return true;
  } catch (error) {
    if (error?.code === 'EEXIST') return false;
    throw error;
  }
}

function clearAttemptMarker() {
  rmSync(ATTEMPT_MARKER, {force: true});
}

export async function bootstrapOwner({
  env = process.env,
  fetch: fetchImpl = globalThis.fetch,
  sleep = (ms, signal) => delay(ms, undefined, {signal}),
  now = Date.now,
  signal,
  claimAttempt = claimAttemptMarker,
  clearAttempt = clearAttemptMarker,
} = {}) {
  const deadline = now() + BOOTSTRAP_DEADLINE_MS;
  const checkpoint = () => {
    if (signal?.aborted) throw new OwnerBootstrapError('N8N_OWNER_BOOTSTRAP_ABORTED');
    if (now() >= deadline) throw new OwnerBootstrapError('N8N_OWNER_BOOTSTRAP_TIMEOUT');
  };
  const pause = async () => {
    try {
      await sleep(RETRY_DELAY_MS, signal);
    } catch {
      if (signal?.aborted) throw new OwnerBootstrapError('N8N_OWNER_BOOTSTRAP_ABORTED');
      throw new OwnerBootstrapError('N8N_OWNER_BOOTSTRAP_FAILED');
    }
  };
  try {
    for (;;) {
      checkpoint();
      try {
        const ready = await send(fetchImpl, '/healthz/readiness', {method: 'GET'}, REQUEST_TIMEOUT_MS, signal);
        discard(ready);
        if (ready.ok) break;
      } catch {
        // n8n is still starting; retry within the deadline.
      }
      checkpoint();
      await pause();
    }

    if (!(await settingsFlag(fetchImpl, REQUEST_TIMEOUT_MS, signal))) {
      // Owner exists (possibly from an attempt whose response was lost): the stale marker is safe to drop.
      clearAttempt();
      return 'existing';
    }

    const email = env.N8N_OWNER_EMAIL;
    const password = env.N8N_OWNER_PASSWORD;
    if (typeof email !== 'string' || !email || typeof password !== 'string' || !password) {
      throw new OwnerBootstrapError('N8N_OWNER_ENV_REQUIRED');
    }
    checkpoint();
    // Claim before the only POST. A surviving marker with the flag still true means an earlier
    // attempt (this or a previous container run) has an unknown outcome: never resend.
    if (!claimAttempt()) throw new OwnerBootstrapError('N8N_OWNER_SETUP_REVIEW_REQUIRED');
    try {
      const response = await send(fetchImpl, '/rest/owner/setup', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({email, password, firstName: 'Campus', lastName: 'Local'}),
      }, REQUEST_TIMEOUT_MS, signal);
      discard(response);
      if (!response.ok) throw 0;
    } catch {
      if (signal?.aborted) throw new OwnerBootstrapError('N8N_OWNER_BOOTSTRAP_ABORTED');
      throw new OwnerBootstrapError('N8N_OWNER_SETUP_FAILED');
    }

    for (;;) {
      checkpoint();
      if (!(await settingsFlag(fetchImpl, REQUEST_TIMEOUT_MS, signal))) {
        clearAttempt();
        return 'created';
      }
      checkpoint();
      await pause();
    }
  } catch (error) {
    throw new OwnerBootstrapError(safeErrorCode(error));
  }
}

export async function checkOwnerHealth({
  fetch: fetchImpl = globalThis.fetch,
  readMarker = () => readFileSync(READY_MARKER, 'utf8'),
} = {}) {
  try {
    if (readMarker() !== 'ready') return false;
    const ready = await send(fetchImpl, '/healthz/readiness', {method: 'GET'}, HEALTH_TIMEOUT_MS);
    discard(ready);
    if (!ready.ok) return false;
    return (await settingsFlag(fetchImpl, HEALTH_TIMEOUT_MS)) === false;
  } catch {
    return false;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  process.exit(args.length === 1 && args[0] === '--healthcheck' && (await checkOwnerHealth()) ? 0 : 1);
}
