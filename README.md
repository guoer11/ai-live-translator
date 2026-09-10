# AI 即時翻譯 APP · V0.1.6

## V0.1.6 語音辨識升級（2026-09-10）

- 語音辨識改為 `gpt-live-transcribe`，沿用現有 WebRTC Realtime session；文字翻譯模型不變。
- `languages: ['zh-tw', 所選外語]` 提供雙語辨識範圍，保留自動方向，不新增操作模式。
- 伺服器降噪改為 `far_field`，用於手機開放空間收音。電視配樂、多人重疊、距離與回音仍可能造成誤辨，並非聲源分離。
- 保留 V0.1.5 的 VAD（threshold 0.5、prefix 700 ms、silence 1200 ms）、Safari 麥克風處理與 ASR 完成事件排序。未加入一般 Realtime session schema 未列出的 delay 欄位。
- 測試為模擬 HTTP／WebRTC 回歸測試；仍需實機驗證新模型權限、端到端連線與辨識品質，不宣稱已完成 iPhone／電視收音實測。
- 設定依據：[OpenAI Realtime API](https://developers.openai.com/api/reference/resources/realtime/subresources/client_secrets)、[即時轉錄](https://developers.openai.com/api/docs/guides/realtime-transcription)。下方舊版紀錄為歷史說明。

## V0.1.1 語言與原文對應修正（2026-09-10）

- 原文與譯文改為同一條處理路徑：等語音辨識完成，正規化後的原文同時用於畫面及文字翻譯。不再用另一個模型重聽同一段聲音產生互不一致的譯文。
- 增加繁中與選定外語的辨識提示；非選定語言的韓文／日文等文字會被攔截並要求重說。
- 使用 OpenCC 1.0.5 將已判定為中文的原文及中文譯文轉為繁體；日文假名內容保留原樣。自動辨識純漢字的中／日文仍可能不確定，這是目前限制。
- 斷句靜音時間由 600 ms 調整為 1000 ms，前置音訊由 300 ms 調整為 500 ms，VAD threshold 由 0.5 調整為 0.55，要求單聲道（裝置支援時）。這些設定仍需 iPhone 15 Pro 的真實環境測試，不能保證消除雜音。
- 保留原本模型，未更換為更貴的語音辨識模型。等待原文完成可能增加字幕延遲；辨識錯字仍可能被忠實翻譯，無法只靠軟體判定現場究竟說了什麼。
- 測試涵蓋快速連續語句、ASR 完成順序顛倒、外語攔截、繁體轉換及停止清理；尚未在使用者 iPhone 實測。

OpenCC 使用官方 npm 套件 `opencc-js@1.0.5`，SHA-512 已比對套件 integrity；本地封裝 `dist/vendor/opencc/cn2t.js`，不依賴外部 CDN。授權見同目錄 LICENSE。[上游](https://github.com/nk2028/opencc-js)。

繁體中文與英文／日文／韓文雙向翻譯的 PWA 第一版。
前端是無外部套件的 ES modules 靜態網站，可部署至 GitHub Pages；後端是 Supabase Edge Function；語音以 WebRTC 串接 OpenAI Realtime。

## 目前完成與未完成

已完成：前端、Realtime WebRTC 連線與事件處理程式、Supabase 連線建立端點、資料庫配額 SQL、GitHub Pages Actions、PWA manifest／快取／圖示、錯誤處理與核心測試。

部署目標：GitHub `guoer11/ai-live-translator`、Supabase `ai-translator`（`mflhfttirywdsqvjhvhl`）。`dist/config.js` 已填入該專案的公開端點。後端仍需由管理者設定下方的 Secrets 才能啟用付費語音翻譯。示範字幕是預設文字，不會開麥克風或呼叫 API。

2026-09-10 部署紀錄：Supabase 資料表與配額 RPC 已建立；以 service_role 實際測試 RPC 成功並回滾測試計數；一般訪客與 authenticated 角色均無資料表或 RPC 權限。`realtime-session` Edge Function 已部署為 ACTIVE。

尚未執行：真實 OpenAI 語音翻譯、GitHub Pages Actions 線上部署成功確認、iPhone/iPad 實機麥克風／安裝／離線測試。單元測試使用替代的 HTTP 與 WebRTC 物件，不代表語音服務已實測成功。完成前端上傳後，若 GitHub Pages 尚未啟用，請到儲存庫 Settings → Pages → Source 選 GitHub Actions，再於 Actions 手動重新執行部署。

Supabase Security Advisors 只有 INFO「RLS Enabled No Policy」：本配額表刻意不提供任何一般使用者政策，只限後端 service_role，因此維持此設定，不新增公開存取政策。[說明](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)。

## V1 規格依據

可見專案紀錄已確認：

- 繁中 ↔ 英文、繁中 ↔ 日文、繁中 ↔ 韓文。
- 可回看最近約 5–10 分鐘翻譯。
- V1 先不做使用者登入。
- 本次要求 GitHub Pages、Supabase、OpenAI Realtime，目標是 iPhone/iPad 可加入主畫面的 PWA。

未取得更完整的原始 V1 規格。以下為本次可調整的實作選擇：選定一組語言後由模型判斷雙向；以語句停頓作為翻譯單位，串流顯示譯文；僅文字字幕，不自動播音；預設保留 10 分鐘，可切成 5 分鐘；不建立帳號、不做雲端同步；測試使用碼控管；切換背景停止；一次連線 10 分鐘後停止，可手動重新開始。並非字字同步的同聲傳譯，延遲取決於停頓、網路及模型。

## 專案結構

```text
dist/                         GitHub Pages 的完整靜態前端
  index.html                  繁中手機／平板介面
  style.css                   響應式樣式及放大字幕
  config.js                   唯一公開設定：Supabase 端點
  manifest.webmanifest         PWA manifest（支援儲存庫子路徑）
  sw.js                       僅快取應用程式檔案
  icons/                      180、192、512 px PNG 圖示
  src/app.js                  介面、裝置生命週期、設定與歷史
  src/history.js              有時效的分頁字幕儲存
  src/realtime.js             麥克風、WebRTC、逐句翻譯佇列
supabase/
  config.toml                 Edge Function 設定
  .env.example                後端 Secrets 名稱，沒有金鑰
  schema/setup.sql            僅服務端能存取的連線配額及 RPC
  functions/realtime-session/  SDP 交換與 OpenAI 連線建立
scripts/                      設定與靜態完整性檢查
tests/                        Node 內建測試，不需下載測試套件
.github/workflows/pages.yml   Pages 自動部署流程
```

## 本機執行

需要 Node.js 22+；沒有 npm dependencies，所以不需安裝套件。

```bash
node --test tests/core.test.mjs
node scripts/check.mjs
python3 -m http.server 8080 --directory dist
```

桌面開啟 `http://localhost:8080`。手機不能使用一般 HTTP 區網 IP 來測試麥克風；請使用 HTTPS 的實際部署網址。未接後端時可以先查看示範字幕。

## Supabase 部署（選定專案後）

1. 在目標 Supabase 專案的 SQL Editor 執行 `supabase/schema/setup.sql`。它僅建立 `translator_session_quota` 與 `translator_take_session()`；不存任何對話、音檔或使用碼。
2. 部署 `supabase/functions/realtime-session/index.ts` 與同資料夾 `handler.js`。設定 `verify_jwt = false`，因為 V1 不使用 Supabase Auth；函式自行檢查使用碼。不要省略使用碼驗證。
3. 在 Supabase Edge Functions Secrets 設定以下值：

| Secret | 說明 |
| --- | --- |
| `OPENAI_API_KEY` | 專用 OpenAI 專案金鑰，只存在後端 |
| `OPENAI_REALTIME_MODEL` | 預設 `gpt-realtime-2.1`；需確認金鑰有該模型權限 |
| `TRANSLATOR_ACCESS_CODE` | 至少 16 字元，建議使用隨機產生的長使用碼 |
| `ALLOWED_ORIGINS` | 如 `https://guoer11.github.io`；多個以逗號分隔，不能加儲存庫路徑、結尾斜線或萬用字元 |

`SUPABASE_URL` 與 `SUPABASE_SERVICE_ROLE_KEY` 由 Supabase 託管執行環境提供，不得放到前端。

若使用 Supabase CLI，先以 `supabase --help`、各子指令 `--help` 核對當前版本參數，再連結目標專案、設定 Secrets、部署函式。若要改成 CLI migrations 管理，先執行 `supabase migration new translator_quota`，再把 `schema/setup.sql` 放入 CLI 產生的檔案；不要同時重複套用兩條部署路徑。

部署後須驗證未授權呼叫被拒絕、正確使用碼可建立連線，並執行 Supabase Security Advisors。確認 `anon` / `authenticated` 無法呼叫配額 RPC 或讀取配額表。

## GitHub Pages 部署

1. 建立獨立儲存庫，例如 `guoer11/ai-live-translator`，將本專案推到 `main`。
2. 儲存庫 Settings → Pages，Source 選 GitHub Actions。
3. 前端已內建這次 Supabase 公開端點，不需新增變數。將來若更換專案，可在 Settings → Secrets and variables → Actions → Variables 新增以下變數覆寫：

   `TRANSLATOR_SESSION_ENDPOINT=https://你的專案.supabase.co/functions/v1/realtime-session`

4. 推送 `main` 或手動執行 Deploy GitHub Pages。流程會先測試，寫入公開 URL，再驗證靜態檔案，才上傳並部署 `dist/`。
5. 完成後網址通常為 `https://guoer11.github.io/ai-live-translator/`。這只是命名範例，不代表目前已部署。
6. 進入頁面「設定」輸入測試使用碼即可測試。不需將使用碼填入 GitHub Actions，也不需公開 Supabase key。

所有前端路徑、manifest scope 與 service worker scope 都相對於儲存庫子目錄。更新任何已快取檔案時，須更新 `sw.js` 中的 CACHE 版本；新版本會等舊頁面全部關閉後啟用，以免中斷翻譯。

`.openai/hosting.json` 若存在，是本次私人介面預覽的識別設定，GitHub Pages workflow 不使用它。將專案複製成不同 Sites 時不可沿用該識別設定。

## 安全與使用量邊界

- 前端只有公開端點，OpenAI Key 與 service role key 只在 Supabase。
- 使用碼只保留在分頁記憶體，不寫入 localStorage/sessionStorage；頁面重新整理需再輸入。這是封閉測試的共用碼，不是正式多使用者登入或授權系統。
- CORS 不是身分驗證，仍須使用碼與後端配額；不可只依賴 Origin。
- Postgres 原子配額以整個 APP 為範圍，每分鐘 5 次、每天 UTC 50 次建立連線。失敗的 OpenAI 建立請求也計次，避免持續重試；無法查配額時拒絕建立連線。
- 配額限制的是「新連線次數」，不是金額或既有連線的音訊用量。前端 10 分鐘停止可被修改過的客戶端繞過，不是服務端硬性費用上限。正式開放前應另做個別使用者授權與服務端會話監控；測試金鑰使用獨立 OpenAI 專案並監看用量。
- 語音經 WebRTC 傳至 OpenAI；Supabase 只交換連線資料。不把音檔存入本 APP。服務供應商資料處理與保存政策不受前端 TTL 控制。
- 字幕以 sessionStorage 暫存在目前分頁，過期後由程式移除；切換頁面回來立即檢查。瀏覽器背景時可能暫停計時器，所以不承諾背景期間精準於第 600 秒擦除磁碟資料。App 重新開啟時會立即清除已過期資料。PWA/瀏覽器可自行清理儲存，歷史不保證一定復原。
- 不把字幕或 API 回應放入 service worker 快取。收到的字幕皆以 textContent 呈現，避免把內容當 HTML 執行。

## 實機驗收清單（尚待連線與裝置）

- Safari iPhone/iPad 允許／拒絕麥克風；拒絕後可重試。
- 三組語言各測兩個方向，含數字、問句、連續兩句、較長句子及背景雜音。
- 連續兩人說話時，譯文與原文對應正確；不會把問句當作聊天回答。
- 開始連線期間停止、收音中停止、斷網、切換背景、鎖定螢幕，確認麥克風指示消失。
- Safari 分享 → 加入主畫面；從主畫面開啟仍可使用麥克風與設定。
- 保留時間 5／10 分鐘、重新整理、清除字幕、離線開啟、版本更新後重新開啟。
- iPad 橫直向與 iPhone 字體放大後無溢出；尚未做瀏覽器畫面 QA。

## 本次驗證

`node --test tests/core.test.mjs`：9 項通過。涵蓋 TTL／儲存失敗、重新整理狀態、快速語句佇列、停止資源清理、Origin／使用碼、CORS／無效輸入、配額失敗拒絕、三語連線設定與秘密隔離、上游錯誤遮蔽。

`node scripts/check.mjs`：JavaScript 語法、HTML 靜態檔案及 PWA manifest 檢查通過。SQL 與 Deno 入口已部署至指定 Supabase；配額 RPC 與權限已實測。

## 官方參考

- OpenAI WebRTC 與 unified SDP endpoint：https://developers.openai.com/api/docs/guides/realtime-webrtc
- Realtime 逐句 out-of-band 回應與事件：https://developers.openai.com/api/docs/guides/realtime-conversations
- Supabase Edge Function 設定：https://supabase.com/docs/guides/functions/function-configuration
- Supabase 開發指南：https://supabase.com/docs/guides/functions/development-tips

本次對照官方文件日期：2026-09-10。
