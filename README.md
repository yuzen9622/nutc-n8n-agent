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

### 1. 填妥設定

準備 Git、Docker／Compose v2、LINE Messaging／Login Channel、LIFF、Google API key，以及 Cloudflare Tunnel 的 connector token 與已綁定的 HTTPS 網域。部署主機不需要 Node.js、pnpm 或 cloudflared。

```sh
if [ ! -e .env ]; then cp .env.example .env; fi
chmod 600 .env
```

依 `.env.example` 填妥：

| 設定 | 用途 |
|---|---|
| `POSTGRES_PASSWORD` | 三個 PostgreSQL role 共用密碼，database／role 仍隔離 |
| `APP_MASTER_KEY` | 64 hex，衍生內部驗證及校務加密金鑰 |
| `N8N_ENCRYPTION_KEY` | n8n credentials 加密 |
| LINE／LIFF 欄位 | Channel IDs、secret、access token、destination、LIFF ID；替換範例值 |
| `PUBLIC_ORIGIN`／`CLOUDFLARE_TUNNEL_TOKEN` | 公開 HTTPS origin／Dashboard connector token |
| `GOOGLE_SEARCH_ENABLED` | 預設 false，完成搜尋驗收後才啟用 |

Google key 與模型只在 n8n editor 設定，不放 `.env`。`N8N_BASE_URL`／owner 維護憑證為選用，不會自動建立 owner。模型費用由供應商計收，請自行管理帳務。

**既有資料先備份：不可清空 volumes、直接換金鑰或覆寫 `.env`。project name 現為 `nutc-agent`，改名不會搬移舊 volumes；須核對並受控遷移。修改 `.env` 也不會自動更新既有 DB role 密碼；保留原 `N8N_ENCRYPTION_KEY`。**

### 2. 啟動五個服務

```sh
docker compose up -d --build --wait --wait-timeout 600
docker compose ps
```

Compose 啟動 `postgres`、`n8n`、`gateway`、`school-adapter`、`cloudflared`。兩個 backend 先執行既有 checksum migration，再 exec server；沒有獨立 migrate service。官方 n8n 2.41.7 只等待 PostgreSQL healthy，自行初始化 metadata，**不自動匯入或發布工作流**。gateway 同時啟動 worker 與公開入口。

`--wait` 只確認四個服務的 healthcheck 及 cloudflared running；Tunnel 是否真正連線另查：

```sh
docker compose exec gateway node -e "fetch('http://cloudflared:20311/ready').then(r=>{console.log(r.status);process.exit(r.ok?0:1)})"
```

應回傳 200。容器啟動不代表 Bot 配置完成，繼續下一步。

### 3. 首次設定 n8n

開啟 `http://localhost:15679` 建立 owner，再於 repo 根目錄執行：

```sh
bash scripts/setup-n8n.sh
```

腳本只使用 Docker：產生三組內部 credentials，經 stdin 交給同版本 [官方 CLI](https://docs.n8n.io/hosting/scaling/cli/)，匯入三個**未啟用**工作流，不發布、不執行 ingest。

| 工作流 | 用途 |
|---|---|
| [`campusNativeAgentLive`](workflows/agent/campusNativeAgentLive.json) | LINE Agent、記憶、RAG 與校務工具 |
| [`campusKnowledgeIngest`](workflows/agent/campusKnowledgeIngest.json) | 手動匯入官方語料 |
| [`campusGoogleSearch`](workflows/agent/campusGoogleSearch.json) | 獨立 Google Search Grounding |

| credential ID | 自動匯入設定 |
|---|---|
| `campus-agent-postgres` | host `postgres`、DB／user `campus_agent`、`POSTGRES_PASSWORD` |
| `campus-live-service` | `X-Campus-Service`，master key 衍生 token |
| `campus-live-webhook` | `X-Campus-Webhook`，master key 衍生 token |

owner 在 editor 建立 **Google Gemini (PaLM)** credential，使用官方 host `https://generativelanguage.googleapis.com`；選取 main 的 Chat Model／Embeddings、ingest 的 Embeddings、search 的 HTTP Request 節點。模型由 n8n 管理；embedding 保持 `models/gemini-embedding-001`／3072 維。

保存並發布 main／search，再手動執行 ingest。確認語料、搜尋與實際回答後才接正式流量。三個流程分別處理對話、語料、搜尋，不是三個 Bot。

**任一目標 workflow／credential ID 已存在，setup 即拒絕，不覆寫、不使用 bootstrap state／pending。** 重跑或匯入中斷時先備份並核對現有內容，再由管理者手動處理；不要清庫重試。`git pull` 不會更新 n8n 中的流程。

遠端 editor 請透過 `ssh -N -L 15679:127.0.0.1:15679 使用者@主機` 存取，不公開管理埠。

### 4. 設定公開網址

```text
LINE／LIFF → cloudflared → gateway:3101（同 process 的受限 publicRouter）
```

Compose 的官方 cloudflared 使用 `TUNNEL_TOKEN`，command 固定 `--url http://gateway:3101`；無 remote ingress 時也有明確 origin。若 Dashboard 配置 remote ingress，origin 同樣設為 **`http://gateway:3101`**，不能用 private `3100` 或 localhost；公開 hostname 須符合 `PUBLIC_ORIGIN`。

LINE webhook 設 `${PUBLIC_ORIGIN}/line/webhook`，LIFF endpoint 設 `${PUBLIC_ORIGIN}/liff/`。Login Channel 須 Published，LIFF 須屬於該 Channel；將 `${PUBLIC_ORIGIN}` 換成實際 HTTPS origin。

兩個網路為 `backend`／`public`，cloudflared 只加入 public。n8n `15679`、gateway private `3100` 僅綁 loopback；public `3101` 無 host port，publicRouter 限制 host／path，不暴露 internal API。Tunnel／DNS 由管理者配置，不需另開 host 程序。

## 開發與檢查

以下只供開發使用，需要 Node.js 24 與 pnpm 10.32.1；一般 Docker 部署不用執行。

```sh
pnpm install --frozen-lockfile
pnpm generate       # 僅生成正式 Agent／搜尋／語料工作流，不匯入或發布
pnpm check
pnpm build
pnpm db:migrate:live # 已運行的已知本機 DB；核對 checksum，不清空資料
pnpm test:line:database
pnpm test:school:database
```

`pnpm check` 包含 TypeScript 型別檢查、回歸測試及工作流 artifact 檢查；資料庫整合檢查需使用已知本機環境。工作流修改後，須在固定 n8n 2.41.7 runtime 實跑並確認 editor，靜態檢查不能代替畫布驗收。

正式工作流的來源是 `scripts/generate-live-agent-workflow.mjs`（main／search）與 `scripts/generate-knowledge-workflow.mjs`（ingest）。修改 generator 後，需一併交付生成的 JSON；生成本身不會匯入或發布，也不能覆寫未知 n8n instance 的工作流。

保留正式回歸測試及必要診斷腳本；臨時驗證輸出寫入忽略的 `.local/verification/`，不納入 docs。

## 專案結構

```text
apps/
  gateway/          LINE、LIFF、任務、工具權限、搜尋委派與派送
    migrations/    正式 Agent DB SQL migration
  school-adapter/  校務登入、本地 OCR 與本人 session 查詢
scripts/           工作流生成、資料庫 migration 與整合診斷
workflows/agent/   三個正式 n8n 工作流 JSON
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

backend 啟動 migration 與 server 都核對 master key fingerprint；缺 marker 或換 key 會停止，不會自動重加密。不可刪 marker 繞過，先備份並安排受控遷移。


| 狀況               | 優先檢查                                                                  |
| ---------------- | --------------------------------------------------------------------- |
| gateway 無法啟動 | `.env` 是否填妥、master key 是否為 64 hex、n8n 派送設定是否完整 |
| migration 失敗     | 資料庫 URL、role 密碼與 migration checksum；不要刪除 volume 或修改既有 migration 來繞過檢查 |
| `EXISTING_DATA_REQUIRES_KEY_MIGRATION`／`APP_MASTER_KEY_CHANGED` | 主密鑰保護強制停止並 rollback；先核對原金鑰與受控遷移方案，不可刪除 fingerprint marker 繞過 |
| LINE 沒有 Agent 回覆 | 工作流是否發布、credential 與 n8n 派送 URL 是否正確，以及服務是否 healthy            |
| LIFF 無法登入或綁定     | HTTPS origin、LIFF／Login Channel 是否一致、Published 狀態與校務 session 是否有效     |
| 搜尋沒有結果           | Google Search 預設停用；啟用後需確認供應商支援與真實搜尋結果，費用由供應商計收                            |
| Tunnel 連線失敗／503 | 檢查 `docker compose logs cloudflared`、token、`/ready` 與 Dashboard；origin 必須為 `http://gateway:3101` |

`restart: unless-stopped` 處理退出／Docker 重啟，不會因 unhealthy 而重啟。cloudflared 會自行重連；持續斷線先查日誌，再視需要 `docker compose restart cloudflared`。一般環境變數更新須重建容器，不是只 restart；密碼、金鑰及 volume 變更須先遷移。


從 [系統設計](docs/SDD.md) 確認責任與安全契約，再依 [Roadmap](docs/ROADMAP.md) 選擇尚未完成的工作。提交變更前執行 `pnpm check`、`pnpm build`；涉及工作流時補上真實 runtime 與 editor 驗收，並清楚區分真實整合、合成測試與未執行項目。