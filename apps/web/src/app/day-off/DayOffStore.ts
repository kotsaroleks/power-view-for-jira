import type { TimeReportDayOff } from "@power-view/domain";

export interface JiraRosterTeam {
  id: string;
  name: string;
  members: { accountId: string; displayName: string; jiraEmail?: string }[];
}

export interface DayOffReadResult {
  dayOffs: TimeReportDayOff[];
  complete: boolean;
  warnings: string[];
}
export interface DayOffStore {
  syncTeam?(
    baseUrl: string,
    team: JiraRosterTeam,
    signal?: AbortSignal,
  ): Promise<{ synced: number; unmapped: number; inactive: number }>;
  connect(): Promise<void>;
  read(
    baseUrl: string,
    accountIds: string[],
    days: string[],
    signal?: AbortSignal,
  ): Promise<DayOffReadResult>;
  set(
    baseUrl: string,
    accountId: string,
    date: string,
    enabled: boolean,
    signal?: AbortSignal,
    verifyIdentity?: () => Promise<void>,
  ): Promise<void>;
}
export class UnknownDayOffOutcomeError extends Error {
  constructor() {
    super(
      "The day-off update result is unknown. Refresh shared storage before another attempt; do not retry automatically.",
    );
    this.name = "UnknownDayOffOutcomeError";
  }
}
