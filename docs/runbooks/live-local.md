# 本機 LINE／校務服務

只操作已知 `campus-phase1` Compose 專案與 `campus_agent` DB。此處是本機 Docker，不是正式遠端 Linux 主機。公開 Cloudflare ingress 只轉送 LINE／LIFF 路徑，n8n、模型代理與校務內部 API 不對外開放。

所有設定實值位於根 `.env`，Docker build context 排除 `.env*`；請勿執行會印出完整秘密的 `docker compose config`。必要變數見 `.env.live.example`。

```sh
pnpm db:migrate:live
# 重跑會以 checksum 確認已套用版本，遇到未登錄 live schema 則停止。
pnpm build
docker compose --env-file .env -f infra/compose.yaml -f infra/compose.agent-online.yaml -f infra/compose.live.yaml -f infra/compose.providers.yaml -f infra/compose.runtime-local.yaml up -d --no-deps --no-build school-adapter gateway
pnpm invite:line
```

邀請名單取自 `.env` 的 `INVITED_LINE_USER_IDS`，目前只填本人一個 ID。`pnpm invite:line` 會原子同步受邀資格：移除未列入帳號的資格、校務／LIFF session、私人暫存與對話記憶，取消尚未交付工作；保留身分及稽核資料。既有 revoked 狀態不會因重新加入名單而自動解除，仍須本人明確傳送「重新啟用」。空白或無效名單會拒絕整次操作，不把漏填當成清空名單。ID 不是 channel ID。LIFF endpoint 為 `https://nutc-agent.yuzen.dev/liff/`。

`compose.live.yaml` 的 Agent 開關預設false，從 `.env` 明確選擇；Docker內派送URL固定為 `http://n8n:5678/webhook/campus-agent-live` 並注入獨立webhook token。使用者要求優先上線已驗證核心後，現行 `.env LIVE_AGENT_ENABLED=true`；正式流程已發布，真自動worker／模型／RAG／校務混合／LINE API派送驗收通過，先限唯一受邀本人。不是只翻開關：真實執行及資料清理證據見 [live-worker-launch.json](../verification/live-worker-launch.json)。

校務服務沒有 host port；gateway 僅綁定 host loopback 3100。校務 Cookie、私人結果、私人 outbox 均加密，密碼不保存。Cloudflare ingress 由 host loopback 3101 提供；`pnpm start:public` 與 `pnpm start:tunnel` 是獨立前景程序，目前不是開機自動服務。

目前本機 Docker VM 僅 24 GB，完整 OCR 映像曾造成磁碟滿與 PostgreSQL 復原。已移除本次建立的完整映像／快取並驗證資料庫恢復，沒有移除既有 volumes。預設本機命令因此使用 `compose.runtime-local.yaml`：固定 Node Debian 映像、唯讀掛載 workspace 的 dist／node_modules／package.json，不掛載 `.env`；修改後必須重新 build 並重建服務。`infra/live.Dockerfile` 留作磁碟足夠時的封裝方式，目前未使用。

`compose.providers.yaml` 從 `.env` 注入 Gemini 代理與共用上限；使用者已追加核准累計測試NT$300，目前實際每日／累計上限US$6。worker已依上述使用者決策啟用，Google Search仍明確停用。成功聊天回應有可信 totalTokenCount 才按最高 token 單價保守結算；錯誤／缺用量資訊保留整筆預留。目前採 Google 官方搜尋而非 Brave；Google 3.x 的 per-query 費用上界尚未證實，搜尋保持停用。主 Agent 保持 Gemini 3.8，只有搜尋工具的 request-priced 模型替代方案需另取得明確同意，不能默默更换或當成完整搜尋已通過。

2026-10-06 最新狀態：磁碟空間再次不足後 engine API 曾持續逾時／500；先確認 Docker engine 與 PostgreSQL 復原，再使用上列命令。不以容器舊 healthy 紀錄作目前健康證據。

其後使用者已擴大 VM 至48GB，確認26GB可用；四個核心服務healthy、DB非recovery，原生模型測試與LINE官方webhook復測通過。以上異常紀錄保留作排查背景，目前不需要重啟。
