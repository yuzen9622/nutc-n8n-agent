# nutc-n8n-agent

![n8n 2.41.7](https://img.shields.io/badge/n8n-2.41.7-EA4B71?style=flat)
![Node.js 24](https://img.shields.io/badge/Node.js-24-5FA04E?style=flat)
![TypeScript 5.9.3](https://img.shields.io/badge/TypeScript-5.9.3-3178C6?style=flat)
![PostgreSQL 17](https://img.shields.io/badge/PostgreSQL-17-4169E1?style=flat)
![pgvector 0.8.2](https://img.shields.io/badge/pgvector-0.8.2-4169E1?style=flat)
![Google Gemini](https://img.shields.io/badge/Google-Gemini-4285F4?style=flat)

透過 LINE 查詢國立臺中科技大學公開資訊與本人校務，讓 n8n 原生 AI Agent 選擇工具、由 Gemini 整理回答。

學生各自透過 LIFF 登入校務系統，不共用帳號。登入密碼不保存，Cookie 不送模型；經本人授權的校務結果會提供 Google Gemini 處理。

[系統設計](docs/SDD.md) · [Roadmap 與驗收進度](docs/ROADMAP.md) · [本機 n8n 畫布](http://localhost:15679/workflow/campusNativeAgentLive) · [LIFF 入口](https://nutc-agent.yuzen.dev/liff/)

## 功能與現況


| 功能      | 說明                                                           |
| ------- | ------------------------------------------------------------ |
| LINE 對話 | 一對一事件驗簽、自動註冊本人身分、持久任務與非同步回覆，不需要受邀名單                          |
| 本人校務查詢  | 透過 LIFF 綁定本人校務 session；課表、缺曠與公告已驗證真實整合                       |
| 公開資訊問答  | 官方 HTML／PDF 語料匯入，使用 Gemini Embeddings 與 PGVector 檢索，核對回答來源   |
| 多輪記憶    | 使用 Postgres Chat Memory，按使用者與身分 generation 隔離，最多保留七天         |
| 登入與撤銷   | 本地 OCR 處理驗證碼、加密保存校務 Cookie；解除綁定或 unfollow 時撤銷 session 與未交付任務 |


## 部署

### 1. 準備環境

- Docker 與 Docker Compose v2。
- Node.js 24 與 pnpm 10.32.1；本機開發及公開 ingress 程序使用。
- LINE Messaging／Login Channel、LIFF 設定及 Google Gemini API key。
- 使用現有公開 tunnel 時，主機需有 `cloudflared` 及對應憑證。

新環境建立根 `.env`；已存在時不複製、不覆寫：

```sh
if [ ! -e .env ]; then cp .env.example .env; fi
pnpm install --frozen-lockfile
```

啟動前依 `.env.example` 填妥設定：


| 設定群組      | 必要內容                                                                                                            |
| --------- | --------------------------------------------------------------------------------------------------------------- |
| 資料庫       | `POSTGRES_PASSWORD`、`DB_POSTGRESDB_PASSWORD`、`AGENT_DB_PASSWORD`、兩個資料庫 URL 與 `N8N_ENCRYPTION_KEY`               |
| 內部驗證      | 各自獨立、至少 32 字元的 `SESSION_SECRET`、`SERVICE_TOKEN`、`N8N_WEBHOOK_TOKEN`、`GEMINI_PROXY_TOKEN`、`SCHOOL_SERVICE_TOKEN` |
| LINE／LIFF | Channel ID、`LINE_DESTINATION`、Channel secret、access token、`LIFF_ID` 與 HTTPS `PUBLIC_ORIGIN`；新專案須替換範例中的既有 ID     |
| 校務加密      | `SCHOOL_SESSION_KEY` 為 64 字元十六進位 AES-256 key；另設定 `SCHOOL_ACCOUNT_HASH_KEY`                                      |
| Gemini    | Chat／embedding key 與模型；範例已指定模型，不能只留空 key 就啟動                                                       |


`DATABASE_URL`／`SCHOOL_DATABASE_URL` 在 Docker 中須指向 `postgres:5432/campus_agent`，使用 `campus_agent` role 與 `AGENT_DB_PASSWORD`。建議密碼為隨機十六進位字串，務必替換兩個 URL 的 placeholder；其他字元須 URL 編碼。

gateway 啟動時會自動啟動任務 worker，不需要額外開關。模型與 embedding 呼叫依供應商計費，應用程式不設定費用上限；請在 Google Cloud 管理帳務與 API 使用量。

### 2. 啟動容器

```sh
pnpm check
pnpm build
docker compose up -d --build --remove-orphans --wait --wait-timeout 600
```

Compose 依序執行 PostgreSQL／pgvector、checksum migration、一次性 `n8n-init`，再啟動 n8n、school-adapter 與 gateway。新空 n8n database 會自動建立四組 credentials、匯入兩個正式工作流並發布主流程，不需要手動匯入 JSON。只有空 volume 才建立獨立的 `n8n`／`campus_agent` database 及 role；既有 volume 不重建資料。

既有環境保留 `campus-phase1` project name、`postgres_data`／`n8n_data` volume 與網路名稱。`--remove-orphans` 會移除同專案已淘汰的 admin-proxy，釋放舊管理埠給 n8n 直接 loopback 綁定。不要執行 `docker compose down -v`，避免刪除既有資料。所有秘密集中 `.env`，不印出完整 Compose config、不提交 Git。

啟動後檢查服務狀態與 readiness：

```sh
docker compose ps
curl --fail http://127.0.0.1:3100/health/live
curl --fail http://127.0.0.1:15679/healthz/readiness
```

`migrate`、`n8n-init` 成功執行後退出是正常狀態。健康檢查只代表服務可回應，不代表 LINE、校務或模型已完成端到端驗收。

### 3. 開啟 n8n

新 instance 首次開啟 `http://localhost:15679` 建立 n8n owner，即可看到自動匯入的兩個流程；不需要手動匯入或設定下列 credentials。owner 帳號仍由你在 editor 建立，`.env` 的 `N8N_OWNER_EMAIL`／`N8N_OWNER_PASSWORD` 只供完成設定後的本機維護腳本使用。


| 工作流                                                                        | 用途                          |
| -------------------------------------------------------------------------- | --------------------------- |
| [`campusNativeAgentLive.json`](workflows/agent/campusNativeAgentLive.json) | LINE 任務的原生 Agent、記憶、檢索與校務工具 |
| [`campusKnowledgeIngest.json`](workflows/agent/campusKnowledgeIngest.json) | 管理者手動匯入核定官方語料               |



| credential ID              | 設定                                                                                            |
| -------------------------- | --------------------------------------------------------------------------------------------- |
| `campus-agent-postgres`    | Postgres：host `postgres`、DB／user `campus_agent`、密碼 `AGENT_DB_PASSWORD`                        |
| `campus-live-service`      | HTTP Header Auth：`X-Campus-Service` = `SERVICE_TOKEN`                                         |
| `campus-live-webhook`      | HTTP Header Auth：`X-Campus-Webhook` = `N8N_WEBHOOK_TOKEN`                                     |
| `campus-live-gemini-proxy` | Google Gemini：內部 proxy token `GEMINI_PROXY_TOKEN`，host `http://gateway:3100/providers/gemini` |


`campusNativeAgentLive` 在新環境已自動發布；`campusKnowledgeIngest` 維持手動執行，不會在啟動時抓取網站或呼叫 Gemini。公開知識庫仍需管理者執行語料流程建置，初始化不代表已存在知識內容。確認 editor 與實際整合後再接通 LINE 公開入口。

初始化使用 [n8n 官方 CLI](https://docs.n8n.io/hosting/scaling/cli/)；credentials 經 stdin 匯入、由 n8n 加密保存，不產生含秘密的匯入檔。已初始化或已有 metadata schema 的 database 只讀略過，不覆寫畫布、credentials 或發布狀態；`git pull` 不會自動更新資料庫中的流程，既有環境更新仍須明確確認並操作。

若初始化中斷，`n8n-init` 會報 `BOOTSTRAP_INCOMPLETE` 或帶有階段的錯誤碼（例如 `BOOTSTRAP_CLI_IMPORT_CREDENTIALS_FAILED`、`BOOTSTRAP_CLI_IMPORT_WORKFLOW_FAILED`、`BOOTSTRAP_CLI_PUBLISH_WORKFLOW_FAILED`），並阻止新 server 啟動，避免盲目重跑覆寫半完成的資料。可用 `docker compose logs n8n-init` 查看安全階段資訊，不輸出 CLI 原文或秘密。缺設定在寫入前會報 `BOOTSTRAP_REQUIRED_*`，補妥設定後可重試；已有 pending 時先備份、由管理者核對失敗階段與已匯入內容，再在已知 instance 手動復原並驗證，不由程式自動重匯入。不要刪除 volume、狀態標記或重置資料來繞過保護。既有環境未自動匯入時，請先備份與確認 instance，再由 editor 匯入／設定／發布，不能把未知 instance 當新環境。

worker 已隨 gateway 自動啟動，不需要額外啟用旗標。語料匯入流程只手動啟動；不能以節點存在代替整合驗收。

### 4. 設定 LINE／LIFF 公開入口

公開入口使用受限 host ingress 與 Cloudflare Tunnel，不暴露 n8n、school-adapter 或 internal／provider API。

`scripts/start-tunnel.mjs` 固定使用現有 `nutc-agent.yuzen.dev` 與對應 tunnel，不是通用的新環境 tunnel 設定器。沿用此環境時，在根 `.env` 填入 `TUNNEL_CRED_CONTENTS`（對應 Cloudflare credentials JSON）；無憑證或使用其他 tunnel 時不要直接執行 `start:tunnel`。

```text
LINE／LIFF → Cloudflare Tunnel → host ingress :3101 → gateway :3100
```

啟動 host 程序：

```sh
# 各在獨立前景程序執行；已有程序時不要重複啟動。
pnpm start:public
pnpm start:tunnel
```

LINE Messaging webhook 設為 `${PUBLIC_ORIGIN}/line/webhook`，LIFF endpoint 設為 `${PUBLIC_ORIGIN}/liff/`；LINE Login Channel 須為 Published，且 LIFF 必須屬於設定的 Login Channel。上述 URL 中的 `${PUBLIC_ORIGIN}` 請替換成實際 HTTPS origin。

n8n 管理入口與 gateway 僅綁定 loopback，school-adapter 無 host port。公開 ingress 拒絕非 LINE／LIFF 路徑，不得以直接公開 n8n 或 gateway 所有路由替代。新環境設定完成後才接通公開入口，避免未發布的工作流接收任務。

## 開發與檢查

```sh
pnpm generate       # 僅生成正式 Agent／語料工作流，不匯入或發布
pnpm check
pnpm build
pnpm db:migrate:live # 已運行的已知本機 DB；核對 checksum，不清空資料
pnpm test:line:database
pnpm test:school:database
```

`pnpm check` 包含 TypeScript 型別檢查、回歸測試及工作流 artifact 檢查；資料庫整合檢查需使用已知本機環境。工作流修改後，須在固定 n8n 2.41.7 runtime 實跑並確認 editor，靜態檢查不能代替畫布驗收。

正式工作流的來源是 `scripts/generate-live-agent-workflow.mjs` 與 `scripts/generate-knowledge-workflow.mjs`。修改 generator 後，需一併交付生成的 JSON；生成本身不會匯入或發布，也不能覆寫未知 n8n instance 的工作流。

保留正式回歸測試及必要診斷腳本；臨時驗證輸出寫入忽略的 `.local/verification/`，不納入 docs。

## 專案結構

```text
apps/
  gateway/          LINE、LIFF、任務、工具權限、模型代理與派送
    migrations/    正式 Agent DB SQL migration
  school-adapter/  校務登入、本地 OCR 與本人 session 查詢
scripts/           工作流生成、資料庫 migration 與整合診斷
workflows/agent/   兩個正式 n8n 工作流 JSON
tests/            正式回歸測試
docs/
  SDD.md           系統設計
  ROADMAP.md       進度與尚未完成的驗收
Dockerfile         PostgreSQL 與應用程式映像建置
docker-compose.yml 唯一 Compose 部署入口
.env.example       新環境設定範本，不含秘密
```

n8n 負責原生 Agent、模型、記憶及檢索；gateway 負責驗簽、身分、任務、工具授權與回覆驗證；school-adapter 負責校方協定與 Cookie。n8n metadata 與 Agent 資料使用不同 database／role，不重新加入歷史 mock 或合成工作流。

## 資料與安全界線

- 登入密碼只用於當次校方登入，不保存、不提供給模型；Cookie 在後端加密保存。
- 本人校務結果會提供 Google Gemini 整理，可能進入本人隔離的對話記憶，最多保留七天，不進共享 RAG。
- 任務 capability、lease、operation 與本人 session 必須綁定；模型不能自行指定使用者、任意 URL 或權限 token。
- 校務 session 最長八小時、閒置三十分鐘；解除綁定或 unfollow 會撤銷舊 session、記憶與未交付工作。
- 不將秘密寫入 Git、工作流 JSON 或映像 build context；不為驗收清空既有資料。

## 排錯與後續開發


| 狀況               | 優先檢查                                                                  |
| ---------------- | --------------------------------------------------------------------- |
| gateway 無法啟動     | `.env` 是否填妥、秘密是否符合長度與獨立性要求、Gemini 與 n8n 派送設定是否完整                      |
| migration 失敗     | 資料庫 URL、role 密碼與 migration checksum；不要刪除 volume 或修改既有 migration 來繞過檢查 |
| LINE 沒有 Agent 回覆 | 工作流是否發布、credential 與 n8n 派送 URL 是否正確，以及服務是否 healthy            |
| LIFF 無法登入或綁定     | HTTPS origin、LIFF／Login Channel 是否一致、Published 狀態與校務 session 是否有效     |
| 搜尋沒有結果           | Google Search 預設停用；啟用後需確認供應商支援與真實搜尋結果，費用由供應商計收                            |


從 [系統設計](docs/SDD.md) 確認責任與安全契約，再依 [Roadmap](docs/ROADMAP.md) 選擇尚未完成的工作。提交變更前執行 `pnpm check`、`pnpm build`；涉及工作流時補上真實 runtime 與 editor 驗收，並清楚區分真實整合、合成測試與未執行項目。