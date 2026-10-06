# 校園 Agent 實作 Roadmap

版本：0.2；2026-10-05。依 [SDD v0.3](SDD.md) 與 [節點工作流](WORKFLOWS.md)。

第一版：少量大學同學試用、LINE 校園問答＋個人課表／缺曠／公告、Linux 自架 n8n、Gemini API、本地 OCR、精選知識庫＋即時搜尋的受控 Agentic RAG。沒有年齡聲明／人工年齡審核流程；不保存學校密碼，第一版無訂閱或校務寫入。

## 總覽

| Phase | 主題 | 依賴 | 目前狀態 | 使用者可看到的成果 |
|---|---|---|---|---|
| 0 | 設計基線與節點規格 | 無 | 文件基線與連結檢查完成 | SDD、工作流圖、節點／API 對照與 roadmap |
| 1 | n8n 部署與畫布優先 | 0、Docker | 本機版驗收通過；遠端延後 | 真實 n8n editor、7 個 workflows、合成資料執行路徑 |
| 2 | LINE／任務／LIFF 底座 | 1、LINE channels | 未開始 | LINE 訊息進主流程並回覆；可開綁定頁 |
| 3 | 公開問答＋Agentic RAG（3A–3C） | 2、Gemini／Brave keys | 未開始 | 在 LINE 收到有來源的真實校園答案 |
| 4 | OCR＋學校登入 | 2、Linux OCR、本人帳號 | 未開始 | 只輸入帳密，自動辨識並綁定成功 |
| 5 | 個人查詢 | 4；混合問答另需 3 | 未開始 | 今日／明日／週課表、缺曠、學生公告 |
| 6 | 整合與試用交付 | 3、5 | 未開始 | 可試用版本、網頁工作流、測試／維運紀錄 |

建議執行順序 0→1→2→3→4→5→6。Phase 3 與 4 技術依賴獨立，可於開發資源允許時交錯進行；此文件不代表已授權額外代理並行實作。

不先猜日曆工期。Phase 1 完成並確認主機／憑證與 OCR runtime 後，再按實測登入、網站解析難度估時。每 phase 通過門檻後才標完成。

## Phase 0 — 設計與需求定版

工作：修訂 SDD，移除年齡產品流程；切換自動 OCR；定義主／子流程、每顆節點、成功／失敗分支、資料引用、API、部署及驗收。

交付：`docs/SDD.md`、`docs/WORKFLOWS.md`、`docs/ROADMAP.md`、[RAG.md](RAG.md)、既有 Gemini 研究附件。

完成門檻：文件互相連結有效；無手動驗證碼／年齡審核殘留要求；OCR retry、密碼處理與 n8n 資料邊界一致。此階段完成不代表 workflow JSON 已可匯入。

## Phase 1 — 先讓 n8n 網頁節點看得到、跑得動

### 執行順序調整（2026-10-06）

使用者指定先在本機實作及 Docker 部署，穩定後再到遠端。本機驗收紀錄見 [phase-1.md](verification/phase-1.md)。以下 Linux 交付門檻保留，先以本機合成環境驗證；遠端尚未驗收不得標為完成。

### 工作

1. 唯讀確認 Linux OS／架構、Docker／Compose、磁碟與網路；記錄管理入口，不假設開發機就是主機。
2. 建立 Compose：n8n、PostgreSQL、Gateway 最小 stub／mock adapter；需要時加 Redis。固定 image version/digest，管理入口使用 VPN／SSH tunnel 或已驗證的私人網址。
3. 建立 WF-01～07 workflow JSON、Credentials mapping 說明、匯入順序及匯出腳本；以實際 n8n schema 測試，不只檢查 JSON 語法。
4. 實作獨立 mock API 與 synthetic tasks，模擬 queryRef/evidenceRef/dataRef/resultRef；禁止外連 LINE、學校與付費模型。
5. 加入 pgvector extension 可用性檢查與 WF-07 合成同步場景。在瀏覽器開啟主流程、公開子流程、個人子流程、錯誤／維護／demo 流程，示範合成場景。

### 交付與門檻

- `infra/compose.yaml`、`workflows/*.json`、mock fixtures、`docs/runbooks/n8n-import.md`。
- 真正 editor URL、各 workflow URL、node typeVersion／workflow ID manifest。
- WF-06 的公開成功、查無來源、個人成功、需重新登入、混合部分成功、供應商錯誤、重複任務場景可實跑。
- 無 unknown nodes、missing subworkflow、懸空必要連線；Switch fallback 與錯誤分支均有結果。
- 網頁實際展示通過；只有 Mermaid、JSON 或 Docker healthy 不算完成。

外部需求：Linux 主機存取方式與管理網址／tunnel。此 phase 不需學生帳密、Gemini 或 LINE secrets。

## Phase 2 — LINE 接收與可靠回覆

### 工作

1. LINE OA／Messaging API 與同 provider LIFF channel 設定。
2. Gateway raw-body 驗簽、本地敏感輸入攔截、allowlist／邀請、DB transaction inbox/task、dispatcher。
3. n8n 呼叫真實 claim／plan／complete API；意圖仍可用固定 mock，先驗證傳輸與狀態。
4. reply／push outbox、去重、deadline、unknown delivery、固定 retry key；UI 清楚標記測試回覆。
5. LIFF token 後端驗證、Web session、CSRF 與綁定頁框架（此 phase 不提交學校登入）。

### 交付與門檻

- 真 LINE→Gateway→n8n→LINE 測試回覆，n8n 畫布能對照請求路徑。
- SDD A01–A06 通過；重送不重覆答，群組不啟動個人工具，偽造身分不能綁定。
- secrets 不進 repo；真實執行資料不保存；無生日／年齡聲明／年齡人工批准步驟。
- UI 上「綁定」尚未啟用時明示，不假裝登入成功。

外部需求：LINE channel／LIFF 設定、HTTPS public webhook。憑證在主機 secret store 配置。

## Phase 3 — 公開問答＋受控 Agentic RAG（第一版必要）

### 3A — 即時搜尋基線

接上 Brave、registry、reader、Gemini 與引用檢查；建立至少 40 題 QA 集，量測純搜尋結果、延遲及費用。保留此基線供比較；不以 3A 完成代替整個 Phase 3。

### 3B — 精選校園知識庫

依 [RAG.md](RAG.md) 建立 PostgreSQL／pgvector schema、版本管理、中文關鍵字＋向量融合檢索。初始最多 30 份官方規章／FAQ／辦事流程，由來源清冊控制，不爬全站。完成 WF-07 手動及每日同步、內容 hash 去重、embedding 成本紀錄與原子發布。固定 embedding model／dimension，先驗證付費 project 可用性。

門檻：每份文件可追溯 URL／版本／段落；更新、刪除、撤下、失敗回復、中文查詢及無 embedding 降級測試通過。真實 n8n 畫布展示同步成功與失敗，不保存完整原文於 execution。

### 3C — 來源規劃與有限補查

WF-02 實作 knowledge/web/both 分支；Gemini 評估公開證據，可提出一次補查或追問，由 Gateway 驗證執行；時效問題強制 web，私人結果不入 RAG。所有路徑服從 SDD 模型、檢索、費用和 90 秒總預算。

門檻：同一批 QA 對比純搜尋與融合版；達 SDD 正確性／引用門檻，記錄延遲、單題成本與失敗例。A15–A17、A21–A22 通過，展示知識庫命中、web、both、來源過期／衝突、一次補查與停止路徑。沒有 key 不假裝成功，也不靜默切免費 project。

交付：真實 WF-02／07、source manifest、migration、embedding model/dimension 紀錄、QA 比較報告與同步／回復 runbook。3A→3B→3C 全數納入第一次試用前的交付。

外部需求：付費 Gemini project、Brave key 與搜尋方案、允許擷取的官方來源。未核定付費方案不自行購買。

## Phase 4 — 本地 OCR 與 ePortal 登入

### 工作

1. 將原專案必要登入／Cookie／HTML 模組移植到獨立 school-adapter，記錄來源 commit／檔案 hash。
2. 在 Linux 容器載入 `ddddocr-node` 及所需資產，沿用原圖 `classification(image)`；驗證 native runtime 相容性。
3. GET 登入表單／驗證碼→OCR→表單提交→已登入特徵→AIS；三輪／30 秒上限。
4. 正確區分帳密錯誤、明確驗證碼錯誤、鎖定、校方維護與網路結果不明；沒有通用無限 retry。
5. LIFF `POST /binding` 只送 account/password；成功綁定、撤銷、過期重新登入。不保存密碼，也不啟動 Mail／TronClass warmup。

### 交付與門檻

- Linux OCR 測試紀錄：合成圖片與授權取得、不含帳密的驗證碼測試集；記錄辨識成功率與失敗類型，不只測 import。
- A07–A12 的登入相關部分通過；密碼錯誤首輪即停，未知網路結果不盲目重送。
- 本人同意的受控真實登入成功，LIFF 不顯示手動驗證碼欄位。
- 原專案未被修改／共用 Session；密碼／Cookie／OCR 原文未進入 n8n execution、DB、log。
- OCR 失敗有明確使用者提示，不能在紀錄中標為成功。

外部需求：Linux 主機 outbound、本人在 LIFF 自行輸入帳密。不要求透過聊天提供密碼。

## Phase 5 — 個人查詢與混合問題

### 工作

1. 取得／解析課表、缺曠、學生系統公告，建立去識別 HTML fixtures。
2. WF-03 三條分支接真 API；Gateway 本地 render，n8n 只見 refs。
3. 日期與學期確認、未知時段、空結果／parser mismatch 分開，呈現資料時間與週課表限制。
4. Rich menu、分頁、重新登入按鈕；混合問題由主流程順序跑公開／個人子流程再合併模板。
5. 同時查詢、解除綁定、unfollow 的競態處理與兩位學生隔離。

### 交付與門檻

- 今日／明日／週課表、指定學期缺曠、公告清單／詳情可在 LINE 使用。
- A09–A14、A19 通過；結果逐項對照 ePortal，不做不可靠的缺曠總數推算。
- 不把個人查詢結果送 Gemini；兩人同時使用無資料串接錯誤。
- 在 n8n 網頁展示各查詢分支與重新登入路徑，敏感內容只在本人 LINE／LIFF 呈現。

## Phase 6 — 整合、維運與小規模試用

### 工作

1. 整體 smoke、100 任務／5 concurrent 壓測、兩位試用者端到端測試；iOS／Android LIFF 各測一種。
2. backup/restore、Session 失效、n8n／Gateway restart、DB 不可用、LINE／Gemini 限額情境。
3. 檢查匯出 JSON、日誌、備份、execution retention；關閉 production mock routes 與 demo workflow。
4. health／用量／磁碟監控、費用 hard cap、部署與回復 runbook。
5. 提供實際 n8n 網址、7 個工作流的交付狀態、試用說明與已知限制，再開放少量同學。

### 交付與門檻

- SDD A01–A22 驗收表逐項 pass／fail／未跑，不能用平均分掩蓋隔離失敗。
- 無跨人資料、帳密留存或重複發送的阻擋問題；效能與費用都有實測。
- 最終工作流 JSON 可重建，credentials 手動綁定方式明確，復原演練成功。
- 真實網頁 editor 展示與使用者可操作驗收完成，不能僅以程式碼／API 測試結案。

## 每個 Phase 的回報格式

1. 已完成行為與變更檔案。
2. n8n workflow URL／revision 與可展示節點。
3. 測試、執行 ID、去識別證據、未跑項目。
4. 未解問題與下一 phase 依賴。

Phase 1 起才產生實際 workflow URLs／execution IDs；本文件不提供假連結。後續若增加追蹤推播、保存密碼或校務寫入，另開下一版設計，不混入本 roadmap。
