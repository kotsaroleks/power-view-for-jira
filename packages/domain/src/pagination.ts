export interface PaginatedResult<TValue> {
  values: TValue[];
  startAt: number;
  maxResults: number;
  total: number;
  isLast: boolean;
}
