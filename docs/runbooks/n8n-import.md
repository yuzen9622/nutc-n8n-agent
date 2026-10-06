# Phase 1：本機 n8n 合成環境

> 此文件保留舊七流程的環境初始化及歷史驗收操作。新版主流程請依 [原生 Agent 操作說明](../NATIVE-AGENT.md)，不要用舊30情境測試宣稱新版 Agent 完成。

此環境只有 synthetic mock，不接 LINE、學校、Gemini 或 Brave。容器重啟會清除 mock 任務；PostgreSQL 保存 n8n 設定與合成 execution，保留 24 小時。正式環境必須另建，不能拿本環境接收學生資料。

## 啟動與匯入

需求：Docker／Compose、Node.js 24、pnpm 10.32.1。本機工作目錄可位於外接磁碟；DB 初始化腳本已複製到 image，不直接執行可能 noexec 的 host bind mount。

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm build
node scripts/setup-secrets.mjs
docker compose --env-file .env -f infra/compose.yaml up -d --build
node scripts/n8n-client.mjs setup-owner
sh scripts/import-workflows.sh
node scripts/publish-workflows.mjs
node scripts/runtime-check.mjs
node scripts/runtime-system-check.mjs
node scripts/runtime-webhook-check.mjs
```

本機管理入口：[n8n editor](http://localhost:15679/)。只有固定目的地的 admin-proxy 綁定 loopback；n8n、mock 與 DB 留在 internal network，不能對外連線。管理 proxy 僅轉發到 n8n:5678，不支援任意目的地。管理者登入資料保存在 `.local/owner.json`（0600，Git 忽略）；不使用學校帳密。`setup-owner` 只用於全新、未建立管理者的獨立 instance，已建立時不要重跑。不存在預設共用密碼。

`setup-secrets` 以隨機值建立互不相同的 token，不覆寫既有值。host `.local/secrets` 目錄為 0700，內部檔案 0644 以供不同容器 UID 讀取各自掛載的 secret；不掛載整個 secrets 目錄到容器。credentials 匯入暫存含 secret，僅在 `.local`，不交付到 Git。

匯入固定 ID，順序為 WF-02、03、04、05、07、01、06。它會更新**本專案同 ID** 的工作流；不要對其他 instance 執行。匯入前如已手動修改，先匯出備份。JSON 皆 inactive；n8n 2.41.7 的巢狀子流程必須有已發布版本，因此匯入後執行 `publish-workflows.mjs` 發布 WF-02、03、04、01。WF-05／07 先保留手動執行，避免未決定前啟用排程。主流程 Webhook 僅在本機 loopback 管理入口可達，仍須獨立 Header Auth。

| Workflow | ID | 畫布 |
|---|---|---|
| WF-01 主流程 | campusWF01phase1 | [主流程](http://localhost:15679/workflow/campusWF01phase1) |
| WF-02 公開問答 | campusWF02phase1 | [公開](http://localhost:15679/workflow/campusWF02phase1) |
| WF-03 個人查詢 | campusWF03phase1 | [個人](http://localhost:15679/workflow/campusWF03phase1) |
| WF-04 錯誤監控 | campusWF04phase1 | [錯誤](http://localhost:15679/workflow/campusWF04phase1) |
| WF-05 維護 | campusWF05phase1 | [維護](http://localhost:15679/workflow/campusWF05phase1) |
| WF-06 合成 demo | campusWF06phase1 | [Demo](http://localhost:15679/workflow/campusWF06phase1) |
| WF-07 知識同步 | campusWF07phase1 | [同步](http://localhost:15679/workflow/campusWF07phase1) |

## Credentials mapping

每個 HTTP node 使用 `httpHeaderAuth`；task capability 與 lease 是 runtime headers，沒有寫入 workflow JSON。合成執行可能包含短期假 capability，不得將此 retention 用於真實流量。

| ID / 名稱尾碼 | 權限 |
|---|---|
| campus-task-synthetic / task | claim、plan、task stage、complete、fail |
| campus-demo-synthetic / demo | 建立合成任務、讀取假 delivery |
| campus-maintenance-synthetic / maintenance | cleanup、aggregate health |
| campus-knowledge-synthetic / knowledge | 僅同步 |
| campus-observability-synthetic / observability | 去識別錯誤監控 |
| campus-webhook-synthetic / webhook | WF-01 Webhook Header Auth（X-Campus-Webhook） |

其餘 credentials 的 header 為 Authorization，值為 Bearer token。匯入 JSON 只有 ID／名稱，沒有 token。Gateway 不接受跨 scope、task、lease、operation 或 ref；所有 body 嚴格拒絕未列欄位。`docs/mock-input-schemas.json` 由 Zod schema 生成。

## 展示與驗證

WF-06：開啟 D02 編輯 `scenario`，執行手動入口。完整情境在 `tests/fixtures/scenarios.json`。D06 只顯示 task ID、狀態、outcome、outboxCount、synthetic 與 delivered=false；不將 mock 排程當作 LINE 送達。

WF-07：執行 K02；all fixture 順序示範 updated、unchanged、withdrawn、failed。只有 updated 會發布合成版本；failed 不發布。這不是實際 embedding 或持久化知識庫，pgvector 另行驗證：

```sh
docker compose --env-file .env -f infra/compose.yaml exec -T postgres psql -U bootstrap -d campus -c "SELECT extversion FROM pg_extension WHERE extname = 'vector';"
```

HTTP Request 會替換 item，因此每顆 API 節點前後都有明確保存／回復 context 的 Edit Fields；每次子流程都 Wait for Completion，mixed 順序處理。所有 Switch 有 fallback；不採等待未啟動分支的 Merge。

## 匯出、停止與復原

```sh
sh scripts/export-workflows.sh
docker compose --env-file .env -f infra/compose.yaml stop
docker compose --env-file .env -f infra/compose.yaml start
```

匯出到 `.local/exports`，不匯出 credentials／執行資料。修改程式或 Compose 後用 `up -d --build`。保留 volumes 與原 encryption key；不要執行 `down -v` 作為一般排錯。DB 初始化只在空 volume 執行，部分初始化失敗要先檢查角色／DB，不盲刪資料。

## 遠端狀態

2026-10-06 使用者指定先本機穩定再部署遠端。`oscar@100.116.231.6` 已唯讀確認為 Ubuntu 26.04 x86_64、Docker 29.1.3／Compose 5.3.1；早期建立的 `/home/oscar/n8n-agent-phase1` 容器已停止，保留 volumes，**不是已驗收遠端部署**。早期 DB 初始化曾因 secret 讀取權限失敗；後續部署前須檢查／修復其 n8n role 密碼，不能直接宣稱可啟動。遠端 source 也不是目前最新版本。
