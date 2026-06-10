const path = require('node:path')
const { app, BrowserWindow, dialog } = require('electron')

let viteServer = null

async function createWindow() {
  const projectRoot = app.isPackaged
    ? path.join(process.resourcesPath, 'app')
    : path.resolve(__dirname, '..')

  try {
    process.env.DHARMA_APP_ROOT = projectRoot
    process.chdir(projectRoot)

    const { createServer, loadEnv } = await import('vite')
    const env = loadEnv('development', projectRoot, '')

    Object.entries(env).forEach(([key, value]) => {
      if (process.env[key] === undefined) {
        process.env[key] = value
      }
    })

    viteServer = await createServer({
      root: projectRoot,
      configFile: path.join(projectRoot, 'vite.config.ts'),
      server: {
        host: '127.0.0.1',
        port: 0,
      },
    })
    await viteServer.listen()

    const address = viteServer.httpServer?.address()
    const port = typeof address === 'object' && address ? address.port : 5173
    const window = new BrowserWindow({
      width: 1440,
      height: 960,
      minWidth: 1100,
      minHeight: 720,
      title: 'Dharma Campaign Report',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
      },
    })

    await window.loadURL(`http://127.0.0.1:${port}`)
  } catch (error) {
    dialog.showErrorBox(
      'Unable to start Dharma Campaign Report',
      error instanceof Error ? error.message : String(error),
    )
    app.quit()
  }
}

app.whenReady().then(createWindow)

app.on('window-all-closed', async () => {
  await viteServer?.close()

  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})
