import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

import {
  desktopIpcChannels,
  parseDesktopCancelRunReply,
  parseDesktopSessionCredentialStatus,
  parseDesktopStartRunReply,
  type CheckQuestDesktopApi
} from './ipc-contract';
import { parseDesktopRunEvent } from './run-event-contract';

const desktopApi: CheckQuestDesktopApi = {
  startRun: async input => {
    try {
      const reply = await ipcRenderer.invoke(desktopIpcChannels.startRun, input);

      return parseDesktopStartRunReply(reply);
    } catch {
      return {
        accepted: false,
        reason: 'application-unavailable',
        message: 'The desktop application could not start the run.'
      };
    }
  },
  cancelRun: async () => {
    try {
      const reply = await ipcRenderer.invoke(desktopIpcChannels.cancelRun);

      return parseDesktopCancelRunReply(reply);
    } catch {
      return {
        requested: false
      };
    }
  },
  getSessionCredentialStatus: async () => {
    try {
      const status = await ipcRenderer.invoke(desktopIpcChannels.sessionCredentialStatus);

      return parseDesktopSessionCredentialStatus(status);
    } catch {
      return {
        available: false
      };
    }
  },
  onRunEvent: listener => {
    const handleEvent = (_event: IpcRendererEvent, value: unknown): void => {
      const desktopEvent = parseDesktopRunEvent(value);

      if (desktopEvent === null) {
        return;
      }

      try {
        listener(desktopEvent);
      } catch {
        /*
         * Renderer presentation failures remain isolated from IPC.
         */
      }
    };

    ipcRenderer.on(desktopIpcChannels.runEvent, handleEvent);

    return () => {
      ipcRenderer.removeListener(desktopIpcChannels.runEvent, handleEvent);
    };
  }
};

contextBridge.exposeInMainWorld('checkQuestDesktop', desktopApi);
