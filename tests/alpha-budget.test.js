/**
 * Shared Alpha Vantage daily budget + Mag7 session cache policy tests.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  ALPHA_PROVIDER_DAILY_LIMIT,
  ALPHA_SOFT_DAILY_LIMIT,
  ALPHA_INTERACTIVE_RESERVE,
  ALPHA_SCHEDULED_MAG7_MAX,
  ALPHA_ONDEMAND_MAG7_MAX,
  ALPHA_PORTFOLIO_NETWORK_MAX,
  CATEGORY_SCHEDULED_MAG7,
  CATEGORY_ONDEMAND_MAG7,
  CATEGORY_PORTFOLIO,
  CATEGORY_INTERACTIVE,
  emptyBudgetState,
  remainingForCategory,
  planBudgetReservation,
  applyBudgetReservation,
  resolveConcurrentReservations,
  expectedDailyUsageBands,
  budgetDocId
} = require('../functions/lib/alphaBudget');
const {
  latestCompletedSessionDateKey,
  isUsEquityTradingDay,
  evaluateDailyScheduleGate
} = (() => {
  const cal = require('../functions/lib/marketCalendar');
  const { evaluateDailyScheduleGate } = require('../functions/lib/dailyValuation');
  return { ...cal, evaluateDailyScheduleGate };
})();
const {
  mag7CacheCoversSession,
  shouldRefreshMag7OnDemand,
  buildMarketDataLabels,
  mag7Fingerprint,
  missingMag7Symbols
} = require('../functions/lib/sessionQuotes');

describe('shared Alpha budget constants', () => {
  it('keeps a safety margin under the provider free-tier limit', () => {
    assert.equal(ALPHA_PROVIDER_DAILY_LIMIT, 25);
    assert.ok(ALPHA_SOFT_DAILY_LIMIT < ALPHA_PROVIDER_DAILY_LIMIT);
    assert.ok(ALPHA_INTERACTIVE_RESERVE >= 5);
    assert.equal(
      ALPHA_SOFT_DAILY_LIMIT - ALPHA_INTERACTIVE_RESERVE,
      12,
      'market pool should leave interactive headroom'
    );
  });

  it('documents expected daily usage bands for deployment reviews', () => {
    const bands = expectedDailyUsageBands();
    assert.ok(bands.scheduledMag7Max <= ALPHA_SCHEDULED_MAG7_MAX);
    assert.ok(bands.portfolioNetworkMax <= ALPHA_PORTFOLIO_NETWORK_MAX);
    assert.ok(bands.onDemandMag7Max <= ALPHA_ONDEMAND_MAG7_MAX);
  });

  it('uses ET date keys for budget documents', () => {
    const d = new Date('2026-11-06T21:30:00.000Z'); // 4:30pm ET
    assert.match(budgetDocId(d), /^alpha_budget_\d{4}-\d{2}-\d{2}$/);
  });
});

describe('budget reservation planning', () => {
  it('allows scheduled Mag7 up to the market pool only', () => {
    const state = emptyBudgetState(new Date('2026-11-06T21:30:00.000Z'));
    const plan = planBudgetReservation(state, CATEGORY_SCHEDULED_MAG7, 7);
    assert.equal(plan.ok, true);
    assert.equal(plan.grant, 7);
    const after = applyBudgetReservation(state, CATEGORY_SCHEDULED_MAG7, plan.grant);
    assert.equal(after.used, 7);
    assert.equal(remainingForCategory(after, CATEGORY_SCHEDULED_MAG7), 5);
    assert.equal(remainingForCategory(after, CATEGORY_INTERACTIVE), ALPHA_SOFT_DAILY_LIMIT - 7);
  });

  it('blocks market fetches once the interactive reserve would be breached', () => {
    let state = emptyBudgetState();
    state = applyBudgetReservation(state, CATEGORY_SCHEDULED_MAG7, 7);
    state = applyBudgetReservation(state, CATEGORY_PORTFOLIO, 5);
    assert.equal(state.used, 12);
    const blocked = planBudgetReservation(state, CATEGORY_ONDEMAND_MAG7, 3);
    assert.equal(blocked.ok, false);
    assert.equal(blocked.grant, 0);
    // Interactive may still spend into the reserve
    const interactive = planBudgetReservation(state, CATEGORY_INTERACTIVE, 3);
    assert.equal(interactive.ok, true);
    assert.equal(interactive.grant, 3);
  });

  it('enforces soft limit for interactive callers', () => {
    let state = emptyBudgetState();
    state = applyBudgetReservation(state, CATEGORY_INTERACTIVE, ALPHA_SOFT_DAILY_LIMIT);
    const denied = planBudgetReservation(state, CATEGORY_INTERACTIVE, 1);
    assert.equal(denied.ok, false);
  });

  it('serializes concurrent Mag7 on-demand attempts without overspending', () => {
    const state = emptyBudgetState();
    // Market pool is 12; two visitors each want 7 Mag7 fills
    const { state: next, results } = resolveConcurrentReservations(state, [
      { category: CATEGORY_ONDEMAND_MAG7, requestCount: 7 },
      { category: CATEGORY_ONDEMAND_MAG7, requestCount: 7 }
    ]);
    assert.equal(results[0].ok, true);
    assert.equal(results[0].grant, 7);
    assert.equal(results[1].ok, true);
    assert.equal(results[1].grant, 5); // remaining market pool
    assert.equal(next.used, 12);
  });

  it('does not let a second concurrent claim exceed the soft limit', () => {
    let state = emptyBudgetState();
    state = applyBudgetReservation(state, CATEGORY_INTERACTIVE, 18);
    const { results } = resolveConcurrentReservations(state, [
      { category: CATEGORY_INTERACTIVE, requestCount: 3 },
      { category: CATEGORY_INTERACTIVE, requestCount: 3 }
    ]);
    assert.equal(results[0].grant, 2);
    assert.equal(results[1].ok, false);
    assert.equal(results[1].grant, 0);
  });
});

describe('latest completed session + holidays', () => {
  it('before the close on a trading day, latest completed session is the prior trading day', () => {
    // Friday Nov 6 2026 10:00 ET = 15:00 UTC
    const morning = new Date('2026-11-06T15:00:00.000Z');
    assert.equal(isUsEquityTradingDay(morning), true);
    assert.equal(latestCompletedSessionDateKey(morning), '2026-11-05');
  });

  it('after the close on a trading day, latest completed session is today', () => {
    const afterClose = new Date('2026-11-06T21:30:00.000Z'); // 4:30pm ET
    assert.equal(latestCompletedSessionDateKey(afterClose), '2026-11-06');
  });

  it('on weekends and holidays, reuses the previous trading session', () => {
    const saturday = new Date('2026-11-07T18:00:00.000Z');
    assert.equal(latestCompletedSessionDateKey(saturday), '2026-11-06');
    const thanksgiving = new Date('2025-11-27T20:00:00.000Z');
    assert.equal(evaluateDailyScheduleGate(thanksgiving).run, false);
    assert.equal(latestCompletedSessionDateKey(thanksgiving), '2025-11-26');
  });
});

describe('Mag7 session cache reuse', () => {
  const completeStocks = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA'].map((symbol) => ({
    symbol,
    price: 100,
    changePercent: 1
  }));

  it('reuses cache when the completed session is already represented', () => {
    const now = new Date('2026-11-06T22:00:00.000Z');
    const cache = {
      stocks: completeStocks,
      sessionDate: '2026-11-06',
      dataFingerprint: mag7Fingerprint(completeStocks)
    };
    assert.equal(mag7CacheCoversSession(cache, '2026-11-06'), true);
    const decision = shouldRefreshMag7OnDemand(cache, now);
    assert.equal(decision.refresh, false);
    assert.equal(decision.reason, 'session_cache_hit');
  });

  it('skips repeated visits after a same-session fetch when provider has no newer quote', () => {
    const now = new Date('2026-11-08T15:00:00.000Z'); // Sunday afternoon ET-ish
    const session = latestCompletedSessionDateKey(now);
    const cache = {
      stocks: completeStocks,
      sessionDate: session,
      lastFetchAttemptSession: session,
      dataFingerprint: mag7Fingerprint(completeStocks),
      lastFetchFingerprint: mag7Fingerprint(completeStocks)
    };
    const decision = shouldRefreshMag7OnDemand(cache, now);
    assert.equal(decision.refresh, false);
  });

  it('requests a refresh when Mag7 symbols are missing', () => {
    const now = new Date('2026-11-06T22:00:00.000Z');
    const cache = {
      stocks: completeStocks.slice(0, 3),
      sessionDate: null
    };
    assert.deepEqual(missingMag7Symbols(cache.stocks).slice(0, 2), ['AMZN', 'NVDA']);
    const decision = shouldRefreshMag7OnDemand(cache, now);
    assert.equal(decision.refresh, true);
    assert.ok(decision.missingSymbols.includes('TSLA'));
  });

  it('labels prices as delayed / not real-time', () => {
    const labels = buildMarketDataLabels({
      sessionDateKey: '2026-11-06',
      asOfIso: '2026-11-06T21:30:00.000Z',
      cached: true
    });
    assert.equal(labels.realtime, false);
    assert.equal(labels.delayed, true);
    assert.match(labels.summary, /not real-time|Cached prices|Delayed/i);
  });
});

describe('scheduled refresh policy', () => {
  it('runs end-of-day work only on trading days', () => {
    assert.equal(evaluateDailyScheduleGate(new Date('2026-11-06T21:30:00.000Z')).run, true);
    assert.equal(evaluateDailyScheduleGate(new Date('2026-11-07T21:30:00.000Z')).run, false);
  });
});
