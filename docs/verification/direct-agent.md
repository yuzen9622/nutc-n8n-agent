# 直接原生節點驗收（2026-10-06）

範圍：使用者確認的 Gemini＋Postgres Chat Memory＋PGVector＋HTTP Request／Search Tools 架構。本輪更新 Campus AI Agent · 原生主流程；使用者的 My workflow 保留。

| 檢查 | 結果 |
|---|---|
| TypeScript、build、回歸／API測試 | 14／14 通過 |
| 原生 node type/version、live graph | 通過，見 direct-agent-manifest.json |
| 主流程 toolWorkflow 數量 | 0；5條 ai_tool、1條 ai_memory、1條 ai_languageModel、1條 ai_embedding |
| 專用 Agent DB | 已建立 campus_agent；n8n DB role 無 CONNECT 權限 |
| pgvector extension | 0.8.2；向量表空白，無假 embedding |
| Postgres Chat Memory | n8n execution121 透過 Memory Manager 原生讀寫，A/B session隔離通過；測試資料已清除 |
| 學生／搜尋 HTTP 設定 | 四顆工具的固定輸入，以普通HTTP節點實跑端點及本地組裝通過 |
| Gemini 自主工具選擇、$fromAI | 未執行，credentials待補 |
| PGVector 原生真實檢索 | 未執行，embedding credential及語料待補 |
| LINE、Brave、學校登入 | 未接通，仍為合成介面 |
| Secret scan、diff whitespace | 通過 |

Memory測試不需要生成模型；固定HTTP測試不等於AI工具呼叫驗收。主流程未發布，不宣稱只補API key就已完成知識庫與正式學生功能。

測試程式：scripts/check-direct-agent-runtime.mjs。機器可讀結果：direct-agent-runtime.json。既有 native-agent-runtime.json 與 phase-1.md 僅作舊版證據。
