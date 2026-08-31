/**
 * 用 online_store_point 的 PHP Enum 補完語意層的「代碼字典」規則。
 *
 * `bootstrap:semantics` 會為每個 MySQL ENUM 欄位草擬一條 table-scoped 規則，
 * 但只列得出可能值，含義留白（「請補充每個值的業務含義」）。這支腳本把那些
 * 空殼換成人工核對過的中文對照，並標記 reviewed=1。
 *
 * 對照來源與逐條決議見 `.scratch/semantic-layer-enums/DRAFT-rules.md`。
 *
 * 只寫 state DB 的 semantic_rule，不碰 analytics DB。可重複執行：
 *   - 內容已是目標值 → 跳過
 *   - 綁定的表對不上 → 跳過並警告（避免規則 id 被重編號後寫錯地方）
 *   - 已被人工改成別的內容 → 跳過並警告，除非給 --force
 *
 *   npm run seed:enum-semantics
 *   npm run seed:enum-semantics -- --force
 */
import {
  createRule,
  listRules,
  updateRule,
  type RuleScope,
  type SemanticRule,
} from "../lib/state/semanticRules";

/** 一條要補完的規則：綁定的表用來驗證 id 沒有被重編號。 */
interface Seed {
  id: number;
  table: string;
  content: string;
}

/**
 * 一條要新增的規則。dedupeKey 是內容裡夠獨特的片語——重跑時只要同綁定的規則
 * already 含這個片語就跳過，所以人工事後改寫過的內容不會被複製一份。
 */
interface NewSeed {
  scope: RuleScope;
  table?: string;
  termName?: string;
  dedupeKey: string;
  content: string;
}

const SEEDS: Seed[] = [
  {
    id: 7,
    table: "mepay.agreements",
    content:
      "agreement_type 是條款類型：ip_rights=智慧財產權與肖像權協議、privacy_policy=隱私權政策、user_policy=使用者條款。",
  },
  {
    id: 8,
    table: "mepay.coupon_codes",
    content:
      "type 是折扣計算方式：fixed=固定金額（value 為折抵金額）、percent=折扣比例（value 為百分比，實際折抵另受 max_discount_amount 上限）。",
  },
  {
    id: 9,
    table: "mepay.coupon_codes",
    content:
      "_shops_filter 是「適用賣場範圍」模式：_all=不限賣場、_only=僅限關聯表 coupon_code_shop 列出的賣場、_except=排除該關聯表列出的賣場。",
  },
  {
    id: 10,
    table: "mepay.coupon_codes",
    content:
      "_shop_items_filter 是「適用商品範圍」模式：_all=不限商品、_only=僅限關聯表 coupon_code_shop_item 列出的商品、_except=排除該關聯表列出的商品。",
  },
  {
    id: 11,
    table: "mepay.coupon_codes",
    content:
      "_categories_filter 是「適用分類範圍」模式：_all=不限分類、_only=僅限關聯表 category_coupon_code 列出的分類、_except=排除該關聯表列出的分類。",
  },
  {
    id: 13,
    table: "mepay.creator_channel_links",
    content:
      "type 是創作者頻道所屬社群平台：youtube=YouTube、twitch=Twitch、discord=Discord、instagram=Instagram、tiktok=TikTok、facebook=Facebook、x=X(Twitter)、threads=Threads、other=其他。同一創作者（creator_profile_id）可有多筆頻道，算創作者人數要 COUNT(DISTINCT creator_profile_id)。",
  },
  {
    id: 14,
    table: "mepay.creator_profiles",
    content:
      "level 是創作者分級，只有 A、B、C、D、E 五級，顯示為「A級」～「E級」。等級高低：A 最高，依序遞減到 E 最低；問「高等級／頂級創作者」時指 A（或 A、B），排序用 level ASC 代表由高到低。",
  },
  {
    id: 15,
    table: "mepay.creator_reviews",
    content:
      "status 是創作者申請的審核狀態：new_application=新申請、pass=已通過、reject=已拒絕、reupload=補件（要求補交資料）。applied_at=申請時間、reviewed_at=審核時間、review_user_id=審核人員。",
  },
  {
    id: 16,
    table: "mepay.creator_types",
    content:
      "type_name 是創作者類型：live_host=實況主（直播）、short_video=短影音、illustrator=繪師/插畫、coser=Coser 角色扮演、guide_writer=遊戲攻略/圖文資訊、blogger=部落客/專欄作家、koc=社群KOC（社團版主、群主、公會長）。一位使用者可有多筆（複選），統計類型分布時 user_id 會重複計數。",
  },
  {
    id: 18,
    table: "mepay.invoice_settings",
    content:
      "type 是發票開立類型：person=個人（載具在 carrier_num）、love=捐贈（愛心碼在 love_code_id）、company=公司（抬頭 identifier_name、統編 identifier_num）。",
  },
  {
    id: 19,
    table: "mepay.m_coin_logs",
    content: [
      "type 是 M 幣異動原因：",
      "order_add=訂單回饋、order_sub=訂單扣點、order_cancel=訂單取消退回、",
      "invite_rebate=推薦碼返利、achievement_rebate=業績返利、",
      "manual_add=人工加點、manual_sub=人工扣點、",
      "collaborate_rebate=合作賣場返利、collaborate_add=合作加點、",
      "support_social_rebate=訂單分潤、supporter_rebate=支持創作者返利、support_order_refunded=贊助訂單退款、",
      "invited_register_reward=推薦碼註冊獎勵、member_referral_reward=會員推薦獎勵、",
      "activity_reward=活動贈送、withdrawal_sub=提領扣點、hivebee_bounty_reward=HB賞金牆任務獎勵。",
      "加項（m_coin 為正）：order_add、order_cancel、invite_rebate、achievement_rebate、manual_add、collaborate_rebate、collaborate_add、support_social_rebate、supporter_rebate、invited_register_reward、member_referral_reward、activity_reward、hivebee_bounty_reward。",
      "減項（m_coin 為負）：order_sub、manual_sub、support_order_refunded、withdrawal_sub。",
      "前台會再歸成 5 大類：交易訂單(order_add/order_sub/order_cancel)、人工加扣(manual_add/manual_sub/hivebee_bounty_reward)、創作者合作(support_social_rebate/support_order_refunded/invited_register_reward/collaborate_add/withdrawal_sub)、會員獎勵(member_referral_reward)、過期失效（見 m_coin_expired_logs）。",
    ].join("\n"),
  },
  {
    id: 20,
    table: "mepay.mepay_orders",
    content:
      "fee_type 是手續費計算方式：fixed=固定金額（fee_value 為金額）、percent=比例（fee_value 為百分比）；實收手續費在 charge_fee。",
  },
  {
    id: 21,
    table: "mepay.mepay_payment_logs",
    content:
      "status 是金流付款結果，欄位型別是「字串型的數字」：'0'=無法判斷、'1'=已付款、'2'=付款失敗、'3'=付款取消。比較時要用字串，例如 status = '1'。",
  },
  {
    id: 22,
    table: "mepay.merchant_payments",
    content:
      "fee_type 是該商戶此支付方式的手續費計算方式：fixed=固定金額、percent=比例，數值在 fee_value；use_default_fee_setting=1 時改用 payments 表的預設費率。",
  },
  {
    id: 24,
    table: "mepay.order_special_collaborates",
    content:
      "status 是特殊合作（廠商直送）的發貨狀態，欄位型別是字串型的數字：'0'=尚未發貨、'1'=發貨完成、'2'=發貨失敗，比較時要用字串。finish=1 表示已發送成功。欄位定義另有 '-1' 但實務未使用，若出現視為異常資料，不要納入正常狀態統計。",
  },
  {
    id: 25,
    table: "mepay.payments",
    content:
      "type 是該支付方式的手續費計算方式：fixed=固定金額、percent=比例，費率在 charge（另有 from_payment_charge、from_foreign_payment_charge 供不同來源使用）。active=1 為啟用中的支付方式。",
  },
  {
    id: 28,
    table: "mepay.shops",
    content:
      "hivebee_notify_mode 是賞金牆（HiveBee）的通知對象模式：support=支持實況主（通知該訂單 orders.support_user_id 對應的創作者）、invited=推薦人（通知 orders.invited_user_id）。僅在 shops.hivebee_enable=1 且訂單實收 orders.total >= shops.hivebee_price 時才會觸發通知。",
  },
  {
    id: 30,
    table: "mepay.user_profile_modify_history",
    content: "type 是會員修改的個資欄位：phone=手機號碼、email=電子郵件。",
  },
  {
    id: 31,
    table: "mepay.user_social_accounts",
    content:
      "provider 是第三方社群綁定來源：google=Google、twitch=Twitch、line=LINE、x=X(Twitter)。",
  },
];

/**
 * 新增的規則。前三條是實測（2026-09-01）打出來的洞：table-scoped 規則只有在
 * stage-1 選中那張表之後才會注入，選錯表就永遠救不回來，所以改用 term/global。
 * 其餘是 int / varchar 編碼欄位的代碼字典——bootstrap 只掃 MySQL ENUM 型別，
 * 這些整批漏掉。
 */
const NEW_SEEDS: NewSeed[] = [
  {
    scope: "term",
    termName: "創作者分級",
    dedupeKey: "創作者分級（創作者等級",
    content:
      "創作者分級（創作者等級、A～E 級）指 creator_profiles.level，值為 A、B、C、D、E，A 最高、E 最低。這與「會員等級」user_levels.name（魔儲會員、白銀會員、尊榮會員）是兩回事，問創作者等級時不要去 join user_levels。",
  },
  {
    scope: "term",
    termName: "特殊合作發貨",
    dedupeKey: "特殊合作（廠商直送）的發貨結果",
    content:
      "特殊合作（廠商直送）的發貨結果記錄在 order_special_collaborates（訂單層級）與 order_special_collaborate_items（品項層級）。問「發貨成功／失敗幾筆」預設用訂單層級：order_special_collaborates.status 是字串型的數字，'0'=尚未發貨、'1'=發貨完成、'2'=發貨失敗。不要用 shops.special_collaborate_delivery_enable 或 orders.mcoin_delivered 判斷發貨結果——前者是賣場設定旗標，後者是 M 幣是否已發放，都不是發貨狀態。",
  },
  {
    scope: "global",
    dedupeKey: "輸出代碼欄位",
    content:
      "輸出代碼欄位（status、type、level、provider 這類值是代碼而非人話的欄位）時，一律在 SELECT 用 CASE WHEN 轉成語意層規則裡標註的中文標籤再輸出，不要直接丟原始代碼——例如要輸出「實況主」而不是 live_host、「已通過」而不是 pass、「訂單回饋」而不是 order_add。GROUP BY 用原始欄位或該中文別名皆可。",
  },
  {
    scope: "table",
    table: "mepay.users",
    dedupeKey: "status 是帳號狀態",
    content:
      "status 是帳號狀態：1=正常（唯一可正常登入使用）、2=禁用、3=註銷中（已申請未生效，時間在 cancel_requested_at / cancel_effective_at）、4=已註銷、5=已凍結。統計「有效會員／會員數」時應限定 status = 1。",
  },
  {
    scope: "table",
    table: "mepay.orders",
    dedupeKey: "freeze_type 是退貨凍結類型",
    content:
      "freeze_type 是退貨凍結類型，NULL=未凍結：1=全部退貨成功、2=全部退貨失敗、3=部分退貨失敗；退款金額在 refund_amount。",
  },
  {
    scope: "table",
    table: "mepay.orders",
    dedupeKey: "login_device 是下單時的登入裝置",
    content:
      "login_device 是下單時的登入裝置：1=Android、2=iOS、3=PC（NULL=未紀錄）。login_type 是登入方式類型：api、quick、account（NULL=未紀錄）。login_method_id 對應 login_methods 表，登入方式名稱一律 join login_methods.name 取得，不要自行推測 login_method_id 的代碼含義。",
  },
  {
    scope: "table",
    table: "mepay.order_payment_details",
    dedupeKey: "status 是金流付款明細狀態",
    content:
      "status 是金流付款明細狀態：0=待付款、1=已付款、2=付款失敗。計算「實際付款成功」要限定 status = 1。",
  },
  {
    scope: "table",
    table: "mepay.order_logs",
    dedupeKey: "訂單狀態異動軌跡",
    content:
      "order_logs 是訂單狀態異動軌跡，一次異動一列；status 的編碼與 orders.status 相同（0=待付款、1=排隊處理中、2=專員服務中、3=請洽客服、4=完成、5=取消、6=已退款），operator_id 是操作人員。",
  },
  {
    scope: "table",
    table: "mepay.shops",
    dedupeKey: "「上架賣場」的口徑",
    content:
      "「上架賣場」的口徑就是 shops.status = 1，不要自行再加 is_show_front 或 publish_start_at / publish_end_at 時間窗條件。status=1 上架、0 下架；handling_fee=1 收取手續費、0 不收取；auto_delivery_type=0 不自動發貨、1 序號、2 API。deleted_at 非空代表已軟刪除，統計時應排除。",
  },
  {
    scope: "table",
    table: "mepay.shops",
    dedupeKey: "special_collaborate_id 是串接的特殊合作廠商",
    content:
      "special_collaborate_id 是串接的特殊合作廠商：1=艾肯、2=UIDPAY、3=星宿、4=MyCard、5=麻雀一番街、6=IplayGame91、7=鈊象、8=小萌、9=Coda、10=Ment；NULL=非特殊合作賣場。",
  },
  {
    scope: "table",
    table: "mepay.coupon_codes",
    dedupeKey: "coupon_code_type 是序號產生方式",
    content:
      "coupon_code_type 是序號產生方式：0=隨機序號、1=通用序號、2=系統固定。system_type 是系統券的發放情境：0=註冊、1=首購、2=儲值、3=下載、4=生日、5=發薪券、6=創作者推薦；NULL=非系統券（一般活動券）。",
  },
  {
    scope: "table",
    table: "mepay.order_special_collaborate_items",
    dedupeKey: "status 是單一品項的發貨狀態",
    content:
      "status 是單一品項的發貨狀態：0=尚未發貨、1=完成、2=失敗、3=商品缺貨（3 未列在程式的列舉中，但實際資料的 message 全部是「商品缺貨」）。失敗原因在 message，need_retry=1 表示可重試。這是品項層級；問「特殊合作發貨失敗幾筆」預設用訂單層級的 order_special_collaborates。",
  },
  {
    scope: "table",
    table: "mepay.global_notifications",
    dedupeKey: "type 是公告類型",
    content:
      "type 是公告類型：announcement=公告、activity=活動、system=系統。target_group 是發送對象：all=不限身份、member=會員群組（群組在 user_group_id）、creator=創作者群組、single_user=單一會員（對象在 user_id）。",
  },
  {
    scope: "table",
    table: "mepay.user_identifiers",
    dedupeKey: "status 是實名認證審核狀態",
    content:
      "status 是實名認證審核狀態：0=建立後尚未送審（欄位預設值，送審時程式會改成 1）、1=審核中、2=未通過、3=通過。統計「實名認證通過人數」要限定 status = 3。",
  },
  {
    scope: "table",
    table: "mepay.categories",
    dedupeKey: "type 是分類用途",
    content:
      "type 是分類用途，現行只有兩種：shop=商品（賣場）分類、page=頁面分類。資料中另有 game、default 兩種值，屬舊資料已廢棄，分析時應排除。",
  },
  {
    scope: "table",
    table: "mepay.order_additional_items",
    dedupeKey: "item_type 是加購品類型",
    content: "item_type 是加購品類型，目前只有 1=序號；is_code_send=1 表示序號已發送。",
  },
];

/** bootstrap 草稿的識別特徵——只有還是草稿的規則可以無條件覆蓋。 */
const DRAFT_MARKER = "請補充每個值的業務含義";

function isUntouchedDraft(r: SemanticRule): boolean {
  return !r.reviewed && r.content.includes(DRAFT_MARKER);
}

async function main() {
  const force = process.argv.includes("--force");

  const existing = new Map<number, SemanticRule>();
  for (const r of await listRules()) existing.set(r.id, r);

  let updated = 0;
  let skipped = 0;
  const warnings: string[] = [];

  for (const seed of SEEDS) {
    const rule = existing.get(seed.id);
    if (!rule) {
      warnings.push(`規則 ${seed.id}（${seed.table}）不存在，跳過`);
      skipped++;
      continue;
    }
    if (rule.scope !== "table" || rule.table !== seed.table) {
      warnings.push(
        `規則 ${seed.id} 綁定的是 ${rule.scope}/${rule.table ?? "-"}，預期 table/${seed.table}，跳過`,
      );
      skipped++;
      continue;
    }
    if (rule.content === seed.content && rule.reviewed) {
      skipped++;
      continue;
    }
    if (!isUntouchedDraft(rule) && rule.content !== seed.content && !force) {
      warnings.push(`規則 ${seed.id}（${seed.table}）已被人工改寫，跳過（要覆蓋請加 --force）`);
      skipped++;
      continue;
    }

    await updateRule(seed.id, {
      scope: "table",
      table: seed.table,
      content: seed.content,
      reviewed: true,
    });
    console.log(`[semantics] 已補完規則 ${seed.id}：${seed.table}`);
    updated++;
  }

  // --- 新增規則 ---
  const all = [...existing.values()];
  let created = 0;

  for (const seed of NEW_SEEDS) {
    const sameBinding = all.filter((r) => {
      if (r.scope !== seed.scope) return false;
      if (seed.scope === "term") return r.termName === seed.termName;
      if (seed.scope === "table") return r.table === seed.table;
      return true; // global
    });
    if (sameBinding.some((r) => r.content.includes(seed.dedupeKey))) {
      skipped++;
      continue;
    }
    const id = await createRule({
      scope: seed.scope,
      termName: seed.termName ?? null,
      table: seed.table ?? null,
      content: seed.content,
      reviewed: true,
    });
    const where = seed.termName ?? seed.table ?? "global";
    console.log(`[semantics] 已新增規則 ${id}：${seed.scope} / ${where}`);
    created++;
  }

  for (const w of warnings) console.warn(`[semantics] ⚠ ${w}`);
  console.log(`[semantics] 完成：更新 ${updated} 條、新增 ${created} 條、跳過 ${skipped} 條。`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
