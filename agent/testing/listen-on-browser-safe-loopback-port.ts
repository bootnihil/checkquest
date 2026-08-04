import type { Server } from 'node:http';

/*
 * Chromium's generic restricted-port list from net/base/port_util.cc.
 *
 * Playwright does not expose this list or a safe loopback-port allocator.
 * Keep this test-only copy aligned with the Chromium source when the bundled
 * browser is upgraded:
 *
 * https://chromium.googlesource.com/chromium/src/+/refs/heads/main/net/base/port_util.cc
 */
const chromiumRestrictedPorts = new Set([
  0, 1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102,
  103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465,
  512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993,
  995, 1719, 1720, 1723, 2049, 3659, 4045, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669,
  6697, 10080
]);

const maximumAllocationAttempts = 20;

const loopbackHost = '127.0.0.1';

async function listenOnEphemeralPort(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    const handleError = (error: Error): void => {
      server.off('listening', handleListening);
      reject(error);
    };

    const handleListening = (): void => {
      server.off('error', handleError);
      resolve();
    };

    server.once('error', handleError);
    server.once('listening', handleListening);
    server.listen(0, loopbackHost);
  });

  const address = server.address();

  if (address === null || typeof address === 'string') {
    throw new Error('The loopback fixture server did not expose a TCP port.');
  }

  return address.port;
}

async function closeRejectedBinding(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close(error => {
      if (error === undefined) {
        resolve();
        return;
      }

      reject(error);
    });
  });
}

export async function listenOnBrowserSafeLoopbackPort(
  server: Server,
  fixtureName: string
): Promise<number> {
  const rejectedPorts: number[] = [];

  for (let attempt = 1; attempt <= maximumAllocationAttempts; attempt += 1) {
    const port = await listenOnEphemeralPort(server);

    if (!chromiumRestrictedPorts.has(port)) {
      /*
       * The accepted server remains bound. Callers can construct their
       * fixture URL without a close/reopen race.
       */
      return port;
    }

    rejectedPorts.push(port);

    await closeRejectedBinding(server);
  }

  throw new Error(
    `${fixtureName} could not obtain a Chromium-safe loopback port after ${maximumAllocationAttempts} attempts. Restricted ports assigned: ${rejectedPorts.join(', ')}.`
  );
}
