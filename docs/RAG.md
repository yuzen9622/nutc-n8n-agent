# PGVector 校園知識庫與搜尋工具

版本：0.2；2026-10-06。AI Agent 直接使用 Postgres PGVector Store 與 Search Tool，沒有 plan/assess API 的固定分支編排。

## 線上查詢

PGVector 使用 `retrieve-as-tool` 接 AI Agent 的 Tool port；Google Gemini Embeddings 接 PGVector 的 Embedding port。公開文件檢索回傳文字與來源 metadata，Agent 據此回答。Search Tool 是直接 HTTP Request Tool，目前為合成搜尋介面，正式接 Brave 發現官方 URL，再由 reader 擷取官方原文。不得只依搜尋 snippet 宣稱校規或期限。

穩定規章優先知識庫；今日異動、最新公告、截止日期需要查核官方最新資料。兩者可由 Agent 組合使用；沒有依據時追問或拒答。模型指令不能代替後端的來源／期限檢查。

## 儲存與匯入

獨立 `campus_agent` database 的 `campus_documents` 表：id UUID、text、metadata JSONB、embedding vector。與 `agent_chat_histories` 分表；對話記憶不是校園知識庫，不將學生私人資料嵌入共享向量表。

目前資料表為空。Embedding node 設定 `models/gemini-embedding-001`，credential 待補。須確認實際輸出維度，文件與 query 使用相同模型、維度及向量空間；不得混用不同版本。現有向量欄位未固定維度，正式匯入前須驗證並建立維度約束／索引，不能用測試向量冒充真實 embedding。

後續新增獨立的「知識匯入工作流」：管理者／排程觸發 → 核定來源讀取 → 文件解析／切段 → metadata → Gemini Embeddings → PGVector Insert Documents。這是離線資料建置流程，不是 Agent 工具外再包一層 Workflow Tool。

初始最多30份核定官方文件，按章節／條文切段，預設400–800 tokens、重疊不超過100。metadata 至少包含 sourceId、原始URL、title、version、page/section、fetchedAt、publishedAt（未知為null）、有效日期與適用學制。

## 更新與來源驗證

正式匯入須有來源清冊、內容hash去重、有效版本切換、撤下與過期機制。失敗不得發布半成品，舊版過期時查官方現況。reader 固定允許來源與大小／timeout／redirect 規則；不接受任意代理 URL。

目前 completion 僅驗證合成 HTTP 證據引用。PGVector 的 metadata.sourceId 還需要接入來源登錄與當次任務證據驗證；在此之前未知 sourceId 會被拒絕。不能只因向量表命中就將答案標為已驗證。

先使用原生 PGVector 精確檢索、topK=6。中文關鍵字融合、RRF、reranker、正式同步與成本管理均未實作，不列為現有能力。Embedding 失敗時目前不宣稱具備關鍵字降級。

## 驗收

有 key 與語料後測試真實查詢向量、規章命中、日期與學制適用性、過期／撤下、衝突來源、無來源、惡意文件指令及 provider failure。以至少40題公開QA比較來源支持、正確拒答、延遲與費用；向量相似度不是事實可信度。

[SDD](SDD.md) · [工作流](WORKFLOWS.md) · [Roadmap](ROADMAP.md)
