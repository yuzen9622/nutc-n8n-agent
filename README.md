# 校園 n8n Agent

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
