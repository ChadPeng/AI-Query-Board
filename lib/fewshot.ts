import { tokenOverlap } from "./schema/keywordScore";

/**
 * Few-shot from the Trusted Query library (JOIN 可靠性第二波). saved_query was
 * an all-or-nothing reuse cache; here confirmed question→SQL pairs double as
 * demonstrations — a weak model imitates a concrete same-tables JOIN far more
 * reliably than it follows abstract join instructions. Deterministic
 * similarity only (no embeddings): table overlap dominates, keyword overlap
 * tiebreaks.
 */

export interface FewShotExample {
  question: string;
  sql: string;
}

const MAX_EXAMPLES = 2;
const MAX_TOTAL_CHARS = 1200;
/** below this, an example is more likely to mislead than help */
const MIN_SCORE = 3;

function tableMentions(sql: string, qualifiedTables: string[]): number {
  const lower = sql.toLowerCase();
  let hits = 0;
  for (const qualified of qualifiedTables) {
    const bare = qualified.slice(qualified.lastIndexOf(".") + 1).toLowerCase();
    const pattern = new RegExp(`\\b${bare.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
    if (lower.includes(qualified.toLowerCase()) || pattern.test(lower)) hits++;
  }
  return hits;
}

/**
 * Pick up to MAX_EXAMPLES saved pairs relevant to this question + the tables
 * stage-1 already selected. Score = tables the example's SQL shares with the
 * selection ×3 (that's the JOIN-shape signal) + question keyword overlap.
 * Two gates (情境三測試的調校)：keyword overlap must be ≥1 — table overlap
 * alone admitted weakly-related examples ("性別分佈" pulled in revenue
 * queries just because both touch user_profiles) — and the total must clear
 * MIN_SCORE. A wrong example is worse than none.
 */
export function pickFewShotExamples(
  question: string,
  selectedTables: string[],
  saved: FewShotExample[],
  max = MAX_EXAMPLES,
): FewShotExample[] {
  if (saved.length === 0 || selectedTables.length === 0) return [];
  const scored = saved
    .map((ex) => {
      const tables = tableMentions(ex.sql, selectedTables);
      const keywords = tokenOverlap(question, ex.question);
      return { ex, keywords, score: tables * 3 + keywords };
    })
    .filter((s) => s.keywords > 0 && s.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score);

  const out: FewShotExample[] = [];
  let chars = 0;
  for (const { ex } of scored) {
    if (out.length >= max) break;
    const size = ex.question.length + ex.sql.length;
    if (chars + size > MAX_TOTAL_CHARS) continue;
    // never leak the exact same question back as its own example
    if (ex.question.trim() === question.trim()) continue;
    out.push(ex);
    chars += size;
  }
  return out;
}
