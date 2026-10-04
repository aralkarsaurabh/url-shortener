// Stops accepting new connections and waits for requests already being handled to finish.
export function closeServer(server) {
  return new Promise((resolve) => {
    // Connections that are idle between requests would keep the server open, so close them as they go idle.
    const sweep = setInterval(() => server.closeIdleConnections(), 100);
    server.close(() => {
      clearInterval(sweep);
      resolve();
    });
    server.closeIdleConnections();
  });
}

// Runs the steps one after another when a stop signal arrives, then exits.
// A step that fails is logged and the rest still run. Exits 1 if any step failed or time ran out.
export function createShutdown({ steps, timeoutMs = 10000, log = console.log, exit = process.exit }) {
  let started = false;

  async function run(signal) {
    if (started) return;
    started = true;
    log(`${signal} received, shutting down`);

    const force = setTimeout(() => {
      console.error(`shutdown took longer than ${timeoutMs} ms, forcing exit`);
      exit(1);
    }, timeoutMs);
    force.unref();

    let failed = false;
    for (const [name, step] of steps) {
      try {
        await step();
        log(`shutdown: ${name} done`);
      } catch (err) {
        failed = true;
        console.error(`shutdown: ${name} failed:`, err.message);
      }
    }
    clearTimeout(force);
    exit(failed ? 1 : 0);
  }

  return { run, isShuttingDown: () => started };
}
