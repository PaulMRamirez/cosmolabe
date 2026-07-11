import { contextBridge, ipcRenderer } from 'electron';
import { BESSEL_IPC, type BesselBridge } from '@bessel/pal-electron';

// Typed pass-through bridge: every method forwards to the matching ipcMain handler.
// contextIsolation stays on; no business logic lives here.
const api: BesselBridge = {
  platform: 'electron',
  versions: process.versions,
  listKernels: () => ipcRenderer.invoke(BESSEL_IPC.listKernels),
  resolveKernel: (name) => ipcRenderer.invoke(BESSEL_IPC.resolveKernel, name),
  readKernel: (id) => ipcRenderer.invoke(BESSEL_IPC.readKernel, id),
  readKernelRange: (id, offset, length) =>
    ipcRenderer.invoke(BESSEL_IPC.readKernelRange, id, offset, length),
  resolveMetaKernel: (tmPath) => ipcRenderer.invoke(BESSEL_IPC.resolveMetaKernel, tmPath),
  openDialog: (options) => ipcRenderer.invoke(BESSEL_IPC.openDialog, options),
  saveDialog: (options) => ipcRenderer.invoke(BESSEL_IPC.saveDialog, options),
  runPython: (request) => ipcRenderer.invoke(BESSEL_IPC.runPython, request),
  pythonAvailable: () => ipcRenderer.invoke(BESSEL_IPC.pythonAvailable),
};

contextBridge.exposeInMainWorld('bessel', api);
