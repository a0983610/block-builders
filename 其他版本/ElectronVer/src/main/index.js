/* 主行程（Node 端，有系統能力）。
   這支的工作只有三件：開一個視窗把遊戲的 index.html 載進來、
   把「瀏覽器有、Electron 預設沒有或行為不一樣」的幾件事補回去、關窗就結束。

   遊戲本身是純前端（沒有 fetch、沒有 Web Worker、three.js 是本機 lib），
   一件系統能力都不需要。唯一的 IPC 是「桌面模式」要的——無框視窗得自己做
   最小化／關閉，最小化與還原也要通知 renderer 停畫面。遊戲邏輯一樣不碰它。 */
const { app, BrowserWindow, Menu, ipcMain, shell, session } = require('electron');
const path = require('path');

/* renderer 底下就是原本那包網頁原封不動搬進來的（index.html 旁邊仍然是 lib/、src/、
   blueprints/），所以 index.html 裡那些相對路徑一行都不用改。
   路徑會長成 src/renderer/src/game.js，看起來有點怪，但那是不動它的代價。 */
const RENDERER = path.join(__dirname, '..', 'renderer');

const PRELOAD = path.join(__dirname, '..', 'preload', 'index.js');

/** 「藍圖預覽」那一頁的長相。它是一般的文件頁（要捲、要關、要能拉大小），
    所以維持原本的有框視窗，不跟著主視窗走桌面那一套。 */
const WIN_OPTS = {
  width: 1280,
  height: 860,
  /* 開窗到畫面畫出來之間會先露出視窗底色，預設是白的會閃一下。
     這裡取 index.html 那條天空漸層的中段色，接得比較順。 */
  backgroundColor: '#8fc0e4',
  webPreferences: {
    preload: PRELOAD,
    contextIsolation: true,
    nodeIntegration: false
  }
};

/* 主視窗＝桌面模式，三個設定各自有非它不可的理由：

   transparent：天空那一片本來就不是 WebGL 畫的（是 index.html 的 body 漸層），
     把那條漸層拿掉、視窗開透明，沒有積木的地方就直接看到桌面。

   frame：實測過（Windows 11 + Electron 44.3），一開 transparent 原生標題列就會消失
     ——量到的 26px 是預設選單列不是標題列，而且下面 Menu.setApplicationMenu(null)
     又把它拿掉了，等於完全無框。既然拿不回來，就明寫 false 不要靠那個副作用，
     最小化／關閉改由畫面右上角兩顆鈕經 IPC 叫回來。
     backgroundColor 也不能留：透明視窗有底色就等於沒透明。

   backgroundThrottling：整個「最小化之後只算不畫」的前提。最小化期間推模擬的是
     game-ui.js 的 setInterval（為什麼不是 rAF，看那邊 setIdle() 的說明），
     而實測預設值之下視窗一最小化，那個計時器會被降到一秒才跑一次——
     50ms 的 tick 變成 1000ms，工地等於停擺。關掉之後它才穩得住 50ms。 */
const MAIN_OPTS = {
  width: 1280,
  height: 860,
  frame: false,
  transparent: true,
  webPreferences: {
    preload: PRELOAD,
    contextIsolation: true,
    nodeIntegration: false,
    backgroundThrottling: false
  }
};

function createWindow() {
  const win = new BrowserWindow(MAIN_OPTS);

  /* target="_blank" 在 Electron 預設是「再開一個 BrowserWindow」，等於拿這個 app 當瀏覽器。
     分兩種處理：
       ① 外站（Gemini／GPT，index.html 的「📥 匯入建築」那格）→ 丟給系統預設瀏覽器
       ② 同資料夾的 藍圖預覽.html（file:）→ 照樣開新視窗，那本來就是這個 app 的第二頁 */
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('file://')) {
      return { action: 'allow', overrideBrowserWindowOptions: WIN_OPTS };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });

  /* 最小化／還原轉告 renderer：看不到的時候畫面整包停掉，模擬繼續跑。
     這件事不能讓 renderer 自己用 visibilitychange 判斷——實測
     backgroundThrottling:false 之下，視窗最小化根本不會觸發它
     （document.visibilityState 從頭到尾都是 visible）。 */
  win.on('minimize', () => win.webContents.send('win:idle', true));
  win.on('restore', () => win.webContents.send('win:idle', false));

  win.loadFile(path.join(RENDERER, 'index.html'));
  return win;
}

app.whenReady().then(() => {
  /* 預設選單列（File／Edit／View…）對這個遊戲沒有用，而且按 Alt 會把它叫出來壓到畫面。
     拿掉的同時也少了 Ctrl+Shift+I，所以下面自己補一個 F12。 */
  Menu.setApplicationMenu(null);

  /* 「📋 取得 prompt」與「📋 貼上」走的是 navigator.clipboard。
     寫入不用權限；讀取（readText）Electron 預設拒絕，按了只會退回「請按 Ctrl+V」。
     兩個 handler 都要掛——實測過只掛 request 那個是無效的：
     Chromium 讀剪貼簿之前先做的是「同步權限檢查」（走 check），
     檢查就被打回票了，request 那條根本不會被問到。
     只放行剪貼簿，其餘（相機、麥克風、定位…）一律擋掉。 */
  const CLIP = ['clipboard-read', 'clipboard-sanitized-write'];
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => {
    callback(CLIP.includes(permission));
  });
  session.defaultSession.setPermissionCheckHandler((wc, permission) => CLIP.includes(permission));

  /* 無框視窗沒有原生的最小化／關閉鈕，畫面右上角那兩顆按下來走這裡。
     用 fromWebContents 拿視窗而不是抓外面那個 win：藍圖預覽是另一個視窗，
     哪一頁按的就關哪一個，不會按了預覽卻把工地收掉。 */
  ipcMain.on('win:minimize', e => {
    const w = BrowserWindow.fromWebContents(e.sender);
    if (w) w.minimize();
  });
  ipcMain.on('win:close', e => {
    const w = BrowserWindow.fromWebContents(e.sender);
    if (w) w.close();
  });

  const win = createWindow();

  /* 少了選單列就沒有開發者工具的快捷鍵，留一個 F12（遊戲的操作鍵是 WASD／QE／ZX／C，不會撞到） */
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') win.webContents.toggleDevTools();
  });
});

app.on('window-all-closed', () => {
  app.quit();
});
