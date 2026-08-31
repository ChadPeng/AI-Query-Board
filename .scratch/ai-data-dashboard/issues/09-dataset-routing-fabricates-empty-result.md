# 09 — 資料模型路由誤判後，AI 捏造 `SELECT 0` 並回報成功

Status: needs-triage

發現於 2026-09-01 的語意層實測（見 `.scratch/semantic-layer-enums/DRAFT-rules.md`）。

## 症狀

問「特殊合作發貨失敗的訂單有幾筆？」，引擎回傳 **`ok: true`**，但 SQL 是捏造的：

```
ok: true
sql: "SELECT 0 AS failed_orders"
explanation: "由於資料模型中記錄特殊合作發貨失敗的狀態在 order_special_collaborates 表，
              但該表未在提供的資料庫結構中出現，無法直接取得此資訊，故回傳 0 作為占位結果。"
tablesUsed: ["mepay.orders", "mepay.shops", "mepay.user_profiles"]
datasetUsed: "訂單分析"
```

正確答案是 `SELECT COUNT(*) FROM mepay.order_special_collaborates WHERE status = '2'` → **730 筆**。

**這是靜默錯誤答案**：前台會照常畫出一張顯示 0 的圖，非技術使用者無從察覺結果是假的。
比「查詢失敗並報錯」危險得多。

## 重現

前提：`dataset` 只有一筆已發布的「訂單分析」（基底 `mepay.orders`，join `user_profiles`、`shops`）。
LLM 為 Ollama Cloud `gpt-oss:120b`。

問下列任一句都會重現（問句不含「訂單」二字也一樣）：

- 「特殊合作發貨失敗的訂單有幾筆？」
- 「特殊合作發貨失敗有幾筆？」
- 「廠商直送發貨失敗的數量」

同一句偶爾會改為被 `isReadOnly` 擋下（`只允許單一 SELECT 查詢`），是同一個成因的另一種取樣結果。

## 根因（兩層，可分開修）

**1. `matchDataset` 過度比中** — [lib/schema/datasetSchema.ts:117](lib/schema/datasetSchema.ts#L117)

`tryResolveDatasetSchema` 把問句丟給 `provider.matchDataset` 做 N-choose-1-or-null。
「訂單分析」的 description 明寫是「營收、訂單數、按月/按使用者/按商店分析」，
與「發貨失敗」無關，但只有單一候選時模型仍然比中。

**2. 比中之後沒有退路** — [lib/schema/datasetSchema.ts:85](lib/schema/datasetSchema.ts#L85)

`resolveSchemaForDataset` 一旦成功，DDL 就只剩資料模型內的表。
語意層的 term/global 規則**有**正常注入（`getAlwaysInjectedRules()`），
所以 LLM 明確知道該查 `order_special_collaborates`（它在 explanation 裡寫出來了），
但那張表不在 DDL 裡，於是它選擇編一個 placeholder 而不是放棄。

`tryResolveDatasetSchema` 只在**拋錯**時回傳 null 走一般檢索；
「比中了但表不夠」這條路徑沒有任何偵測或 fallback。

## 修法取捨

| 方案 | 動到 | 說明 |
|---|---|---|
| A. 產出後偵測 placeholder | `lib/engine.ts` | 資料模型路徑產出的 SQL 若沒有 FROM 任何實際表（或只有常數投影），視為未命中，fallback 回一般檢索重跑一次。根治，但要小心別把合法的 `SELECT 1` 類查詢誤殺。 |
| B. prompt 明令禁止捏造 | `lib/llm/*` prompt | 要求「所需的表不在提供的結構中時，必須明確回報無法回答，不得回傳占位值」。成本最低，但依賴模型服從度。 |
| C. 收緊 dataset 描述 | `dataset.description` 資料 | 只治標，且每加一個資料模型就要重調。 |
| D. matchDataset 加信心門檻 | `lib/llm/*` | 單一候選時要求模型更保守，或改成需要明確理由才比中。 |

建議 A + B 一起做：A 是安全網，B 降低觸發率。C 可當立即緩解。

## 驗收

1. 上述三句問法都不再回傳 `ok: true` 搭配捏造的 `SELECT 0`。
2. 「特殊合作發貨失敗有幾筆？」能答出 730（走一般檢索路徑，命中 `mepay.order_special_collaborates`）。
3. 原本就該命中「訂單分析」的問題（如「2026年7月訂單最多的前10個商店」）行為不變 —
   跑 `npm run eval` 對比。

## 備註

語意層本身沒問題：`term / 特殊合作發貨`（rule 40）已明訂該查哪張表、
以及不要用 `shops.special_collaborate_delivery_enable` 或 `orders.mcoin_delivered` 判斷發貨結果。
規則有被注入、LLM 也讀懂了，是資料模型的表清單把它擋在門外。
