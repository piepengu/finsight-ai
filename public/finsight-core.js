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
    filterSnapshotsByRange,
    analyzeObservationGaps,
    chartSegmentShouldBreak,
    describeSnapshotKind,
    formatLongGapMessage,
    assessChartRange
  };
});
