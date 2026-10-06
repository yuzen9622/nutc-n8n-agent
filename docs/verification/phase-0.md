# Phase 0 驗證（2026-10-06）

- SDD、WORKFLOWS、ROADMAP、RAG 的相對 Markdown 連結由 `scripts/check-artifacts.mjs` 檢查通過。
- 登入契約一致：LIFF 僅送帳號／密碼；OCR 在 school-adapter，三輪／30 秒上限；未知登入結果停止，不盲目重送。
- 不保存學校密碼；校方 Cookie、驗證碼圖、個人原文不進 n8n／Gemini／公開 RAG。
- 沒有年齡聲明／人工審核或手動驗證碼產品流程；文件提到這些詞是排除項，不是待辦。
- 個人查詢未知操作以 `personal/unsupported-prompt` 回應，與重新登入分開。
- 使用者於本次指定：先本機 Docker 驗證穩定，再處理遠端；ROADMAP 已記錄，遠端未被當作完成。

此紀錄只證明設計基線與文件一致性。工作流相容性、執行與畫布另記於 Phase 1，不由本紀錄替代。
