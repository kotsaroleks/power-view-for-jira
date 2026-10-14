export interface EstimationDraft {
  techLead: string;
  qaLead: string;
  days: string;
  decomposition: string;
  questions: string;
  answers: string;
  questionsResolved: boolean;
  scope: string;
  scopeConfirmed: boolean;
  environment: string;
  conditions: string;
  testPlan: string;
  testData: string;
  qaSubmitted: boolean;
  ready: boolean;
}

export const emptyDraft = (): EstimationDraft => ({
  techLead: "",
  qaLead: "",
  days: "",
  decomposition: "",
  questions: "",
  answers: "",
  questionsResolved: false,
  scope: "",
  scopeConfirmed: false,
  environment: "",
  conditions: "",
  testPlan: "",
  testData: "",
  qaSubmitted: false,
  ready: false,
});

export const stages = [
  "Tech estimation",
  "PM clarification",
  "Scope confirmation",
  "QA preparation",
  "Ready to dev",
] as const;
export type Stage = (typeof stages)[number];

export function techComplete(draft: EstimationDraft): boolean {
  return Boolean(
    draft.techLead.trim() &&
    Number.isFinite(Number(draft.days)) &&
    Number(draft.days) > 0 &&
    draft.decomposition.trim(),
  );
}
export function scopeComplete(draft: EstimationDraft): boolean {
  return (
    techComplete(draft) &&
    Boolean(draft.scope.trim()) &&
    (!draft.questions.trim() ||
      (draft.questionsResolved && Boolean(draft.answers.trim())))
  );
}
export function qaComplete(draft: EstimationDraft): boolean {
  return (
    draft.scopeConfirmed &&
    scopeComplete(draft) &&
    [
      draft.qaLead,
      draft.environment,
      draft.conditions,
      draft.testPlan,
      draft.testData,
    ].every((value) => Boolean(value.trim()))
  );
}
export function stageFor(draft: EstimationDraft): Stage {
  if (!techComplete(draft)) return stages[0];
  if (draft.questions.trim() && (!draft.questionsResolved || !draft.answers.trim()))
    return stages[1];
  if (!draft.scopeConfirmed || !scopeComplete(draft)) return stages[2];
  if (!draft.qaSubmitted || !qaComplete(draft) || !draft.ready) return stages[3];
  return stages[4];
}

export function parseIssueKeys(input: string): string[] {
  return [...new Set(input.toUpperCase().match(/\b[A-Z][A-Z0-9_]*-\d+\b/g) ?? [])];
}

const techFields = new Set<keyof EstimationDraft>([
  "techLead",
  "days",
  "decomposition",
  "questions",
  "answers",
  "questionsResolved",
  "scope",
]);
const qaFields = new Set<keyof EstimationDraft>([
  "qaLead",
  "environment",
  "conditions",
  "testPlan",
  "testData",
]);
export function updateDraft<K extends keyof EstimationDraft>(
  draft: EstimationDraft,
  field: K,
  value: EstimationDraft[K],
): EstimationDraft {
  const next = { ...draft, [field]: value };
  if (techFields.has(field))
    return { ...next, scopeConfirmed: false, qaSubmitted: false, ready: false };
  if (qaFields.has(field) || field === "scopeConfirmed")
    return { ...next, qaSubmitted: false, ready: false };
  return next;
}

export interface ReleaseBoard {
  release: string;
  keys: string[];
  drafts: Record<string, EstimationDraft>;
}
export function readBoard(value: string | null): ReleaseBoard {
  const fallback: ReleaseBoard = { release: "", keys: [], drafts: {} };
  if (!value) return fallback;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") return fallback;
    const data = parsed as Record<string, unknown>;
    if (
      typeof data.release !== "string" ||
      !Array.isArray(data.keys) ||
      !data.drafts ||
      typeof data.drafts !== "object"
    )
      return fallback;
    const keys = [
      ...new Set(
        data.keys.filter(
          (key): key is string =>
            typeof key === "string" && /^[A-Z][A-Z0-9_]*-\d+$/.test(key),
        ),
      ),
    ];
    const drafts: Record<string, EstimationDraft> = {};
    for (const key of keys) {
      const candidate = (data.drafts as Record<string, unknown>)[key];
      const draft = emptyDraft();
      if (candidate && typeof candidate === "object") {
        for (const field of Object.keys(draft) as (keyof EstimationDraft)[]) {
          const value = (candidate as Record<string, unknown>)[field];
          if (typeof value === typeof draft[field])
            Object.assign(draft, { [field]: value });
        }
      }
      drafts[key] = draft;
    }
    return { release: data.release, keys, drafts };
  } catch {
    return fallback;
  }
}
