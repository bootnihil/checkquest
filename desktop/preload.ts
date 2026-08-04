import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

import {
  desktopIpcChannels,
  projectDesktopCancelRunReply,
  projectDesktopRunEvent,
  projectDesktopSessionCredentialStatus,
  projectDesktopStartRunReply,
  type CheckQuestDesktopApi
} from './contracts';

const desktopApi: CheckQuestDesktopApi = {
  startRun: async input => {
    try {
      const reply = await ipcRenderer.invoke(desktopIpcChannels.startRun, input);

      return projectDesktopStartRunReply(reply);
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

      return projectDesktopCancelRunReply(reply);
    } catch {
      return {
        requested: false
      };
    }
  },
  getSessionCredentialStatus: async () => {
    try {
      const status = await ipcRenderer.invoke(desktopIpcChannels.sessionCredentialStatus);

      return projectDesktopSessionCredentialStatus(status);
    } catch {
      return {
        available: false
      };
    }
  },
  onRunEvent: listener => {
    const handleEvent = (_event: IpcRendererEvent, value: unknown): void => {
      const desktopEvent = projectDesktopRunEvent(value);

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
