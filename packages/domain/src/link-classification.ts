export type IssueLinkRelationshipKind =
  "blocks" | "finish-to-finish" | "depends" | "duplicate" | "relates" | "unknown";

export function classifyIssueLinkRelationship(
  name: string,
  inward: string,
  outward: string,
): IssueLinkRelationshipKind {
  const value = `${name} ${inward} ${outward}`.toLowerCase();
  if (value.includes("block")) {
    return "blocks";
  }
  if (/finish[- ]?finish/.test(value) || value.includes("finished together")) {
    return "finish-to-finish";
  }
  if (value.includes("duplicate")) {
    return "duplicate";
  }
  if (value.includes("depend")) {
    return "depends";
  }
  if (value.includes("relate")) {
    return "relates";
  }
  return "unknown";
}
