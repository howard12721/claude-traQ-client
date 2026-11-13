// デスクトップ版。ビルド済みの画面を localhost で配信し、/api (WebSocket 含む) を traQ に中継する。
// 開発サーバー (vite) の proxy と同じ構成なので、ログインのクッキーもそのまま localhost に保存される。
const { app, BrowserWindow, nativeTheme, shell } = require('electron')
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const httpProxy = require('http-proxy')

const ORIGIN = process.env.TRAQ_ORIGIN || 'https://q.trap.jp'
// 既定以外の traQ に繋ぐときはログイン状態などを別に保存し、普段のアプリと混ざらないようにする
if (process.env.TRAQ_ORIGIN) app.setPath('userData', path.join(app.getPath('appData'), 'traQ-' + new URL(ORIGIN).host))
const DIST = path.join(__dirname, '..', 'dist')
// 下書きや設定 (localStorage) はオリジンごとなので、毎回同じポートを使う。塞がっていれば空きポート
const PORT = 47321
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.json': 'application/json', '.map': 'application/json',
}

function startServer() {
  const proxy = httpProxy.createProxyServer({ target: ORIGIN, changeOrigin: true, ws: true, secure: true })
  proxy.on('error', (_err, _req, res) => {
    if (res && typeof res.writeHead === 'function' && !res.headersSent) { res.writeHead(502); res.end() } else res?.destroy?.()
  })

  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/api/')) return proxy.web(req, res)
    // 静的ファイル。dist の外は見せない。無ければ SPA として index.html
    let rel
    try { rel = path.normalize(decodeURIComponent(req.url.split('?')[0])) } catch { res.writeHead(400); return res.end() }
    let file = path.join(DIST, rel)
    if (!file.startsWith(DIST + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html')
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' })
    fs.createReadStream(file).pipe(res)
  })
  server.on('upgrade', (req, socket, head) => {
    if (req.url.startsWith('/api/')) proxy.ws(req, socket, head)
    else socket.destroy()
  })

  return new Promise((resolve, reject) => {
    const listen = port => server.listen(port, 'localhost', () => resolve(server.address().port))
    server.once('error', err => {
      if (err.code !== 'EADDRINUSE') return reject(err)
      server.once('error', reject)
      listen(0)
    })
    listen(PORT)
  })
}

let base

function createWindow() {
  const win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 380, minHeight: 480,
    title: 'traQ',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#111316' : '#f4f5f7',
    webPreferences: { contextIsolation: true, sandbox: true },
  })
  const openOutside = url => { if (/^https?:\/\//.test(url)) shell.openExternal(url) }
  // 外部リンクは既定のブラウザで開き、アプリの画面からは離れない
  win.webContents.setWindowOpenHandler(({ url }) => { openOutside(url); return { action: 'deny' } })
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(base)) { e.preventDefault(); openOutside(url) }
  })
  win.loadURL(base)
}

if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows()
    if (win) { if (win.isMinimized()) win.restore(); win.focus() }
  })
  app.whenReady().then(async () => {
    // パッケージ版は .app のアイコン。開発中 (npm run app) も Dock を traQ のアイコンにする
    if (process.platform === 'darwin' && !app.isPackaged) app.dock?.setIcon(path.join(__dirname, '..', 'build', 'icon.png'))
    base = `http://localhost:${await startServer()}/`
    createWindow()
    app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow() })
  })
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
}
