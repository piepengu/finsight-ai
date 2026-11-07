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

  const DEFAULT_CHART_RANGE_MS = {
    '1W': 7 * 24 * 60 * 60 * 1000,
    '1M': 30 * 24 * 60 * 60 * 1000,
    '3M': 90 * 24 * 60 * 60 * 1000,
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

  function assessChartRange(snapshots, range, rangeMsMap = DEFAULT_CHART_RANGE_MS) {
    const filtered = filterSnapshotsByRange(snapshots, range, rangeMsMap);
    const count = filtered.length;
    if (count === 0) {
      return {
        ok: false,
        sparse: true,
        pointCount: 0,
        filtered,
        message: 'No recorded portfolio snapshots in this range yet.'
      };
    }
    if (count === 1) {
      return {
        ok: false,
        sparse: true,
        pointCount: 1,
        filtered,
        message:
          'Only one snapshot in this range. The chart shows recorded observations only — not daily market marks between trades.'
      };
    }

    const first = new Date(filtered[0].timestamp).getTime();
    const last = new Date(filtered[filtered.length - 1].timestamp).getTime();
    const span = Math.max(0, last - first);
    const expected = rangeMsMap[range];

    if (expected && span < expected * 0.35) {
      const days = Math.max(1, Math.round(span / (24 * 60 * 60 * 1000)));
      return {
        ok: true,
        sparse: true,
        pointCount: count,
        filtered,
        message: `${count} recorded snapshots spanning about ${days} day(s). Less history than the ${range} window — gaps are unmeasured, not proven flat performance.`
      };
    }

    if (count < 3) {
      return {
        ok: true,
        sparse: true,
        pointCount: count,
        filtered,
        message: `${count} recorded snapshots. Lines connect observations only; values between points were not recorded.`
      };
    }

    return { ok: true, sparse: false, pointCount: count, filtered, message: '' };
  }

  return {
    parseMoneyText,
    computePortfolioTotals,
    holdingsCostBasis,
    createGenerationTracker,
    formatCompanyHeading,
    waitUntil,
    DEFAULT_CHART_RANGE_MS,
    filterSnapshotsByRange,
    assessChartRange
  };
});
