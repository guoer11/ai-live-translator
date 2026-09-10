# 家庭 Google 登入設定（V0.2.0）

程式已使用 Supabase Auth PKCE。實際 Google OAuth 必須由管理者在 Google Cloud 建立 Web application Client ID，再於 Supabase 啟用 Google provider；不將 Client Secret 放進前端或 GitHub。

1. Google Cloud → Google Auth Platform：建立專案或選既有專案，設定 Branding（應用名稱及支援信箱）、Audience 選 External。家庭測試可先維持 Testing，將指定家人加入 Test users。僅要求基本 openid/email/profile。
2. Clients → Create client → Web application。
   - Authorized JavaScript origins：`https://guoer11.github.io`
   - Authorized redirect URIs：`https://mflhfttirywdsqvjhvhl.supabase.co/auth/v1/callback`
3. Supabase ai-translator → Authentication → Sign In / Providers → Google：啟用，填入上述 Client ID 與 Client Secret，儲存。
4. Authentication → URL Configuration：Site URL 及 Redirect URLs 都設定 `https://guoer11.github.io/ai-live-translator/`（保留結尾斜線）。
5. 停用不使用的 Email provider，保持 Anonymous Sign-ins 關閉。Google 第一次登入需要允許新使用者建立 Auth 帳號；使用權由後端名單另外把關。
6. 開啟 APP，以指定家庭帳號登入。非名單帳號即使通過 Google 驗證，也會被後端拒絕使用；使用碼已移除。測試登出後麥克風停止、對話清除，以及非授權帳號無法開始翻譯。

名單存於 `public.translator_allowed_users`，RLS 開啟、一般角色無讀寫權限，僅 service_role 可讀。實際名單不提交 GitHub。停用某人的 enabled 後，下次權限檢查／建立翻譯連線即拒絕；已建立的 OpenAI 連線不會被資料庫自動切斷，最長維持原本 10 分鐘上限。

手機主畫面 PWA 的 OAuth 往返仍需實機測試；若在外部 Safari 完成登入，回原本啟動登入的瀏覽器測試，不手動複製登入碼。登入工作階段由 Supabase SDK 儲存在該網站的 localStorage，字幕維持 sessionStorage；登出／換人會清除字幕。

驗證：`npm ci --ignore-scripts`、`npm test`、`npm run build`。SDK 固定為 `@supabase/supabase-js@2.116.0`，由 lockfile 安裝並於 build 複製官方 UMD 與 LICENSE 至本地靜態資產，執行時不依賴 CDN。Google 真實登入、iPhone PWA 與付費語音須完成 OAuth 設定後驗證。

官方文件：https://supabase.com/docs/guides/auth/social-login/auth-google
