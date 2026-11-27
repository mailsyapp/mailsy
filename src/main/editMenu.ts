import { BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron'

type HistoryCommand = 'undo' | 'redo'

const HISTORY_INPUT_TYPES: Record<HistoryCommand, string> = {
  undo: 'historyUndo',
  redo: 'historyRedo'
}

function historyScript(command: HistoryCommand): string {
  return `(() => {
    const target = document.activeElement ?? document.body
    const event = new InputEvent('beforeinput', {
      inputType: '${HISTORY_INPUT_TYPES[command]}',
      bubbles: true,
      cancelable: true
    })
    if (target.dispatchEvent(event)) document.execCommand('${command}')
  })()`
}

function historyItem(
  label: string,
  accelerator: string,
  command: HistoryCommand
): MenuItemConstructorOptions {
  return {
    label,
    accelerator,
    click: () => {
      void BrowserWindow.getFocusedWindow()?.webContents.executeJavaScript(historyScript(command))
    }
  }
}

export function installApplicationMenu(): void {
  const isMac = process.platform === 'darwin'
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' } as const] : []),
    { role: 'fileMenu' },
    {
      label: 'Edit',
      submenu: [
        historyItem('Undo', 'CmdOrCtrl+Z', 'undo'),
        historyItem('Redo', 'Shift+CmdOrCtrl+Z', 'redo'),
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle' },
        { role: 'delete' },
        { role: 'selectAll' }
      ]
    },
    { role: 'viewMenu' },
    { role: 'windowMenu' }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
