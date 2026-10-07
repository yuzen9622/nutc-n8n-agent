# 移除費用限制與 worker gate

使用者明確授權刪除 PROVIDER_DAILY_BUDGET_MICRO_USD、PROVIDER_TOTAL_BUDGET_MICRO_USD、LIVE_AGENT_ENABLED 及其邏輯。供應商不再使用任何費用預留／結算／cap；worker隨gateway無條件啟動。Google Search獨立開關與所有API/auth/owner/lease/body/output/timeout限制不變。不呼叫真模型／LINE／校方，不擅自啟動現有服務。

1. 核心：config移除金額欄位／enabled並要求dispatch設定；server無條件TaskWorker；刪BudgetRepository；Gemini、Grounding、TaskService去除budget參數及呼叫，保留驗證、錯誤sanitization、bounded I/O。
2. 同步：tests改為直接provider request stub與已驗證授權／邊界；增加無預算及已移除flag仍能config／必填dispatch；scripts更新constructors與刪過時manual-worker-disabled script；根Compose、範例／實際.env只移除指定已廢變數（其餘keys byte-preserved）；README／SDD／Roadmap／workflow note不再費用cap及worker選配描述。
3. Migration：不改已套用SQL內容／checksum、不drop歷史usage表；現行runtime完全不讀寫帳本。
4. 驗收：先用新tests看到舊config/provider不符後實作；pnpm generate/check/build、deleted-active-reference scan、migration byte comparison、diffcheck/secrets check；獨立review。在独立dummy Docker project實跑空DB／migration／always-worker啟動與停止、HTTP健康／signature拒絕，禁止外部provider連線；JSON執行參數不變只有note差異則fixed n8n editor讀回。僅清除本任務建立的temporaryresources。

## 完成證據

- `pnpm generate/check/build` PASS；102/102 tests、27 個腳本 syntax、diff/secrets checks PASS。
- 費用／worker 廢棄變數在 active code/config/docs 零引用；實際 `.env` 其他位元組不變，14 個歷史 migrations byte-identical。
- 隔離 Docker project：無 budget／worker 變數仍健康啟動；真 DB claim/prepare/complete/outbox、三次 stub provider 呼叫不受 cap、proxy 401、output clamp、舊 usage ledger 未寫入；LINE DB 45／school DB 25 checks PASS。
- 獨立 review 發現 shutdown abort 會永久 fail 在途任務，補 red→green 回歸與 drain 修正；真 SIGTERM 期間 internal prepare/complete 仍可用、task completed/outbox pending，重新啟動後 sent。第二位限定 reviewer PASS。
- 固定 n8n 2.41.7 editor 真讀回 20 nodes、更新後 worker note、零 browser errors；排除 note／credential 顯示名後兩個 workflow 的執行 graph/settings/credential ID 不變。
- 同時新增的 bootstrap 保留；僅調整 Gemini credential 顯示名與兩條 SELECT-only 測試對換行空白的辨識，不改初始化行為。
- LSP 9 paths：0 diagnostics，3 confirmed clean／6 inconclusive，完整 TypeScript build PASS。
- 所有自建 test containers/networks/volumes/image tags、dummy env/preload/browser 已清除；未啟動現有 deployment，無真 provider／LINE／school 呼叫。
- 證據：`.local/verification/no-budget-static.json`、`no-budget-runtime.json`；歷史租約 90s／派送 timeout 95s 邊界未改，不歸因本次移除費用限制。
