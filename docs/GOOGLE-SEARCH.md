# Gemini 官方 Google Search 整合

2026-10-06。使用者指定採 Google 官方搜尋，取消 Serper 提案，不需要第三方 API key。

## 流程

原生 n8n AI Agent → official_search HTTP Tool → Gateway → Gemini `generateContent`＋`google_search` → Gemini 搜尋並統整 → 加密保存本人回答 → LINE 附 LIFF 結果連結。主 Agent 僅取得 `grounded_answer_ready`，不再改写 Grounded Result。LIFF 驗證 LINE 身分、受邀資格、session/CSRF、任務所有人及 generation 後顯示完整回答、來源與 Google Search Suggestions。

搜尋結果與官方 RAG 證據分開：不將 grounding 網址交給 crawler，不灌入共享 corpus，不將答案回填主 Agent 的 Memory。結果保存最多一天；清除對話、撤銷、移出邀請名單時立即清除。失敗任務不保留答案。LINE 純文字不支援完整 Search Suggestions HTML，因此用 LIFF 顯示，不能宣稱已完成純文字聊天室內的完整搜尋呈現。

## 設定與費用限制

沿用 root `.env` 的 `GEMINI_CHAT_KEY`、`GEMINI_CHAT_MODEL`。

- `GOOGLE_SEARCH_ENABLED=false`：目前仍停用付費呼叫。
- `GOOGLE_SEARCH_MAX_COST_MICRO_USD=0`：確認包含模型與搜尋的預留額前，零值拒絕呼叫。
- 費用預留使用共同持久帳本的 `gemini` 分類，不採只計 token 的退回機制，避免漏算搜尋。
- Gemini 3 搜尋按實際 query 計費；單次请求可能產生多筆 query。官方目前查得的 GoogleSearch / ToolConfig schema 未提供可確認的每次 query 數硬上限。**設定預留額本身不是供應商搜尋次數硬上限，不能據此宣稱嚴格保證不超過 100 元。** 在證明費用上界或確認供應商可強制限制之前，不啟用正式付費搜尋。
- 既有保守帳本共 US$1.787719，下次主 Agent 固定預留 US$0.25，超過現有 US$2 共同上限。不是已確認的實際 Google 帳單，不清零、不擅自提高上限。

## 驗證界線

已加入 transport fixture 測試：官方端點／key／google_search 請求、先預留才連線、錯誤遮蔽、回應大小／結束狀態／grounding metadata、來源 HTTPS、主文字逸出及搜尋建議主動內容拒絕。資料庫隔離測試包含加密、跨使用者拒絕、完成前不可讀、答案不可被外層 Agent 改寫、到期清理。這些使用合成回應，不是 Google 實際搜尋成功證據。

待驗收：真 Google Search、真 LINE/LIFF 本人閱讀、Google 實際 Search Suggestions HTML 相容性、完整混合查詢與學校本人登入。正式 workflow 仍未發布，worker 仍停用。

## 官方依據

- [Google 搜尋 grounding](https://ai.google.dev/gemini-api/docs/generate-content/google-search?hl=en)
- [Gemini API 條款：Grounding with Google Search](https://ai.google.dev/gemini-api/terms)
- [計價](https://ai.google.dev/gemini-api/docs/pricing)

本輪驗證結果：`pnpm check` 71 項測試通過、`pnpm build` 通過、49 項隔離資料庫檢查通過、秘密掃描通過。n8n 2.41.7 execution 151 驗證 Google 分支的合成工具回應、本人加密回答與混合 outbox；正式工作流 system message 已於 editor 讀回確認。migration 010 已套用到既有本機 campus_agent；gateway 健康檢查 200、公開 `/liff/result` 未登入回傳 401。Google 付費呼叫與真人端到端仍未執行。
