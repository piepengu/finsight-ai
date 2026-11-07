/**
 * Session-aware Mag7 / quote cache helpers (pure).
 * Educational app: prices are delayed / end-of-day, never advertised as real-time.
 */

'use strict';

const { latestCompletedSessionDateKey, tradingDateKeyEt } = require('./marketCalendar');

const MAG7_SYMBOLS = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA'];

function mag7Fingerprint(stocks) {
  const list = Array.isArray(stocks) ? stocks : [];
  return list
    .map((s) => {
      const sym = String(s.symbol || '').toUpperCase();
      const price = Number(s.price);
      const ch = Number(s.changePercent);
      return `${sym}:${Number.isFinite(price) ? price.toFixed(4) : 'x'}:${Number.isFinite(ch) ? ch.toFixed(4) : 'x'}`;
    })
    .sort()
    .join('|');
}

function stocksBySymbol(stocks) {
  const map = new Map();
  for (const s of stocks || []) {
    const sym = String(s?.symbol || '').toUpperCase();
    if (sym) map.set(sym, s);
  }
  return map;
}

function missingMag7Symbols(stocks, required = MAG7_SYMBOLS) {
  const have = stocksBySymbol(stocks);
  return required.filter((sym) => {
    const row = have.get(sym);
    const price = row != null ? Number(row.price) : NaN;
    return !(row && Number.isFinite(price) && price > 0);
  });
}

/**
 * Cache represents the latest completed session when sessionDate matches and Mag7 is complete.
 */
function mag7CacheCoversSession(cacheData, sessionDateKey, required = MAG7_SYMBOLS) {
  if (!cacheData || !sessionDateKey) return false;
  if (cacheData.sessionDate !== sessionDateKey) return false;
  return missingMag7Symbols(cacheData.stocks, required).length === 0;
}

/**
 * Decide whether an on-demand Mag7 network refresh should run.
 */
function shouldRefreshMag7OnDemand(cacheData, now = new Date(), required = MAG7_SYMBOLS) {
  const sessionDateKey = latestCompletedSessionDateKey(now);

  if (mag7CacheCoversSession(cacheData, sessionDateKey, required)) {
    return {
      refresh: false,
      reason: 'session_cache_hit',
      sessionDateKey,
      missingSymbols: []
    };
  }

  const missingSymbols = missingMag7Symbols(cacheData?.stocks, required);
  const attemptedSameSession = cacheData?.lastFetchAttemptSession === sessionDateKey;

  // Complete for a different/older session → need a full refill for the new session
  const needSymbols =
    missingSymbols.length > 0
      ? missingSymbols
      : [...required];

  // Already attempted this session with a complete set that somehow failed session tagging —
  // or attempted and still incomplete: allow retry only if still missing symbols.
  if (attemptedSameSession && missingSymbols.length === 0 && cacheData?.sessionDate === sessionDateKey) {
    return {
      refresh: false,
      reason: 'already_fetched_session',
      sessionDateKey,
      missingSymbols: []
    };
  }

  // Provider had no newer quote: same fingerprint after a prior attempt for this session
  if (
    attemptedSameSession &&
    cacheData?.lastFetchFingerprint &&
    cacheData?.dataFingerprint &&
    cacheData.lastFetchFingerprint === cacheData.dataFingerprint &&
    missingSymbols.length === 0
  ) {
    return {
      refresh: false,
      reason: 'no_newer_quote',
      sessionDateKey,
      missingSymbols: []
    };
  }

  return {
    refresh: true,
    reason: missingSymbols.length > 0 ? 'incomplete_or_missing' : 'stale_session',
    sessionDateKey,
    missingSymbols: needSymbols
  };
}

/**
 * Build user-facing market data labels. Never claim real-time.
 */
function buildMarketDataLabels({
  now = new Date(),
  sessionDateKey,
  asOfIso,
  cached = true,
  partial = false,
  quotaExhausted = false,
  source = 'cache'
} = {}) {
  const session = sessionDateKey || latestCompletedSessionDateKey(now);
  const asOf = asOfIso || null;

  let freshness = 'delayed_eod';
  let summary = `Delayed end-of-day prices for session ${session} (not real-time).`;

  if (quotaExhausted) {
    freshness = 'quota_cached';
    summary = `API daily budget reached — showing last available prices (session ${session}).`;
  } else if (partial) {
    freshness = 'partial_cached';
    summary = `Partial Mag7 set for session ${session} — some symbols unavailable.`;
  } else if (source === 'network') {
    freshness = 'delayed_eod';
    summary = `Updated from market data provider (delayed / end-of-day, session ${session}).`;
  } else if (cached) {
    freshness = 'cached_session';
    summary = `Cached prices from the latest completed market session (${session}).`;
  }

  return {
    freshness,
    summary,
    sessionDate: session,
    asOf,
    realtime: false,
    delayed: true
  };
}

function describeCacheAge(asOfIso, now = new Date()) {
  if (!asOfIso) return null;
  const t = new Date(asOfIso).getTime();
  if (Number.isNaN(t)) return null;
  const ageMs = Math.max(0, now.getTime() - t);
  const ageMinutes = Math.round(ageMs / 60000);
  return { ageMs, ageMinutes, asOf: asOfIso, asOfEtDate: tradingDateKeyEt(new Date(t)) };
}

module.exports = {
  MAG7_SYMBOLS,
  mag7Fingerprint,
  missingMag7Symbols,
  mag7CacheCoversSession,
  shouldRefreshMag7OnDemand,
  buildMarketDataLabels,
  describeCacheAge
};
