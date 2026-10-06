# n8n 工作流與節點規格

版本：0.4；2026-10-06。依使用者「My workflow」的原生節點架構。本文件為目前規格，舊版七個流程的測試紀錄僅適用原版本。

## 目前主流程

ID：`campusNativeAgentV2`，名稱「Campus AI Agent · 原生主流程」。來源為 `scripts/generate-agent-workflows.mjs`，產物 `workflows/agent/campusNativeAgentV2.json`。

| 節點 | 原生 type | 作用 |
|---|---|---|
| Webhook | webhook 2.1 | POST campus-agent-v2、Header Auth、Respond to Webhook 模式 |
| 驗證與去重 | httpRequest 4.4 | 呼叫 agent/prepare；建立任務與可信上下文 |
| 是否新任務 | if 2.2 | duplicate 直接回覆，新任務繼續 |
| 整理訊息 | set 3.4 | 解包 prompt、taskId、capability、sessionKey |
| AI Agent | langchain.agent 3.1 | 選工具、生成 JSON；最多5 iterations |
| Gemini Chat Model | lmChatGoogleGemini 1.2 | ai_languageModel 直接接 Agent |
| Postgres Chat Memory | memoryPostgresChat 1.4 | ai_memory 直接接 Agent；窗口5次互動 |
| campus_knowledge | vectorStorePGVector 1.3 | retrieve-as-tool，ai_tool 直接接 Agent；topK=6 |
| Google Gemini Embeddings | embeddingsGoogleGemini 1 | ai_embedding 接 campus_knowledge |
| student_schedule | httpRequestTool 4.5 | 固定課表操作，ai_tool 直接接 Agent |
| student_absence | httpRequestTool 4.5 | 固定缺曠操作，ai_tool 直接接 Agent |
| student_announcements | httpRequestTool 4.5 | 固定公告操作，ai_tool 直接接 Agent |
| official_search | httpRequestTool 4.5 | 搜尋工具，query 由 $fromAI 提供，端點固定 |
| 驗證結果與本地組裝 | httpRequest 4.4 | 檢查輸出與來源，再合併私人模板 |
| 回覆 Webhook | respondToWebhook 1.5 | 回 JSON；目前 synthetic=true、delivered=false |
| 安全錯誤回覆 | set 3.4 | 固定失敗訊息，不暴露內部錯誤 |

上述 langchain types 前綴為 `@n8n/n8n-nodes-langchain.`，其餘為 `n8n-nodes-base.`。主流程沒有 Call n8n Workflow Tool。

## 工具參數與輸出

學生工具不提供模型自訂 URL、帳號或 action。三顆 HTTP Request Tool 各自固定 query= schedule、absence、announcements。taskId 和 capability 固定取自「整理訊息」。Search Tool 只允許模型填公開 query，目前呼叫合成搜尋介面；正式用相同介面接 Brave／reader。

PGVector 與 Chat Memory 使用 Campus Agent Postgres credential；Gemini Chat Model 與 Embeddings credential 留待使用者設定。PGVector 目前空表，沒有合成向量冒充 Gemini embeddings。記憶窗口不是保留期限，清理機制另行實作。

模型不得把私人原文存入 memory。工具只回私人處理狀態；最終私人模板在 Agent 之後生成。記憶中的 sourceId 不能冒充本次檢索結果。

## 入口與測試

```json
{"eventId":"demo-001","scenario":"personal","session":"demo-a"}
```

只能使用合成 scenario 與兩個測試 session。正式自由文字／身分驗證待 Phase 2；不讓匿名 event 任意選取別人的 memory。未補外部 credentials 前主流程保持未發布，不能標成可用的對外 Webhook。

## 歷史流程

`workflows/WF-01.json`～`WF-07.json` 與 `campusAgentToolknowledge/personal/web` 保留作舊回歸資產。新版生成／部署以主流程為準，不再產生或發布三個包裝子流程；舊報告中的30情境、execution117不證明本版 Memory、PGVector 或直接工具通過驗收。

[SDD](SDD.md) · [RAG](RAG.md) · [Roadmap](ROADMAP.md) · [部署說明](NATIVE-AGENT.md)
