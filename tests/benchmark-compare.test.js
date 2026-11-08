/**
 * SPY benchmark comparison: normalization, alignment, gaps, limited history.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseAlphaDailySeries,
  buildBenchmarkComparison,
  spyAsOfDateKeyForObservation,
  spyCloseForObservation,
  indexSpyBars,
  pctReturn,
  SPY_BENCHMARK_LABEL
} = require('../functions/lib/benchmarkCompare');
const { filterSnapshotsByRange } = require('../functions/lib/portfolioHistory');
const Core = require('../public/finsight-core.js');

const RANGE_MS = {
  '1W': 7 * 24 * 60 * 60 * 1000,
  '1M': 30 * 24 * 60 * 60 * 1000,
  '3M': 90 * 24 * 60 * 60 * 1000,
  ALL: null
};

function makeSpyBars(startDate, days, startClose = 100) {
  const bars = [];
  const [y, m, d] = startDate.split('-').map(Number);
  let cursor = new Date(Date.UTC(y, m - 1, d, 17, 0, 0));
  let close = startClose;
  let added = 0;
  while (added < days) {
    const wd = cursor.getUTCDay(); // rough weekday; good enough for synthetic bars
    if (wd !== 0 && wd !== 6) {
      const key = cursor.toISOString().slice(0, 10);
      bars.push({ date: key, close });
      close += 0.5;
      added += 1;
    }
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
  }
  return bars;
}

describe('parseAlphaDailySeries', () => {
  it('parses compact TIME_SERIES_DAILY payload', () => {
    const parsed = parseAlphaDailySeries({
      'Time Series (Daily)': {
        '2026-11-06': { '4. close': '680.10' },
        '2026-11-05': { '4. close': '678.00' }
      }
    });
    assert.equal(parsed.ok, true);
    assert.equal(parsed.bars.length, 2);
    assert.equal(parsed.bars[0].date, '2026-11-05');
    assert.equal(parsed.bars[1].close, 680.1);
  });

  it('fails honestly when Alpha returns Information / empty series', () => {
    const parsed = parseAlphaDailySeries({
      Information: 'Thank you for using Alpha Vantage! Our standard API call frequency is...'
    });
    assert.equal(parsed.ok, false);
    assert.equal(parsed.bars.length, 0);
  });
});

describe('return normalization and alignment', () => {
  it('normalizes both series to 0% at the shared base', () => {
    const spyBars = [
      { date: '2026-11-03', close: 100 },
      { date: '2026-11-04', close: 101 },
      { date: '2026-11-05', close: 102 },
      { date: '2026-11-06', close: 104 }
    ];
    // After close ET on Nov 5 ≈ 21:00 UTC
    const snaps = [
      {
        timestamp: '2026-11-05T21:30:00.000Z',
        portfolioValue: 10000,
        cashBalance: 4000,
        kind: 'trade'
      },
      {
        timestamp: '2026-11-06T21:30:00.000Z',
        portfolioValue: 11000,
        cashBalance: 4000,
        kind: 'daily'
      }
    ];
    const result = buildBenchmarkComparison({ portfolioSnapshots: snaps, spyBars });
    assert.equal(result.ok, true);
    assert.equal(result.portfolioSeries[0].y, 0);
    assert.ok(Math.abs(result.spySeries[0].y) < 1e-9);
    assert.ok(result.portfolioSeries[1].y > 0);
    assert.match(result.meta.spyLabel, /SPY/);
    assert.match(SPY_BENCHMARK_LABEL, /unadjusted/i);
  });

  it('does not use a same-day SPY close for a morning observation', () => {
    const spyBars = [
      { date: '2026-11-05', close: 100 },
      { date: '2026-11-06', close: 110 }
    ];
    const spyIndex = indexSpyBars(spyBars);
    // Nov 6 2026 10:00 ET = 15:00 UTC
    const morning = new Date('2026-11-06T15:00:00.000Z');
    const asOf = spyAsOfDateKeyForObservation(morning);
    assert.equal(asOf, '2026-11-05');
    const close = spyCloseForObservation(morning, spyIndex);
    assert.equal(close.date, '2026-11-05');
    assert.equal(close.close, 100);
  });

  it('pctReturn computes percentage change', () => {
    assert.ok(Math.abs(pctReturn(110, 100) - 10) < 1e-9);
    assert.ok(Math.abs(pctReturn(90, 100) - -10) < 1e-9);
    assert.equal(pctReturn(100, 0), null);
  });
});

describe('gaps, sparse history, missing benchmark', () => {
  it('preserves long portfolio gaps in series timestamps (no interpolated points)', () => {
    const spyBars = makeSpyBars('2026-06-01', 120, 400);
    const snaps = [
      {
        timestamp: '2025-11-27T18:00:00.000Z',
        portfolioValue: 10000,
        kind: 'init'
      },
      {
        timestamp: '2026-11-05T21:30:00.000Z',
        portfolioValue: 10000,
        kind: 'trade'
      },
      {
        timestamp: '2026-11-06T21:30:00.000Z',
        portfolioValue: 10840,
        kind: 'daily'
      }
    ];
    const result = buildBenchmarkComparison({ portfolioSnapshots: snaps, spyBars });
    // Init falls outside compact spy window → excluded; remaining points kept as-is
    assert.equal(result.ok, true);
    assert.ok(result.meta.excludedOlderCount >= 1);
    assert.equal(result.portfolioSeries.length, 2);
    const xs = result.portfolioSeries.map((p) => p.x);
    assert.equal(xs.length, 2);
    assert.ok(xs[1] - xs[0] < 7 * 24 * 60 * 60 * 1000);
  });

  it('reports insufficient overlap when SPY history is missing', () => {
    const result = buildBenchmarkComparison({
      portfolioSnapshots: [
        { timestamp: '2026-11-05T21:00:00.000Z', portfolioValue: 10000, kind: 'trade' },
        { timestamp: '2026-11-06T21:00:00.000Z', portfolioValue: 10100, kind: 'daily' }
      ],
      spyBars: []
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'benchmark_unavailable');
  });

  it('reports insufficient portfolio points', () => {
    const result = buildBenchmarkComparison({
      portfolioSnapshots: [
        { timestamp: '2026-11-06T21:00:00.000Z', portfolioValue: 10000, kind: 'trade' }
      ],
      spyBars: [{ date: '2026-11-06', close: 100 }]
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'insufficient_portfolio');
  });

  it('1W filtering still applies before comparison', () => {
    const snaps = [
      { timestamp: '2025-11-27T18:00:00.000Z', portfolioValue: 10000, kind: 'init' },
      { timestamp: '2026-11-05T15:00:00.000Z', portfolioValue: 10020, kind: 'trade' },
      { timestamp: '2026-11-06T21:30:00.000Z', portfolioValue: 10840, kind: 'daily' },
      { timestamp: '2026-11-07T18:00:00.000Z', portfolioValue: 10850, kind: 'live', source: 'live' }
    ];
    const filtered = filterSnapshotsByRange(snaps, '1W', RANGE_MS);
    assert.ok(filtered.every((s) => s.kind !== 'init'));
    const spyBars = makeSpyBars('2026-10-01', 40, 500);
    const result = buildBenchmarkComparison({
      portfolioSnapshots: filtered,
      spyBars
    });
    assert.equal(result.ok, true);
    assert.ok(result.portfolioSeries.length >= 2);
  });
});

describe('FinSightCore mirrors server comparison helpers', () => {
  it('buildBenchmarkComparison exists on core and agrees on empty spy', () => {
    const snaps = [
      { timestamp: '2026-11-05T21:00:00.000Z', portfolioValue: 10000, kind: 'trade' },
      { timestamp: '2026-11-06T21:00:00.000Z', portfolioValue: 10100, kind: 'daily' }
    ];
    const a = buildBenchmarkComparison({ portfolioSnapshots: snaps, spyBars: [] });
    const b = Core.buildBenchmarkComparison({ portfolioSnapshots: snaps, spyBars: [] });
    assert.equal(a.ok, false);
    assert.equal(b.ok, false);
    assert.equal(a.reason, b.reason);
  });
});
