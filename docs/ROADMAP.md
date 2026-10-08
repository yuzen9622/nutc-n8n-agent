# 校園 AI Agent Roadmap

更新：2026-10-08。正式流程採原生 n8n Agent；先本機 Docker，穩定後再部署遠端。部署入口為根目錄 `Dockerfile` 與 `docker-compose.yml`，操作指令見 [README](../README.md)，設計見 [SDD](SDD.md)。不再保留 Phase 1 mock 程式、合成工作流與歷史驗證文件。

| Phase | 範圍 | 目前狀態 |
|---|---|---|
| 0 | 原生 Agent、模型、記憶與工具設計 | 已建立正式設計基線 |
| 1 | 本機部署、原生畫布與獨立 Agent DB | 已建立；新空環境自動匯入／發布；LINE／LIFF ingress 與 Tunnel 納入同一 Compose，不需額外 host 程序 |
| 2 | LINE／LIFF、身分、持久任務與多輪對話 | 已發布並啟用 worker；公開自動註冊及本人校務綁定已部署；雙真人端到端驗收未完成 |
| 3 | Gemini、PGVector 與公開搜尋 | 真 Gemini／Embeddings 與官方 HTML／PDF 語料匯入、檢索已驗證；Google Search 保持停用，完整 40 題問答驗收未完成 |
| 4 | 學校登入與本地 OCR | ePortal／AIS 真登入、加密持久 session 與課表／缺曠／公告查詢已驗證 |
| 5 | 真實學生功能與混合回覆 | 本人校務結果供 Gemini 整理；加密 outbox／LINE 派送已驗證，完整真人 UI／混合及多輪驗收未完成 |
| 6 | 隔離、成本、負載、備份及遠端部署 | 未完成；目前仍為本機 Docker，非正式 Linux 主機 |

## 後續驗收

- 兩位學生並行使用：登入、對話記憶、校務結果與派送隔離。
- LINE／LIFF 真人多輪與混合問題；iOS／Android 使用體驗。
- 完整公開／搜尋／混合／拒答問答集。搜尋仍使用獨立開關，啟用前完成供應商與回答來源驗收，不擅自更換模型。
- 重送不重複發送、session 失效、解除綁定／unfollow 與派送競態。
- provider 錯誤、限流、資料庫／服務重啟、100 任務／5 並行。
- 備份還原與遠端 Linux 部署；不得以本機 Docker VM 或合成測試代替正式驗收。

使用者已核准本人校務結果提供 Google Gemini 整理，登入密碼與 Cookie 不提供給模型；記憶最多七天且不進共享 RAG。依使用者要求，worker 隨服務啟動，應用程式不再設置每日／累計費用上限或預留結算；費用由供應商計收。

刪除歷史報告不等於補足未完成驗收；每次交付仍須區分真實整合、合成測試及未執行項目。
