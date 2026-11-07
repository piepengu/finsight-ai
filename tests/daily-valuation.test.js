/**
 * Phase 2 daily MTM + calendar + quote-cache planning tests.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  isUsEquityTradingDay,
  isUsMarketHoliday,
  isWeekendEt,
  dailySnapshotDocId,
  tradingDateKeyEt,
  isQuoteFreshForDailyValuation,
  etParts
} = require('../functions/lib/marketCalendar');
const {
  computeCompleteDailyValuation,
  evaluateDailyScheduleGate,
  uniqueHoldingSymbols,
  planNetworkFetches,
  mergeQuoteMaps,
  buildDailySnapshotPayload,
  ALPHA_FREE_DAILY_LIMIT,
  DEFAULT_DAILY_JOB_NETWORK_BUDGET
} = require('../functions/lib/dailyValuation');
const { quotesFromMag7Cache, quoteFromStockPriceCache } = require('../functions/lib/quoteResolve');
const { buildPortfolioHistoryResponse } = require('../functions/lib/portfolioHistory');

describe('API budget awareness', () => {
  it('documents free-tier daily limit (25) and conservative network budget', () => {
    assert.equal(ALPHA_FREE_DAILY_LIMIT, 25);
    assert.ok(DEFAULT_DAILY_JOB_NETWORK_BUDGET <= 5);
    assert.ok(DEFAULT_DAILY_JOB_NETWORK_BUDGET < ALPHA_FREE_DAILY_LIMIT);
  });
});

describe('market calendar', () => {
  it('treats Thanksgiving 2025 as a holiday (weekday but not a trading day)', () => {
    const thanksgiving = new Date('2025-11-27T20:00:00.000Z'); // afternoon ET
    assert.equal(isUsMarketHoliday(thanksgiving), true);
    assert.equal(isUsEquityTradingDay(thanksgiving), false);
    const gate = evaluateDailyScheduleGate(thanksgiving);
    assert.equal(gate.run, false);
    assert.equal(gate.reason, 'holiday');
  });

  it('skips weekends', () => {
    const sat = new Date('2026-11-07T18:00:00.000Z'); // Saturday
    assert.equal(isWeekendEt(sat), true);
    assert.equal(evaluateDailyScheduleGate(sat).run, false);
  });

  it('idempotent daily doc id is stable per ET date', () => {
    const d = new Date('2026-11-06T21:30:00.000Z'); // 4:30pm ET on Nov 6 2026
    assert.equal(dailySnapshotDocId(d), `daily_${tradingDateKeyEt(d)}`);
    assert.match(dailySnapshotDocId(d), /^daily_\d{4}-\d{2}-\d{2}$/);
  });
});

describe('computeCompleteDailyValuation', () => {
  it('values cash + holdings when all quotes present', () => {
    const result = computeCompleteDailyValuation({
      cashBalance: 4000,
      holdings: [
        { symbol: 'AAPL', shares: 2 },
        { symbol: 'MSFT', shares: 1 }
      ],
      quotesBySymbol: {
        AAPL: { price: 100, asOf: '2026-11-06T21:00:00.000Z' },
        MSFT: { price: 200, asOf: '2026-11-06T21:00:00.000Z' }
      }
    });
    assert.equal(result.ok, true);
    assert.equal(result.portfolioValue, 4000 + 200 + 200);
  });

  it('refuses partial valuation when a quote is missing (no avgPrice fallback)', () => {
    const result = computeCompleteDailyValuation({
      cashBalance: 4000,
      holdings: [
        { symbol: 'AAPL', shares: 2 },
        { symbol: 'MSFT', shares: 1 }
      ],
      quotesBySymbol: {
        AAPL: { price: 100, asOf: '2026-11-06T21:00:00.000Z' }
      }
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'incomplete_quotes');
    assert.deepEqual(result.missingSymbols, ['MSFT']);
  });

  it('allows cash-only portfolios without quotes', () => {
    const result = computeCompleteDailyValuation({
      cashBalance: 10000,
      holdings: [],
      quotesBySymbol: {}
    });
    assert.equal(result.ok, true);
    assert.equal(result.portfolioValue, 10000);
  });
});

describe('shared quote cache across users', () => {
  it('dedupes tickers across multiple users', () => {
    const symbols = uniqueHoldingSymbols([
      [{ symbol: 'AAPL', shares: 1 }, { symbol: 'MSFT', shares: 1 }],
      [{ symbol: 'aapl', shares: 3 }, { symbol: 'TSLA', shares: 1 }]
    ]);
    assert.deepEqual(symbols, ['AAPL', 'MSFT', 'TSLA']);
  });

  it('plans network fetches only for cache misses within budget', () => {
    const plan = planNetworkFetches(
      ['AAPL', 'MSFT', 'TSLA', 'NVDA'],
      { AAPL: { price: 1, asOf: '2026-11-06T20:00:00.000Z' } },
      2
    );
    assert.deepEqual(plan.toFetch, ['MSFT', 'TSLA']);
    assert.deepEqual(plan.stillMissing, ['NVDA']);
  });

  it('merges Mag7 cache quotes when fresh', () => {
    const now = new Date('2026-11-06T21:30:00.000Z');
    const quotes = quotesFromMag7Cache(
      {
        timestamp: new Date('2026-11-06T20:00:00.000Z'),
        stocks: [{ symbol: 'AAPL', price: 190.5 }]
      },
      now,
      8 * 60 * 60 * 1000
    );
    assert.equal(quotes.AAPL.price, 190.5);
    assert.equal(quotes.AAPL.source, 'mag7_cache');
  });

  it('rejects stale Mag7 cache from a prior session day', () => {
    const now = new Date('2026-11-06T21:30:00.000Z');
    const quotes = quotesFromMag7Cache(
      {
        timestamp: new Date('2026-11-05T20:00:00.000Z'),
        stocks: [{ symbol: 'AAPL', price: 190.5 }]
      },
      now,
      8 * 60 * 60 * 1000
    );
    assert.equal(Object.keys(quotes).length, 0);
  });
});

describe('idempotent daily snapshot payload', () => {
  it('tags kind=daily and keeps trade snapshots conceptually separate', () => {
    const valuation = computeCompleteDailyValuation({
      cashBalance: 10000,
      holdings: [],
      quotesBySymbol: {}
    });
    const payload = buildDailySnapshotPayload({
      valuation,
      now: new Date('2026-11-06T21:30:00.000Z')
    });
    assert.equal(payload.kind, 'daily');
    assert.equal(payload.quoteStatus, 'ok');
    assert.ok(payload.valuationDate);
  });

  it('duplicate run model: same doc id for same ET day', () => {
    const a = dailySnapshotDocId(new Date('2026-11-06T21:30:00.000Z'));
    const b = dailySnapshotDocId(new Date('2026-11-06T22:00:00.000Z'));
    assert.equal(a, b);
  });
});

describe('Phase 1 live point must not plot incomplete valuations', () => {
  it('omits live point when caller passes null (incomplete quotes)', () => {
    const { snapshots, meta } = buildPortfolioHistoryResponse({
      storedSnapshots: [
        { timestamp: '2026-11-05T12:00:00.000Z', portfolioValue: 10000, cashBalance: 10000 }
      ],
      livePoint: null
    });
    assert.equal(snapshots.length, 1);
    assert.equal(meta.liveAttached, false);
  });

  it('attaches live only when complete', () => {
    const { snapshots, meta } = buildPortfolioHistoryResponse({
      storedSnapshots: [
        { timestamp: '2026-11-05T12:00:00.000Z', portfolioValue: 10000, cashBalance: 10000 }
      ],
      livePoint: {
        timestamp: '2026-11-06T21:00:00.000Z',
        portfolioValue: 10100,
        cashBalance: 5000,
        quoteStatus: 'ok'
      }
    });
    assert.equal(meta.liveAttached, true);
    assert.equal(snapshots[snapshots.length - 1].source, 'live');
  });
});

describe('quote freshness helper', () => {
  it('accepts same-day quote within max age', () => {
    const now = new Date('2026-11-06T21:30:00.000Z');
    const asOf = new Date('2026-11-06T18:00:00.000Z');
    assert.equal(isQuoteFreshForDailyValuation(asOf, now, 8 * 60 * 60 * 1000), true);
  });

  it('reads stock_price cache helper', () => {
    const now = new Date('2026-11-06T21:30:00.000Z');
    const q = quoteFromStockPriceCache(
      'MSFT',
      { price: 400, timestamp: new Date('2026-11-06T20:00:00.000Z') },
      now,
      8 * 60 * 60 * 1000
    );
    assert.equal(q.price, 400);
    assert.equal(q.source, 'stock_price_cache');
  });
});
