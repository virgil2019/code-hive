const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("hive", {
  getSessions: () => ipcRenderer.invoke("get-sessions"),
  openProject: (path, tty) => ipcRenderer.invoke("open-project", path, tty),
  acknowledge: (sessionId) => ipcRenderer.invoke("acknowledge", sessionId),
  onSessionsUpdate: (callback) => {
    ipcRenderer.on("sessions-update", (_event, data) => callback(data));
  },
});
