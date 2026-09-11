# AI 即時翻譯－Chrome 網頁字幕 V0.1.0

這是手機 PWA 的電腦延伸版。它不使用麥克風，而是直接擷取目前 Chrome 分頁的音訊，送到既有 Supabase / OpenAI Realtime 後端，並把繁體中文字幕疊在影片下方。

## V0.1.0 支援

- YouTube 與一般 `http/https` 網頁影片
- 英文 / 日文 / 韓文 → 繁體中文字幕
- 直接擷取目前分頁音訊，不受辦公室環境噪音影響
- 保留原本分頁聲音播放
- YouTube 全螢幕時字幕仍會移入全螢幕元素
- 與手機版共用家庭 Google 帳號白名單與 OpenAI API

## 第一次安裝

1. Chrome 開啟 `chrome://extensions/`。
2. 右上角開啟「開發人員模式」。
3. 點「載入未封裝項目」。
4. 選擇本 Repo 的 `chrome-extension` 資料夾。
5. 固定擴充功能到 Chrome 工具列。

此專案 manifest 內含固定公開金鑰，因此開發版 Extension ID 固定為：

`mdbnahpneomonfndhcnkeeldjbebkfhj`

Supabase Authentication → URL Configuration → Redirect URLs 必須加入：

`https://mdbnahpneomonfndhcnkeeldjbebkfhj.chromiumapp.org/supabase-auth`

這個網址只用於 Google 登入完成後把 Supabase Session 回傳給 Chrome 擴充功能。

## 使用方式

1. 開啟 YouTube 或其他網頁影片。
2. 點 Chrome 工具列的「AI 即時翻譯－網頁字幕」。
3. 第一次使用先按「使用 Google 登入」。
4. 選影片語言與字幕大小。
5. 點「開始翻譯目前分頁」。
6. 繁中字幕會直接覆蓋在影片下方；再次打開外掛可停止翻譯。

## 限制

- V0.1.0 只抓 Chrome「目前分頁」音訊，不抓 VLC、遊戲或整台 Windows 的系統音訊。
- `chrome://`、Chrome Web Store 等瀏覽器保護頁面不能注入字幕。
- DRM 或特殊網站可能限制音訊擷取。
- 目前來源語言由使用者選英文 / 日文 / 韓文；之後可再做自動偵測。
- API 用量與手機版共用同一個 OpenAI 專案。
