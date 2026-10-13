import type { Server } from 'node:http';

export interface Listener { server: Server; port: number; host: string }

function listen({ server, port, host }: Listener): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once('error', onError);
    server.listen(port, host, () => { server.off('error', onError); resolve(); });
  });
}

// Stop accepting, let pending requests finish up to drainMs, then force-close leftovers.
export function closeServer(server: Server, drainMs = 40_000): Promise<void> {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => server.closeAllConnections(), drainMs);
    server.close(error => { clearTimeout(timer); error ? reject(error) : resolve(); });
    server.closeIdleConnections();
  });
}

// Binds listeners in order. Any failure closes the ones already open, so the process is never half-alive.
export async function listenAll(listeners: Listener[]): Promise<void> {
  const opened: Server[] = [];
  try {
    for (const listener of listeners) { await listen(listener); opened.push(listener.server); }
  } catch (error) {
    await Promise.allSettled(opened.map(server => closeServer(server, 0)));
    throw error;
  }
}

export interface GatewayRuntime {
  internal: Listener;
  public?: Listener;
  startWorker: () => void;
  stopWorker: () => Promise<void>;
  endPool: () => Promise<void>;
  publicDrainMs?: number;
}

// Worker starts only after every listener is bound. A bind failure releases the pool and rethrows.
export async function startGateway(runtime: GatewayRuntime): Promise<void> {
  try {
    await listenAll(runtime.public ? [runtime.internal, runtime.public] : [runtime.internal]);
  } catch (error) {
    await runtime.endPool().catch(() => undefined);
    throw error;
  }
  runtime.startWorker();
}

// Public stops first; internal stays up so in-flight dispatch can still call prepare/complete while the worker drains.
export async function stopGateway(runtime: GatewayRuntime): Promise<void> {
  const failures: unknown[] = [];
  const step = async (action: () => Promise<void>) => { try { await action(); } catch (error) { failures.push(error); } };
  const publicListener = runtime.public;
  if (publicListener) await step(() => closeServer(publicListener.server, runtime.publicDrainMs ?? 40_000));
  await step(runtime.stopWorker);
  await step(() => closeServer(runtime.internal.server, 5_000));
  await step(runtime.endPool);
  if (failures.length) throw failures[0];
}
