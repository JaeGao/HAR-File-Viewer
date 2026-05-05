const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const path = require('path')
const fs = require('fs')

if (process.platform === 'linux') {
  // Let Chromium pick X11 or Wayland automatically instead of forcing Wayland,
  // which is incompatible with Vulkan and causes the renderer warning.
  app.commandLine.appendSwitch('ozone-platform-hint', 'auto')
  // Disable Vulkan on Linux to avoid the Wayland/Vulkan conflict entirely.
  app.commandLine.appendSwitch('disable-features', 'Vulkan')
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'HAR Analyzer',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  win.loadFile('index.html')
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

ipcMain.handle('open-file-dialog', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Open HAR File',
    filters: [{ name: 'HAR Files', extensions: ['har'] }, { name: 'All Files', extensions: ['*'] }],
    properties: ['openFile']
  })
  if (result.canceled || result.filePaths.length === 0) return null
  const filePath = result.filePaths[0]
  const stats = fs.statSync(filePath)
  const content = fs.readFileSync(filePath, 'utf-8')
  return { path: filePath, name: path.basename(filePath), size: stats.size, content }
})
