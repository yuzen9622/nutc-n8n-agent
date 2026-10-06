# 部署排錯紀錄（2026-10-06）

- 固定版本：n8n 2.41.7、pgvector 0.8.2／PostgreSQL 17.10、Node 24.14.0。所有基底 image 已固定 registry manifest digest；詳見 Compose／Dockerfiles。
- 遠端初次 DB 初始化：secret 為 host owner 0600，postgres UID 無法讀取，導致空密碼角色。修正為 host 父目錄 0700、個別 secret 0644，並在 SQL 前檢查讀取及非空。遠端已停止；尚未修復其舊 volume。
- 本機外接磁碟 bind-mounted init.sh 被視為可執行但 noexec，初始化中斷。改為 COPY 進專用 PostgreSQL image 並設 0644，由官方 entrypoint source。此次本機半完成初始化以明確 `sh init.sh` 補建，沒有刪除 volume。
- Docker Desktop 曾回傳 daemon 500／starting；恢復後繼續本專案工作。未重啟其他使用者服務或改動 Docker Desktop 設定。
- 單一 internal network 的 publish 未產生可用 host listener；增設 admin-proxy，僅固定轉發至 n8n:5678，host 只綁 127.0.0.1:15679。n8n、mock、DB 留在 internal network。
- 已實測 n8n 與 mock 對外 TCP 1.1.1.1:443 被拒絕；n8n DB user 無法 CONNECT campus database；pgvector extension 回 0.8.2，等向量距離為 0。

上述不等於工作流驗收；結果以 runtime 與 browser 紀錄為準。
