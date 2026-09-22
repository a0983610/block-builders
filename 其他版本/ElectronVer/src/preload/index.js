/* 橋樑（renderer 與主行程之間唯一的通道）。

   遊戲本身還是純前端（canvas／localStorage／剪貼簿／下載都是瀏覽器本來就有的），
   這裡開的三件事全都是「桌面模式」要的，遊戲邏輯一件都不靠它：

     minimize／close  主視窗是無框的（開了 transparent 就沒有原生標題列），
                      這兩顆鈕得自己做，做了就得有地方叫主行程。
     onIdle           主行程在視窗最小化／還原時通知一次，讓 renderer 決定
                      要不要繼續畫。renderer 自己判斷不了——實測
                      backgroundThrottling:false 之下最小化不會觸發
                      visibilitychange。

   contextIsolation: true 之下，能出去的就只有這三個，nodeIntegration 一樣是關的。 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  minimize: () => ipcRenderer.send('win:minimize'),
  close: () => ipcRenderer.send('win:close'),
  /* cb(true)＝看不到了（只算不畫）、cb(false)＝回來了 */
  onIdle: cb => ipcRenderer.on('win:idle', (_e, v) => cb(!!v))
});
