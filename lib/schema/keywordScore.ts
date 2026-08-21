/**
 * Deterministic keyword-overlap scoring (no LLM, no IO). Used to narrow the
 * table catalog when stage-1 selection comes back empty, and by the few-shot
 * example picker. Questions are usually Chinese, table names English, and
 * descriptions Chinese — so tokenize both ways: ASCII words + CJK bigrams.
 */

const CJK_RUN = /[一-鿿]+/g;
const ASCII_WORD = /[a-z0-9_]+/g;

export function tokenize(text: string): string[] {
  const lower = text.toLowerCase();
  const tokens = new Set<string>();
  for (const word of lower.match(ASCII_WORD) ?? []) {
    if (word.length >= 2) tokens.add(word);
  }
  for (const run of lower.match(CJK_RUN) ?? []) {
    if (run.length === 1) {
      tokens.add(run);
      continue;
    }
    for (let i = 0; i + 1 < run.length; i++) tokens.add(run.slice(i, i + 2));
  }
  return [...tokens];
}

/**
 * Overlap of question tokens vs a table's name + description. Table-name hits
 * weigh double (the name is the stronger signal of "this is that table").
 */
export function keywordScore(
  questionTokens: string[],
  tableName: string,
  description: string,
): number {
  const name = tableName.toLowerCase();
  const desc = description.toLowerCase();
  let score = 0;
  for (const t of questionTokens) {
    if (name.includes(t)) score += 2;
    else if (desc.includes(t)) score += 1;
  }
  return score;
}

/** Shared token overlap of two texts (for question-vs-question similarity). */
export function tokenOverlap(a: string, b: string): number {
  const ta = new Set(tokenize(a));
  return tokenize(b).filter((t) => ta.has(t)).length;
}
