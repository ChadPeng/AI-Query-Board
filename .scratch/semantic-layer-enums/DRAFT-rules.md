# 語意層規則草案 — 依 online_store_point 的 Enum 撰寫

Status: done（2026-09-01 全部寫入，語意層 25 → 41 條，未審核 0 條）

來源：`c:\xampp8240\htdocs\online_store_point\app\Enums\**` + `database/migrations`
比對：已對 analytics DB（`mepay`）的實際欄位型別與值分布做過核對。
待確認事項 8 題已於 2026-09-01 全數定案，決議見文末 D 段，並已反映在下列規則內文中。

---

## A. 補完現有 19 條未審核規則 — ✅ 已於 2026-09-01 寫入

這 19 條是 `bootstrap:semantics` 自動草擬的，內容還停在「（請補充每個值的業務含義）」。
作法：**改寫 content，並設 reviewed=1**；scope / table 綁定維持原樣。

| # | rule id | 表 . 欄位 | 建議 content |
|---|---|---|---|
| A1 | 7 | agreements.agreement_type | agreement_type 是條款類型：ip_rights=智慧財產權與肖像權協議、privacy_policy=隱私權政策、user_policy=使用者條款。 |
| A2 | 8 | coupon_codes.type | type 是折扣計算方式：fixed=固定金額（value 為折抵金額）、percent=折扣比例（value 為百分比，實際折抵另受 max_discount_amount 上限）。 |
| A3 | 9 | coupon_codes._shops_filter | _shops_filter 是「適用賣場範圍」模式：_all=不限賣場、_only=僅限關聯表 coupon_code_shop 列出的賣場、_except=排除該關聯表列出的賣場。 |
| A4 | 10 | coupon_codes._shop_items_filter | _shop_items_filter 是「適用商品範圍」模式：_all=不限商品、_only=僅限關聯表 coupon_code_shop_item 列出的商品、_except=排除該關聯表列出的商品。 |
| A5 | 11 | coupon_codes._categories_filter | _categories_filter 是「適用分類範圍」模式：_all=不限分類、_only=僅限關聯表 category_coupon_code 列出的分類、_except=排除該關聯表列出的分類。 |
| A6 | 13 | creator_channel_links.type | type 是創作者頻道所屬社群平台：youtube=YouTube、twitch=Twitch、discord=Discord、instagram=Instagram、tiktok=TikTok、facebook=Facebook、x=X(Twitter)、threads=Threads、other=其他。同一創作者（creator_profile_id）可有多筆頻道，算創作者人數要 COUNT(DISTINCT creator_profile_id)。 |
| A7 | 14 | creator_profiles.level | level 是創作者分級，只有 A、B、C、D、E 五級，顯示為「A級」～「E級」。**等級高低：A 最高，依序遞減到 E 最低**；問「高等級／頂級創作者」時指 A（或 A、B），排序用 level ASC 代表由高到低。 |
| A8 | 15 | creator_reviews.status | status 是創作者申請的審核狀態：new_application=新申請、pass=已通過、reject=已拒絕、reupload=補件（要求補交資料）。applied_at=申請時間、reviewed_at=審核時間、review_user_id=審核人員。 |
| A9 | 16 | creator_types.type_name | type_name 是創作者類型：live_host=實況主（直播）、short_video=短影音、illustrator=繪師/插畫、coser=Coser 角色扮演、guide_writer=遊戲攻略/圖文資訊、blogger=部落客/專欄作家、koc=社群KOC（社團版主、群主、公會長）。一位使用者可有多筆（複選），統計類型分布時 user_id 會重複計數。 |
| A10 | 18 | invoice_settings.type | type 是發票開立類型：person=個人（載具在 carrier_num）、love=捐贈（愛心碼在 love_code_id）、company=公司（抬頭 identifier_name、統編 identifier_num）。 |
| A11 | 19 | m_coin_logs.type | 見下方「A11 完整內容」 |
| A12 | 20 | mepay_orders.fee_type | fee_type 是手續費計算方式：fixed=固定金額（fee_value 為金額）、percent=比例（fee_value 為百分比）；實收手續費在 charge_fee。 |
| A13 | 21 | mepay_payment_logs.status | status 是金流付款結果，欄位型別是「字串型的數字」：'0'=無法判斷、'1'=已付款、'2'=付款失敗、'3'=付款取消。比較時要用字串，例如 status = '1'。 |
| A14 | 22 | merchant_payments.fee_type | fee_type 是該商戶此支付方式的手續費計算方式：fixed=固定金額、percent=比例，數值在 fee_value；use_default_fee_setting=1 時改用 payments 表的預設費率。 |
| A15 | 24 | order_special_collaborates.status | status 是特殊合作（廠商直送）的發貨狀態，欄位型別是字串型的數字：'0'=尚未發貨、'1'=發貨完成、'2'=發貨失敗，比較時要用字串。finish=1 表示已發送成功。欄位定義另有 '-1' 但**實務未使用**，若出現視為異常資料，不要納入正常狀態統計。 |
| A16 | 25 | payments.type | type 是該支付方式的手續費計算方式：fixed=固定金額、percent=比例，費率在 charge（另有 from_payment_charge、from_foreign_payment_charge 供不同來源使用）。active=1 為啟用中的支付方式。 |
| A17 | 28 | shops.hivebee_notify_mode | hivebee_notify_mode 是賞金牆（HiveBee）的通知對象模式：support=支持實況主（通知該訂單 orders.support_user_id 對應的創作者）、invited=推薦人（通知 orders.invited_user_id）。僅在 shops.hivebee_enable=1 且訂單實收 orders.total >= shops.hivebee_price 時才會觸發通知。 |
| A18 | 30 | user_profile_modify_history.type | type 是會員修改的個資欄位：phone=手機號碼、email=電子郵件。 |
| A19 | 31 | user_social_accounts.provider | provider 是第三方社群綁定來源：google=Google、twitch=Twitch、line=LINE、x=X(Twitter)。 |

### A11 完整內容（m_coin_logs.type）

```
type 是 M 幣異動原因：
order_add=訂單回饋、order_sub=訂單扣點、order_cancel=訂單取消退回、
invite_rebate=推薦碼返利、achievement_rebate=業績返利、
manual_add=人工加點、manual_sub=人工扣點、
collaborate_rebate=合作賣場返利、collaborate_add=合作加點、
support_social_rebate=訂單分潤、supporter_rebate=支持創作者返利、support_order_refunded=贊助訂單退款、
invited_register_reward=推薦碼註冊獎勵、member_referral_reward=會員推薦獎勵、
activity_reward=活動贈送、withdrawal_sub=提領扣點、hivebee_bounty_reward=HB賞金牆任務獎勵。
加項（m_coin 為正）：order_add、order_cancel、invite_rebate、achievement_rebate、manual_add、
collaborate_rebate、collaborate_add、support_social_rebate、supporter_rebate、
invited_register_reward、member_referral_reward、activity_reward、hivebee_bounty_reward。
減項（m_coin 為負）：order_sub、manual_sub、support_order_refunded、withdrawal_sub。
前台會再歸成 5 大類：交易訂單(order_add/order_sub/order_cancel)、
人工加扣(manual_add/manual_sub/hivebee_bounty_reward)、
創作者合作(support_social_rebate/support_order_refunded/invited_register_reward/collaborate_add/withdrawal_sub)、
會員獎勵(member_referral_reward)、過期失效（見 m_coin_expired_logs）。
```

> 註：現有已審核規則 **37**（m_coin 欄位正負號）與此重疊。37 保留（負責講正負號口徑），19 專責當「代碼字典」。

---

## B. 新增 13 條規則 — ✅ 已於 2026-09-01 寫入

> 實測後的兩處調整：B6 改成「上架賣場 = `status=1`，不要自行加 `is_show_front` 或
> 上架時間窗」；B9 補上 `status=3`＝商品缺貨（程式列舉沒有，但那 192 筆的 `message`
> 全是「商品缺貨」）。另見 E 段新增的 3 條 term/global 規則。

這些都是 int / varchar 編碼欄位。`bootstrap:semantics` 只掃 MySQL `ENUM` 型別，所以整批漏掉。
scope 一律 `table`，reviewed=1。**同一張表的相關欄位合併成一條**，避免規則數量爆炸。

| # | 表 | 建議 content |
|---|---|---|
| B1 | users | status 是帳號狀態：1=正常（唯一可正常登入使用）、2=禁用、3=註銷中（已申請未生效，時間在 cancel_requested_at / cancel_effective_at）、4=已註銷、5=已凍結。統計「有效會員／會員數」時應限定 status = 1。 |
| B2 | orders | freeze_type 是退貨凍結類型，NULL=未凍結：1=全部退貨成功、2=全部退貨失敗、3=部分退貨失敗；退款金額在 refund_amount。 |
| B3 | orders | login_device 是下單時的登入裝置：1=Android、2=iOS、3=PC（NULL=未紀錄）。login_type 是登入方式類型：api、quick、account（NULL=未紀錄）。login_method_id 對應 login_methods 表，登入方式名稱一律 join login_methods.name 取得，**不要自行推測 login_method_id 的代碼含義**。 |
| B4 | order_payment_details | status 是金流付款明細狀態：0=待付款、1=已付款、2=付款失敗。計算「實際付款成功」要限定 status = 1。 |
| B5 | order_logs | order_logs 是訂單狀態異動軌跡，一次異動一列；status 的編碼與 orders.status 相同（0=待付款、1=排隊處理中、2=專員服務中、3=請洽客服、4=完成、5=取消、6=已退款），operator_id 是操作人員。 |
| B6 | shops | status=1 上架、0 下架；handling_fee=1 收取手續費、0 不收取；auto_delivery_type=0 不自動發貨、1 序號、2 API。deleted_at 非空代表已軟刪除，統計賣場時應排除。 |
| B7 | shops | special_collaborate_id 是串接的特殊合作廠商：1=艾肯、2=UIDPAY、3=星宿、4=MyCard、5=麻雀一番街、6=IplayGame91、7=鈊象、8=小萌、9=Coda、10=Ment；NULL=非特殊合作賣場。 |
| B8 | coupon_codes | coupon_code_type 是序號產生方式：0=隨機序號、1=通用序號、2=系統固定。system_type 是系統券的發放情境：0=註冊、1=首購、2=儲值、3=下載、4=生日、5=發薪券、6=創作者推薦；NULL=非系統券（一般活動券）。 |
| B9 | order_special_collaborate_items | status 是單一品項的發貨狀態：0=尚未發貨、1=完成、2=失敗；失敗原因在 message，need_retry=1 表示可重試。 |
| B10 | global_notifications | type 是公告類型：announcement=公告、activity=活動、system=系統。target_group 是發送對象：all=不限身份、member=會員群組（群組在 user_group_id）、creator=創作者群組、single_user=單一會員（對象在 user_id）。 |
| B11 | user_identifiers | status 是實名認證審核狀態：0=建立後尚未送審（欄位預設值，送審時程式會改成 1）、1=審核中、2=未通過、3=通過。統計「實名認證通過人數」要限定 status = 3。 |
| B12 | categories | type 是分類用途，現行只有兩種：shop=商品（賣場）分類、page=頁面分類。資料中另有 game、default 兩種值，屬**舊資料已廢棄**，分析時應排除。 |
| B13 | order_additional_items | item_type 是加購品類型，目前只有 1=序號；is_code_send=1 表示序號已發送。 |

### 可選（低價值，你說要才寫）

- `deposit_methods`：儲值管道字典（1電信代儲、2美國谷歌、3外卡谷歌、4安卓庫存、5蘋果庫存、6日本谷歌、7日本蘋果、8亞太電信、9MYCARD、10GASH、11貝殼幣、12轉單）。
  **但 name 欄位本身就是中文，直接 join 就好，這條可能多餘。**
- term 規則（會永遠注入 prompt，數量要克制）：`有效會員 = users.status = 1`、`上架賣場 = shops.status = 1 且 deleted_at IS NULL`、`付款成功 = order_payment_details.status = 1`。

---

## C. 明確排除，不寫入語意層

| 項目 | 原因 |
|---|---|
| `LoginMethodEnum`（1=Google、2=Facebook、3=官方…） | 全專案零引用的死碼，且編號與 `login_methods` 表 id（1=ICANTW、2=Genshin…）完全對不上。改由 B3 明訂「一律 join `login_methods.name`」。 |
| `point_card_system_orders.status` | 全表僅 110 筆，且 `PointCardSystemOrderStatusEnum` 的 `dispatching` label 有筆誤（被寫成「失敗」）。價值不足，不佔用規則。 |
| `shops.is_collaborate` | 全庫 937 筆固定為 2，無鑑別度。B7 只保留 `special_collaborate_id`。 |

---

## D. 待確認事項決議紀錄（2026-09-01）

| # | 問題 | 決議 |
|---|---|---|
| 1 | creator_profiles.level A～E 誰高 | **A 最高，往 E 遞減** → 寫入 A7 |
| 2 | shops.hivebee_notify_mode 的 support / invited | 由程式解出：`HiveBeeEnum` support=支持實況主、invited=推薦人 → 寫入 A17 |
| 3 | order_special_collaborates.status 的 '-1' | **註明「實務未使用，出現視為異常」** → 寫入 A15 |
| 4 | user_identifiers.status 的 0 | 由程式解出：migration `default(0)`，送審時改為 1 → 0=尚未送審，寫入 B11 |
| 5 | categories.type 的 game / default | **舊資料已廢棄，分析時排除** → 寫入 B12 |
| 6 | point_card_system_orders.status 的 dispatching | **整張表跳過，不寫規則** → 列入 C 段 |
| 7 | shops.is_collaborate | **不提此欄位** → 列入 C 段 |
| 8 | LoginMethodEnum | **判定死碼，不寫入** → 列入 C 段 |

---

## E. 實測（2026-09-01）與因此補的 3 條規則

A 段寫入後跑了 10 題真實問句，7 對 3 有問題。**兩個失敗都不是規則內容寫錯，
而是 stage-1 選錯表 —— table-scoped 規則只有在那張表被選中之後才注入，選錯就永遠救不回來。**
所以補了 2 條 term（永遠注入，能從源頭導正選表）與 1 條 global：

| 規則 | scope | 修的問題 |
|---|---|---|
| 創作者分級 | term | 「創作者等級分布」原本選到 `user_levels`（魔儲/白銀/尊榮），不是 A～E |
| 特殊合作發貨 | term | 「特殊合作發貨失敗」原本用 `shops.special_collaborate_delivery_enable` + `orders.mcoin_delivered`，答 45419（正確 730） |
| 代碼輸出翻中文 | global | 圖表直接吐 `live_host`、`youtube`、`pass` 等原始代碼 |

補完後重測：創作者等級分布 ✅（並自動翻成「A級/D級/E級」）、上架賣場 ✅ 214。

**另外發現一個引擎層缺陷，已另開 issue，不在本文件範圍**：
[09 — 資料模型路由誤判後，AI 捏造 `SELECT 0` 並回報成功](../ai-data-dashboard/issues/09-dataset-routing-fabricates-empty-result.md)。
「特殊合作發貨失敗」至今仍答錯，但成因是問句被誤判進「訂單分析」資料模型、
表清單被限縮，**與語意層無關**（規則有正常注入，LLM 也讀懂了）。

順帶記錄：`lib/schema/introspect.ts` 沒有讀 `COLUMN_COMMENT`，
所以 DB 的欄位註解不會餵給 LLM——代碼含義只能靠語意層規則。

---

## 執行方式

腳本：[`scripts/seed-enum-semantics.ts`](../../scripts/seed-enum-semantics.ts)，`npm run seed:enum-semantics`。
只寫 state DB（`ai_query_board.semantic_rule`），**完全不碰 analytics DB（mepay）**。可重複執行：

- 補完（A 段）：內容已是目標值就跳過；規則綁定的表對不上、或已被人工改寫過，
  都會跳過並警告（要覆蓋加 `--force`）。
- 新增（B、E 段）：同綁定的規則若已含該條的 `dedupeKey` 片語就跳過，
  所以事後人工改寫內容也不會被複製一份。

最終結果：**41 條規則、未審核 0 條**（global 3、term 3、table 35）。
