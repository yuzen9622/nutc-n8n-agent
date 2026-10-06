# 本機 LINE／校務服務

只操作已知 `campus-phase1` Compose 專案與 `campus_agent` DB。此處是本機 Docker，不是正式遠端 Linux 主機。公開 Cloudflare ingress 只轉送 LINE／LIFF 路徑，n8n、模型代理與校務內部 API 不對外開放。

所有設定實值位於根 `.env`，Docker build context 排除 `.env*`；請勿執行會印出完整秘密的 `docker compose config`。必要變數見 `.env.live.example`。

```sh
pnpm db:migrate:live
# 重跑會以 checksum 確認已套用版本，遇到未登錄 live schema 則停止。
pnpm build
docker compose --env-file .env -f infra/compose.yaml -f infra/compose.agent-online.yaml -f infra/compose.live.yaml -f infra/compose.providers.yaml -f infra/compose.runtime-local.yaml up -d --no-deps --no-build --force-recreate --wait --wait-timeout 120 school-adapter gateway
```

2026-10-07 公開准入程式已改為不使用受邀名單；使用者明確核准校務結果送 Google Gemini 整理，並確認 LINE Login Channel 為 Published。check 99/99、build、真 DB LINE 49／school 25 項與固定 n8n Memory／HTTP 工具／completion／加密 outbox runtime 已通過，migration 015 已套用並核對 checksum，gateway／school-adapter 強制重建後 healthy，公開 ingress 已重啟、LIFF SDK 真瀏覽器初始化成功且登入按鈕啟用。公開 LIFF 200、匿名 bind 401、跨 Origin identity 403、無簽章 webhook 401、internal 404；既有身分、校務 Cookie 與費用帳本指紋前後不變。證據：[部署](../verification/public-line-deployment.json)、[瀏覽器畫面](../verification/public-line-liff.png)。隔離測試使用合成身分，不冒充雙真人已驗收。

更新後不需 `INVITED_LINE_USER_IDS` 或邀請腳本。加入 LINE Bot 的使用者可直接使用；後端只信任已驗簽的一對一事件及已驗證的 LINE ID token，自動建立各自身分。每人於 LIFF 登入自己的校務帳號，session／記憶／私人任務及回覆仍隔離。LINE Login Channel 必須在 LINE Developers 設為 Published 才能讓非開發者登入；後端開放准入不能代替平台發布。LIFF endpoint 為 `https://nutc-agent.yuzen.dev/liff/`。

解除綁定／封鎖 Bot 仍撤銷並刪除本人登入資料。新使用者的 follow 可自動註冊；已撤銷者重新加好友仍須本人精確傳送「重新啟用」恢復使用，以免延遲 follow 推翻較新的封鎖。恢復後必須重新登入校務，舊 Cookie 不會恢復。migration 015 僅移除邀請判斷，保留既有 revoked 狀態及舊欄位；不清空資料或費用帳本。

`compose.live.yaml` 的 Agent 開關預設false，從 `.env` 明確選擇；Docker內派送URL固定為 `http://n8n:5678/webhook/campus-agent-live` 並注入獨立webhook token。使用者要求優先上線已驗證核心後，現行 `.env LIVE_AGENT_ENABLED=true`；正式流程已發布，真自動worker／模型／RAG／校務混合／LINE API派送驗收通過；當時只有本人試用，本輪已依使用者要求修改公開准入原始碼；公開准入的部署與資料保留驗證見 [public-line-deployment.json](../verification/public-line-deployment.json)。不是只翻開關：真實執行及資料清理證據見 [live-worker-launch.json](../verification/live-worker-launch.json)。

校務服務沒有 host port；gateway 僅綁定 host loopback 3100。校務 Cookie、私人結果、私人 outbox 均加密，密碼不保存。Cloudflare ingress 由 host loopback 3101 提供；`pnpm start:public` 與 `pnpm start:tunnel` 是獨立前景程序，目前不是開機自動服務。

目前本機 Docker VM 僅 24 GB，完整 OCR 映像曾造成磁碟滿與 PostgreSQL 復原。已移除本次建立的完整映像／快取並驗證資料庫恢復，沒有移除既有 volumes。預設本機命令因此使用 `compose.runtime-local.yaml`：固定 Node Debian 映像、唯讀掛載 workspace 的 dist／node_modules／package.json，不掛載 `.env`；修改後必須重新 build 並重建服務。`infra/live.Dockerfile` 留作磁碟足夠時的封裝方式，目前未使用。

`compose.providers.yaml` 從 `.env` 注入 Gemini 代理與共用上限；使用者已追加核准累計測試NT$300，目前實際每日／累計上限US$6。worker已依上述使用者決策啟用，Google Search仍明確停用。成功聊天回應有可信 totalTokenCount 才按最高 token 單價保守結算；錯誤／缺用量資訊保留整筆預留。目前採 Google 官方搜尋而非 Brave；Google 3.x 的 per-query 費用上界尚未證實，搜尋保持停用。主 Agent 保持 Gemini 3.8，只有搜尋工具的 request-priced 模型替代方案需另取得明確同意，不能默默更换或當成完整搜尋已通過。

2026-10-06 最新狀態：磁碟空間再次不足後 engine API 曾持續逾時／500；先確認 Docker engine 與 PostgreSQL 復原，再使用上列命令。不以容器舊 healthy 紀錄作目前健康證據。

其後使用者已擴大 VM 至48GB，確認26GB可用；四個核心服務healthy、DB非recovery，原生模型測試與LINE官方webhook復測通過。以上異常紀錄保留作排查背景，目前不需要重啟。
