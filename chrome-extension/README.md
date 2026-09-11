# AI 即時翻譯－Chrome 網頁字幕 V0.2.0

這是手機 PWA 的電腦延伸版。YouTube 優先使用可讀取的影片字幕；無可用字幕時，自動擷取目前 Chrome 分頁音訊。兩者都經過既有 Supabase 家庭帳號驗證及 OpenAI Realtime 翻譯，並把繁體中文字幕疊在影片下方。

## V0.2.0 字幕優先

- 自動讀取所選語言的官方或自動字幕，不需要打開 CC；popup 顯示「字幕模式」或「音訊模式」。
- 依影片播放時間送出短句，不等整段 cue 結束；收到中文串流立即顯示，同一句補字時修訂原行。
- 新 cue 不會先清掉上一句中文。暫停不送新文字，拖曳進度時取消舊翻譯，YouTube 換片重新判斷來源。
- 字幕模式不擷取音訊、不啟動 ASR，沿用日文與 shared 的 `translator_glossary`；詞彙庫讀取失敗會報錯。
- 翻譯最多同時兩筆、待處理最多四句；網路或模型過慢時跳過過時待譯句，避免越積越落後。

### 更新與驗證

GitHub Actions 成功後，下載該次執行的 `ai-live-translator-chrome` artifact，解壓縮並以內容更新原外掛資料夾。在 `chrome://extensions/` 按重新載入，再重新整理 YouTube。固定 Extension ID、家庭登入設定與手機 PWA 不變。

播放有日文字幕的影片，確認 popup 為字幕模式，連續講話時有中文串流；暫停、拖曳、換片後不應跳回舊譯文。以無字幕影片確認音訊模式仍有辨識及翻譯。0.5～1 秒是目標，尚需實機量測；YouTube 自動字幕本身延遲、網路與模型首字時間仍影響結果。

只使用播放器公開給目前頁面的字幕 track，無法讀取、格式不支援或受限時使用音訊備援。此版本不持續刷新直播字幕 track，主要供一般隨選影片使用；不使用 OCR，也不繞過影片權限。

## 原有支援

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

- 音訊模式只抓 Chrome「目前分頁」音訊，不抓 VLC、遊戲或整台 Windows 的系統音訊。
- `chrome://`、Chrome Web Store 等瀏覽器保護頁面不能注入字幕。
- DRM 或特殊網站可能限制音訊擷取。
- 目前來源語言由使用者選英文 / 日文 / 韓文；之後可再做自動偵測。
- API 用量與手機版共用同一個 OpenAI 專案。
