// Registers the ipcMain handlers backing the typed bridge. Kernel channels delegate
// to a NodeKernelSource rooted at the resolved kernel directory; dialogs use the
// native dialog module; python delegates to the bridge. Located PalErrors are
// serialized so the renderer can rethrow them typed.

import { BrowserWindow, dialog, ipcMain } from 'electron';
import { PalError, type KernelHandle } from '@bessel/pal';
import {
  BESSEL_IPC,
  type DialogOpenOptions,
  type DialogSaveOptions,
  type PythonRunRequest,
} from '@bessel/pal-electron';
import {
  NodeKernelSource,
  resolveLoadableKernels,
  confineMetaKernelPath,
} from '@bessel/pal-electron/node';
import { kernelRoot } from './kernel-root.ts';
import { detectPython, runPython } from './python-bridge.ts';

function serialize(err: unknown): never {
  if (err instanceof PalError) {
    throw new Error(JSON.stringify({ __palError: { message: err.message, code: err.code, location: err.location } }));
  }
  throw err;
}

const byId = (id: string): KernelHandle => ({ id, name: id });

export function registerIpcHandlers(): void {
  const source = new NodeKernelSource(kernelRoot());

  ipcMain.handle(BESSEL_IPC.listKernels, () => source.list().catch(serialize));
  ipcMain.handle(BESSEL_IPC.resolveKernel, (_e, name: string) =>
    source.resolve(name).catch(serialize),
  );
  ipcMain.handle(BESSEL_IPC.readKernel, (_e, id: string) => source.read(byId(id)).catch(serialize));
  ipcMain.handle(BESSEL_IPC.readKernelRange, (_e, id: string, offset: number, length: number) =>
    source.readRange(byId(id), offset, length).catch(serialize),
  );
  ipcMain.handle(BESSEL_IPC.resolveMetaKernel, (_e, tmPath: string) =>
    Promise.resolve()
      .then(() => resolveLoadableKernels(confineMetaKernelPath(tmPath, kernelRoot())))
      .catch(serialize),
  );

  ipcMain.handle(BESSEL_IPC.openDialog, async (_e, options: DialogOpenOptions) => {
    const opts = {
      properties: ['openFile' as const],
      title: options.title,
      filters: options.filters?.map((f) => ({ name: f.name, extensions: [...f.extensions] })),
    };
    const win = BrowserWindow.getFocusedWindow();
    const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    return result.canceled ? null : result.filePaths;
  });

  ipcMain.handle(BESSEL_IPC.saveDialog, async (_e, options: DialogSaveOptions) => {
    const win = BrowserWindow.getFocusedWindow() ?? undefined;
    const result = win
      ? await dialog.showSaveDialog(win, options)
      : await dialog.showSaveDialog(options);
    return result.canceled ? null : (result.filePath ?? null);
  });

  ipcMain.handle(BESSEL_IPC.runPython, (_e, request: PythonRunRequest) => runPython(request));
  ipcMain.handle(BESSEL_IPC.pythonAvailable, () => detectPython());
}
