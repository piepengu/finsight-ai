/**
 * Pure helpers for daily mark-to-market portfolio snapshots.
 * Never fabricates prices from avgCost; never writes partial valuations.
 */

'use strict';

const {
  isUsEquityTradingDay,
  isWeekendEt,
  isUsMarketHoliday,
  dailySnapshotDocId,
  tradingDateKeyEt,
  isQuoteFreshForDailyValuation
} = require('./marketCalendar');

/**
 * Alpha Vantage free tier (verified 2025 docs): 25 requests/day, 5/min.
 * Mag7 refresh already competes for this budget — daily job must be cache-first.
 */
const ALPHA_FREE_DAILY_LIMIT = 25;
/** Soft cap for *new* network quote fetches inside one daily job run */
const DEFAULT_DAILY_JOB_NETWORK_BUDGET = 5;

/**
 * @param {{ cashBalance: number, holdings: Array<{ symbol: string, shares: number }>, quotesBySymbol: Record<string, { price: number, asOf: string|Date, stale?: boolean }> }} input
 * @returns {{ ok: true, portfolioValue: number, cashBalance: number, legs: object[] } | { ok: false, reason: string, missingSymbols?: string[] }}
 */
function computeCompleteDailyValuation({ cashBalance, holdings, quotesBySymbol }) {
  const cash = Number(cashBalance);
  if (!Number.isFinite(cash)) {
    return { ok: false, reason: 'invalid_cash_balance' };
  }

  const list = Array.isArray(holdings) ? holdings : [];
  if (list.length === 0) {
    return {
      ok: true,
      portfolioValue: cash,
      cashBalance: cash,
      legs: [],
      complete: true
    };
  }

  const missingSymbols = [];
  const legs = [];
  let holdingsValue = 0;

  for (const h of list) {
    const symbol = String(h.symbol || '').toUpperCase();
    const shares = Number(h.shares);
    if (!symbol || !Number.isFinite(shares) || shares <= 0) {
      return { ok: false, reason: 'invalid_holding', missingSymbols: [symbol || '(unknown)'] };
    }
    const q = quotesBySymbol[symbol];
    const price = q != null ? Number(q.price) : NaN;
    if (!q || !Number.isFinite(price) || price <= 0) {
      missingSymbols.push(symbol);
      continue;
    }
    const value = shares * price;
    holdingsValue += value;
    legs.push({
      symbol,
      shares,
      price,
      value,
      marketDataAsOf: q.asOf || null
    });
  }

  if (missingSymbols.length > 0) {
    return {
      ok: false,
      reason: 'incomplete_quotes',
      missingSymbols,
      complete: false
    };
  }

  return {
    ok: true,
    complete: true,
    portfolioValue: cash + holdingsValue,
    cashBalance: cash,
    legs
  };
}

/** Decide whether the scheduled job should run on this calendar moment. */
function evaluateDailyScheduleGate(now = new Date()) {
  const dateKey = tradingDateKeyEt(now);
  if (!isUsEquityTradingDay(now)) {
    let reason = 'non_trading_day';
    if (isWeekendEt(now)) reason = 'weekend';
    else if (isUsMarketHoliday(now)) reason = 'holiday';
    return { run: false, reason, dateKey };
  }
  return { run: true, reason: 'trading_day', dateKey };
}

/**
 * Merge quote maps: prefer fresher asOf when both present.
 */
function mergeQuoteMaps(base, extra) {
  const out = { ...(base || {}) };
  for (const [sym, q] of Object.entries(extra || {})) {
    if (!q) continue;
    const prev = out[sym];
    if (!prev) {
      out[sym] = q;
      continue;
    }
    const prevT = new Date(prev.asOf || 0).getTime();
    const nextT = new Date(q.asOf || 0).getTime();
    if (nextT >= prevT) out[sym] = q;
  }
  return out;
}

/**
 * Build shared ticker list across users (unique uppercase symbols).
 */
function uniqueHoldingSymbols(usersHoldings) {
  const set = new Set();
  for (const holdings of usersHoldings) {
    for (const h of holdings || []) {
      const s = String(h.symbol || '').toUpperCase();
      if (s) set.add(s);
    }
  }
  return [...set].sort();
}

/**
 * Plan network fetches: only symbols missing from cacheQuotes.
 */
function planNetworkFetches(requiredSymbols, cacheQuotes, networkBudget = DEFAULT_DAILY_JOB_NETWORK_BUDGET) {
  const missing = requiredSymbols.filter((s) => {
    const q = cacheQuotes[s];
    return !(q && Number.isFinite(Number(q.price)) && Number(q.price) > 0);
  });
  const toFetch = missing.slice(0, Math.max(0, networkBudget));
  const stillMissing = missing.slice(toFetch.length);
  return { toFetch, stillMissing, missingCount: missing.length };
}

function buildDailySnapshotPayload({
  valuation,
  now = new Date(),
  quoteStatus = 'ok'
}) {
  const marketDataAsOf =
    valuation.legs.length > 0
      ? valuation.legs
          .map((l) => (l.marketDataAsOf ? new Date(l.marketDataAsOf).getTime() : 0))
          .reduce((a, b) => Math.max(a, b), 0)
      : now.getTime();

  return {
    kind: 'daily',
    cashBalance: valuation.cashBalance,
    portfolioValue: valuation.portfolioValue,
    quoteStatus,
    marketDataAsOf: new Date(marketDataAsOf || now).toISOString(),
    valuationDate: tradingDateKeyEt(now),
    legs: valuation.legs,
    // timestamp set by caller with serverTimestamp for Firestore ordering
  };
}

module.exports = {
  ALPHA_FREE_DAILY_LIMIT,
  DEFAULT_DAILY_JOB_NETWORK_BUDGET,
  computeCompleteDailyValuation,
  evaluateDailyScheduleGate,
  shouldRunDailyValuationJob: evaluateDailyScheduleGate,
  mergeQuoteMaps,
  uniqueHoldingSymbols,
  planNetworkFetches,
  buildDailySnapshotPayload,
  dailySnapshotDocId,
  isQuoteFreshForDailyValuation,
  tradingDateKeyEt
};
