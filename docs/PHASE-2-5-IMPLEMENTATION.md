# Phase 2–5 實作與驗收追蹤

目標：將實際使用入口改為真實 LINE／LIFF、Gemini、公開官方語料與校務資料；歷史 synthetic 資產僅保留作回歸。未完成項目不得以合成結果標記通過。

## 架構邊界

- `apps/mock-gateway` 維持 Phase 1 synthetic-only，不加入外連。
- `apps/gateway` 放正式身分、持久任務、provider adapters 與本地回覆組裝；採 router → schema/controller → service → repository/provider。
- 學校登入／Cookie／OCR 應在獨立 school-adapter；必須依實際學校協定實作，不猜 URL、欄位或成功條件。
- n8n 仍使用原生 Agent、Gemini、Memory、PGVector 與直接 HTTP Tools；正式切換必須同步生成 JSON、固定 runtime 實跑及 editor 驗收。

## 目前驗收狀態（2026-10-06）

下表為現況；後續各節保留分階段歷史證據，當時的「未設定／未測試」不代表最新狀態。

| 範圍 | 已有證據 | 尚未完成 |
|---|---|---|
| LINE／LIFF | 官方 webhook 驗證、Console 本人 ID 核對、`.env` 單人邀請同步、本人真實 ID token 驗證與 LIFF session | 真 LINE 問答、回覆派送及多輪端到端 |
| 持久任務／生命週期 | 真 PostgreSQL 隔離測試、原生 n8n HTTP／Memory runtime、去重／lease／撤銷／清除競態 | 真 LINE 跨服務驗收 |
| Gemini／PGVector | 真 Gemini、3072 維 embedding、3 份官方文件／6 段原生匯入與檢索 | 40 題 QA 與全功能整合；目前 11 題通過公開問答層 |
| Google 搜尋 | 官方 Gemini `google_search`、加密本人結果、LIFF Search Suggestions、原生 n8n 合成 provider 驗證 | 真付費搜尋、實際回傳 HTML 相容性、費用上界驗收；仍未啟用 |
| 共用預算 | 原子預留／結算、實際 upstream HTTP 結果稽核、失敗回應測試 | 剩餘保守預算不足下一次 chat 預留；不得清空歷史帳本 |
| 校務登入 | 新版 ePortal／AIS 真登入、公開 bind HTTP 200、加密持久 session、三項真實學生查詢；013 明確拒絕限流補強 | 本輪 bind 的 web session 為既有單人受邀 owner 管理建立，不冒充新真人 LINE OAuth；新一輪本人 LIFF UI 待驗收 |
| 學生工具／混合回覆 | 真課表／缺曠／公告經固定 n8n HTTP runtime → 加密 outbox → 真 LINE push 已接受；回覆正文已清，temporary 管理驗收資料移除 | 真模型選工具、真人 LINE 入站、公開／私人混合端到端仍待驗收 |

## 已確認設定與待完成事項

- 根目錄 `.env` 保存手動管理秘密；Messaging Channel `2011885580`、Login Channel `2011885607`、LIFF `2011885607-MccunYXG`、LINE secret／token、Gemini keys 與唯一受邀本人 ID 已設定。n8n credentials 由 n8n 加密資料庫管理，不是 `.env` 自動同步。
- 公開 origin 為 `https://nutc-agent.yuzen.dev`。LIFF `/liff` 與 `/liff/` 均實測 HTTP 200；Cloudflare ingress 與 gateway 已同步接受兩者，避免 LINE SDK 回傳無尾斜線路徑時 404。Messaging webhook 為 `/line/webhook`，LINE Login 採 LIFF SDK 流程。
- 本人 LINE 身分驗證成功與校務登入分開驗證。本輪依使用者提供的測試憑證完成真校務登入；密碼未寫入 `.env`、程式檔或報告，登入後僅保存加密 Cookie。
- 使用者指定 Gemini 內建 Google Search，不使用 Serper；Brave 不再是正式搜尋的必要憑證。
- 目前費用帳本累計 US$1.787719，按保守 NT$40/USD 約 NT$71.51，屬預留／結算上限而非實際帳單。共用 US$2 上限剩 US$0.212281，小於下次 chat 預留 US$0.25。NT$100 累計授權不變，未新增付費呼叫。
- 新版 ePortal 的原生帳密／CSRF／captcha／固定學生 app SSO 已在後端實作並真正建立 AIS Cookie，不依賴第三方 callback 或匯入瀏覽器 Cookie。舊瀏覽器結構證據保留於 [eportal-browser-sso.json](verification/eportal-browser-sso.json)，本輪真工具與 LINE push 證據見 [school-live-runtime.json](verification/school-live-runtime.json)。

## 目前操作限制

本機正式 migrations 002–012 已套用；gateway／school-adapter 健康。`campusNativeAgentLive` 未發布，`LIVE_AGENT_ENABLED=false`，Google 搜尋未啟用。n8n 的 11 個歷史合成 workflow 與其 execution、6 個合成 credentials、mock 容器及根 `.env` 的6個 mock token 已清除；預設 Compose 不含 mock。原始碼／JSON／fixture 僅留歷史回歸，不匯入正式服務。Phase 2–5 尚未達成完整真實端到端，不開放一般使用者。

最新 LINE 證據：[liff-live-login.json](verification/liff-live-login.json)。本次路由修正及安全錯誤碼診斷通過 73 項測試、`pnpm check`／`pnpm build`；Cloudflare ingress validation 通過。校務錯誤診斷只記錄內部固定錯誤碼，不記錄帳密、Cookie 或校方 HTML。此診斷尚未捕捉新一輪本人綁定失敗。

## 本輪驗證

- `pnpm check`：型別、回歸與新增 LINE 單元測試、既有 workflow 靜態圖檢查。
- `pnpm build`：編譯正式 gateway 與既有 mock gateway。
- `pnpm test:line:database`：在既知本機 Compose 的 PostgreSQL 建立一次性 schema，使用真實 repository 驗證並行去重、受邀資格、隔離、清除、撤銷、同使用者單一 lease、lease-bound completion、atomic outbox、重試 key 與保留期限；結束刪除該測試 schema。證據見 [line-database.json](verification/line-database.json)。
- provider HTTP 回應在單元測試中使用 fixture；沒有呼叫真實 LINE。資料庫測試使用合成使用者，沒有碰既有對話或學生資料。
- 正式工作流草稿已生成、匯入已知本機 n8n 2.41.7 並檢查 editor 畫布，保留未發布。`check-live-dispatch-runtime.mjs` 使用真正 prepare／complete HTTP 節點、原生 Postgres Memory 與 generation trigger，驗證 durable outbox；資料為測試 fixture，沒有執行 AI Agent／Gemini／真實工具選擇。證據見 [runtime](verification/live-dispatch-runtime.json) 及 [草稿](verification/live-agent-draft.json)。

## 正式任務派送契約

- Worker 先 claim 持久任務，隨機產生 lease 與 capability（DB 僅存 capability hash），只把這三個欄位送至內部 n8n Webhook；不重送結果不明的模型工作。
- n8n `prepare` 以獨立 service token 驗證，原子取得一次性執行權；prompt／session key 從 DB 本人身分與 generation 推導，外部不得傳入 session 或 userId。
- 四顆 HTTP 工具與 complete 都固定傳 taskId／lease／capability。HTTP 工具每任務最多四次；此限制仍不涵蓋原生模型／embedding，不能視作總費用限制。
- 同人同時只處理一個任務；不同人最多五個。錯誤、逾時及 worker 失聯會建立固定失敗通知；已完成的任務不會再產生第二筆 outbox。
- Outbox 以固定 UUID 當 LINE retry key。發送時鎖定本人身分，避免撤銷超越正在發送的請求；有界重試、23 小時截止，成功後抹除回覆文字。
- 原生 Memory 使用獨立 `live_agent_chat_histories`，DB trigger 在 INSERT／UPDATE 時鎖定與驗證目前 generation；清除／撤銷後的延遲寫入拒絕。

## 公開證據與成本新增驗證

正式 reader 已透過受控 DNS／HTTPS 讀取 LINE 官方文件作為無付費連線 smoke；並非中科大語料驗收。Brave 搜尋單元測試使用 HTTP fixture，資料庫測試覆蓋來源過期／撤下／版本與總預算併發；Gemini proxy 測試同樣為 fixture，未呼叫 Google。原生 runtime 的搜尋結果由明確測試 provider 注入，不代表已使用真 Brave。

2026-10-06 本輪設定／LIFF 更新：`pnpm check` 39 項測試通過，`pnpm build` 通過。包含 `.env`／secret file 互斥、LIFF Channel 一致性、HTTPS origin、跨來源驗證拒絕與 SDK 回跳頁 HTTP 測試；未使用真實 LINE token，未完成真 LINE 登入。使用者選擇既有公開 HTTPS 網域，等待其實際網址與代理設定。

## 公開入口（2026-10-06）

使用者指定 Cloudflare Tunnel 與 `nutc-agent.yuzen.dev`，已建立獨立 tunnel `fc9524a7-43ef-47d4-bf18-2d0a11d954c1` 及 DNS CNAME，不改動既有其他 tunnel。公開 ingress 在 loopback 3101，只接 LIFF 頁／設定與 LINE webhook／identity；內部 gateway 3100、n8n 管理與 provider proxy 不公開。

- LIFF endpoint：`https://nutc-agent.yuzen.dev/liff/`（瀏覽器及 curl 200；LIFF ID 未填時顯示尚未完成設定）。
- Messaging webhook：`https://nutc-agent.yuzen.dev/line/webhook`（正式 gateway 缺憑證，現在回 503，不能宣稱 Verify 通過）。
- LINE Login 使用 LIFF SDK，不需自訂 OAuth callback；新增 LIFF app 並勾選 `openid`，提供完整 LIFF ID。
- `pnpm check` 40 項測試與 `pnpm build` 通過；公開 API 邊界實際 HTTPS 驗證見 [public-ingress.json](verification/public-ingress.json)。這 40 項程式測試不是 Phase 3 要求的 40 題問答驗收。
- 目前 public ingress 與 tunnel 是背景程序，非開機自動服務。程序 PID 記錄在忽略 Git 的 `.local/public-ingress-processes.json`；重啟前先確認該程序仍屬本專案，避免重複啟動。

重新啟動（先確認程序未在執行）：

```sh
pnpm build
pnpm start:public
# 另一個終端
pnpm start:tunnel
```

Cloudflare 非秘密路由在 `infra/cloudflare.yaml`，憑證 JSON 放根目錄 `.env` 的 `TUNNEL_CRED_CONTENTS`，由 `pnpm start:tunnel` 透過環境變數傳入，不建立另一個憑證檔。實際 LINE 登入與校務綁定尚未完成，整體 Phase 2–5 仍進行中。

## 秘密設定統一（2026-10-06）

依使用者要求，專案管理的秘密只以根目錄 `.env` 作為設定來源，包括 LINE／Brave／Gemini、service tokens、PostgreSQL 密碼、n8n 加密金鑰與 owner 登入、Cloudflare `TUNNEL_CRED_CONTENTS`。權限 `0600`，排除 Git 與 Docker build context。不再支援秘密 `*_FILE`；`OFFICIAL_HOSTS_FILE` 僅是非秘密的官方網域清單。

原有 17 個秘密／credentials JSON 檔在逐項確認與 `.env` 值一致後移除，沒有輪換任何既有密碼或加密金鑰。n8n CLI 匯入 credentials 改用 stdin；測試程序的短效 token／capability 只經記憶體、環境變數或 pipe 傳递，不建立秘密檔案。`scripts/check-secrets.mjs` 同時檢查 Git 可見檔案與 `.local` 秘密副本。

n8n 2.41.7 原生仍會把加密金鑰寫入容器內 `.n8n/config` 並將 credentials 加密存在資料庫，這是已檢查原始碼的 runtime 行為；不是另一份需人工維護的專案設定，不能直接刪去金鑰而破壞啟動／解密。

驗證：`pnpm check` 39 項通過（移除舊 file-secret 支援測試）、`pnpm build` 通過；Compose 以 `--env-file .env` 重建後四個容器健康；owner 登入及 17 節點 live 草稿讀取成功；26 項隔離 DB 檢查、原生 n8n Memory／HTTP／outbox runtime 通過；公開 LIFF HTTPS 200。Cloudflare 已重新以 `.env` 憑證啟動，未使用舊憑證 JSON。仍未呼叫付費 provider／真實 LINE 發送。

2026-10-06 已依使用者提供設定 `LIFF_ID=2011885607-MccunYXG` 於 `.env`，重啟 public ingress；公開 `/liff/config` 200，瀏覽器 LIFF SDK 初始化成功、登入按鈕啟用。LINE Messaging secret／token、Brave key 尚未設定，不能將此結果視為後端身分驗證或校務綁定完成。

## 中科大校務核心（2026-10-06）

已新增獨立 `apps/school-adapter` 的 SSO／AIS 有界連線、真實 ASP.NET 登入協定、三輪／30 秒登入控制、本地 ddddocr 子程序與課表／缺曠／公告列表解析。沒有對外開放帳密輸入；持久 session／LIFF 綁定、rate limit、本人工具 ref 與私人回覆銜接仍未完成。架構與驗證邊界見 [SCHOOL-ADAPTER](SCHOOL-ADAPTER.md)。

真實匿名登入頁／驗證碼已讀取；本地 OCR 產生五字元格式，沒有送出學校帳密或驗證登入，報告見 [school-anonymous.json](verification/school-anonymous.json)。不能把匿名 OCR smoke 當作本人登入或課表資料驗收。

本輪最終：`pnpm check` 47 項通過，`pnpm build` 通過；本機 Docker 的固定 Node 24 Debian Linux ARM64 OCR 驗收通過（18.7 秒，無網路／唯讀／非 root），見 [school-ocr-linux.json](verification/school-ocr-linux.json)。初次 8 秒 OCR 限制不足以涵蓋 Linux 冷啟動，已改為單次 20 秒，仍由登入總计 30 秒 AbortSignal 覆蓋，未放寬登入總期限。

## 校務 Session 持久層（2026-10-06）

已加入內部校務 HTTP API、嚴格 schema／獨立 token、AES-GCM Cookie 與 HMAC 學號、跨程序登入限制、30 分鐘閒置／8 小時絕對期限、解除綁定交易刪除及晚到登入拒絕。50 項程式測試與 build 通過，隔離 PostgreSQL schema 的 12 項實際 SQL 驗證通過，見 [school-database.json](verification/school-database.json)。

仍未部署校務服務／套用實際 schema，LIFF web session／CSRF、綁定表單、私人工具 ref 與回覆管線尚未串接；沒有提交學校帳密、讀取私人資料或付費呼叫。

## LIFF 綁定入口（2026-10-06）

已新增伺服器端 LINE token 驗證後建立的 LIFF Session：256-bit 隨機 token，以 Secure／HttpOnly／SameSite=Strict／__Host- Cookie 傳送，資料庫僅保存 token／CSRF 的 SHA-256。絕對期限 15 分鐘，每次重新登入輪換，清除對話／撤銷資格使旧 Session 失效。綁定必須通過固定 Origin、CSRF、strict schema，使用者 ID 由資料庫決定；學號／密碼只轉交獨立校務服務。

LIFF 靜態頁已加入本人學號／密碼表單，送出即清空密碼欄，錯誤使用固定文案，不顯示 upstream 原文。`SCHOOL_ORIGIN` 僅接受指定本機／Compose 內部端點，service token 只取根 `.env`。校務登入最長 35 秒，public ingress 對此固定路由等待上限 40 秒。

本輪尚未重啟公開 ingress、套用實際資料庫 migrations 或啟動 gateway／school-adapter；公開站仍是原有版本。沒有執行真 LINE 身分驗證或提交校務帳密。006 migration 與 Session SQL 使用隔離 schema 驗證；並非上線驗收。

驗證結果：`pnpm check` 52 項通過、`pnpm build` 通過；校務／LIFF 隔離資料庫檢查共 14 項通過。Git diff 格式及秘密外洩檢查通過。HTTP 測試使用合成 LINE 身分與校務回應，尚未驗證實際 LINE SDK 到學校的端到端流程。

## 真實私人工具接線（2026-10-06）

`TaskService` 的三項 personal 操作已由 `SCHOOL_NOT_CONFIGURED` 固定失敗改為呼叫獨立校務 API（未設定服務仍 fail closed）。使用者取自已驗證 task，不接受模型指定。學校回應經型別／action 驗證，本地模板支援課表、缺曠、公告與明確空資料，過長內容告知至校務系統查看，不捏造摘要。

007 migration 新增 task／lease／operation 綁定的私人 ref。私人文字以 AES-GCM 與情境 AAD 加密，模型只收到 ref／status；完成時將本次私人結果與有來源的公開回答組合，outbox 亦加密。發送前持有身分／校務 Session 鎖檢查撤銷與到期，失效則取消；成功或永久失敗清除待發正文。清除對話／撤銷會移除私人 refs。

54 項程式測試及 build 通過，31 項 LINE／task 隔離 SQL 檢查通過，包含私人參照、加密、lease、解密交付與 Session 到期取消。資料均為明確合成驗證資料；真實校務帳密、LINE 發送、Gemini／Brave 付費呼叫仍未執行，公開部署仍待完成。

固定 n8n 2.41.7 runtime 亦通過：實際 prepare／公開搜尋／學生工具／complete HTTP 與原生 Memory 節點執行成功，execution 不含私人測試標記；加密 outbox 經本地交付回呼驗證包含私人模板與官方來源。學校／搜尋 provider 使用合成 fixture，未呼叫 Gemini 或 LINE，詳見 `verification/live-dispatch-runtime.json`。

## 本機真實服務部署（2026-10-06）

使用者補入 LINE／Gemini keys 後，LINE bot info 與兩組 Gemini models list 驗證成功；既有 `models/gemini-3.8-flash` 可用。沒有執行生成／embedding。LINE webhook 已由使用者設定至公開網址並啟用；本輪官方 webhook test 回傳 `success=true`、HTTP 200，證明真實簽章與 destination 可接受。

已將 002–007 migrations 套入既有 `campus_agent`，新增 checksum ledger、transaction／advisory lock，重跑沒有重複套用；沒有覆寫既有表資料。gateway 與 school-adapter 使用固定 Node 24 Debian 映像基底、唯讀／非 root／內部網路部署，兩個容器 healthy；gateway 僅 host loopback 3100，校務無 host port。Agent worker 與付費預算保持關閉，尚未注入 Gemini／Brave 到容器。

首次映像 unpack 遇 Docker VM 空間不足，只清除本次建立的兩個 BuildKit cache ID（約 880 MB），未清理任何既有容器、映像或 volumes。既有完成的 image layers 隨後成功 unpack 並啟動，未以其他平台或假服務替代。

公開 ingress 已更新，LIFF SDK 按鈕啟用，未登入 bind 401、跨 Origin identity 403、內部 routes 404。部署中的校務容器匿名 GET／本地 OCR 格式檢查通過（3.445 秒），仍未提交帳密或驗證 OCR 正確率。54 項測試及 build、秘密檢查通過。證據見 `verification/live-local-deployment.json`；操作見 [live-local](runbooks/live-local.md)。

尚待 `.env` 的 `INVITED_LINE_USER_IDS`（已向使用者索取）、真人 LIFF／校務綁定、Brave key、模型預算代理與原生節點設定、官方向量語料／40 題驗收。不是 Phase 2–5 全部完成。

## 真實 Gemini 與執行環境異常（2026-10-06）

已查核官方 3.8 Flash／embedding-001 定價與臺銀匯率，設定共用 US$2 累計上限（以 NT$40/USD 保守計 NT$80）。成功聊天依 totalTokenCount × 較高輸出費率作保守結算，未知／失敗嘗試不退還預留。55 項測試與 build 通過。費率與計算見 [PROVIDER-BUDGET](PROVIDER-BUDGET.md)。

真實已部署代理的 generateContent 與 embedContent 通過，文字輸出有內容，embedding 維度3072，未送私人資料；見 `verification/live-gemini.json`。先前 minimal 不支援的400仍計入預留，已改 low；最後確認帳本為 US$0.275454（NT$40/USD 約NT$11.02），這是保守預留／結算上限，不是 Google 帳單。

Docker VM 僅24GB且反覆磁碟滿，曾造成 PostgreSQL checkpoint失敗。移除本次完整映像與快取後曾確認資料庫復原、六筆遷移完整、原有資料保留；本機改為固定Node映像＋唯讀 workspace artifacts。之後空間再次不足，執行閒置 BuildKit cache 清理（不刪映像／容器／volumes）期間 Docker engine 中斷。Desktop 顯示running，但engine API逾時／500。原生n8n模型／PGVector probe因連線中斷失敗，沒有取得成功證據，不能把直接Gemini API成功當成原生節點成功。

目前服務健康狀態未重新確認，公開LIFF靜態頁仍可開，但backend功能不可承諾可用。已向使用者請求Docker Desktop重啟確認，因重啟會中斷同VM其他專案容器；等待回覆，未擅自重啟。其後須檢查 engine、PostgreSQL、n8n、gateway與school，再重跑原生probe。

使用者隨後調大 Docker VM；實測容量48GB、可用26GB，engine恢復，PostgreSQL非recovery且postgres／n8n／gateway／school全部healthy。沒有由agent重啟Docker。中斷execution127先經stop確認canceled並移除臨時workflow，再重跑execution128成功；原生Gemini Chat Model與Gemini Embeddings＋PGVector load已通過，詳見 `verification/native-live-gemini.json`。向量表仍空，不能作語料命中證據。LINE官方webhook重新測試200成功。

本輪最後帳本：Gemini4次（含失敗／中斷）保守累計US$0.251482，embedding3次US$0.075，共US$0.326482；按NT$40/USD約NT$13.06，累計硬上限US$2仍有效。秘密檢查通過。

## 官方語料與原生 RAG（2026-10-06，Docker 擴容後）

已套用 008 migration，建立 3072 維 staging／正式 chunk 表、批次發布紀錄及有效來源 view。新增核定來源 catalog、正文 reader 改善、按段切分、hash 去重與整批原子發布。來源未標發布／施行日的欄位保留 null；來源矛盾不能自行判定優先順序。

本機原生匯入工作流 `GpPL25hCJhMyJEIa` 已實跑並在 editor 檢查。第一批 2 份官方 HTML、5 段，真實 Gemini embedding 已入庫。初次 execution129 因未保存 manual data 留下過時 running DB 紀錄，stop API 確認沒有可停止的執行；其發布以資料庫證據確認。調整公開語料工作流保存 execution 後，再次執行134完整 success，重用5段既有向量，沒有執行embedding／insert節點，不重複扣 embedding 費。

execution130 原生 PGVector 查詢命中缺曠更正說明；execution132 原生 Gemini Agent 真正使用 campus_knowledge，回傳具2個官方sourceId的答案。第一次完整 Agent probe 回傳 Markdown JSON code fence，被原本嚴格 parser 拒絕；已增加只接受「單一完整 JSON fence」的相容處理，仍拒絕前後多餘文字與額外欄位。沒有用假回應取代模型。

正式草稿已改接共用費用 proxy、`campus_knowledge_current`，並由固定 completion 節點轉送 native observation。Gateway 核對段落全文／chunkId／sourceId／version，再建立 task／lease 證據；來源有效性在完成與派送再次檢查。原有 editor layout 保留，仍未發布。14項隔離SQL測試通過，含不完整發布／維度／撤下／過期／舊版／段落竄改／lease。原生Memory與加密私人outbox回歸execution133通過；其學校／搜尋仍為明確標示的fixture，沒有真人私人資料。

費用帳本累計US$0.573924（以NT$40/USD約NT$22.96），屬保守預留／結算上限，不是實際帳單；原US$2累計硬上限不變。40題公開QA與14項私人／混合／隔離驗收清單已建立在 `docs/qa/phase-2-5.json`，全部明列not-run，不能當通過證據。

當時仍缺搜尋供應商設定、INVITED_LINE_USER_IDS 與本人 LIFF／學校登入。後續使用者指定僅本人試用、詢問以 Google Search 替代 Brave；最新範圍見下方。PDF語料、完整QA與真人LINE端到端尚未完成。Phase2–5目標仍進行中；正式LINE worker保持關閉。

最後驗證：59項程式測試、`pnpm check`、`pnpm build` 與秘密掃描通過。gateway 健康檢查曾遇既有 Docker overlayfs 路徑不存在；僅以既有映像重建本專案 gateway 容器後復原，未重啟Docker或其他專案、未動資料庫volume。postgres／n8n／gateway／school皆healthy；本機health200、公開LIFF200、公開internal路徑404，LINE官方webhook test再次HTTP200／success=true。

## 未登入指引與明確重新啟用（2026-10-06）

009 migration 新增任務綁定的 `school_login_required`。School adapter 明確回報登入缺失／過期／失效時，工具回傳安全狀態，由 Gateway 本地產生固定 LIFF 連結；不採用模型生成的登入網址，也不在聊天室收帳密。狀態持久化，模型後續失敗仍會回覆登入指引。service credential 的401或非預期錯誤維持服務失敗，不誤導使用者重登。

曾解除綁定但仍在受邀名單的使用者，可透過已驗簽的一對一 LINE 訊息精確傳送「重新啟用」。此操作輪替 generation、沿用 inbox 去重並排入固定確認回覆；不恢復舊學校 cookie，也不替未受邀者取得資格。一般訊息、群組訊息及舊 LIFF session 不會重新啟用。LIFF 對撤銷狀態提供上述明確操作指引。

61項程式測試、39項LINE／task隔離SQL檢查、14項school／LIFF隔離SQL檢查與build通過。SQL使用合成身分；真人登入／LINE訊息仍未驗收。009已套入本機DB，gateway與公開LIFF ingress已更新；正式worker仍關閉。本輪沒有付費供應商呼叫。

## 單人試用與搜尋替代評估（2026-10-06）

使用者指定目前只開放本人。INVITED_LINE_USER_IDS 僅需一個本人 U 開頭的 LINE User ID，存放根目錄 .env；既有邀請腳本支援單一使用者。雙真人隔離驗收 QA-39 延後，不作為單人試用前置條件；合成身分隔離測試仍保留。截至此次檢查，.env 尚未填入使用者 ID，不能宣稱已完成邀請。

Google Search 尚未接入，也未進行付費搜尋呼叫。Google Custom Search JSON API 已停止接受新客戶，既有客戶服務至 2027-01-01。Gemini Google Search grounding 並非現有 Brave「搜尋網址→官方頁 reader→來源證據」的直接替代：條款禁止以其 Links 識別爬取頁面，並要求向提問者一併呈現 Grounded Results 與 Search Suggestions。若採用，需獨立結果呈現流程，不能將結果網址抽出送入目前 reader／RAG 入庫。官方語料 RAG 的驗收不依賴 Brave；搜尋替代方向待使用者回覆，NT$100 累計測試上限不變。

依據：https://developers.google.com/custom-search/v1/overview 、https://ai.google.dev/gemini-api/terms#grounding-with-google-search 。

## 官方 PDF 解析與真實原生匯入（2026-10-06）

新增固定 pdfjs-dist 6.4.299 文字解析子程序，不繼承 .env，128 MiB JS heap、10 秒期限、兩個程序上限。沿用官方 reader 的 HTTPS／DNS／redirect／1 MiB 限制；最多30頁、120000 UTF-8 bytes，空白／圖片頁、壞檔、過大或逾時整份拒絕。只做文字擷取，不執行 viewer 或 PDF 腳本。PDF 逐頁切段並保存實際頁碼，不跨頁混合。

加入校方「請假及缺曠注意事項」PDF，逐項核對原頁6項內容及頁首；macOS 與 Linux 實際解析文字一致。未標明發布／施行日期，因此 metadata 仍為 null，不宣稱最新法規。n8n execution135 成功發布3份文件／6段，既有5段向量重用，只新增1次真實embedding。execution136原生PGVector查詢命中五專前三年請假流程，確認page=1。n8n executions 畫面顯示135 Succeeded、No active executions。證據在 `verification/knowledge-pdf.json`。

65項程式測試、14項語料SQL驗證、pnpm check、pnpm build與秘密掃描通過。費用帳本累計US$0.623924（以NT$40/USD約NT$24.96），屬保守預留／結算上限，不是實際帳單；US$2累計硬上限不變。正式worker仍關閉；40題QA、真實搜尋與本人LINE／學校登入驗收未完成。

## 公開問答分層驗收（2026-10-06）

新增 `scripts/run-public-qa.mjs`，每批明確指定1–8題；保留每題 execution、原始回答、原生檢索 observation、當次來源引用與模板 hash，擷取成功後仍需逐題語意核對。重測只允許明確標記待修正的一題，保留原失敗結果；未知執行狀態不自動重啟。測試僅使用原生 Gemini Agent 與真實 PGVector，未接 LINE、Memory、搜尋或私人工具，不能作為這些整合的通過證據。

executions137–148完成12題。QA-01～09中的1、2、3、4、5、6、7、8、9，以及43、47，共11題通過此層語意檢查：包含真實來源網址、PDF流程、45節門檻衝突、未標日期與缺少銷過細節時的限制。QA-12未捏造期限，但推薦了尚未確認存在的法律系所辦公室，保留為待修正。

已在 canonical generator／JSON 與未啟用的正式草稿補上國立臺中科技大學範圍、未知系所先澄清、不得編造單位或聯絡方式。API讀回及editor系統提示已核對。execution149重測失敗，不能宣稱修正已經真模型驗證；當時runner未保存細節便移除臨時工作流，無法從留存資料斷定確切錯因。runner已改為保留失敗工作流及固定錯誤碼供診斷。

目前帳本US$1.787719（保守NT$40/USD約NT$71.51），剩US$0.212281，低於下一次chat固定預留US$0.25，因此停止更多付費chat。未清空帳本、未提高上限。公開QA仍未達40題，修正重測、搜尋與真人整合皆未完成。詳見 `verification/public-qa.json` 和 `qa/phase-2-5.json`。

## 單人名單同步與設計文件校正（2026-10-06）

原邀請脚本只增加資格，無法保證 `.env` 移除的使用者失去存取權。已改用LineRepository原子同步名單：同一交易鎖定身分、收回未列入者資格、輪替generation，透過既有trigger移除校務／LIFF session及私人ref，並清除Memory、取消未交付任務與outbox。保留身分／稽核資料；重新加入名單保留revoked狀態，仍需本人明確重新啟用。名單為空或格式無效拒絕整次操作；重跑相同名單不干擾保留者session。

65項程式測試與44項隔離LINE／task SQL驗證通過，pnpm check／build及秘密掃描通過。新增5項SQL檢查包含只保留一人、移除者清理、保留者不變、冪等／無效名單拒絕、重新加入不恢復舊登入。只使用隔離schema合成身分；根.env仍未填本人User ID，沒有執行正式邀請同步。

SDD v0.5已區分歷史mock流程與正式持久流程，校正先前仍寫「模型未驗證、沒有語料、沒有inbox/outbox／Memory清理」的過時描述。未降低費用預留：Google countTokens官方範例與生成用量可不同，不能僅依估計值保證硬上限；本輪無付費呼叫，帳本不變。

## 2026-10-06 Google 官方搜尋接線

使用者明確排除第三方 Serper，已加入 Gemini 官方 `google_search` provider、費用預留、加密的本人搜尋回答、LIFF 結果讀取與 Search Suggestions 顯示。新增 migration 010；主 Agent 得到狀態，Gemini 的搜尋統整答案由本人結果頁完整呈現，不交 crawler/RAG。詳細實作、測試與尚未啟用原因見 [Google Search](GOOGLE-SEARCH.md)。目前只完成離線／隔離驗證，不能標記 Google 或 LINE 端到端完成；100 元預算不擅自提高。

## 修正校務登入誤鎖（2026-10-06）

使用者回報「已達登入次數限制，請於 30 分鐘後再試」。實際 adapter 診斷碼為本地 SCHOOL_LOGIN_RATE_LIMIT，並非校方回報鎖帳。舊版把所有嘗試（含 OCR／網路／解析失敗）計入兩次／30 分鐘，導致除錯期間阻擋本人。

012 migration 保留舊記錄為 legacy_unknown，不將未知結果推定為密碼錯誤。新嘗試分別記錄成功、技術失敗、校方明確拒絕帳密及鎖帳；只有明確拒絕帳密才計入同人／同學號兩次／15 分鐘保護，校方鎖帳仍拒絕。技術失敗可重試，跨程序單一登入與 session 所有權限制保留。74 項單元測試、18 項隔離 PostgreSQL 驗證與 pnpm check／build 通過。012 已套用，gateway、school-adapter、公開 ingress 已更新。現有兩筆記錄為 legacy_unknown，阻擋性帳密失敗為 0；公開 JS 已沒有舊的 30 分鐘訊息。尚需本人重試確認原綁定錯因與真校務登入。
