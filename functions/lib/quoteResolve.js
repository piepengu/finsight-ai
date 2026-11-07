/**
 * Shared ticker quote resolution for daily valuation (cache-first).
 * Sources: Mag7 cache doc, per-symbol stock_price_* cache, optional network.
 */

'use strict';

const { isQuoteFreshForDailyValuation, tradingDateKeyEt } = require('./marketCalendar');

/**
 * Extract usable quotes from Mag7 cache document data.
 */
function quotesFromMag7Cache(mag7Data, now = new Date(), maxAgeMs) {
  const out = {};
  if (!mag7Data || !Array.isArray(mag7Data.stocks)) return out;
  const asOf = mag7Data.timestamp?.toDate
    ? mag7Data.timestamp.toDate()
    : mag7Data.timestamp
      ? new Date(mag7Data.timestamp)
      : null;

  // Prefer explicit sessionDate from the hybrid EOD cache; fall back to timestamp freshness.
  const sessionOk =
    mag7Data.sessionDate &&
    asOf &&
    mag7Data.sessionDate === tradingDateKeyEt(now);
  if (!sessionOk && !isQuoteFreshForDailyValuation(asOf, now, maxAgeMs)) return out;
  if (!asOf) return out;

  for (const s of mag7Data.stocks) {
    const symbol = String(s.symbol || '').toUpperCase();
    const price = Number(s.price);
    if (!symbol || !Number.isFinite(price) || price <= 0) continue;
    out[symbol] = {
      price,
      asOf: asOf.toISOString(),
      source: 'mag7_cache'
    };
  }
  return out;
}

/**
 * Extract quote from stock_price_{SYMBOL} cache doc if fresh for daily valuation.
 */
function quoteFromStockPriceCache(symbol, cachedData, now = new Date(), maxAgeMs) {
  if (!cachedData || cachedData.price == null) return null;
  const price = Number(cachedData.price);
  if (!Number.isFinite(price) || price <= 0) return null;
  const asOf = cachedData.timestamp?.toDate
    ? cachedData.timestamp.toDate()
    : cachedData.timestamp
      ? new Date(cachedData.timestamp)
      : null;
  if (!isQuoteFreshForDailyValuation(asOf, now, maxAgeMs)) return null;
  return {
    price,
    asOf: asOf.toISOString(),
    source: 'stock_price_cache'
  };
}

module.exports = {
  quotesFromMag7Cache,
  quoteFromStockPriceCache
};
