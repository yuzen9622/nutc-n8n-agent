# n8n Docker 首次自動初始化

## 已核准契約
使用官方 CLI，讓填好根 .env 的新環境在 docker compose up 時自動匯入兩個正式 workflow、建立四組 credentials、發布 campusNativeAgentLive；campusKnowledgeIngest 維持手動/inactive。首次 owner 仍由 editor 設定。不得覆寫任何既有畫布、credentials、發布狀態、學生資料、秘密或預算設定。現有工作樹有先前清理及移除費用/worker 開關的變更，保持不動。

## 責任分配
- n8n 官方 CLI 負責 metadata migration、owner/personal project、credential 加密、workflow import 及 publish。
- Compose 負責 postgres/migrate → n8n-init → n8n → gateway 啟動次序。
- 自寫一個 scripts/bootstrap-n8n.mjs：固定資料來源與 credentials 組合、新空 metadata DB 判定、advisory lock、一次性狀態與安全錯誤輸出。不自行寫 n8n workflow/credential/user 表、不使用非公開 owner setup API。

## 安全與恢復
1. init image 與 server 固定同 n8n 2.41.7 digest；僅此 image 包含官方 JSON 與 bootstrap 腳本，秘密透過根 .env 的 Compose env 傳入。
2. 連 n8n metadata DB，獲 session advisory lock。已存在 n8n/public schema 資料則只讀 skip，不 import/publish；完整標記同樣 skip。
3. 在確認空 DB、讀取/檢查 artifacts 及必要 secrets 後建立專用 campus_bootstrap 狀態（pending），再用 CLI 經 stdin 匯入 credentials/workflows、publish 主流程。
4. init 不呼叫 provider、LINE 或 school，不會執行知識匯入。CLI output 不直接輸出；秘密不落檔或進 command args。
5. 全部完成才標 complete。中途失敗保留 pending，後續啟動 fail closed，避免半初始化自動覆寫人工修改。README 說明保留 DB 並人工診斷，不建議 down -v。
6. 不提供自動 upgrade/強制 overwrite。更新需要明確確認已知 instance 後另行處理；本輪不新增泛用部署管理框架。

## 範圍
Dockerfile 新 n8n-init target；docker-compose.yml 共用 DB env + init service/depends_on；.dockerignore 讓 init image 可 COPY 正式 workflows；scripts/bootstrap-n8n.mjs；tests/n8n-bootstrap.test.ts；README.md、docs/SDD.md 與 .env.example 的首次部署说明。

## 驗收
- 官方 CLI/owner/credential keys 查證；確認首次 UI owner 承接匯入 workflows/credentials。
- unit 測 artifact/secret 驗證、順序、不覆寫既有、重跑 skip、pending/CLI failure 關閉、競態鎖定、秘密遮罩。
- pnpm check、pnpm build、diff --check。
- 独立 dummy .env/Compose project/ports，完整 Compose fresh startup、四 encrypted credentials/two workflow/published 主流程、zero external calls。
- 同 project rerun/修改畫布及 credentials 後 rerun，hash 不變；既有未標記 metadata DB skip；fresh 缺設定拒絕；partial init failure blocked。
- 固定 n8n runtime HTTP 與真 browser editor：首次 owner 設定後兩 workflow/credentials 可見，主流程已發布，開畫布無 errors。不冒充真人 LINE/模型問答验收。
- 未參與實作 reviewer 獨立審查；清理僅自己建立的測試資產，不啟動/重啟原環境。
