import {spawn} from 'node:child_process';
import {rmSync, writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {READY_MARKER, bootstrapOwner, safeErrorCode} from './n8n-owner-bootstrap.mjs';

const ENTRYPOINT = '/docker-entrypoint.sh';
const KILL_GRACE_MS = 35_000;
const GROUP_POLL_MS = 100;
const REAP_WAIT_MS = 5_000;

function signalGroup(child, signal) {
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // The child is already gone.
    }
  }
}

// Signal 0 probes the whole process group; EPERM still means members exist.
function groupExists(child) {
  if (!Number.isInteger(child?.pid)) return false;
  try {
    process.kill(-child.pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

export function superviseN8n({
  env = process.env,
  spawnFn = spawn,
  bootstrap = bootstrapOwner,
  markerPath = READY_MARKER,
  writeMarker = path => writeFileSync(path, 'ready', {mode: 0o644}),
  removeMarker = path => rmSync(path, {force: true}),
  killGroup = signalGroup,
  groupAlive = groupExists,
  processRef = process,
  killGraceMs = KILL_GRACE_MS,
  pollMs = GROUP_POLL_MS,
  reapMs = REAP_WAIT_MS,
  log = message => console.error(message),
} = {}) {
  return new Promise(resolve => {
    const abort = new AbortController();
    const listeners = [];
    let child;
    let childDone = false;
    let bootstrapDone = false;
    let stopping = false;
    let stopSignal = null;
    let forced = false;
    let failed = false;
    let killTimer;
    let pollTimer;
    let reapTimer;
    let exitCode = 1;
    let settled = false;

    const dropMarker = () => {
      try {
        removeMarker(markerPath);
        return true;
      } catch {
        return false;
      }
    };
    const finish = code => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      clearTimeout(pollTimer);
      clearTimeout(reapTimer);
      for (const [name, handler] of listeners) processRef.off(name, handler);
      abort.abort();
      dropMarker();
      resolve(code);
    };
    // The original grace deadline is armed once; later group checks never extend it.
    const armGrace = () => {
      if (killTimer) return;
      killTimer = setTimeout(() => {
        forced = true;
        killGroup(child, 'SIGKILL');
        reapTimer = setTimeout(() => finish(1), reapMs);
      }, killGraceMs);
    };
    // Resolves only once the whole process group is gone, not merely the direct child.
    // A single scheduled poll at most; the handle is cleared before each check runs.
    const awaitGroup = () => {
      if (settled || pollTimer) return;
      const check = () => {
        pollTimer = undefined;
        if (settled) return;
        if (!groupAlive(child)) return finish(forced ? 1 : exitCode);
        pollTimer = setTimeout(check, pollMs);
      };
      check();
    };
    const stop = (signal, failure) => {
      if (failure) failed = true;
      if (stopping) return;
      stopping = true;
      stopSignal = signal;
      dropMarker();
      abort.abort();
      // Before spawn returns there is no child group yet; the signal is forwarded afterwards.
      if (!child) return;
      if (!childDone || groupAlive(child)) killGroup(child, signal);
      armGrace();
      if (childDone) awaitGroup();
    };
    const fail = code => {
      log(`${code}: n8n startup stopped.`);
      stop('SIGTERM', true);
    };

    if (!dropMarker()) {
      log('N8N_OWNER_BOOTSTRAP_FAILED: n8n startup stopped.');
      return resolve(1);
    }

    for (const name of ['SIGTERM', 'SIGINT']) {
      const handler = () => stop(name, false);
      listeners.push([name, handler]);
      processRef.on(name, handler);
    }

    const childEnv = {...env};
    for (const key of Object.keys(childEnv)) if (key.startsWith('N8N_OWNER_')) delete childEnv[key];
    try {
      child = spawnFn(ENTRYPOINT, [], {env: childEnv, detached: true, stdio: ['ignore', 'inherit', 'inherit']});
    } catch {
      child = undefined;
      log('N8N_OWNER_BOOTSTRAP_FAILED: n8n startup stopped.');
      return finish(1);
    }

    child.on('error', () => {
      failed = true;
      if (child.pid === undefined) {
        childDone = true;
        log('N8N_OWNER_BOOTSTRAP_FAILED: n8n startup stopped.');
        finish(1);
      } else fail('N8N_OWNER_BOOTSTRAP_FAILED');
    });
    child.on('close', (code, signal) => {
      childDone = true;
      if (settled) return;
      if (stopping) {
        const graceful = code === 0 || signal === stopSignal;
        exitCode = graceful ? 0 : code ?? 1;
        if (failed) exitCode = 1;
      } else {
        // Natural exit: an unfinished bootstrap is a startup failure even for exit 0.
        if (!bootstrapDone) log('N8N_OWNER_BOOTSTRAP_FAILED: n8n exited before owner setup completed.');
        dropMarker();
        abort.abort();
        exitCode = !bootstrapDone ? 1 : code ?? 1;
        // Bounded cleanup of any descendants the direct child left behind.
        if (groupAlive(child)) {
          killGroup(child, 'SIGTERM');
          armGrace();
        }
      }
      awaitGroup();
    });

    // A signal that arrived while spawn was returning is forwarded to the real group now.
    if (stopping) {
      killGroup(child, stopSignal);
      armGrace();
      return;
    }

    Promise.resolve()
      .then(() => bootstrap({env, signal: abort.signal}))
      .then(() => {
        if (settled || stopping || childDone) return;
        try {
          writeMarker(markerPath);
        } catch {
          return fail('N8N_OWNER_BOOTSTRAP_FAILED');
        }
        bootstrapDone = true;
      }, error => {
        if (settled || stopping || childDone) return;
        fail(safeErrorCode(error));
      });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await superviseN8n());
}
