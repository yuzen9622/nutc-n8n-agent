# nutc-n8n-agent

![n8n 2.41.7](https://img.shields.io/badge/n8n-2.41.7-EA4B71?style=flat)
![Node.js 24](https://img.shields.io/badge/Node.js-24-5FA04E?style=flat)
![TypeScript 5.9.3](https://img.shields.io/badge/TypeScript-5.9.3-3178C6?style=flat)
![PostgreSQL 17](https://img.shields.io/badge/PostgreSQL-17-4169E1?style=flat)
![pgvector 0.8.2](https://img.shields.io/badge/pgvector-0.8.2-4169E1?style=flat)
![Google Gemini](https://img.shields.io/badge/Google-Gemini-4285F4?style=flat)

透過 LINE 查詢國立臺中科技大學公開資訊與本人校務，讓 n8n 原生 AI Agent 選擇工具、由 Gemini 整理回答。

學生各自透過 LIFF 登入校務系統，不共用帳號。登入密碼不保存，Cookie 不送模型；經本人授權的校務結果會提供 Google Gemini 處理。

[系統設計](docs/SDD.md) · [Roadmap 與驗收進度](docs/ROADMAP.md) · [本機 n8n 畫布](http://localhost:15680/workflow/campusNativeAgentLive) · [LIFF 入口](https://nutc-agent.yuzen.dev/liff/)

## 功能與現況


| 功能      | 說明                                                           |
| ------- | ------------------------------------------------------------ |
| LINE 對話 | 一對一事件驗簽、自動註冊本人身分、持久任務與非同步回覆，不需要受邀名單                          |
| 本人校務查詢  | 透過 LIFF 綁定本人校務 session；課表、缺曠與公告已驗證真實整合                       |
| 公開資訊問答  | 官方 HTML／PDF 語料匯入，使用 Gemini Embeddings 與 PGVector 檢索，核對回答來源   |
| 請假預覽／確認 | 先查當天實際可請假課程，顯示「尚未送出」摘要；另一則精確「確認送出」才消耗預覽。新版本尚待受控部署及真 Agent／校方驗收 |
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
| `N8N_OWNER_EMAIL`／`N8N_OWNER_PASSWORD` | 必填。首次空 n8n metadata DB 時自動建立 owner；密碼須符合 n8n 2.41.7 預設（8–64 字元、至少一個數字與一個大寫字母，以 n8n API 為準） |
| LINE／LIFF 欄位 | Channel IDs、secret、access token、destination、LIFF ID；替換範例值 |
| `PUBLIC_ORIGIN`／`CLOUDFLARE_TUNNEL_TOKEN` | 公開 HTTPS origin／Dashboard connector token |

Google key 與模型只在 n8n editor 設定，不放 `.env`。`N8N_BASE_URL` 僅供 host 維護工具，owner 自動建立固定在 n8n 容器內，不依賴它。模型費用由供應商計收，請自行管理帳務。

**既有資料先備份：不可清空 volumes、直接換金鑰或覆寫 `.env`。project name 現為 `nutc-agent`，改名不會搬移舊 volumes；須核對並受控遷移。修改 `.env` 也不會自動更新既有 DB role 密碼；保留原 `N8N_ENCRYPTION_KEY`。**

### 2. 啟動五個服務

```sh
docker compose up -d --build --wait --wait-timeout 600
docker compose ps
```

Compose 啟動 `postgres`、`n8n`、`gateway`、`school-adapter`、`cloudflared`。兩個 backend 先執行既有 checksum migration，再 exec server；沒有獨立 migrate service。官方 n8n 2.41.7 等待 PostgreSQL healthy 後初始化 metadata；n8n 容器內的 supervisor 在首次空 DB 以 `N8N_OWNER_*` 自動建立 owner，**owner 完成後才 healthy**，**不自動匯入或發布工作流**。已有 owner 時直接略過，不登入、不比對、不覆寫，修改 `.env` 的 owner 值不會更新既有 owner（需用 n8n 自己的管理／恢復程序；本專案不提供 reset）。owner 設定失敗時 n8n 會停止並只輸出固定錯誤碼（不含密碼或回應內容）。首次 POST 前會在 `n8n_data` 建立非秘密 attempt marker（`.campus-owner-setup-attempt`）：若重啟後 owner 仍未建立（flag 仍 true）而 marker 存在，會以 `N8N_OWNER_SETUP_REVIEW_REQUIRED` 停止且不再送出 POST，避免 `restart: unless-stopped` 盲目重送；若 owner 已存在則自動清除 stale marker。看到此碼時請先備份 `n8n_data` 與 PostgreSQL、確認 owner 狀態，確認未建立後由管理者手動移除該 marker 再受控重啟；本專案不提供自動刪 marker 流程。gateway 同時啟動 worker 與公開入口。

`--wait` 只確認四個服務的 healthcheck 及 cloudflared running；Tunnel 是否真正連線另查：

```sh
docker compose exec gateway node -e "fetch('http://cloudflared:20311/ready').then(r=>{console.log(r.status);process.exit(r.ok?0:1)})"
```

應回傳 200。容器啟動不代表 Bot 配置完成，繼續下一步。

### 3. 首次設定 n8n

n8n healthy 後 owner 已建立，直接以 `.env` 的 `N8N_OWNER_EMAIL`／`N8N_OWNER_PASSWORD` 登入 `http://localhost:15680`（顯示名稱為 Campus Local，可於 editor 修改），**不需要再註冊**。接著在 repo 根目錄執行（這是 Bot 工作流設定的第二階段，仍須手動）：

```sh
bash scripts/setup-n8n.sh
```

腳本只使用 Docker：產生三組內部 credentials，經 stdin 交給同版本 [官方 CLI](https://docs.n8n.io/hosting/scaling/cli/)，匯入兩個**未啟用**工作流，不發布、不執行 ingest。

| 工作流 | 用途 |
|---|---|
| [`campusNativeAgentLive`](workflows/agent/campusNativeAgentLive.json) | LINE Agent、記憶、RAG 與校務工具 |
| [`campusKnowledgeIngest`](workflows/agent/campusKnowledgeIngest.json) | 手動匯入官方語料 |

| credential ID | 自動匯入設定 |
|---|---|
| `campus-agent-postgres` | host `postgres`、DB／user `campus_agent`、`POSTGRES_PASSWORD` |
| `campus-live-service` | `X-Campus-Service`，master key 衍生 token |
| `campus-live-webhook` | `X-Campus-Webhook`，master key 衍生 token |

owner 登入 editor 後建立 **Google Gemini (PaLM)** credential，使用官方 host `https://generativelanguage.googleapis.com`；選取 main 的 Chat Model／Embeddings／`official_search` HTTP Tool 節點與 ingest 的 Embeddings。`official_search` 由主 Agent 直接呼叫 Google 搜尋，只傳 AI 產生的公開 query；摘要與來源網址直接經正常 LINE 回覆送出，來源是外部網頁，不是學校核定 RAG，也不進共享 evidence。模型由 n8n 管理；embedding 保持 `models/gemini-embedding-001`／3072 維。

保存並發布 main，再手動執行 ingest。確認語料、搜尋與實際回答後才接正式流量。兩個流程分別處理對話（含直接 Google 搜尋工具）與語料。

**任一目標 workflow／credential ID 已存在，setup 即拒絕，不覆寫、不使用 bootstrap state／pending。** 重跑或匯入中斷時先備份並核對現有內容，再由管理者手動處理；不要清庫重試。`git pull` 不會更新 n8n 中的流程。

遠端 editor 請透過 `ssh -N -L 15680:127.0.0.1:15680 使用者@主機` 存取，不公開管理埠。

### 4. 設定公開網址

```text
LINE／LIFF → cloudflared → gateway:3101（同 process 的受限 publicRouter）
```

Compose 的官方 cloudflared 使用 `TUNNEL_TOKEN`，command 固定 `--url http://gateway:3101`；無 remote ingress 時也有明確 origin。若 Dashboard 配置 remote ingress，origin 同樣設為 **`http://gateway:3101`**，不能用 private `3100` 或 localhost；公開 hostname 須符合 `PUBLIC_ORIGIN`。

LINE webhook 設 `${PUBLIC_ORIGIN}/line/webhook`，LIFF endpoint 設 `${PUBLIC_ORIGIN}/liff/`。Login Channel 須 Published，LIFF 須屬於該 Channel；將 `${PUBLIC_ORIGIN}` 換成實際 HTTPS origin。

兩個網路為 `backend`／`public`，cloudflared 只加入 public。n8n `15680`、gateway private `3100` 僅綁 loopback；public `3101` 無 host port，publicRouter 限制 host／path，不暴露 internal API。Tunnel／DNS 由管理者配置，不需另開 host 程序。

## 開發與檢查

以下只供開發使用，需要 Node.js 24 與 pnpm 10.32.1；一般 Docker 部署不用執行。

```sh
pnpm install --frozen-lockfile
pnpm generate       # 僅生成正式 Agent／語料工作流，不匯入或發布
pnpm check
pnpm build
pnpm db:migrate:live # 已運行的已知本機 DB；核對 checksum，不清空資料
pnpm test:line:database
pnpm test:school:database
```

`pnpm check` 包含 TypeScript 型別檢查、回歸測試及工作流 artifact 檢查；資料庫整合檢查需使用已知本機環境。工作流修改後，須在固定 n8n 2.41.7 runtime 實跑並確認 editor，靜態檢查不能代替畫布驗收。

正式工作流的來源是 `scripts/generate-live-agent-workflow.mjs`（main）與 `scripts/generate-knowledge-workflow.mjs`（ingest）。修改 generator 後，需一併交付生成的 JSON；生成本身不會匯入或發布，也不能覆寫未知 n8n instance 的工作流。

保留正式回歸測試及必要診斷腳本；臨時驗證輸出寫入忽略的 `.local/verification/`，不納入 docs。

## 請假流程與既有安裝更新

請假已拆成 `student_leave_preview`、`student_leave_confirm`、`student_leave_notes`。預覽只接受日期、完整假別名稱、事由及節次意圖（早上節數／range／periods）；課程 ID 與假別代碼由本人校務 session 即時查得。心理假正規化為心理調適假，代碼從表單取得，不硬編碼。日期、節次及未知欄位不會被 clamp、預設或忽略。

預覽有效五分鐘，必須完整呈現固定摘要後，使用者在**另一則訊息**只回覆「確認送出」。同 turn、預先排隊、非精確 prompt、session／generation 改變均不能送出。確認工具無可替換 payload 的參數。舊 `leave_apply` 已停用且零校方 I/O。成功同時要求具體 `opDone(...)` 完成語義，以及完整 before／after 記錄集合中唯一新增的 matching record 明細；HTTP 200、redirect 或模型宣稱不是證明。

每份預覽最多一次 create 嘗試：持久 attempt marker **先 commit**，再呼叫校方。結果未知、timeout 或 crash 後不重送，也不能換 task／新預覽繞過 unresolved marker；僅能至後台查看或唯讀 reconcile。這不是分散式 exactly-once，marker 後／POST 前 crash 可能實際零次。附件、多日、無法驗明的記錄明細或不完整分頁均 fail closed；不以猜測補資料。

既有安裝必須先備份並 drain 舊 backend，再套用新增的 017 migration／更新 gateway 與 school-adapter，最後更新 main。不可回滾成舊一步 apply 工具與舊 backend 的可執行組合；保留 attempt marker，不清庫、不自動刪校方假單。首次 setup 的拒覆寫保護維持不變。

下列是**後續維護指令，本輪未執行部署／發布或真 POST**：

```sh
# 新程式的隔離 DB 自驗：只建 random-owned schema，假校方 transport，零 LINE
node scripts/check-leave-database.mjs --project nutc-agent
# backend 完成受控更新後，已知本機 main 的 owned leave 片段更新
node scripts/update-local-leave-workflow.mjs --project nutc-agent --dry-run
node scripts/update-local-leave-workflow.mjs --project nutc-agent --apply
node scripts/update-local-leave-workflow.mjs --project nutc-agent --verify
```

Updater 只接受本 repo 的 `nutc-agent` labels、固定 n8n 2.41.7 digest 與 loopback 15680；已有 owner 登入，不 setup/reset。dry-run 保存 0600 snapshot；apply 核對 published/editable version、hash、checksum、editor write lock，僅替換 leave nodes／connections／Agent 請假段落，其他節點與 credentials refs 不變。漂移或部分失敗即停，可能保持 inactive，不自動復原／重試；先檢查受限 snapshot 與 progress。

部署及 active workflow 通過獨立核對後，才可由已授權管理者執行 `scripts/check-leave-live.mjs --project nutc-agent --preview`，依同一 run-id 做 `--confirm-authorized --run <id>`、`--replay --run <id>` 或唯讀 `--reconcile --run <id>`。runner 原子建立 capture task，不送 LINE webhook；worker 不 loading，兩層 outbox filter 不 push。stdout 僅報匹配布林、run-bound HMAC、count 與 capture delivery 證據，不 dump 本人摘要。manifest 0600、簽章與 enqueue reservation 阻止中斷後重建確認；stale `operation.lock` 必須先核對，不能盲目刪除重跑。

此 runner 硬限凍結案例的真日期 2026-10-13／請假日 2026/10/14、唯一本人 session、心理 code 17、實際第 2/3/4 節與指定事由。日期不符就停止，不改時鐘、換日期或另送一張湊驗收。新程式的 unit／隔離 DB 自驗不是真 Agent、active workflow、校方新增紀錄或手機 LINE 驗收。

## 專案結構

```text
apps/
  gateway/          LINE、LIFF、任務、工具權限與派送
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

backend 啟動 migration 與 server 都核對 master key fingerprint；缺 marker 或換 key 會停止，不會自動重加密。不可刪 marker 繞過，先備份並安排受控遷移。


| 狀況               | 優先檢查                                                                  |
| ---------------- | --------------------------------------------------------------------- |
| gateway 無法啟動 | `.env` 是否填妥、master key 是否為 64 hex、n8n 派送設定是否完整 |
| migration 失敗     | 資料庫 URL、role 密碼與 migration checksum；不要刪除 volume 或修改既有 migration 來繞過檢查 |
| `EXISTING_DATA_REQUIRES_KEY_MIGRATION`／`APP_MASTER_KEY_CHANGED` | 主密鑰保護強制停止並 rollback；先核對原金鑰與受控遷移方案，不可刪除 fingerprint marker 繞過 |
| LINE 沒有 Agent 回覆 | 工作流是否發布、credential 與 n8n 派送 URL 是否正確，以及服務是否 healthy            |
| LIFF 無法登入或綁定     | HTTPS origin、LIFF／Login Channel 是否一致、Published 狀態與校務 session 是否有效     |
| 搜尋沒有結果           | 確認 `official_search` 節點已選取 Google credential，且供應商支援 Google Search；費用由供應商計收                            |
| Tunnel 連線失敗／503 | 檢查 `docker compose logs cloudflared`、token、`/ready` 與 Dashboard；origin 必須為 `http://gateway:3101` |

`restart: unless-stopped` 處理退出／Docker 重啟，不會因 unhealthy 而重啟。cloudflared 會自行重連；持續斷線先查日誌，再視需要 `docker compose restart cloudflared`。一般環境變數更新須重建容器，不是只 restart；密碼、金鑰及 volume 變更須先遷移。


從 [系統設計](docs/SDD.md) 確認責任與安全契約，再依 [Roadmap](docs/ROADMAP.md) 選擇尚未完成的工作。提交變更前執行 `pnpm check`、`pnpm build`；涉及工作流時補上真實 runtime 與 editor 驗收，並清楚區分真實整合、合成測試與未執行項目。