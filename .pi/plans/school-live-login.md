# 真實校務登入與單人上線

## 已觀測問題
舊 SSO 成功後 academic1/TransNewPortalv2.asp 轉向 ePortal/login.php，AIS 沒有 cookie。新版公開 login.php 使用 CSRF meta、四字元 captcha、verifyCode POST 與 login_action.php JSON 回傳 url。原 OCR worker 僅允許五字元。

## 實作與驗收
1. 加入新版 ePortal 固定端點與純解析，三輪／30 秒總期限、本地 OCR、先校驗 captcha 才送帳密。CSRF 僅送固定 ePortal 登入端點；轉址清除 body 和 CSRF。拒絕未知回應、外站、非 HTTPS、credential replay。舊 ASP.NET 解析保持回歸，不作正式登入入口。
2. 用受控 CookieJar 進入校方明確 AIS 入口，最後確認 AIS home；不保存帳密、不輸出 HTML/ticket/cookie。課表／缺曠／公告真實查詢與解析比對。
3. 以已受邀本人 owner 經真 gateway / school API 建立加密 session，驗證 LIFF 入口、私人 ref／本地組裝與實際 LINE 派送。付費 provider 不提高既有 NT$100 授權、不清帳本；檢查預算精確剩餘，必要時回報授權阻礙。
4. 正式工作流同步 canonical generator/JSON，部署已知 campus-phase1 n8n 2.41.7；固定 runtime 實跑及 editor 驗收；保留 n8n 原生節點架構。
5. 盤點合成 workflow/credential/DB，只清除明確合成資料與停用合成入口，不動真語料、真學生 session、owner/邀請、費用稽核或其他 Docker 專案。歷史測試 fixture 不作正式資料。
6. pnpm check/build、相關 SQL 整合、獨立安全審查、目前服務健康、公開入口、實際登入和真實學生回覆驗收，報告只存非私人結果與布林證據。

## 當前驗收（2026-10-06）
- 新版真登入已修；最新部署後再登入成功，真課表7／缺曠6／公告19。校方 session 到期確實要求重新登入，不保存密碼自動續登。
- 固定 n8n 管理實跑三學生 HTTP 工具 → 加密 outbox → 真 LINE API push 接受；正文與 temporary workflow/execution/task 已清除。不是新 LINE 入站或模型選工具驗收。
- 正式 runtime 清除11合成workflow／其execution、6合成credentials、mock容器及6環境mock entries。保留既有My workflow、官方語料、真身分/session/費用帳本。Compose有效預設5服務，不含mock。
- 86/86、build、school SQL19／LINE SQL44通过。未知正整數拒絕計入雙維度限流，013正式套用。reviewer指出unsafe-integer邊界已修，獨立verifier跑parser4/4及正式container dist斷言通過。
- editor note與canonical generator/JSON已同步；保留既有畫布佈局、功能參數。正式workflow仍inactive、worker仍false。
- 剩餘費用US$0.212281小於chat預留US$0.25，實際reserve回DAILY_PROVIDER_BUDGET，帳本71筆／1787719micro-USD未改。日額重置也不能越過累計US$2。
- 真模型／搜尋／混合40題、真人LIFF UI與LINE入站、發布與啟用尚未完成；等待追加費用授權，不得以管理腳本冒充。
- 完整範圍與證據見 `docs/verification/school-live-readiness.json`。

## 不變量
單人試用；mock-gateway 保持合成且不加入校方外連。私人原文不交模型／Memory／execution。密碼不落地。沒有測到的範圍不標通過。
