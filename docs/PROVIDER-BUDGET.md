# 供應商測試預算

查核日：2026-10-06。使用者已明確核准將累計服務端測試總額由新臺幣100元提高至300元。根 `.env` 及實際 gateway 改為共用每日／累計 US$6 上限，按保守 NT$40/USD 計為 NT$240，保留匯差及手續費空間。保留既有帳本與聊天 US$0.25／embedding US$0.025 預留，不清空帳本、不重設累計值；這不是每日可再花300元。

官方來源：

- [Google Gemini API 定價](https://ai.google.dev/gemini-api/docs/pricing)：Gemini 3.8 Flash 標準文字輸入 US$0.75／百萬 tokens、輸出（含 thinking）US$3.75／百萬，適用至 2026-12-31。
- [Gemini Embedding 001 定價](https://ai.google.dev/gemini-api/docs/pricing?hl=zh-tw)：US$0.15／百萬輸入 tokens。
- [臺灣銀行 USD 牌告](https://rate.bot.com.tw/xrt/quote/ltm/USD?Lang=zh-TW)：查核日即期賣出約 NT$31.785，採 NT$40 作測試預算餘裕，不作實際帳單匯率承諾。
- [3.8 Flash 模型規格](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash)：thinking 僅 low／medium／high，minimal 不支援。

每次 Gemini HTTP 嘗試先預留 US$0.25；輸入 body 128 KiB、輸出最多 2048 tokens、只有文字／函式工具，禁止多候選、檔案、圖片、cache 及額外付費內建工具。Embedding 每次最多16筆、同樣 body 上限，預留 US$0.025。SDK 重試各自預留；逾時、未知狀態或無法辨識的用量保留全額。純 token relay 收到原始上游 HTTP 400／500 時，依官方 billing FAQ 免收 token 費用，保留 1 microUSD、釋放其他預留，並記錄原始狀態與結算依據。Google Search 含额外搜尋費用，不套用此退款規則。

Gemini 3.8 Flash 成功回應有正整數 totalTokenCount，且在已查核費率有效期內，才能把預留值降低至「所有 tokens 一律以較高輸出單價」計算的上限。此值仍高於一般實際費用；不是 Google 最終帳單。結算失敗保留全額預留。

原始 API keys 只在 gateway `.env`／容器環境；n8n 新建獨立 `Campus Gemini budget proxy` credential，只有內部 proxy token 與內部 Host。原有使用者 credentials 不改写。

首次真實測試有一筆 minimal 不支援的 HTTP 400，仍保留 US$0.25；修正 low 後生成成功（121 total tokens），保守結算 US$0.000454；embedding 成功且維度3072，保留 US$0.025。當時帳本合計 US$0.275454；後續以資料庫帳本為準。

## 2026-10-06 原始 HTTP 狀態與歷史預留

[Google 官方 billing FAQ](https://ai.google.dev/gemini-api/docs/billing#am-i-charged-for-failed-requests) 明確說明 HTTP 400／500 失敗請求不收 token 費用，但仍占 quota。migration 011 新增原始上游狀態、结算依據及時間，沒有記錄 prompt、key 或錯誤原文。狀態只登記一次，避免後續不同狀態覆蓋既有證據。

舊初次 minimal 失敗紀錄只有對外 HTTP 400；當時代理把其他部分 4xx 也映射為 400，未保存原始上游 status，因此不據此回溯釋放預留。追加授權前的帳本為 US$1.787719／71筆，當時下一次預留被真 BudgetRepository 拒絕。其後經使用者核准調為 US$6，真 chat／embedding smoke、公開及本人原生工具／Memory／混合問答繼續驗收；最新數字以資料庫為準。這是保守帳本，不是 Google 實際帳單。Google 3.x Search 的 query 次數沒有已確認硬上限，不因總額提高就擅自啟用無法證明費用上界的搜尋。
