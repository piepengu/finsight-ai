/**
 * Pure helpers for FinSight AI — safe to unit-test in Node.
 * Loaded before app.js in the browser (attaches to globalThis.FinSightCore).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  root.FinSightCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function parseMoneyText(text) {
    const cleaned = String(text || '').replace(/[^0-9.-]/g, '');
    const n = parseFloat(cleaned);
    return Number.isFinite(n) ? n : 0;
  }

  function computePortfolioTotals(cashBalance, holdingsMarketValue) {
    const cash = Number(cashBalance);
    const holdings = Number(holdingsMarketValue);
    const safeCash = Number.isFinite(cash) ? cash : 0;
    const safeHoldings = Number.isFinite(holdings) ? holdings : 0;
    const totalValue = safeCash + safeHoldings;
    const startingCapital = 10000;
    return {
      cash: safeCash,
      holdingsMarketValue: safeHoldings,
      totalValue,
      startingCapital,
      totalPL: totalValue - startingCapital
    };
  }

  function holdingsCostBasis(holdings) {
    if (!Array.isArray(holdings) || holdings.length === 0) return 0;
    return holdings.reduce((sum, h) => {
      const cost = Number(h.totalCost);
      if (Number.isFinite(cost)) return sum + cost;
      const shares = Number(h.shares) || 0;
      const avg = Number(h.avgPrice) || 0;
      return sum + shares * avg;
    }, 0);
  }

  /** Incrementing generation token — stale async work must bail when ids differ. */
  function createGenerationTracker() {
    let current = 0;
    return {
      next() {
        current += 1;
        return current;
      },
      isCurrent(id) {
        return id === current;
      },
      invalidate() {
        current += 1;
        return current;
      },
      get current() {
        return current;
      }
    };
  }

  function formatCompanyHeading(companyName, symbol) {
    const name = String(companyName || '').trim();
    const sym = String(symbol || '').trim().toUpperCase();
    if (!name && !sym) return '';
    if (!sym) return name;
    if (!name) return sym;
    const nameUpper = name.toUpperCase();
    if (nameUpper === sym) return sym;
    // Already "Something (SYM)" or just ends with (SYM)
    if (nameUpper.endsWith(`(${sym})`)) return name;
    return `${name} (${sym})`;
  }

  /**
   * Bounded poll until predicate is true or timeout.
   * @returns {Promise<boolean>}
   */
  function waitUntil(predicate, { timeoutMs = 10000, intervalMs = 50 } = {}) {
    return new Promise((resolve) => {
      const start = Date.now();
      const tick = () => {
        try {
          if (predicate()) {
            resolve(true);
            return;
          }
        } catch (_) { /* keep waiting */ }
        if (Date.now() - start >= timeoutMs) {
          resolve(false);
          return;
        }
        setTimeout(tick, intervalMs);
      };
      tick();
    });
  }

  const DAY_MS = 24 * 60 * 60 * 1000;
  /** Do not draw chart segments across gaps longer than this. */
  const MAX_CONNECTED_GAP_MS = 7 * DAY_MS;

  const DEFAULT_CHART_RANGE_MS = {
    '1W': 7 * DAY_MS,
    '1M': 30 * DAY_MS,
    '3M': 90 * DAY_MS,
    ALL: null
  };

  function filterSnapshotsByRange(snapshots, range, rangeMsMap = DEFAULT_CHART_RANGE_MS) {
    if (!snapshots?.length) return [];
    const ordered = [...snapshots].sort(
      (a, b) => new Date(a.timestamp) - new Date(b.timestamp)
    );
    const ms = rangeMsMap[range];
    if (!ms) return ordered;
    const latest = new Date(ordered[ordered.length - 1].timestamp).getTime();
    const cutoff = latest - ms;
    return ordered.filter((s) => new Date(s.timestamp).getTime() >= cutoff);
  }

  function analyzeObservationGaps(snapshots, maxGapMs = MAX_CONNECTED_GAP_MS) {
    const ordered = [...(snapshots || [])].sort(
      (a, b) => new Date(a.timestamp) - new Date(b.timestamp)
    );
    let maxGapMsFound = 0;
    let longGapCount = 0;

    for (let i = 1; i < ordered.length; i++) {
      const prev = new Date(ordered[i - 1].timestamp).getTime();
      const next = new Date(ordered[i].timestamp).getTime();
      if (!Number.isFinite(prev) || !Number.isFinite(next)) continue;
      const gap = Math.max(0, next - prev);
      if (gap > maxGapMsFound) maxGapMsFound = gap;
      if (gap > maxGapMs) longGapCount += 1;
    }

    return {
      pointCount: ordered.length,
      maxGapMs: maxGapMsFound,
      maxGapDays: maxGapMsFound > 0 ? Math.round(maxGapMsFound / DAY_MS) : 0,
      longGapCount,
      hasLongGaps: longGapCount > 0,
      maxConnectedGapMs: maxGapMs
    };
  }

  function chartSegmentShouldBreak(fromMs, toMs, maxGapMs = MAX_CONNECTED_GAP_MS) {
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return false;
    return Math.abs(toMs - fromMs) > maxGapMs;
  }

  function formatLongGapMessage(count, gapInfo) {
    const days = Math.max(8, gapInfo.maxGapDays || Math.round(gapInfo.maxGapMs / DAY_MS));
    if (gapInfo.maxGapMs >= 60 * DAY_MS) {
      const months = Math.max(2, Math.round(gapInfo.maxGapMs / (30 * DAY_MS)));
      return `${count} recorded observations. Longest unmeasured gap ~${months} months — lines do not connect across gaps over 7 days.`;
    }
    return `${count} recorded observations. Longest unmeasured gap ~${days} days — lines do not connect across gaps over 7 days.`;
  }

  function describeSnapshotKind(point) {
    const p = point || {};
    if (p.source === 'live' || p.kind === 'live') {
      return 'Live portfolio estimate';
    }
    switch (p.kind) {
      case 'init':
        return 'Account initialization';
      case 'trade':
        return 'Trade snapshot';
      case 'daily':
        return 'Daily valuation';
      case 'stored':
        return 'Recorded snapshot';
      default:
        return p.kind ? `Recorded snapshot (${p.kind})` : 'Recorded snapshot';
    }
  }

  function assessChartRange(snapshots, range, rangeMsMap = DEFAULT_CHART_RANGE_MS) {
    const filtered = filterSnapshotsByRange(snapshots, range, rangeMsMap);
    const count = filtered.length;
    const gaps = analyzeObservationGaps(filtered);

    if (count === 0) {
      return {
        ok: false,
        sparse: true,
        pointCount: 0,
        filtered,
        gaps,
        message: 'No recorded portfolio snapshots in this range yet.'
      };
    }
    if (count === 1) {
      return {
        ok: false,
        sparse: true,
        pointCount: 1,
        filtered,
        gaps,
        message:
          'Only one snapshot in this range. Lines between trades are not measured daily values — make another trade or wait for a daily valuation to see change over time.'
      };
    }

    const first = new Date(filtered[0].timestamp).getTime();
    const last = new Date(filtered[filtered.length - 1].timestamp).getTime();
    const span = Math.max(0, last - first);
    const expected = rangeMsMap[range];

    if (gaps.hasLongGaps) {
      return {
        ok: true,
        sparse: true,
        pointCount: count,
        filtered,
        gaps,
        message: formatLongGapMessage(count, gaps)
      };
    }

    if (expected && span < expected * 0.35) {
      const days = Math.max(1, Math.round(span / DAY_MS));
      return {
        ok: true,
        sparse: true,
        pointCount: count,
        filtered,
        gaps,
        message: `${count} recorded snapshots spanning about ${days} day(s). This is less history than the ${range} window — gaps are unmeasured, not proven flat performance.`
      };
    }

    if (count < 3) {
      return {
        ok: true,
        sparse: true,
        pointCount: count,
        filtered,
        gaps,
        message: `${count} recorded snapshots. Chart connects observations only; values between points were not recorded.`
      };
    }

    return { ok: true, sparse: false, pointCount: count, filtered, gaps, message: '' };
  }

  const SPY_BENCHMARK_LABEL =
    'SPY (S&P 500 ETF proxy) — unadjusted closing prices, not the exact S&P 500 total return';

  function etPartsCore(date) {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
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
      dateKey: `${parts.year}-${parts.month}-${parts.day}`,
      weekday: parts.weekday,
      hour: Number(parts.hour),
      minute: Number(parts.minute)
    };
  }

  function tradingDateKeyEtCore(date) {
    return etPartsCore(date).dateKey;
  }

  function previousTradingDayKeyCore(from) {
    let cursor = new Date(from.getTime());
    for (let i = 0; i < 14; i++) {
      cursor = new Date(cursor.getTime() - DAY_MS);
      const p = etPartsCore(cursor);
      if (p.weekday !== 'Sat' && p.weekday !== 'Sun') return p.dateKey;
    }
    return etPartsCore(cursor).dateKey;
  }

  function spyAsOfDateKeyForObservation(observationTs) {
    const when = observationTs instanceof Date ? observationTs : new Date(observationTs);
    if (Number.isNaN(when.getTime())) return null;
    const parts = etPartsCore(when);
    const isWeekend = parts.weekday === 'Sat' || parts.weekday === 'Sun';
    if (!isWeekend) {
      const minutes = parts.hour * 60 + parts.minute;
      if (minutes < 16 * 60) return previousTradingDayKeyCore(when);
      return parts.dateKey;
    }
    return previousTradingDayKeyCore(when);
  }

  function indexSpyBars(bars) {
    const byDate = new Map();
    for (const b of bars || []) {
      if (b?.date && Number.isFinite(Number(b.close))) byDate.set(b.date, Number(b.close));
    }
    const dates = [...byDate.keys()].sort();
    return { byDate, dates, firstDate: dates[0] || null, lastDate: dates[dates.length - 1] || null };
  }

  function findSpyCloseOnOrBefore(dateKey, spyIndex, maxLookback) {
    if (!dateKey || !spyIndex?.byDate) return null;
    let key = dateKey;
    const limit = maxLookback == null ? 10 : maxLookback;
    for (let i = 0; i < limit; i++) {
      if (spyIndex.byDate.has(key)) return { date: key, close: spyIndex.byDate.get(key) };
      const [y, m, d] = key.split('-').map(Number);
      const cursor = new Date(Date.UTC(y, m - 1, d, 17, 0, 0));
      cursor.setUTCDate(cursor.getUTCDate() - 1);
      key = tradingDateKeyEtCore(cursor);
    }
    return null;
  }

  function pctReturn(value, base) {
    const v = Number(value);
    const b = Number(base);
    if (!Number.isFinite(v) || !Number.isFinite(b) || b === 0) return null;
    return ((v / b) - 1) * 100;
  }

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

    const aligned = [];
    const excludedOlder = [];
    for (const snap of ordered) {
      const asOfKey = spyAsOfDateKeyForObservation(snap.timestamp);
      const spy = findSpyCloseOnOrBefore(asOfKey, spyIndex);
      if (!spy) {
        excludedOlder.push(snap);
        continue;
      }
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

    const lastSpyDate = aligned[aligned.length - 1].spy.date;
    const spySeries = [];
    for (const date of spyIndex.dates) {
      if (date < baseSpyDate) continue;
      if (date > lastSpyDate) break;
      const close = spyIndex.byDate.get(date);
      const y = pctReturn(close, baseSpy);
      if (y == null) continue;
      const [y0, m0, d0] = date.split('-').map(Number);
      const x = Date.UTC(y0, m0 - 1, d0, 21, 0, 0);
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
        `Both series start at 0% on the first overlapping observation (${tradingDateKeyEtCore(new Date(baseTs))}).${excludedNote}`.trim(),
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

  return {
    parseMoneyText,
    computePortfolioTotals,
    holdingsCostBasis,
    createGenerationTracker,
    formatCompanyHeading,
    waitUntil,
    DAY_MS,
    MAX_CONNECTED_GAP_MS,
    DEFAULT_CHART_RANGE_MS,
    SPY_BENCHMARK_LABEL,
    filterSnapshotsByRange,
    analyzeObservationGaps,
    chartSegmentShouldBreak,
    describeSnapshotKind,
    formatLongGapMessage,
    assessChartRange,
    buildBenchmarkComparison,
    pctReturn,
    spyAsOfDateKeyForObservation
  };
});
