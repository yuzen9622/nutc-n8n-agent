# 公開 LINE Bot 使用（使用者已授權，2026-10-07）

## 需求與凍結邊界
移除人工受邀名單，任何使用者可從同一 LINE Bot 一對一入口使用，驗證自己的 LINE 身分後於 LIFF 登入自己的校務帳號。保留 raw-body 簽章、LINE token audience/expiry、Origin/CSRF、owner/generation/lease/capability、學號唯一綁定、撤銷、既有共享費用硬上限與 worker 並行限制。不得提高預算、開啟搜尋、更換模型、碰既有校務 Cookie、清帳本或復活 revoked 帳號。

目前 HEAD 的 LineRepository/BindingRepository 已自動建立身分，但仍有 invitation sync 管理腳本、task/school/memory 的 invited 判斷與舊 SQL 測試。根工作樹乾淨，pnpm check/build 基線通過；真 DB 腳本仍斷言舊受邀行為，必須與新契約同步並強化新用戶首次並發驗證。

## 最小變更
1. LineRepository 移除 syncInvitations。identity 與 accept 的首次身分建立使用 INSERT ... ON CONFLICT DO NOTHING，接著 SELECT ... FOR UPDATE 取得最新 owner；僅 revoked 控制存取，不依 invited，不更新 invited。identity 必須是 transaction，不得在 race 中返回已撤銷身分。保留清除/解除/精確重新啟用及 inbox 去重。LineService 新增 signed、fresh、一對一 follow 專用指令（固定本地啟用訊息，不啟動模型），只註冊新的／未撤銷身分；unfollow 仍 revoke。一般訊息與 follow 都不得解除 revoked，僅本人精確「重新啟用」代表重新同意。獨立審查發現舊 follow 延遲／逆序抵達會推翻 unfollow，因此撤銷後 follow 不再自動恢復。
2. BindingRepository.issue 同樣使用 race-safe insert then lock，保留 revoked/rotation/expiry/hash；authorize 不新增任何放寬。TaskRepository 的 invited SQL 條件全部移除，保持 NOT revoked/generation 所有其他條件。SchoolSessionRepository.owner 移除 invited，但未建立身分與 revoked 仍拒絕。不改私人工具內容/模型行為。
3. 新增 infra/db/migrations/015-public-line-access.sql，不改既有 migrations checksum，不 DROP 欄位/表，不批次 UPDATE 身分、不更動既有 revoked/session。保留 invited 欄位僅作舊 schema 相容並加 COMMENT 說明已停用。替換 memory guard 僅檢查有效 owner+generation+not revoked；替換 school revoke 僅 NEW.revoked；替換 grounded cleanup 僅 generation change/revoked。重建 school/liff/private/grounded 的 identity triggers，UPDATE OF 欄位僅 generation/revoked（school 只 revoked），不再由 invited 變更影響任何權限或清理。保留現有各清理函式、不弱化撤銷。
4. 移除 scripts/invite-line-users.mjs 與 package.json invite:line 指令。不改 version。example 設定移除邀請 ID。實際.env 的精確 INVITED_LINE_USER_IDS 刪除由主對話處理，不輸出秘密。部署檔案若有注入 INVITED_LINE_USER_IDS 才刪該欄，主對話處理。
5. tests/line.test.ts 補 fresh follow/unfollow/resume、group/stale follow拒絕與多位未知LINE使用者可進入之service測試，保留signature/identity expiry/forged user tests。真 DB 腳本 check-line-database/check-school-database 加入015：替換舊 invitation denial/sync 測試為新用戶自動准入、原 invited=false可用、重複首次並行建立不unique failure、兩人記憶/私人工具/ref/outbox不串人、校務兩個owner各自Cookie、跨owner school query拒絕、同學號重綁拒絕、revoked即使無名單仍被拒絕、explicit resume idempotency且不恢復school Cookie。原有 lease/source/budget/CSRF 等測試保留，勿只刪斷言求綠。不要寫入正式真人資料。
6. 主對話追加與公開安全相關的最小加密防護：TaskRepository 的 GCM 解密明定 authTagLength=16（符合既有加密產生的完整 tag），拒絕截短 tag；新增 tests/private-crypto.test.ts 實測原 cipher helper 的正常解密、短 tag 與錯誤 context，不改私人工具全文／模型資料邊界（此項仍待使用者決策）。school DB 加入實際 LineService/Repository 逆序 unfollow→follow 的回歸，證明 follow 不解除 revoked。

## 實作者可改範圍
apps/gateway/src/modules/line/{line.repository.ts,line.service.ts}; apps/gateway/src/modules/liff/binding.repository.ts; apps/gateway/src/modules/tasks/task.repository.ts; apps/school-adapter/src/modules/school/session.repository.ts; infra/db/migrations/015-public-line-access.sql; tests/line.test.ts（必要可新增 tests/public-line-access.test.ts）；scripts/check-line-database.mjs; scripts/check-school-database.mjs; scripts/invite-line-users.mjs（授權刪除）；package.json（只移除 invite:line）；.env.live.example（只邀請欄）。
主對話獨自處理其他 docs、部署設定、.env、verification artifact 與正式migration/服務重啟。實作者不得deploy、commit、改真DB或跑會覆寫既有verification的DB腳本；可執行 pnpm check/build、單元測試。

## 驗收與部署（主對話）
先獨立 review source/SQL/diff，通過 check/build 及真 PostgreSQL 一次性 schema 的LINE/school測試；真n8n Memory/HTTP runtime若適用則以已知腳本實跑，不付費模型、不送真人訊息。原始碼不改workflow則无需更新/發布workflow。主對話核對migrate script與compose目標，套用015到已知campus_agent（使用者已明確授權此次權限變更），僅重建gateway/school並重啟本任務公開ingress，不重啟Docker/其他專案/Cloudflare Tunnel。驗證服務health、公開LIFF200/未登入bind401/內部路由404/無簽章webhook401，正式部署source與migration一致。加入第二真人LINE與學校帳密由使用者本人完成，不以fixture當真人驗收。保持NT300授權預算與原帳本，回報共享費用上限多人共用。

## 失敗與回滾
任何測試失敗不得宣告完成；保留既有資料，修原因。migration僅替換function/trigger/comment，未刪資料；若需回復必須同時回復程式與相應權限function，不能盲目重跑旧checksum migration。無LINE Developers Console寫入授权；若channel发布状态限制一般帐号，先唯讀查明後請使用者或取得專項授权，不猜可用。
