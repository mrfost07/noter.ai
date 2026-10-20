import type { MemoFilter } from "@/contexts/MemoFilterContext";
import type { MemoSuggestion, SuggestionSource } from "./memo-suggestions";
import { parseSuggestionExpression, type SuggestionExpression, type SuggestionToken } from "./suggestion-expression";

interface ContextConditions {
  checklist: boolean;
  excludesChecklist: boolean;
}

const emptyConditions = (): ContextConditions => ({
  checklist: false,
  excludesChecklist: false,
});

function readAtom(tokens: SuggestionToken[], negated: boolean): ContextConditions {
  const result = emptyConditions();
  const [left, operator, right] = tokens;
  if (!left) return result;
  if (["has_task_list", "has_incomplete_tasks"].includes(left.text)) {
    let positive: boolean;
    if (tokens.length === 1) positive = true;
    else if (tokens.length === 3 && ["==", "!="].includes(operator.text) && ["true", "false"].includes(right.text)) {
      positive = (right.text === "true") === (operator.text === "==");
    } else return result;
    result.checklist = positive !== negated;
    // A new checklist starts unchecked, so a ban on incomplete tasks also excludes it.
    result.excludesChecklist = !result.checklist;
    return result;
  }
  return result;
}

function analyze(expression: SuggestionExpression, negated = false): ContextConditions {
  if (expression.kind === "not") return analyze(expression.child, !negated);
  if (expression.kind === "atom") return readAtom(expression.tokens, negated);
  const left = analyze(expression.left, negated);
  const right = analyze(expression.right, negated);
  const conjunction = (expression.kind === "and") !== negated;
  const excludesChecklist = conjunction
    ? left.excludesChecklist || right.excludesChecklist
    : left.excludesChecklist && right.excludesChecklist;
  return {
    checklist: (left.checklist || right.checklist) && !excludesChecklist,
    excludesChecklist,
  };
}

function readConditions(source: string): ContextConditions {
  try {
    const expression = parseSuggestionExpression(source);
    return expression ? analyze(expression) : emptyConditions();
  } catch {
    return emptyConditions();
  }
}

/** Checklist provider shares the same Boolean reader as tags. */
export function getContextSuggestionCandidates(filters: MemoFilter[], viewFilter?: string): MemoSuggestion[] {
  const conditions = filters.flatMap<ContextConditions & { source: SuggestionSource }>((filter) => {
    if (filter.factor === "celSearch") return [{ ...readConditions(filter.value), source: "search" as const }];
    if (filter.factor === "property.hasTaskList") return [{ ...readConditions("has_task_list"), source: "selection" as const }];
    return [];
  });
  if (viewFilter) conditions.push({ ...readConditions(viewFilter), source: "view" });
  const candidates: MemoSuggestion[] = [];
  if (!conditions.some((condition) => condition.excludesChecklist)) {
    for (const condition of conditions) {
      if (condition.checklist) candidates.push({ id: "checklist", kind: "checklist", source: condition.source });
    }
  }
  return candidates;
}
