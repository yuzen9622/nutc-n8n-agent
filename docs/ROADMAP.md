# 校園 AI Agent Roadmap

更新：2026-10-13。部署見 [README](../README.md)，設計見 [SDD](SDD.md)。先本機 Docker，穩定後再部署遠端。

## 請假 preview／跨 turn confirm：本輪實作者自驗

- 凍結 runner 4/4、focused 51/51、`pnpm check` 186/186（無 skip）、build／generate／secret scan／diff 通過；凍結三項 SHA256 未變。第一次全量曾遇未修改的 owner-bootstrap subprocess 測試失敗，原命令重跑通過，未放寬測試。
- 真 PostgreSQL **random-owned 隔離 schema＋假校方 transport** 通過：017 fresh／upgrade／checksum、cross-turn／owner／generation／session、兩個 adapter 的 CAS、COMMIT 回應遺失、POST 後 rollback、revocation race、unknown 重啟不重送、trusted reply、capture push/loading=0。既有 LINE／school DB 檢查通過；五項 controlled fault（marker/prompt/old-record/model/capture）均被 assertion 捕捉。這些不是校方真新增證據。
- main generator／inactive JSON 已拆 preview／confirm／notes，HTTP9／ai_tool10，direct `official_search` 保留。guarded updater 與 capture harness 已交付，但未在 active workflow 執行更新／確認；不沿用歷史 runtime 證據。
- **未執行／不得稱完整驗收**：本機部署與 017 production migration、active main patch、真 Agent 兩輪、第一次校方 create／new matching record／replay、fresh-context 獨立驗收、手機 LINE。先 review，再由主對話受控部署；日期／session／version 不符合凍結前提就停止，不另送一張。

## 本輪部署驗收（先前五服務／owner 工作）

| 項目 | 結果 |
|---|---|
| 靜態檢查／建置 | `pnpm check` 121 tests PASS；`pnpm build` PASS |
| 根 Compose | 使用隔離 project `nutc-five-verify` 實跑五服務；兩個 backend 先 migration 再 exec server；PostgreSQL role 隔離已驗證 |
| 公開入口 | 真 Tunnel `/ready` 200；公網 LIFF 200；LINE raw-body 簽名驗證通過；private 路徑即使帶 token 仍 404 |
| n8n 首次設定（歷史） | 當時以瀏覽器建立 owner、開啟主流程畫布；手動 setup 成功，三個 inactive workflows／三個 credentials 可見；Postgres credential 實測連線成功；再次 setup 拒絕且 metadata hash 不變 |
| n8n owner 自動建立 | 隔離 project `nutc-owner-acceptance` 實跑 frozen runner（官方 n8n 2.41.7）：healthy 時 setup flag false、設定帳密登入 200、僅一位使用者、無自動匯入；換 env 重建後原登入 200、替換帳密 401、人數不變；logs 無密碼；缺密碼 config 失敗。未驗：瀏覽器外觀、email／reset／LDAP／SAML、遠端 Linux／Cloudflare、setup POST 中途 crash 復原 |
| 停止／重啟 | 五服務正常退出（exit 0），重新啟動成功；三個 workflows／三個加密 credentials hash 完全相同，Tunnel ready 與外網 LIFF 仍回 200 |
| 尚未驗證 | 本輪未重新驗收 Google／chat／RAG／ingest 或真人 LINE 對話 |

Compose 不自動 import／publish，也沒有 n8n-init。owner 由 n8n 容器依 `.env` 自動建立（本輪新增，見下列驗收紀錄）；healthy 後執行 `bash scripts/setup-n8n.sh`，再於 editor 配置 Google credential、發布 main、手動 ingest。新安裝匯入兩個 inactive workflows 與三組內部 credentials。容器健康與 Tunnel 連線不代表 Bot 已配置完成。

本輪未修改使用者既有 `.env`、既有 volumes 或遠端。cloudflared 固定 origin 為 `http://gateway:3101`；Dashboard 有 remote ingress 時也使用同一 origin，不指向 private 3100／localhost。

## 功能進度與歷史證據

以下為前輪整合證據，**不是本輪模型或真人驗收**。

| 範圍 | 現況 |
|---|---|
| 原生 Agent／記憶／工具 | 正式設計及工作流基線已建立；worker 隨 gateway 啟動 |
| LINE／LIFF | 自動註冊、本人綁定、持久任務與加密派送已有整合證據；雙真人、多輪及手機 UI 未完成 |
| Gemini／PGVector | 前輪隔離 n8n 2.41.7 真 Google chat／Embeddings、官方 HTML／PDF ingest、RAG 已通過；6 chunks／3072 維，主 Agent 留下 3 筆核對證據 |
| Google Search | 本輪改為主 Agent 的直接 `official_search` Google HTTP tool；正常 LINE 摘要及 grounding 來源，不進共享 evidence。真 pinned Agent／tool 與 live 部署尚待本輪自驗，不沿用前輪證據 |
| 校務／OCR | 前輪 ePortal／AIS 真登入、加密 session、課表／缺曠／公告查詢已驗證 |
| 負載／備份／遠端 | 完整驗收未完成，不是正式 Linux 部署 |

## 後續驗收

- 本輪配置下真 Google／chat／RAG／ingest，以及完整 40 題公開／搜尋／混合／拒答與來源呈現；直接搜尋工具需驗收後再接正式流量，embedding 維持既有模型／3072 維。
- 兩位學生並行登入、記憶、校務结果及派送隔離；LINE／LIFF 真人多輪與 iOS／Android 體驗。
- 重送不重複派送、session 失效、解除綁定／unfollow 與派送競態。
- provider 錯誤／限流、資料庫與服務故障、100 任務／worker 5 並行；n8n concurrency 10 的 main／tool／editor 並行確認。
- 備份還原及遠端 Linux 部署；先核對 `nutc-agent` project 與實際 volumes。不可清庫、直接換 key 或覆寫 `.env`；改名不搬 volumes，既有 role 密碼與加密資料須受控遷移，保留 `N8N_ENCRYPTION_KEY`。

本人校務結果可提供 Google Gemini 整理，密碼與 Cookie 不進模型，記憶最多七天且不進共享 RAG。費用由供應商計收，應用程式不設定每日／累計費用上限。每次交付仍須區分真整合、合成測試與未執行項目。
