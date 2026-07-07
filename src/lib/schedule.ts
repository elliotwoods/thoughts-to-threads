// Pure, dependency-free scheduling helpers shared by the server tick, the
// status API, and the settings UI (safe to import from client components — no
// server-only deps, mirroring lib/post.ts).
//
// The Vercel cron fires once daily at 00:00 UTC (== 09:00 in Asia/Seoul). These
// helpers decide, at runtime, *which* weekdays that daily tick is allowed to
// publish on, so the active days are editable from the portal without a
// redeploy. Weekdays use the JS convention: 0 = Sunday … 6 = Saturday.
//
// Note: 00:00 UTC on a given date is 09:00 KST on the SAME calendar date, so the
// weekday computed in Asia/Seoul at cron time matches the intended local day.

export interface Weekday {
  value: number;
  short: string;
  long: string;
}

export const WEEKDAYS: Weekday[] = [
  { value: 0, short: "Sun", long: "Sunday" },
  { value: 1, short: "Mon", long: "Monday" },
  { value: 2, short: "Tue", long: "Tuesday" },
  { value: 3, short: "Wed", long: "Wednesday" },
  { value: 4, short: "Thu", long: "Thursday" },
  { value: 5, short: "Fri", long: "Friday" },
  { value: 6, short: "Sat", long: "Saturday" },
];

/**
 * Weekday (0=Sun…6=Sat) of an instant, evaluated in an IANA timezone. Falls back
 * to the UTC weekday if the timezone is missing/invalid (mirrors yearInTz in
 * firestore.ts).
 */
export function weekdayInTz(date: Date, timeZone?: string | null): number {
  if (!timeZone) return date.getUTCDay();
  try {
    const short = new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
    }).format(date);
    const i = WEEKDAYS.findIndex((w) => w.short === short);
    return i >= 0 ? i : date.getUTCDay();
  } catch {
    return date.getUTCDay();
  }
}

/** Coerce arbitrary input into a clean, sorted, de-duplicated weekday list. */
export function normalizeScheduleDays(input: unknown): number[] {
  if (!Array.isArray(input)) return [];
  const set = new Set<number>();
  for (const v of input) {
    const n = Number(v);
    if (Number.isInteger(n) && n >= 0 && n <= 6) set.add(n);
  }
  return [...set].sort((a, b) => a - b);
}

/** Is `now` (evaluated in `timeZone`) one of the scheduled publishing weekdays? */
export function isScheduledDay(
  days: number[],
  timeZone: string | null | undefined,
  now: Date
): boolean {
  if (!days || days.length === 0) return false;
  return days.includes(weekdayInTz(now, timeZone));
}

/** Human label: [0,1,3] -> "Sun, Mon, Wed"; [] -> "never"; all seven -> "every day". */
export function formatScheduleDays(days: number[]): string {
  const clean = normalizeScheduleDays(days);
  if (clean.length === 0) return "never";
  if (clean.length === 7) return "every day";
  return clean.map((d) => WEEKDAYS[d].short).join(", ");
}

/**
 * ISO of the next scheduled run strictly after `now`. The cron fires at 00:00
 * UTC daily; a run happens only when that instant's weekday (in `timeZone`) is
 * scheduled. Scans the next 8 daily 00:00-UTC instants so a once-a-week schedule
 * always resolves. Returns null when nothing is scheduled.
 */
export function nextScheduledRunIso(
  days: number[],
  timeZone: string | null | undefined,
  now: Date
): string | null {
  const clean = normalizeScheduleDays(days);
  if (clean.length === 0) return null;
  for (let i = 1; i <= 8; i++) {
    const cand = new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() + i,
        0,
        0,
        0,
        0
      )
    );
    if (clean.includes(weekdayInTz(cand, timeZone))) return cand.toISOString();
  }
  return null;
}
