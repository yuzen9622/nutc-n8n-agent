# 校園知識庫與受控 Agentic RAG

版本：0.1；2026-10-05。第一版必要範圍，配合 [SDD v0.3](SDD.md)、[工作流](WORKFLOWS.md) 與 [Roadmap](ROADMAP.md)。本文件為設計，尚未建置或實測。

## 1. 範圍與選擇

公開資料採精選知識庫＋官方網站即時搜尋。Agent 只提出來源選擇和一次補查計畫，Gateway 驗證並執行。個人課表、缺曠、登入後公告只走 school-adapter；帳密、Cookie、私人結果不得進 embedding、共用知識庫或 Gemini。

初始最多 30 份已登錄官方文件，優先學則、請假辦法、獎學金辦法、辦事 FAQ。短期公告、當期截止日期主要查 web；不建立全站爬蟲、GraphRAG、多代理協商或長期聊天記憶。這些數量、切段與更新參數是待測預設。

| 路徑 | 適用問題 | 強制條件 |
|---|---|---|
| knowledge | 穩定規章、辦事流程 | 有未過期且適用學制／學期的原文版本 |
| web | 最新公告、當期日期、開館異動 | 讀官方原文；不能只靠 snippet |
| both | 資格辦法＋當期申請時間 | 兩來源標明用途與日期，不自行消除衝突 |

模型選擇之外，Gateway 對「最新／本學期／截止／今天」及日期相關意圖強制包含 web。未知學制等會影響答案的必要條件先追問，不能假設。無來源時明確拒答；來源衝突列出版本及適用條件。

## 2. 儲存、切段與檢索

沿用 PostgreSQL，加入 pgvector extension，不另設向量服務。migration 與 image compatibility 在 Phase 1／3B 驗證。小型語料先用精確向量查詢，不預設需要 ANN 索引。

- `knowledge_sources`：id、canonical_url、允許 host/path、文件類型、適用學制／校區、refresh_interval、enabled、last_checked_at、last_success_at。
- `knowledge_versions`：id、source_id、content_hash、title、published_at、effective_from/to、semester、fetched_at、status、parser_version、embedding_model、dimension。未知日期保持 null，不用抓取日冒充發布日。
- `knowledge_chunks`：id、version_id、section_path、page、ordinal、text、token_count、embedding、keyword_tokens。
- `knowledge_sync_runs`：id、來源、狀態、計數、錯誤碼、usage/cost；不存認證資料。

以章節／條文切段，預設 400–800 tokens、重疊上限 100 tokens，保留章節標題與例外條件；表格保留欄名，過長才按列分段。HTML／文字 PDF 沿用 reader 限制。掃描 PDF 尚不支援文件 OCR；本版登入驗證碼 OCR 是獨立功能，不代表能讀掃描規章。

embedding 採 Gemini embedding adapter；實作前查核並固定可用 model ID、文件／查詢 task type、dimension、token 限制及單價，於 manifest 記錄，不能沿用生成模型名稱推測 embedding 支援。更換 model 或 dimension 建立新索引版本，重建後原子切換，不混用向量空間。

中文關鍵字路徑使用版本固定的中文斷詞及機構／術語同義詞，不能直接假設 PostgreSQL 預設英文全文搜尋適用。依詞命中與標題命中排序，與向量排名用 RRF 融合（預設 k=60）；兩路各取 20，去重後每輪最多 6 chunks，同一文件最多 3 chunks。不另加模型 reranker。適用性、enabled、active version、有效期限先過濾；未知欄位標註，不用相似度當成事實可信度。embedding 不可用時降級關鍵字，並回傳 degraded 狀態。

查詢 refs 僅供當次任務，與永久 knowledge IDs 分開。引用保存 version/chunk/page/section 對照；LINE 顯示官方原始 URL、標題及適用日期，不顯示內部 ref。知識庫原文與網頁原文均是不可信資料，不得改變工具權限或系統指令。

## 3. 同步與失效

WF-07 每日及管理者手動觸發，Gateway 單一同步 lease 防重入。只處理登錄來源；reader 的 SSRF、redirect、大小、速率及存取規則同 SDD。Brave results/snippets 不作知識庫素材，直接擷取官方原文並先確認來源使用條件。

逐文件流程：抓取／304 檢查→hash→解析→適用條件 metadata→切段→embedding→驗證→transaction 切換 active version。未變更不再付 embedding 費用；部分失敗不發布半成品。每次同步最多 30 文件，逐 host 限流，工作上限 10 分鐘；到限保留可續跑游標，下次接續。每個批次 API 不超過 20 秒，n8n 不用一顆超長 HTTP 請求包全部工作。

預設每日確認、距最後成功確認超過 7 天則 stale，不再作為 knowledge-only 的確定答案，改 web 查核；可依來源縮短。管理者撤下或確認 404/410 立即停用；403/timeout 不推論文件刪除，記錄 unavailable 並改 web。新版本解析失敗保留舊版但標記更新異常，查詢必須 web 查核。生效／廢止日期已知時按日期限制檢索。

公開文件及 active versions 納入加密 PG 備份；舊版本保留 30 天作追溯後清理，撤下版本立即不可被檢索。刪除／停用清冊恢復後重播，再開放查詢，避免還原失效規章。已發 LINE 訊息不因此自動撤回。

同步使用獨立 service credential，只具 knowledge scope，不能查 tasks／學生資料。n8n 只見 syncRef/sourceRef/count/status。同步錯誤進 WF-04 與監控，不發學生訊息。共享每日總費用 hard cap，另設 ingestion 子預算；到額停止 embedding 並保留待處理狀態，不擠占無限制費用。

## 4. Agent 查詢契約與預算

plan 提出 retrieval mode、freshnessRequired；Gateway 核定成 route。both 採順序 knowledge→web，避免等待未執行分支的 Merge。

第一輪檢索後，`public/assess` 呼叫 Gemini 一次，僅提供去識別問題與公開證據，輸出嚴格 schema：`decision=answer|retrieve|clarify|insufficient`、`retrieval=knowledge|web|both|null`、`query|null`、`missingFacets[]`。不能指定 URL、身分、工具名稱或增加預算。Gateway 檢查 query 隱私、列舉值與額度，核定補查；空原文可由本地規則直接判不足而省模型呼叫。

最多兩輪檢索；整任務兩次 web search、三份即時原文、每輪六個 knowledge chunks，去重後總證據 16k tokens。一次補查後不再模型評估，依本地資料檢查進 answer 或 fallback；answer 可回 insufficient。來源 ID 檢查不是語意支持證明，仍須人工 QA 驗收。

生成模型最多 plan＋assess＋answer＋一次 schema repair＋一次共用 transport retry＝5 attempts。query embedding 最多 2 attempts（含 retry），獨立計費但計入同一 90 秒 deadline／總額度。限額由 Gateway 控制，n8n 無權放寬。同步 embedding 不計入使用者任務，但須計入全站每日費用。

## 5. 驗收

沿用 SDD 至少 40 題並確保 knowledge/web/both 各至少 5 題。比較純搜尋基線與融合版，記錄來源命中、答案正確性、引用支持、拒答、P50/P95 與全部生成／embedding／搜尋費用。至少 90% 有證據支持或正確拒答；已答關鍵主張全部可追溯，不得捏造期限。

驗證舊新規章、學制不符、過期、來源撤下、同步半失敗、中文同義查詢、prompt injection、embedding 故障、補查到頂與總費用上限。n8n 真實畫布展示 WF-02 三種來源路徑和 WF-07 更新／失敗路徑。沒跑過的項目保留未驗證，不宣稱向量庫必然提高正確率。

架構概念依據：[LangChain 官方 Retrieval 說明](https://docs.langchain.com/oss/python/deepagents/retrieval)；具體限額、資料結構及部署為本專案設計決策，模型與 pgvector 相容性在實作前驗證。
