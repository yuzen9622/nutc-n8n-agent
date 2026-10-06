# LINE 訊息體驗修正

## 範圍與驗收
- 一對一受邀使用者的新文字訊息啟動 LINE 官方 loading animation；不對無效簽章、群組、未授權、重送啟動。不阻塞持久 ACK，失敗不阻止任務。動畫為短期 UX，不新增 durable 任務或額外訊息。
- LINE text 在共用派送邊界轉成純文字，保留文字、清單、換行與完整 URL；不要直接全域刪除 `*`、`_` 造成合法文字或 URL 損壞。Agent 也明確禁止 Markdown 排版。
- 正式 Agent system message 每次執行動態提供 Asia/Taipei 日期、時間、星期與 UTC+08:00，今天／明天按此判斷；不把模型訓練時間或 chat memory 當時鐘，也不讓使用者訊息覆蓋時間權威。
- 不調整預算、模型、校务登入／身分、搜尋、邀請或其他服務；不還原既有 mock 檔案刪除及 public-server 變更。

## 方式
1. 讀正式 ingress/client/worker seams 與測試，以外部 I/O fake 建立會在舊版失敗的行為測試。
2. 做最小變更；修改正式 generator 與生成的 campusNativeAgentLive JSON。
3. 聚焦測試、pnpm check/build、變更檔 LSP。全專案 baseline 已因既有刪檔失敗，要如實區分。
4. 更新已知本機 campus-phase1 runtime，保留既有 credential 與發布狀態；在固定 n8n 2.41.7 執行表達式／流程並檢查 editor。外部付費模型與 LINE 副作用測試限必要且符合現有授權，不使用私人原文作證據。
5. 客戶端畫面 loading 需要使用者手機一對一聊天室驗收；HTTP 202 不等於畫面可見，不誇稱。
