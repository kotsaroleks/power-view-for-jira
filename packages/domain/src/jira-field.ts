export interface JiraFieldSchema {
  type?: string;
  custom?: string;
  system?: string;
}

export interface JiraField {
  id: string;
  name: string;
  custom: boolean;
  schema?: JiraFieldSchema;
  searchable?: boolean;
  clauseNames: string[];
}

export interface FieldCandidate {
  id: string;
  name: string;
  schemaType?: string;
  confidence: number;
  reason: string;
}

export type DateFieldPurpose = "start" | "end";

export interface FieldMapping {
  startDateFieldId?: string;
  endDateFieldId?: string;
  hierarchyFieldId?: string;
  storyPointsFieldId?: string;
}

function normalizedName(value: string): string {
  return value.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

function isDateField(field: JiraField): boolean {
  const type = field.schema?.type?.toLowerCase();
  return type === "date" || type === "datetime";
}

function candidateScore(
  field: JiraField,
  purpose: DateFieldPurpose,
): { confidence: number; reason: string } | undefined {
  if (!isDateField(field)) {
    return undefined;
  }

  const name = normalizedName(field.name);
  if (purpose === "start") {
    const exactScores: Record<string, number> = {
      "start date": 1,
      "planned start": 0.96,
      "target start": 0.93,
      "actual start": 0.88,
      "start time": 0.82,
    };
    const exact = exactScores[name];
    if (exact !== undefined) {
      return { confidence: exact, reason: `Date field name matches “${field.name}”.` };
    }
    if (/\bstart\b/.test(name)) {
      return {
        confidence: 0.7,
        reason: "Date field name contains the word “start”.",
      };
    }
    return undefined;
  }

  if (field.id === "duedate") {
    return {
      confidence: 0.98,
      reason: "Jira's native due date is the standard end-date fallback.",
    };
  }

  const exactScores: Record<string, number> = {
    "end date": 1,
    "planned end": 0.96,
    "target end": 0.93,
    "due date": 0.9,
    "resolution date": 0.7,
  };
  const exact = exactScores[name];
  if (exact !== undefined) {
    return { confidence: exact, reason: `Date field name matches “${field.name}”.` };
  }
  if (/\b(end|due|finish)\b/.test(name)) {
    return {
      confidence: 0.7,
      reason: "Date field name suggests an end or due date.",
    };
  }
  return undefined;
}

export function rankDateFieldCandidates(
  fields: JiraField[],
  purpose: DateFieldPurpose,
): FieldCandidate[] {
  return fields
    .flatMap((field) => {
      const score = candidateScore(field, purpose);
      return score
        ? [
            {
              id: field.id,
              name: field.name,
              ...(field.schema?.type ? { schemaType: field.schema.type } : {}),
              confidence: score.confidence,
              reason: score.reason,
            },
          ]
        : [];
    })
    .sort(
      (left, right) =>
        right.confidence - left.confidence || left.name.localeCompare(right.name),
    );
}

export function validateFieldMapping(
  mapping: FieldMapping,
  fields: JiraField[],
): string[] {
  const fieldsById = new Map(fields.map((field) => [field.id, field]));
  const errors: string[] = [];

  for (const [label, fieldId] of [
    ["Start date", mapping.startDateFieldId],
    ["End date", mapping.endDateFieldId],
  ] as const) {
    if (!fieldId) {
      continue;
    }
    const field = fieldsById.get(fieldId);
    if (!field) {
      errors.push(`${label} field is no longer available in Jira.`);
    } else if (!isDateField(field)) {
      errors.push(`${label} must use a Jira date or date-time field.`);
    }
  }

  if (mapping.startDateFieldId && mapping.startDateFieldId === mapping.endDateFieldId) {
    errors.push("Start and end dates must use different fields.");
  }

  for (const [label, fieldId] of [
    ["Hierarchy", mapping.hierarchyFieldId],
    ["Story points", mapping.storyPointsFieldId],
  ] as const) {
    if (fieldId && !fieldsById.has(fieldId)) {
      errors.push(`${label} field is no longer available in Jira.`);
    }
  }

  return errors;
}
