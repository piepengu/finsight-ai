/**
 * US equity session helpers (NYSE / Nasdaq common holidays).
 * Kept small and explicit for a student educational app — not a full exchange calendar API.
 */

'use strict';

/** Fixed-date + observed US market holidays (NYSE) for nearby years. */
const US_MARKET_HOLIDAYS = new Set([
  // 2025
  '2025-01-01', // New Year's Day
  '2025-01-20', // MLK Day
  '2025-02-17', // Presidents Day
  '2025-04-18', // Good Friday
  '2025-05-26', // Memorial Day
  '2025-06-19', // Juneteenth
  '2025-07-04', // Independence Day
  '2025-09-01', // Labor Day
  '2025-11-27', // Thanksgiving
  '2025-12-25', // Christmas
  // 2026
  '2026-01-01',
  '2026-01-19',
  '2026-02-16',
  '2026-04-03',
  '2026-05-25',
  '2026-06-19',
  '2026-07-03', // Independence Day observed
  '2026-09-07',
  '2026-11-26',
  '2026-12-25',
  // 2027
  '2027-01-01',
  '2027-01-18',
  '2027-02-15',
  '2027-03-26',
  '2027-05-31',
  '2027-06-18', // Juneteenth observed
  '2027-07-05', // Independence Day observed
  '2027-09-06',
  '2027-11-25',
  '2027-12-24' // Christmas observed
]);

function zonedParts(date, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(date).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value])
  );
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    weekday: parts.weekday,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    dateKey: `${parts.year}-${parts.month}-${parts.day}`
  };
}

function etParts(date = new Date()) {
  return zonedParts(date, 'America/New_York');
}

function isWeekendEt(date = new Date()) {
  const wd = etParts(date).weekday;
  return wd === 'Sat' || wd === 'Sun';
}

function isUsMarketHoliday(date = new Date()) {
  return US_MARKET_HOLIDAYS.has(etParts(date).dateKey);
}

/** Regular session weekday that is not a listed NYSE holiday. */
function isUsEquityTradingDay(date = new Date()) {
  return !isWeekendEt(date) && !isUsMarketHoliday(date);
}

function tradingDateKeyEt(date = new Date()) {
  return etParts(date).dateKey;
}

function dailySnapshotDocId(date = new Date()) {
  return `daily_${tradingDateKeyEt(date)}`;
}

/**
 * Whether a cached quote timestamp is acceptable for end-of-day valuation.
 * Requires same America/New_York calendar date and age within maxAgeMs.
 */
function isQuoteFreshForDailyValuation(quoteTimestamp, now = new Date(), maxAgeMs = 8 * 60 * 60 * 1000) {
  if (!quoteTimestamp) return false;
  const ts = quoteTimestamp instanceof Date ? quoteTimestamp : new Date(quoteTimestamp);
  if (Number.isNaN(ts.getTime())) return false;
  const age = now.getTime() - ts.getTime();
  if (age < 0 || age > maxAgeMs) return false;
  return tradingDateKeyEt(ts) === tradingDateKeyEt(now);
}

module.exports = {
  US_MARKET_HOLIDAYS,
  etParts,
  isWeekendEt,
  isUsMarketHoliday,
  isUsEquityTradingDay,
  tradingDateKeyEt,
  dailySnapshotDocId,
  isQuoteFreshForDailyValuation
};
