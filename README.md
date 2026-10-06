# 校園 n8n Agent

目前主流程：[原生 n8n AI Agent](docs/NATIVE-AGENT.md) · [正式畫布](http://localhost:15679/workflow/campusNativeAgentLive) · [LIFF 登入](https://nutc-agent.yuzen.dev/liff/)。採原生 Gemini、Postgres Chat Memory、PGVector＋Embeddings 及學生 HTTP Tools；校務帳密只由獨立 adapter 使用，不入模型或資料庫。

新版 ePortal／AIS 真登入、公開校務綁定與三項真實學生查詢已通過。依使用者「優先上線」決策，正式原生流程已發布、AI worker 已開啟，先限本人試用：Gemini 3.8、官方知識庫、課表／缺曠／公告及私人混合回覆。真正的自動 worker → 正式 n8n → 私人加密 outbox → LINE API 派送已通過；合成 runtime 與管理驗收資料已清除。測試總額NT$300、共用US$6硬限制與原帳本保留。即時 Google 搜尋仍停用，完整搜尋／40題及本人新LINE／LIFF UI驗收不能宣稱已完成。最新範圍見 [實作追蹤](docs/PHASE-2-5-IMPLEMENTATION.md)。

- [Roadmap](docs/ROADMAP.md)
- [設計文件](docs/SDD.md)
- [節點規格](docs/WORKFLOWS.md)
- [本機部署、匯入與展示](docs/runbooks/n8n-import.md)
- [本機驗收紀錄：30 情境與重啟驗證](docs/verification/phase-1.md)

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm build
# 正式設定及完整 Compose 指令依 docs/runbooks/live-local.md；
# 不要用歷史 synthetic 匯入／secret 初始化指令部署正式環境。
```

正式 DB、校務服務與公開入口依 [本機操作](docs/runbooks/live-local.md)。n8n 的 11 個歷史合成流程、6 個合成 credentials 及 mock 容器已清除；預設 Compose 不再啟動 mock。真語料、學生 session、身分、使用者畫布與費用帳本保留。

歷史 Phase 1 程式／JSON／fixture 和30情境紀錄僅保留回歸用途；需要明確使用 `--profile synthetic` 並另外設定測試 tokens，不能用它們作正式服務或真實驗收證據。
