import type { RoutineItem, RoutineTemplate } from "@autiplanner/core";

export const ICS_ISSUE_CODES = [
  "empty-calendar",
  "malformed-line",
  "missing-calendar-envelope",
  "missing-version",
  "unsupported-version",
  "multiple-calendar",
  "unclosed-component",
  "missing-uid",
  "missing-summary",
  "missing-daypart",
  "invalid-daypart",
  "invalid-outcome",
  "inferred-outcome",
  "outcome-status-conflict",
  "completed-without-timestamp",
  "timestamp-without-completed",
  "unsupported-status",
  "missing-schedule",
  "invalid-datetime",
  "invalid-date",
  "date-differs-from-schedule",
  "timezone-conflict",
  "missing-dtstamp",
  "duplicate-property",
  "duplicate-uid",
  "invalid-order",
  "invalid-revision",
  "dropped-nested-component",
  "unsupported-recurrence",
  "unsupported-property",
] as const;

export type IcsIssueCode = (typeof ICS_ISSUE_CODES)[number];

export interface IcsIssue {
  code: IcsIssueCode;
  message: string;
  uid?: string;
  line?: number;
}

export interface ParsedCalendar {
  prodId?: string;
  version?: string;
  calscale?: string;
  method?: string;
  /** Calendar properties this profile does not model, kept for rewrite. */
  calendarProperties: readonly string[];
  items: readonly RoutineItem[];
  /** Series templates. These are not completable occurrences. */
  series: readonly RoutineTemplate[];
  /**
   * Components that were not imported as routine items, including rejected
   * VTODO records and unmodeled components such as VEVENT. A modeled rewrite
   * can append these so they are not silently deleted.
   */
  preserved: readonly string[];
  issues: readonly IcsIssue[];
}

export interface SerializeOptions {
  /** DTSTAMP applied to written VTODO components. Defaults to the current time. */
  dtstamp?: Date;
  prodId?: string;
}

export class IcsSerializeError extends Error {
  readonly details: readonly string[];

  constructor(details: readonly string[]) {
    super(`cannot serialize routine calendar: ${details.join("; ")}`);
    this.name = "IcsSerializeError";
    this.details = details;
  }
}
