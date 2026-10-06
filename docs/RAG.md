# PGVector 校園知識庫與搜尋工具

版本：0.3；2026-10-06。原生 n8n Agent 直接連 PGVector 與 Gemini Embeddings；公開語料與學生私人資料分開。

## 已驗證的真實資料

核定來源位於 `apps/gateway/src/modules/knowledge/knowledge.catalog.ts`。目前為國立臺中科技大學生活輔導組「學生缺曠查詢」與「Q&A」2 份官方 HTML，加上「請假及缺曠注意事項」1 份官方 PDF，共 6 段，使用 `models/gemini-embedding-001` 的 3072 維真實向量。不是完整校規庫；其他規章與處室仍未完整涵蓋。

- 原生匯入：n8n execution 129 已發布到資料庫。初次執行未保存 manual execution data，n8n 留下過時 running 紀錄；stop API 回報找不到執行中的工作。因此不以該執行紀錄宣稱完成狀態，發布證據以 DB 為準。後續公開語料匯入已開啟 execution 保存；execution 134 完整 success，未重呼叫 embedding，見 `verification/knowledge-refresh.json`。
- 原生檢索：execution 130，查詢「缺曠資料如果被誤記，應該如何更正？」命中任課老師簽證與生活輔導組更正說明。
- 原生 Agent：execution 132 實際使用 PGVector tool，取得 5 段、2 個 sourceId 並回答問題。
- PDF：execution 135 成功發布 3 份／6 段，只新增一次 embedding；execution 136 原生 PGVector 查詢命中 PDF 的五專前三年紙本請假流程，metadata.page=1。macOS／Linux 真實解析與原頁視覺核對通過，n8n executions 畫面確認 135 Succeeded，見 `verification/knowledge-pdf.json`。
- `check-knowledge-database.mjs` 在隔離 schema 驗證整批發布、冪等、篡改、維度、撤下、過期、舊版本及 task/lease 證據綁定。SQL fixture 不是正式語料。
- 公開問答：executions137–148實跑12題，11題通過原生Agent層語意核對，QA-12發現未知系所推薦問題；修正已接線但149重測失敗。此層不涵蓋LINE／Memory／搜尋／私人工具，不能宣稱40題或端到端完成。逐題證據見 `verification/public-qa.json`。

報告見 [匯入](verification/knowledge-ingest.json)、[檢索](verification/knowledge-retrieval.json)、[Agent](verification/knowledge-agent.json)、[SQL](verification/knowledge-database.json)。

## 匯入與發布

來源：`scripts/generate-knowledge-workflow.mjs`；產物：`workflows/agent/campusKnowledgeIngest.json`。本機 n8n 草稿 ID `GpPL25hCJhMyJEIa`，只允許管理者手動啟動，不排程扣費。

手動入口 → Gateway 讀取核定來源 → 逐段檢查 hash → 原生 Gemini Embeddings → 原生 PGVector Insert 暫存 → Gateway 驗證整批 → 原子發布。內容與模型未變時重用既有向量。prepare/publish 只接受 service credential，公開 ingress 不代理這些路徑。

reader 使用固定 HTTPS host、每次 redirect 與 DNS 位址檢查、1 MiB 上限與逾時；RPage 優先選 `.mpgdetail` 正文，排除網站選單。HTML 正文最多 12000 字元。PDF 使用固定 pdfjs-dist 6.4.299，在不繼承秘密環境變數的子程序解析，128 MiB JS heap、10 秒期限、最多兩個解析程序；停用字串程式碼生成，不執行 PDF viewer／JavaScript。最多30頁、全文120000 UTF-8 bytes，每頁必須有可讀文字；壞檔、空白／圖片頁或超限整份拒絕，沒有以部分文字冒充完整文件。掃描 PDF 尚未加入 OCR。

PDF 逐頁切段、metadata 保留實際頁碼，版本 hash 包含頁界。切段優先段落邊界、每段最多 2000 UTF-8 bytes、零重疊；這是目前的確切實作，尚未以 Gemini tokenizer 驗證原設計的 400–800 token 目標。短文件不強行補長。

metadata 包含 sourceId、URL、title、內容 hash version、page/section、fetchedAt、publishedAt、有效期限、適用學制、chunkId、模型與維度。官方頁面未標明的發布／施行日期維持 null，不把擷取日冒充施行日。兩份來源對曠課節數的文字有差異，Agent 必須說明衝突，不能自行決定法規優先順序。

`campus_knowledge_staging` 使用 `vector(3072)`；整批所有預期段落及 metadata 都比對成功才更新來源版本並寫入 `campus_knowledge_chunks`。失敗或逾 30 分鐘的批次不發布；不會自動重新啟用撤下來源。`campus_knowledge_current` view 只呈現 active、仍在 24 小時查核有效期內的當前版本。使用精確相似度掃描，沒有 3072 維 HNSW 索引或合成向量。

## 本次引用證據

正式工作流保留原生 PGVector `retrieve-as-tool`、topK=6，開啟 Agent `returnIntermediateSteps`。固定 completion 節點只轉交框架產生的 campus_knowledge observation，不從模型最終 JSON 擷取證據。

Gateway 解析固定 n8n 2.41.7 observation 結構，核對 sourceId、version、chunkId 與段落全文，再綁定目前 task/lease。completion 與 outbox delivery 再次檢查來源仍有效；記憶中的舊引用、只猜到 sourceId、竄改段落或跨任務 lease 皆不足以通過。模型輸出可為完整 JSON 或單一完整 JSON code fence，仍使用嚴格欄位契約。

所有 Gemini、embedding、Brave 呼叫受同一持久費用上限約束，詳見 [預算](PROVIDER-BUDGET.md)。私人學校結果不嵌入本語料庫，也不交給 Gemini；由 Gateway 本地組裝。

## 尚待完成

使用者詢問改用 Google Search；其 grounding 不能直接取代 Brave 網址發現／reader 流程，替代方向待確認，真實搜尋與最新公告驗收未完成。更多核定來源、至少 40 題公開／混合／拒答／衝突／惡意指令 QA 與真人 LINE 驗收仍待完成。使用者已限定只開放本人，雙真人隔離驗收延後，合成隔離測試保留。目前沒有關鍵字降級、RRF 或 reranker。正式 LINE worker 保持關閉，不能將上述 smoke 宣稱為 Phase 3 完成。

[SDD](SDD.md) · [工作流](WORKFLOWS.md) · [Roadmap](ROADMAP.md)
