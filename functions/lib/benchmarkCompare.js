/**
 * SPY vs paper-portfolio percentage comparison (pure / testable).
 * Does not invent portfolio values; does not use future SPY closes.
 */

'use strict';

const {
  etParts,
  isUsEquityTradingDay,
  previousTradingDayKey,
  tradingDateKeyEt
} = require('./marketCalendar');
const { MAX_CONNECTED_GAP_MS, chartSegmentShouldBreak } = require('./portfolioHistory');

const DAY_MS = 24 * 60 * 60 * 1000;
const SPY_BENCHMARK_LABEL =
  'SPY (S&P 500 ETF proxy) — unadjusted closing prices, not the exact S&P 500 total return';

/**
 * Parse Alpha Vantage TIME_SERIES_DAILY JSON into sorted ascending bars.
 * @returns {{ date: string, close: number }[]}
 */
function parseAlphaDailySeries(payload) {
  const series = payload && payload['Time Series (Daily)'];
  if (!series || typeof series !== 'object') {
    const msg = payload?.Information || payload?.Note || payload?.['Error Message'] || 'missing_series';
    return { ok: false, reason: String(msg), bars: [] };
  }
  const bars = [];
  for (const [date, row] of Object.entries(series)) {
    const close = parseFloat(row['4. close']);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(close) || close <= 0) continue;
    bars.push({ date, close });
  }
  bars.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  if (bars.length === 0) return { ok: false, reason: 'empty_bars', bars: [] };
  return { ok: true, bars, reason: null };
}

function indexSpyBars(bars) {
  const byDate = new Map();
  for (const b of bars || []) {
    if (b?.date && Number.isFinite(Number(b.close))) byDate.set(b.date, Number(b.close));
  }
  const dates = [...byDate.keys()].sort();
  return { byDate, dates, firstDate: dates[0] || null, lastDate: dates[dates.length - 1] || null };
}

/**
 * Latest SPY session date that is known at observation time (no future close).
 * Before 16:00 ET on a trading day → prior trading day; else that session / prior completed.
 */
function spyAsOfDateKeyForObservation(observationTs) {
  const when = observationTs instanceof Date ? observationTs : new Date(observationTs);
  if (Number.isNaN(when.getTime())) return null;
  const parts = etParts(when);
  if (isUsEquityTradingDay(when)) {
    const minutes = parts.hour * 60 + parts.minute;
    if (minutes < 16 * 60) return previousTradingDayKey(when);
    return parts.dateKey;
  }
  return previousTradingDayKey(when);
}

/** Walk calendar keys backward until a SPY bar exists (holidays / missing days). */
function findSpyCloseOnOrBefore(dateKey, spyIndex, maxLookback = 10) {
  if (!dateKey || !spyIndex?.byDate) return null;
  let key = dateKey;
  for (let i = 0; i < maxLookback; i++) {
    if (spyIndex.byDate.has(key)) {
      return { date: key, close: spyIndex.byDate.get(key) };
    }
    // step back one calendar day via noon-ET approximation
    const [y, m, d] = key.split('-').map(Number);
    const cursor = new Date(Date.UTC(y, m - 1, d, 17, 0, 0));
    cursor.setUTCDate(cursor.getUTCDate() - 1);
    key = tradingDateKeyEt(cursor);
  }
  return null;
}

function spyCloseForObservation(observationTs, spyIndex) {
  const asOfKey = spyAsOfDateKeyForObservation(observationTs);
  if (!asOfKey) return null;
  return findSpyCloseOnOrBefore(asOfKey, spyIndex);
}

function pctReturn(value, base) {
  const v = Number(value);
  const b = Number(base);
  if (!Number.isFinite(v) || !Number.isFinite(b) || b === 0) return null;
  return ((v / b) - 1) * 100;
}

/**
 * Build comparison series for a filtered portfolio snapshot list + SPY bars.
 */
function buildBenchmarkComparison({
  portfolioSnapshots = [],
  spyBars = [],
  maxGapMs = MAX_CONNECTED_GAP_MS
} = {}) {
  const ordered = [...(portfolioSnapshots || [])].sort(
    (a, b) => new Date(a.timestamp) - new Date(b.timestamp)
  );
  const spyIndex = indexSpyBars(spyBars);

  if (!spyIndex.firstDate) {
    return {
      ok: false,
      reason: 'benchmark_unavailable',
      message:
        'S&P 500 comparison data is temporarily unavailable. Please check back after the next market-data refresh.',
      portfolioSeries: [],
      spySeries: [],
      meta: { spyLabel: SPY_BENCHMARK_LABEL }
    };
  }

  if (ordered.length < 2) {
    return {
      ok: false,
      reason: 'insufficient_portfolio',
      message:
        'Need at least two recorded portfolio observations in this range to compare percentage returns.',
      portfolioSeries: [],
      spySeries: [],
      meta: {
        spyLabel: SPY_BENCHMARK_LABEL,
        spyFirstDate: spyIndex.firstDate,
        spyLastDate: spyIndex.lastDate
      }
    };
  }

  // Keep only observations that can align to a non-future SPY close within cached history
  const aligned = [];
  const excludedOlder = [];
  for (const snap of ordered) {
    const spy = spyCloseForObservation(snap.timestamp, spyIndex);
    if (!spy) {
      excludedOlder.push(snap);
      continue;
    }
    // SPY bar must not be after observation as-of key (already enforced) and must be in cache range
    aligned.push({ snap, spy });
  }

  if (aligned.length < 2) {
    return {
      ok: false,
      reason: 'insufficient_overlap',
      message:
        'Portfolio and SPY histories do not overlap enough for a fair comparison. Free-tier SPY history covers about the last 100 trading days — older portfolio points cannot be compared.',
      portfolioSeries: [],
      spySeries: [],
      meta: {
        spyLabel: SPY_BENCHMARK_LABEL,
        spyFirstDate: spyIndex.firstDate,
        spyLastDate: spyIndex.lastDate,
        excludedOlderCount: excludedOlder.length
      }
    };
  }

  const basePortfolio = Number(aligned[0].snap.portfolioValue);
  const baseSpy = aligned[0].spy.close;
  const baseTs = aligned[0].snap.timestamp;
  const baseSpyDate = aligned[0].spy.date;

  const portfolioSeries = aligned.map(({ snap, spy }) => {
    const y = pctReturn(snap.portfolioValue, basePortfolio);
    return {
      x: new Date(snap.timestamp).getTime(),
      y,
      meta: {
        ...snap,
        spyAsOfDate: spy.date,
        spyClose: spy.close,
        returnPct: y
      }
    };
  });

  // Dense daily SPY % from base SPY date through last aligned observation's as-of date
  const lastSpyDate = aligned[aligned.length - 1].spy.date;
  const spySeries = [];
  for (const date of spyIndex.dates) {
    if (date < baseSpyDate) continue;
    if (date > lastSpyDate) break;
    const close = spyIndex.byDate.get(date);
    const y = pctReturn(close, baseSpy);
    if (y == null) continue;
    // Plot at ET noon-ish for the session date (stable time-axis point)
    const [y0, m0, d0] = date.split('-').map(Number);
    const x = Date.UTC(y0, m0 - 1, d0, 21, 0, 0); // ~16:00 ET during EST
    spySeries.push({
      x,
      y,
      meta: { kind: 'spy_daily', date, close, returnPct: y }
    });
  }

  const excludedNote =
    excludedOlder.length > 0
      ? ` ${excludedOlder.length} older portfolio observation(s) fall outside available SPY history and were omitted from this comparison.`
      : '';

  return {
    ok: true,
    reason: null,
    message:
      `Both series start at 0% on the first overlapping observation (${tradingDateKeyEt(new Date(baseTs))}).${excludedNote}`.trim(),
    portfolioSeries,
    spySeries,
    meta: {
      spyLabel: SPY_BENCHMARK_LABEL,
      baseTimestamp: baseTs,
      baseSpyDate,
      basePortfolioValue: basePortfolio,
      baseSpyClose: baseSpy,
      spyFirstDate: spyIndex.firstDate,
      spyLastDate: spyIndex.lastDate,
      excludedOlderCount: excludedOlder.length,
      maxConnectedGapMs: maxGapMs,
      portfolioPointCount: portfolioSeries.length,
      spyPointCount: spySeries.length
    }
  };
}

/** Whether a portfolio compare segment should break (reuse 7-day policy). */
function portfolioCompareSegmentShouldBreak(fromMs, toMs, maxGapMs = MAX_CONNECTED_GAP_MS) {
  return chartSegmentShouldBreak(fromMs, toMs, maxGapMs);
}

module.exports = {
  SPY_BENCHMARK_LABEL,
  DAY_MS,
  parseAlphaDailySeries,
  indexSpyBars,
  spyAsOfDateKeyForObservation,
  findSpyCloseOnOrBefore,
  spyCloseForObservation,
  pctReturn,
  buildBenchmarkComparison,
  portfolioCompareSegmentShouldBreak
};
