# Dataset：星型限制的資料模型與確定性編譯器

BI 平台第一階段引入 **Dataset**（資料模型）：Editor 把「表怎麼 JOIN、什麼是維度/度量」策展成具名實體（`dataset` / `dataset_table` / `dataset_field` 三張表）。兩個消費者：

- **Explorer（/explore）**：點選維度/度量/篩選，由 `lib/datasets/compile.ts` 確定性編譯成 SQL——零 LLM、零 JOIN 幻覺。
- **AI 引擎（dataset-first 路由）**：問題先做「N 選 1 或 null」的模型匹配（弱模型最擅長的題型，同 matchSavedQuestion 已驗證的模式）；命中時跳過 stage-1 挑表與 graph-connect，直接注入模型的 JOIN 樹（措辭為必須照抄）與維度/度量口徑詞彙。未命中走原路，回歸風險為零。

## 核心決策：星型/雪花限制

一個 Dataset **恰有一張基底表**（fact）；JOIN 樹上每個節點以 `parent.parent_column = child.child_column` 掛上父節點，且基數**只允許 many_to_one / one_to_one**（向維度方向走）；**度量只能定義在基底表**。

### 為什麼（非顯而易見處）

這組限制**在結構上直接消滅 fan-out**——m:1/1:1 的 LEFT JOIN 保證結果列數恆等於基底表列數，所以 `SUM/AVG/COUNT` 不需要任何預聚合子查詢就是正確的。編譯器因此可以保持在「拼字串＋綁參數」的複雜度，而不是變成查詢計劃器。未來若要支援 1:N（訂單→明細）是「放寬限制＋加預聚合」，屬於功能擴充，不是修 bug。

其他關鍵選擇：

- **JOIN 邊複製自 Relationship、不引用**（記 `relationship_id` 作 provenance）。Dataset 是策展過的穩定產物，不能因為有人改了全域關係圖而默默改變語意（Tableau 的 data source 同樣是 local join）。
- **JOIN 樹直接掛在 dataset_table 節點上**（parent_alias），不另設 join 表——by construction 無環、驗證簡單；`alias` 天然支援同表多角色（buyer/seller）。
- **維度與度量合一表**（`kind` 判別）——一組 CRUD，度量專屬欄位可空。
- **度量口徑存原生 SQL 布林片段**（`condition_sql`），信任層級同 Report 手寫 SQL（ADR-0004：不是資料存取升級，執行仍走全套護欄）；編譯時包成 `CASE WHEN (cond) THEN expr END`（隱式 ELSE NULL 對所有允許的聚合都正確）。禁止 `;`、`?`、`:name`。
- **日期粒度是查詢時 transform**（day/week/month/quarter/year → DATE_FORMAT 等），不是模型欄位——避免每個粒度建一個維度的膨脹。
- **儲存時活體探測**（`lib/datasets/probe.ts`）：所有引用欄位＋每條口徑條件各跑一支無聚合、LIMIT 1 的查詢——MySQL 錯誤變成表單驗證訊息，而不是使用者查詢時的 500。
- **篩選值一律 prepared statement**（`runGuardedQuery` 的 values 路徑），識別字全部反引號跳脫。

## 否決的替代方案

- **任意圖形 JOIN（不限星型）**：編譯器必須處理 fan-out（同一度量因 1:N JOIN 重複計算）——需要預聚合、查詢計劃，v1 過度工程且容易默默算錯數字。寧可先限縮、保證正確。
- **Explorer 由 LLM 產 SQL**：整個功能的存在理由就是「這條路徑不會錯」；LLM 產 spec（而非 SQL）留作後續選配。
- **dataset_join 獨立表**：樹掛節點上更簡單，且反正 v1 更新採 replace-all。

## 後果

- 權限：`dataset:manage` = Editor、`dataset:explore` = Viewer（`lib/auth/permissions.ts`）。
- 1:N、HAVING（度量篩選）、第二維度（顏色/序列）、DnD shelf、活視圖（exploration）皆為後續放寬/疊加，互動模型不變。
- AI 命中模型時 `EngineSuccess.datasetUsed` 會標示模型名，前端顯示「📐 資料模型：…」。
