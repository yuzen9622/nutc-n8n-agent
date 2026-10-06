# 中科大校務 adapter

本服務位於 `apps/school-adapter`，與歷史 synthetic gateway 及 n8n 模型隔離。校方登入、OCR、唯讀解析、內部 HTTP API、加密持久 session 與限流已部署；真實 ePortal／AIS 登入及課表、缺曠、公告查詢已驗證。只有受邀身分、LIFF Session、Origin 與 CSRF 驗證通過的公開 `/liff/bind` 可以提交帳密；adapter 本身不對外開放，密碼不入庫。

## 協定來源

沿用 SDD 所列 `/Volumes/KINGSTON/yuzen/code/nutc_student_system` 的 `b2e4d4fd033e284334d8ea055f9a6fe31dcfb8cc`。只移植課表、缺曠、公告列表的解析；不移植 Redis 密碼保存、自動重登、請假寫入、TronClass／Webmail、背景預熱。

2026-10-06 透過真實匿名 GET 核對 ePortal 的 ASP.NET ViewState、EventValidation、Account／Password／ValidationCode 欄位；captcha 回傳 `images/jpg`，以 MIME 白名單及 JPEG magic bytes 同時驗證。匿名 smoke 不提交帳密，也不把 OCR 結果提交學校，不能證明真登入成功或辨識結果正確。

## 分層與邊界

- `constants/school.ts`：唯一校方端點／期限來源。
- `school.client.ts`：僅 HTTPS SSO／AIS，DNS 位址檢查、CookieJar、逐跳 redirect 檢查、1 MiB 回應限制。不得把 URL、cookies、原始錯誤或 POST body 記入日誌。POST 的 307／308 不重送；302／303 轉成 GET，不轉送帳密。
- `login.parse.ts`、`captcha.parse.ts`：純解析與校方回應判讀。常駐鎖定警告不是錯誤狀態；只辨識明確驗證碼錯誤／帳密錯誤／鎖定訊息，未知結果停止。
- `login.service.ts`：每次呼叫使用新 CookieJar，共用 30 秒截止、最多三輪 OCR，密碼不 trim；失敗清除 cookies。沒有寫密碼的儲存介面，也沒有 silent relogin。
- `ocr.provider.ts`／`ocr.worker.ts`：獨立本地程序、最多兩個工作、20 秒單次上限（仍受登入總計 30 秒限制）、中止即 SIGKILL；不開 debug、不保存影像／辨識文字、不提供任何 `.env` 秘密給 worker。模型取自套件本地 ONNX，禁止其 fetch。
- `student.service.ts`、各 `*.parse.ts`：固定本人課表／缺曠／公告 GET；AIS 到期要求重新登入。異常頁面不回假空資料。課表時間映射沿用原程式，仍須登入後與校方頁面對照。

HTTP 層維持 router → schema/controller → service → repository/client；統一內部 `/internal/v1/school` 註冊入口、獨立 service token、strict 輸入 schema，不能讓 n8n 指定使用者或 cookie。依既有規則所有長效秘密只放根目錄 `.env`，短效 session 必須獨立加密保存並可撤銷。

## 驗證

- `tests/school.test.ts`：Cookie 網域隔離、redirect 不重播密碼、三輪上限、帳密／鎖定／未知錯誤立即停止、密碼空白保留、網路不明不重送、逾時、OCR 工作槽釋放、私有頁面到期及異常空表。
- `scripts/check-school-anonymous.mjs`：真匿名校方 GET＋本機 ddddocr；報告只保存布林／格式／耗時，不保存 captcha、Cookie、ViewState。
- `scripts/check-school-ocr-linux.mjs`：固定 Node 24 Debian image，在 `--network none`、唯讀、非 root、限制 CPU／記憶體的臨時 Linux 容器執行相同 OCR；僅匿名影像經 stdin 傳入，`.env`／學校 Cookie 不掛載。這是本機 Docker 驗收，不是正式 Linux 主機部署。
- `scripts/check-artifacts.mjs`：service／parser 單向依賴檢查。

仍待本人真登入、資料對照、兩位真實使用者隔離、LIFF 綁定及 gateway 在途私人結果撤銷競態驗收。資料庫層的限制、到期與撤銷已用隔離 schema 驗證。

2026-10-06 驗證結果：47 項程式測試及 build 通過；匿名 macOS OCR 格式驗證通過，固定 Linux ARM64 容器 OCR 格式驗證通過。本人帳密尚未提交，真實學生資料和空表樣式仍未驗證。

## 持久 Session 與內部 API

`005-school-sessions.sql` 新增加密 Cookie、登入嘗試及登入 lease。學號使用獨立 HMAC 金鑰雜湊；AES-256-GCM 綁定 LINE owner 及 session ID；密碼不入庫。012 migration 記錄登入結果；013 另將有效 JSON 的未知非零登入拒絕記為 `authentication_rejected`，不說成密碼錯誤。校方明確帳密拒絕、鎖帳及這類明確登入拒絕都計入每人及每學號 15 分鐘兩次保護。OCR、連線、解析、CSRF／session reload、取消及未知原因的舊嘗試不計入；校方明確鎖帳另行保留。共用資料庫鎖與唯一約束仍防止跨程序同時登入。Cookie 閒置 30 分鐘或建立 8 小時失效，過期仍保留帳號綁定直到解除。撤銷 identity 在同一交易刪除 Cookie 及待完成登入。

`POST /internal/v1/school/login` 接受 strict `{userId, account, password}`；`POST /internal/v1/school/query` 接受 `{userId, action}`，action 僅 `schedule`、`absence`、`announcements`。需獨立 `X-Campus-School` token，只有 gateway 可以提供已驗證的 owner；不提供給模型或公開 ingress。私人查詢以 session row lock 序列化 Cookie 更新。

設定見 `.env.live.example`，實值只放根 `.env`。`pnpm start:school` 預設監聽 loopback 3200。尚未部署、尚未把 002–005 migrations 套入實際 app schema，需完成 gateway 整合與部署設定後啟動。

2026-10-06 新增驗證：50 項程式測試、build 通過；`pnpm test:school:database` 於已知 PostgreSQL 的獨立暫存 schema 執行 12 項真實 SQL 檢查並清除，涵蓋跨連線 singleflight、加密持久化、雙維度 rate limit、到期、並行更新及撤銷後晚到登入。報告 `verification/school-database.json` 使用合成身分與 Cookie，不代表真人登入驗收。

私人工具查詢回應包含內部 `sessionId` 與型別化結果，gateway 逐項驗證後以固定本地模板處理。n8n 僅收到 task／lease 綁定的 ref、operation 與 status；資料及待發回覆均加密。完成時驗證校務 Session，發送前再次驗證，過期或被替換的 Session 不發送舊私人結果。

## 未登入與解除綁定後重新使用

學校查詢明確回報session缺失、過期或失效時，Gateway保存task/lease範圍的登入提示，回覆固定LIFF連結；模型不決定登入網址。service驗證失敗不能當成學生登入過期。

「解除綁定」移除學校cookie與私人待發结果。受邀本人若要恢復使用，須在助理的一對一聊天室明確傳送「重新啟用」，再於LIFF重新登入學校。此命令不能建立邀請、不恢復舊session，重送事件也不重複輪替generation。真人流程仍待受邀使用者驗收。

## 校方登入轉址（2026-10-06）

本人真登入的拒絕診斷確認 HTTPS 目的地主機為 `academic1.nutc.edu.tw`。此精確主機已加入 school-adapter allowlist 與學生系統入口範圍；沒有擴大成整個 nutc.edu.tw wildcard。帳密 POST 仍只送至原 SSO endpoint，redirect 不重送帳密，Cookie 仍依網域隔離，HTTP／非預設 port／相似外部主機仍拒絕。登入必須在最後成功讀取固定 AIS home 並通過頁面檢查才會保存 session。合成 transit 測試不代表本人綁定已成功，仍需真實重試驗收。

後續本人重試另觀測到 HTTPS `eportal.nutc.edu.tw` 轉址，與已驗證的新版官方入口一致；已加入此精確主機並補上 academic1 → ePortal → AIS 的合成轉址回歸。仍須本人實際建立後端 session，不能以主機放行或合成測試宣稱真登入成功。

後續真登入紀錄為 `SCHOOL_SESSION_EXPIRED`，證明請求已抵達 adapter 並進入 AIS 確認階段；不是未收到登入。舊 parser 僅選第一個包含「學生管理系統」的連結，現改優先選精確 AIS origin，並加入「舊版入口在前、AIS 在後」回歸。另記 entry／landing／home origin 與頁面結構布林值，不記原始 HTML、帳密、ticket 或 Cookie。77 項測試及編譯通過；實際登入失敗是否由連結順序造成仍待新登入驗證，不把推論當成已證實根因。

## 新版 ePortal 真實登入修復（2026-10-06）

本輪直接重現舊 SSO 成功 → academic1 → 新 ePortal 登入頁，未建立 AIS Cookie 的問題；不是密碼錯誤，也不只是舊入口排序。正式入口改為已從校方 dashboard 核對的 `/?app_id=NUTC_6401`。

新協定：讀 CSRF／固定學生 app → 本地 OCR 四字元驗證碼 → `login_page.php` 的 `verifyCode` → 固定 `login_action.php` 送帳密及 CSRF → `login_check.php` 的有限 JS location → `token_auth.php`／`login_main.php` → `redirect2app.php` 的固定 `get_redirect_url` → 校方 AIS ticket → 固定 AIS home 結構驗證。只解析已觀測的 location 字串、不 eval 校方 JS；帳密、CSRF 不隨 redirect 重播。校方同時對無關 IP domain 發出的 Set-Cookie 按瀏覽器語義忽略，合法 cookies 仍受 CookieJar 網域隔離。三輪／30 秒總期限不變。

部署容器實測新登入約 12.9 秒；三项真實查詢成功，報告不保存私人列內容。公開 `/liff/bind` 經 Origin、CSRF 與受邀 owner session 回 200，新增加密校務 session；此回合測試 web session 由管理程式為既有唯一受邀 owner 建立，不冒充新的真人 LINE OAuth 登入。其後透過正式 school API 再讀三項資料皆 200。後續固定 n8n 2.41.7 管理驗收使用真 school provider：三項 HTTP 工具只回 ref/status，真私人結果本地組裝、加密 outbox、派送前核對 session，再由 LINE 官方 API 接受 push；成功後清正文。temporary workflow/execution 及管理验收 task 已移除，詳見 [school-live-runtime.json](verification/school-live-runtime.json)。這不是新的 LINE 入站事件或模型選工具驗收。正式 worker 仍關閉，費用帳本保留。

公開 `POST /liff/bind` 的既有 strict `{account,password}`、Origin、LIFF Cookie 與 CSRF 契約不變。新增錯誤 `SCHOOL_AUTHENTICATION_REJECTED`：內部 school API 回 401，gateway 公開 bind 映射為 409／`{"error":"SCHOOL_AUTHENTICATION_REJECTED"}`，UI 告知校方拒絕登入、但不一定是密碼錯誤；兩次明確拒絕後回既有 `SCHOOL_LOGIN_RATE_LIMIT`。其他 HTTP／OCR／解析故障仍為技術失敗，不藉此推定錯誤密碼。
