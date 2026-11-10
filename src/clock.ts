const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export type Clock = () => Date;
export const systemClock: Clock = () => new Date();

interface Parts {
  y: number;
  m: number;
  d: number;
  hh: number;
  mm: number;
  weekday: number;
}

function partsIn(date: Date, tz: string): Parts {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
    weekday: "short",
  });
  const o: Record<string, string> = {};
  for (const p of f.formatToParts(date)) o[p.type] = p.value;
  return {
    y: +o.year,
    m: +o.month,
    d: +o.day,
    hh: +o.hour,
    mm: +o.minute,
    weekday: WEEKDAYS.indexOf(o.weekday),
  };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number) => String(n).padStart(2, "0");

/** "Tue 3 Nov 2026" */
export function dayLabel(date: Date, tz: string): string {
  const p = partsIn(date, tz);
  return `${WEEKDAYS[p.weekday]} ${p.d} ${MONTHS[p.m - 1]} ${p.y}`;
}

/** "2026-11-03" in the given timezone */
export function isoDay(date: Date, tz: string): string {
  const p = partsIn(date, tz);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}

/** "Tue 3 Nov 2026 19:45" */
export function stamp(date: Date, tz: string): string {
  const p = partsIn(date, tz);
  return `${dayLabel(date, tz)} ${pad(p.hh)}:${pad(p.mm)}`;
}

/**
 * Day-by-day table around today. Models are unreliable at weekday arithmetic,
 * so we hand them the answer for "last Tuesday", "yesterday", "on the 3rd".
 * Newest day first. "last Tue" marks the most recent matching weekday strictly before today.
 */
export function calendarBlock(now: Date, tz: string, daysBack = 28, daysAhead = 7): string {
  const seenWeekday = new Set<number>();
  const lines: string[] = [];
  // Walk by whole 24h steps from local noon so DST shifts cannot skip or repeat a day.
  const p0 = partsIn(now, tz);
  const noon = new Date(now.getTime() + ((12 - p0.hh) * 60 - p0.mm) * 60_000);
  for (let off = daysAhead; off >= -daysBack; off--) {
    const d = new Date(noon.getTime() + off * 86_400_000);
    const p = partsIn(d, tz);
    const tags: string[] = [];
    if (off === 0) tags.push("today");
    else if (off === -1) tags.push("yesterday");
    else if (off === 1) tags.push("tomorrow");
    if (off < 0 && !seenWeekday.has(p.weekday)) {
      seenWeekday.add(p.weekday);
      tags.push(`last ${WEEKDAYS[p.weekday]}`);
    }
    lines.push(`${isoDay(d, tz)} ${dayLabel(d, tz)}${tags.length ? "  <- " + tags.join(", ") : ""}`);
  }
  return lines.join("\n");
}

/** Models sometimes copy the "[Tue 3 Nov 2026 19:45]" prefix into their reply. Remove it. */
export function stripStamps(text: string): string {
  return text.replace(/(^|\n)[ \t]*\[(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,? [^\]\n]{3,40}\][ \t]*/g, "$1");
}
