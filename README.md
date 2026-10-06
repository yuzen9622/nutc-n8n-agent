# 校園 n8n Agent

目前主流程：[原生 n8n AI Agent](docs/NATIVE-AGENT.md) · [本機畫布](http://localhost:15679/workflow/campusNativeAgentV2)。直接接 Gemini、Postgres Chat Memory、PGVector＋Embeddings、學生 HTTP Tools 與搜尋工具。Gemini credentials 待補，向量表尚無語料，HTTP 工具目前為合成資料。下列七個舊流程保留作回歸測試。

Phase 0～1：n8n 畫布、合成 Gateway 與隔離 Docker 環境。現階段不連 LINE、Gemini、Brave 或學校，不使用學生帳密。

- [Roadmap](docs/ROADMAP.md)
- [設計文件](docs/SDD.md)
- [節點規格](docs/WORKFLOWS.md)
- [本機部署、匯入與展示](docs/runbooks/n8n-import.md)
- [本機驗收紀錄：30 情境與重啟驗證](docs/verification/phase-1.md)

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm build
node scripts/setup-secrets.mjs
docker compose -f infra/compose.yaml up -d --build
```

後續初始化、匯入和測試依 runbook。服務只接受合成資料；mock 記憶體狀態不具 production 持久化保證。穩定性以驗證紀錄為準，不能只看 Docker healthy。

新版主流程的 DB 初始化、部署與測試依 [原生 Agent 操作說明](docs/NATIVE-AGENT.md)。舊七流程 runbook 與30情境紀錄保留作歷史證據。
