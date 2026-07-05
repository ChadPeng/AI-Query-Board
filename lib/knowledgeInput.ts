import { parseQualified } from "./schema/introspect";
import type { Cardinality, NewRelationship } from "./state/relationships";
import type { NewSemanticRule, RuleScope } from "./state/semanticRules";

/**
 * Request-body validation for the Semantic Layer management API. Kept out of the
 * route files so both `route.ts` and `[id]/route.ts` can share it without a
 * route-to-route import (which trips Next's route-module type checks).
 */

const CARDS: Cardinality[] = ["many_to_one", "one_to_one"];
const SCOPES: RuleScope[] = ["global", "term", "table"];

export function parseRelationshipBody(body: Record<string, unknown>): NewRelationship | string {
  const from = parseQualified(String(body.fromTable ?? ""));
  const to = parseQualified(String(body.toTable ?? ""));
  if (!from) return "來源表格式需為 schema.table";
  if (!to) return "目標表格式需為 schema.table";
  const fromColumn = typeof body.fromColumn === "string" ? body.fromColumn.trim() : "";
  const toColumn = typeof body.toColumn === "string" ? body.toColumn.trim() : "";
  if (!fromColumn || !toColumn) return "來源欄與目標欄不可為空";
  const cardinality = body.cardinality;
  if (typeof cardinality !== "string" || !CARDS.includes(cardinality as Cardinality)) {
    return "基數必須是 many_to_one / one_to_one";
  }
  return {
    fromSchema: from.schema,
    fromTable: from.table,
    fromColumn,
    toSchema: to.schema,
    toTable: to.table,
    toColumn,
    cardinality: cardinality as Cardinality,
    reviewed: Boolean(body.reviewed),
  };
}

export function parseRuleBody(body: Record<string, unknown>): NewSemanticRule | string {
  const scope = body.scope;
  if (typeof scope !== "string" || !SCOPES.includes(scope as RuleScope)) {
    return "scope 必須是 global / term / table";
  }
  const content = typeof body.content === "string" ? body.content.trim() : "";
  if (!content) return "規則內容不可為空";
  if (scope === "term" && !(typeof body.termName === "string" && body.termName.trim())) {
    return "術語規則需要一個術語名稱";
  }
  if (scope === "table" && !(typeof body.table === "string" && body.table.includes("."))) {
    return "表級規則需要選定一張表";
  }
  // Keep only the field relevant to the scope, so the stored row (and the rule
  // fed to the LLM) never carries stray metadata from another scope.
  return {
    scope: scope as RuleScope,
    termName: scope === "term" && typeof body.termName === "string" ? body.termName.trim() : null,
    table: scope === "table" && typeof body.table === "string" ? body.table : null,
    content,
    reviewed: Boolean(body.reviewed),
  };
}
