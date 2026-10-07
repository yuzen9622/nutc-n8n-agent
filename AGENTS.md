# Campus Agent

- 先讀 `docs/ROADMAP.md`、`docs/SDD.md`，再讀目標程式；docs 僅保留這兩份文件。
- 正式服務在 `apps/gateway`、`apps/school-adapter`；不得重新加入 Phase 1 mock 程式或合成工作流。
- 輸入 schema 拒絕額外欄位；task capability、lease、operation 與本人 session 必須綁定。
- 正式工作流來源是 `scripts/generate-live-agent-workflow.mjs`、`scripts/generate-knowledge-workflow.mjs`，生成後一併交付正式 JSON。
- 部署只用根 `Dockerfile`、`docker-compose.yml`；SQL migration 保留在應用內，秘密只放根 `.env`。
- 修改後跑 `pnpm check`、`pnpm build`；workflow 改動需在固定 n8n runtime 實跑。靜態檢查不能代替 editor 驗收。
- 不覆寫既有資料、匯入到未知 n8n instance，或把本機 Docker VM 當正式 Linux 主機。
