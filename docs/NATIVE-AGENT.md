# 原生 Agent 本機操作（歷史合成階段）

2026-10-06：下方為 Phase 1 歷史回歸操作，不是目前正式部署指令。正式 runtime 已移除 V2 與所有 synthetic credentials；不要執行下方 setup/deploy 或重新匯入合成流程。現行操作見 [live-local runbook](runbooks/live-local.md)，進度见 [Phase 2–5](PHASE-2-5-IMPLEMENTATION.md)。

[開啟現行主流程](http://localhost:15679/workflow/campusNativeAgentLive)。使用者自己的「My workflow」保留；正式流程已發布、worker已啟用，先限本人使用已驗證核心；即時搜尋停用，新真人端到端驗收仍在進行。架構基線見 [SDD](SDD.md)，逐節點規格見 [WORKFLOWS](WORKFLOWS.md)。

## 畫布

Webhook → 驗證／去重 → 整理訊息 → AI Agent → 驗證／本地組裝 → 回覆。

Agent 直接連接 Gemini Chat Model、Postgres Chat Memory、PGVector Store、三顆學生 HTTP Request Tools，以及一顆搜尋 HTTP Request Tool。Gemini Embeddings 接 PGVector。主流程沒有 Call n8n Workflow Tool。

## 初始化與更新

```sh
pnpm install --frozen-lockfile
node scripts/setup-secrets.mjs
docker compose --env-file .env -f infra/compose.yaml up -d --build
# 首次環境依舊 runbook 初始化 n8n owner 與 synthetic service credentials
node scripts/setup-agent-postgres.mjs
node scripts/generate-agent-workflows.mjs
node scripts/deploy-agent-workflows.mjs
pnpm check
pnpm build
node scripts/check-direct-agent-runtime.mjs
```

DB setup 建立獨立 campus_agent role/database、Chat Memory 與空的向量表，再匯入「Campus Agent Postgres」credential。生成密碼在 根目錄 `.env` 的 `AGENT_DB_PASSWORD`，不提交 Git。重跑不重建資料、不輪換現有生成密碼。

部署腳本只更新指定主流程，保留使用者已綁定的 Gemini／Embedding credential，不會覆寫 My workflow，不會重新發布舊包裝工具。舊流程保留為歷史測試資產。

## 使用者補外部設定

- Gemini Chat Model：綁定自己的 Google Gemini credential，確認生成模型可用。
- Google Gemini Embeddings：綁定自己的 Google Gemini credential，確認 embedding 模型／維度。
- PGVector：目前空表；需先完成核定文件匯入與來源驗證對接。只補 key 不等於已有知識庫。
- Search Tool：目前是合成搜尋介面，正式 Brave credential、搜尋與官方 reader adapter 待實作。

預設 n8n 不可連外。準備模型 smoke 時執行：

```sh
docker compose --env-file .env -f infra/compose.yaml -f infra/compose.agent-online.yaml up -d n8n
```

上列 override 讓 n8n 連外，不是細粒度域名限制；其他服務維持 internal network。當前不自動套用，也不呼叫付費模型。

## Webhook

未補模型前先保持未發布。editor 中按 Webhook Listen for test event，再 POST `/webhook-test/campus-agent-v2`，Header Auth 使用既有 Campus synthetic webhook credential。body：

```json
{"eventId":"demo-001","scenario":"personal","session":"demo-a"}
```

scenario 可選 knowledge、web、personal、mixed；session 為 demo-a／demo-b，僅合成資料。公開 knowledge 路徑目前受空向量表及來源對接限制。成功測試後才發布，production path 為 `/webhook/campus-agent-v2`；此為內部測試入口，不具 LINE raw-body 驗簽。

## 狀態與證據

[直接節點 manifest](verification/direct-agent-manifest.json) 記錄 node registry 與 live graph 對照。[本機 runtime](verification/direct-agent-runtime.json) 區分 native memory 實跑與固定輸入 HTTP 測試；不把它當作 Gemini 工具選擇、$fromAI 或真向量檢索的證據。

n8n 主流程不保存 execution 原文；Chat Memory 另行持久保存，contextWindowLength 不會刪除 DB 歷史。正式保留／刪除與session身分映射待實作，當前只允許合成資料。
