# Campus Agent

- 先讀 `docs/ROADMAP.md`、`docs/WORKFLOWS.md`，再讀目標程式。
- Phase 1 僅合成資料；mock gateway 不得加入外部供應商、LINE 或學校連線。
- `apps/mock-gateway/src` 採 router → schema → controller → service；service 不依賴 HTTP。設定集中 config，回應由 utils/http 統一。
- `mock.schema.ts` 是輸入契約來源；拒絕額外欄位，task capability、lease、operation 與 ref 必須綁定。
- 工作流來源是 `scripts/generate-workflows.mjs`，生成後一併交付 `workflows/*.json`。
- 修改後跑 `pnpm check`、`pnpm build`；workflow 改動需在固定 n8n runtime 實跑。靜態檢查不能代替 editor 驗收。
- 不覆寫既有資料、匯入到未知 n8n instance，或把本機 Docker VM 當正式 Linux 主機。
