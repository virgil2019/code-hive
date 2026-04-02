import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("hive", {
  getSessions: () => ipcRenderer.invoke("get-sessions"),
  openProject: (path: string) => ipcRenderer.invoke("open-project", path),
  onSessionsUpdate: (callback: (data: any) => void) => {
    ipcRenderer.on("sessions-update", (_event, data) => callback(data));
  },
});
