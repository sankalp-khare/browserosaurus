import { execFile } from 'child_process'
import electron from 'electron'
import electronIsDev from 'electron-is-dev'
import path from 'path'
import sleep from 'tings/sleep'

import { apps } from '../config/apps'
import { App } from '../config/types'
import {
  APP_SELECTED,
  CATCH_MOUSE,
  CHANGE_THEME,
  COPY_TO_CLIPBOARD,
  FAV_SELECTED,
  HIDE_WINDOW,
  HOTKEYS_UPDATED,
  MAIN_LOG,
  OpenAppArguments,
  QUIT,
  RELEASE_MOUSE,
  RELOAD,
  RENDERER_STARTED,
  SET_AS_DEFAULT_BROWSER,
  UPDATE_HIDDEN_TILE_IDS,
} from '../renderer/sendToMain'
import copyToClipboard from '../utils/copyToClipboard'
import { filterAppsByInstalled } from '../utils/filterAppsByInstalled'
import { logger } from '../utils/logger'
import createWindow from './createWindow'
import {
  APP_VERSION,
  INSTALLED_APPS_FOUND,
  PROTOCOL_STATUS_RETRIEVED,
  STORE_RETRIEVED,
  URL_UPDATED,
} from './events'
import { Hotkeys, Store, store } from './store'

// Attempt to fix this bug: https://github.com/electron/electron/issues/20944
electron.app.commandLine.appendArgument('--enable-features=Metal')

if (store.get('firstRun')) {
  // Prompt to set as default browser
  electron.app.setAsDefaultProtocolClient('http')
}

// Prevents garbage collection
let bWindow: electron.BrowserWindow | undefined
let tray: electron.Tray | undefined
let installedApps: App[] = []

electron.app.on('ready', async () => {
  bWindow = await createWindow()

  tray = new electron.Tray(
    path.join(__dirname, '/static/icon/tray_iconTemplate.png'),
  )
  tray.setPressedImage(
    path.join(__dirname, '/static/icon/tray_iconHighlight.png'),
  )
  tray.setToolTip('Browserosaurus')
  tray.addListener('click', () => {
    bWindow?.show()
  })

  store.set('firstRun', false)

  // Hide from dock and cmd-tab
  electron.app.dock.hide()
})

// App doesn't always close on ctrl-c in console, this fixes that
electron.app.on('before-quit', () => {
  electron.app.exit()
})

async function sendUrl(url: string) {
  if (bWindow) {
    bWindow.webContents.send(URL_UPDATED, url)
    bWindow.show()
  } else {
    await sleep(500)
    sendUrl(url)
  }
}

electron.app.on('open-url', (event, url) => {
  event.preventDefault()
  sendUrl(url)
})

/**
 * ------------------
 * Renderer Listeners
 * ------------------
 */

electron.ipcMain.on(RENDERER_STARTED, async () => {
  installedApps = await filterAppsByInstalled(apps)

  bWindow?.center()

  // Send all info down to renderer
  bWindow?.webContents.send(STORE_RETRIEVED, store.store)
  bWindow?.webContents.send(INSTALLED_APPS_FOUND, installedApps)
  bWindow?.webContents.send(
    APP_VERSION,
    `v${electron.app.getVersion()}${electronIsDev ? ' DEV' : ''}`,
  )

  // Is default browser?
  bWindow?.webContents.send(
    PROTOCOL_STATUS_RETRIEVED,
    electron.app.isDefaultProtocolClient('http'),
  )
})

electron.ipcMain.on(
  APP_SELECTED,
  (_: Event, { url, appId, isAlt, isShift }: OpenAppArguments) => {
    // Bail if app's bundle id is missing
    if (!appId) return

    const app = apps.find((b) => b.id === appId)

    // Bail if app cannot be found in config (this, in theory, can't happen)
    if (!app) return

    const urlString = url || ''
    const processedUrlTemplate = app.urlTemplate
      ? app.urlTemplate.replace(/\{\{URL\}\}/u, urlString)
      : urlString

    const openArguments: string[] = [
      '-b',
      appId,
      isAlt ? '--background' : [],
      isShift && app.privateArg ? ['--new', '--args', app.privateArg] : [],
      // In order for private/incognito mode to work the URL needs to be passed at last, _after_ the respective app.privateArg flag
      processedUrlTemplate,
    ].flat()

    execFile('open', openArguments)
  },
)

electron.ipcMain.on(COPY_TO_CLIPBOARD, (_: Event, url: string) => {
  copyToClipboard(url)
})

electron.ipcMain.on(HIDE_WINDOW, () => {
  bWindow?.hide()
})

electron.ipcMain.on(FAV_SELECTED, (_, favAppId) => {
  store.set('fav', favAppId)
})

electron.ipcMain.on(HOTKEYS_UPDATED, (_, hotkeys: Hotkeys) => {
  store.set('hotkeys', hotkeys)
})

electron.ipcMain.on(CHANGE_THEME, (_, theme: Store['theme']) => {
  store.set('theme', theme)
})

electron.ipcMain.on(UPDATE_HIDDEN_TILE_IDS, (_, hiddenTileIds: string[]) => {
  store.set('hiddenTileIds', hiddenTileIds)
})

electron.ipcMain.on(SET_AS_DEFAULT_BROWSER, () => {
  electron.app.setAsDefaultProtocolClient('http')
})

electron.ipcMain.on(RELOAD, () => {
  bWindow?.reload()
})

electron.ipcMain.on(QUIT, () => {
  electron.app.quit()
})

electron.ipcMain.on(MAIN_LOG, (_, string: string) => {
  logger('Renderer', string)
})

electron.ipcMain.on(CATCH_MOUSE, () => {
  bWindow?.setIgnoreMouseEvents(false)
})

electron.ipcMain.on(RELEASE_MOUSE, () => {
  bWindow?.setIgnoreMouseEvents(true, { forward: true })
})
