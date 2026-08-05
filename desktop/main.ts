import { join } from 'node:path';

import {
  app,
  BrowserWindow,
  ipcMain,
  screen,
  type IpcMainInvokeEvent,
  type WebFrameMain
} from 'electron';

import { desktopIpcChannels, type DesktopStartRunReply } from './ipc-contract';
import { DesktopRunController } from './run-controller';
import { DesktopSessionCredentialStore } from './session-credential';
import { desktopRendererSecurityPreferences } from './security-policy';
import { desktopMinimumWindowSize, getDesktopInitialWindowBounds } from './window-bounds';

app.enableSandbox();

let mainWindow: BrowserWindow | undefined;
let runController: DesktopRunController | undefined;
let quitAfterCleanup = false;
let shutdownPromise: Promise<void> | undefined;
const sessionCredentials = new DesktopSessionCredentialStore();

function unavailableStartReply(): DesktopStartRunReply {
  return {
    accepted: false,
    reason: 'application-unavailable',
    message: 'The desktop application is not available.'
  };
}

function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  const window = mainWindow;

  if (window === undefined || window.isDestroyed()) {
    return false;
  }

  const senderFrame: WebFrameMain | null = event.senderFrame;

  return (
    event.sender === window.webContents &&
    senderFrame !== null &&
    senderFrame === window.webContents.mainFrame
  );
}

function registerDesktopIpc(): void {
  ipcMain.handle(desktopIpcChannels.startRun, (event, request: unknown) => {
    if (!isTrustedSender(event)) {
      return unavailableStartReply();
    }

    return runController?.start(request) ?? unavailableStartReply();
  });

  ipcMain.handle(desktopIpcChannels.cancelRun, event => {
    if (!isTrustedSender(event)) {
      return {
        requested: false
      };
    }

    return (
      runController?.cancel() ?? {
        requested: false
      }
    );
  });

  ipcMain.handle(desktopIpcChannels.sessionCredentialStatus, event => {
    if (!isTrustedSender(event)) {
      return {
        available: false
      };
    }

    return (
      runController?.getSessionCredentialStatus() ?? {
        available: false
      }
    );
  });
}

function configureWindowSecurity(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler(() => ({
    action: 'deny'
  }));

  window.webContents.on('will-navigate', event => {
    event.preventDefault();
  });

  window.webContents.on('will-attach-webview', event => {
    event.preventDefault();
  });

  window.webContents.on('render-process-gone', () => {
    void runController?.cancelAndWait();
  });

  window.webContents.session.setPermissionCheckHandler(() => false);

  window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
}

async function createMainWindow(): Promise<void> {
  const initialBounds = getDesktopInitialWindowBounds(screen.getPrimaryDisplay().workAreaSize);
  const window = new BrowserWindow({
    width: initialBounds.width,
    height: initialBounds.height,
    minWidth: desktopMinimumWindowSize.width,
    minHeight: desktopMinimumWindowSize.height,
    center: true,
    show: false,
    backgroundColor: '#071321',
    title: 'CheckQuest',
    icon: join(__dirname, 'renderer', 'checkquest-icon.png'),
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      ...desktopRendererSecurityPreferences,
      spellcheck: false,
      partition: 'checkquest-ui'
    }
  });

  mainWindow = window;
  runController = new DesktopRunController({
    sessionCredentials,
    emitEvent: event => {
      if (!window.isDestroyed()) {
        window.webContents.send(desktopIpcChannels.runEvent, event);
      }
    }
  });

  configureWindowSecurity(window);

  window.once('ready-to-show', () => {
    window.show();
  });

  window.on('closed', () => {
    void runController?.cancelAndWait();

    if (mainWindow === window) {
      mainWindow = undefined;
    }
  });

  await window.loadFile(join(__dirname, 'renderer', 'index.html'));
}

registerDesktopIpc();

app.on('before-quit', event => {
  if (quitAfterCleanup) {
    return;
  }

  if (runController?.hasActiveRun() !== true) {
    sessionCredentials.clear();
    return;
  }

  event.preventDefault();

  if (shutdownPromise !== undefined) {
    return;
  }

  shutdownPromise = runController.cancelAndWait().finally(() => {
    sessionCredentials.clear();
    quitAfterCleanup = true;
    app.quit();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createMainWindow();
  }
});

void app
  .whenReady()
  .then(createMainWindow)
  .catch(() => {
    app.exit(1);
  });
