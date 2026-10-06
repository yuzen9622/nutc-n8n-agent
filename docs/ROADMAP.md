# 校園 AI Agent Roadmap

版本：0.3；2026-10-06。以使用者確認的原生 n8n 節點架構為準；先本機 Docker，穩定後再部署遠端。

| Phase | 範圍 | 目前狀態 |
|---|---|---|
| 0 | 原生 Agent、模型、記憶與工具設計 | 本輪同步改寫設計基線 |
| 1 | 本機部署、原生畫布、DB 與合成介面 | 結構與本機元件驗證；真模型驗收待 credentials |
| 2 | LINE／LIFF、身分、持久任務、多輪對話 | 進行中：公開 LIFF 頁／SDK 初始化及派送草稿通過驗證；web session／CSRF／綁定已部署；官方 webhook 與本人 LIFF 身分登入已驗證；真人 LINE 問答仍待驗收 |
| 3 | Gemini、PGVector 語料、公開搜尋問答 | 真 Gemini／Embeddings／3 份官方語料（含 PDF）原生匯入與檢索已驗證；Google 官方搜尋接線已完成，付費搜尋與 40 題 QA 待驗收 |
| 4 | 學校登入與本地 OCR | 新版 ePortal／AIS 真登入、公開綁定、加密持久 session 及三項真實校務查詢通過；新一輪真人 LIFF UI 驗收待完成 |
| 5 | 真實學生功能與混合回覆 | 正式草稿使用 gateway；私人工具與加密本地回覆已接線，部署與真人資料驗收待完成 |
| 6 | 隔離／成本／負載／備份與遠端試用 | 未完成；遠端停止狀態 |

## Phase 0–1

原生主流程必須包含 Webhook、AI Agent、Gemini Chat Model、Postgres Chat Memory、PGVector＋Embeddings、直接學生 HTTP Tools 與 Search Tool。不以 Call n8n Workflow Tool 統一包裝所有功能。

交付：固定版本 Docker、工作流來源與JSON、獨立 Agent DB、credentials mapping、實際 editor、圖結構與API邊界測試。資料庫測試、原生 memory 測試、工具 HTTP 測試與真模型端到端結果分開紀錄。只有圖片或節點存在不算 Agent 完成。

## Phase 2

LINE raw-body 驗簽、公開自動註冊（不使用受邀名單）、群組限制、輸入最小化、transaction inbox/task/outbox、快速 ACK 與可靠派送；LIFF token 驗證與本人校務綁定頁。加入好友可使用，但解除綁定／unfollow 仍撤銷；follow 不能解除既有撤銷；本人精確「重新啟用」只恢復助理，不恢復舊校務登入。正式 session key 由驗證身分推導，兩人隔離；多輪上下文清除、七天保留與解除綁定清理。不能只用模型指令實作身分與權限。

## Phase 3

使用者補 Gemini Chat Model／Embeddings credential，確認模型可用性與費用，套用連外設定後做真 Agent smoke。建立官方語料匯入工作流與來源清冊，維度一致性、sourceId證據驗證、版本與撤下控制；Gemini 官方 Google Search（詳見 GOOGLE-SEARCH.md）與獨立官方 reader。至少40題測試知識庫／搜尋／混合／拒答。模型、embedding、搜尋共同用量與硬限制須另實作，maxIterations不等於費用上限。

## Phase 4–5

獨立 school-adapter、本地OCR、三輪／30秒登入限制，不保存密碼；本人session、安全撤銷與續期。三顆 HTTP Tools 各接真實課表、缺曠、公告 API，後端持續檢查所有權。私人結果本地組裝，不回填 Gemini 或 Chat Memory；混合問題合併公開與私人回覆。

## Phase 6

兩位學生並行隔離、重送不重覆發送、失效與撤銷競態、provider錯誤與費用到頂、DB／服務重啟、100任務／5並行、備份還原、iOS/Android LIFF試用。通過本機穩定性與相關真實整合驗收後才到遠端主機。

## 證據分類

[舊 Phase 1](verification/phase-1.md) 的30情境與 [舊包裝工具測試](verification/native-agent-runtime.json) 保留為歷史證據，不能證明本版直接工具、Memory 或PGVector已通過。每輪回報必須明列已跑、未跑、合成或真實、credential／資料依賴。

[SDD](SDD.md) · [工作流](WORKFLOWS.md) · [RAG](RAG.md) · [本機操作](NATIVE-AGENT.md)

Phase 2–5 本輪實作與尚缺設定詳見 [實作追蹤](PHASE-2-5-IMPLEMENTATION.md)。
