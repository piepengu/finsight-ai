/**
 * Phase 1 portfolio history shaping + chart range assessment tests.
 * Run: node --test tests/*.test.js
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  dedupeIdenticalSnapshots,
  buildPortfolioHistoryResponse,
  filterSnapshotsByRange,
  assessChartRange
} = require('../functions/lib/portfolioHistory');
const Core = require('../public/finsight-core.js');

const RANGE_MS = {
  '1W': 7 * 24 * 60 * 60 * 1000,
  '1M': 30 * 24 * 60 * 60 * 1000,
  '3M': 90 * 24 * 60 * 60 * 1000,
  ALL: null
};

describe('dedupeIdenticalSnapshots', () => {
  it('keeps flat-but-valid consecutive trade snapshots', () => {
    const points = [
      { timestamp: '2026-11-05T12:00:00.000Z', portfolioValue: 10000, cashBalance: 10000 },
      { timestamp: '2026-11-07T15:00:00.000Z', portfolioValue: 10000, cashBalance: 5000 },
      { timestamp: '2026-11-07T16:00:00.000Z', portfolioValue: 10000.4, cashBalance: 5000 }
    ];
    const out = dedupeIdenticalSnapshots(points);
    assert.equal(out.length, 3);
  });

  it('collapses only genuinely identical near-simultaneous records', () => {
    const points = [
      { timestamp: '2026-11-07T15:00:00.000Z', portfolioValue: 10000, cashBalance: 8000 },
      { timestamp: '2026-11-07T15:00:00.400Z', portfolioValue: 10000, cashBalance: 8000 }
    ];
    const out = dedupeIdenticalSnapshots(points);
    assert.equal(out.length, 1);
  });
});

describe('buildPortfolioHistoryResponse', () => {
  it('does not insert synthetic $10k history', () => {
    const { snapshots, meta } = buildPortfolioHistoryResponse({
      storedSnapshots: [
        { timestamp: '2026-11-07T12:00:00.000Z', portfolioValue: 10500, cashBalance: 2000 }
      ],
      livePoint: null
    });
    assert.equal(snapshots.length, 1);
    assert.equal(snapshots[0].portfolioValue, 10500);
    assert.equal(meta.syntheticHistory, false);
  });

  it('appends live point without overwriting stored history', () => {
    const { snapshots, meta } = buildPortfolioHistoryResponse({
      storedSnapshots: [
        { timestamp: '2026-11-05T12:00:00.000Z', portfolioValue: 10000, cashBalance: 10000 },
        { timestamp: '2026-11-07T12:00:00.000Z', portfolioValue: 10000, cashBalance: 4000 }
      ],
      livePoint: {
        timestamp: '2026-11-07T18:00:00.000Z',
        portfolioValue: 10125.5,
        cashBalance: 4000,
        quoteStatus: 'ok'
      }
    });
    assert.equal(snapshots.length, 3);
    assert.equal(snapshots[1].portfolioValue, 10000);
    assert.equal(snapshots[2].source, 'live');
    assert.equal(meta.liveAttached, true);
  });

  it('preserves sparse Nov 5–7 history instead of collapsing to two endpoints', () => {
    const { snapshots } = buildPortfolioHistoryResponse({
      storedSnapshots: [
        { timestamp: '2026-11-05T12:00:00.000Z', portfolioValue: 10000, cashBalance: 10000 },
        { timestamp: '2026-11-07T10:00:00.000Z', portfolioValue: 10000, cashBalance: 6000 },
        { timestamp: '2026-11-07T11:00:00.000Z', portfolioValue: 10000.25, cashBalance: 6000 }
      ],
      livePoint: {
        timestamp: '2026-11-07T20:00:00.000Z',
        portfolioValue: 10010,
        cashBalance: 6000,
        quoteStatus: 'ok'
      }
    });
    assert.ok(snapshots.length >= 4);
  });
});

describe('date ranges + sparse messaging', () => {
  const snaps = [
    { timestamp: '2026-11-05T12:00:00.000Z', portfolioValue: 10000, cashBalance: 10000 },
    { timestamp: '2026-11-07T12:00:00.000Z', portfolioValue: 10050, cashBalance: 5000 }
  ];

  it('filters 3M to include short real history', () => {
    const filtered = filterSnapshotsByRange(snaps, '3M', RANGE_MS);
    assert.equal(filtered.length, 2);
  });

  it('marks 3M as sparse when span is much shorter than window', () => {
    const assessment = assessChartRange(snaps, '3M', RANGE_MS);
    assert.equal(assessment.ok, true);
    assert.equal(assessment.sparse, true);
    assert.match(assessment.message, /unmeasured|Less history|gaps/i);
  });

  it('reports insufficient data for a single point', () => {
    const assessment = assessChartRange(
      [{ timestamp: '2026-11-07T12:00:00.000Z', portfolioValue: 10000, cashBalance: 10000 }],
      '1W',
      RANGE_MS
    );
    assert.equal(assessment.ok, false);
    assert.equal(assessment.pointCount, 1);
  });
});

describe('FinSightCore chart helpers align with functions lib', () => {
  it('assessChartRange in core matches for empty range', () => {
    const a = Core.assessChartRange([], '1M');
    const b = assessChartRange([], '1M', RANGE_MS);
    assert.equal(a.pointCount, 0);
    assert.equal(b.pointCount, 0);
  });
});

describe('missing quotes policy (live point)', () => {
  it('allows caller to attach live cash-only when quotes unavailable', () => {
    const { snapshots } = buildPortfolioHistoryResponse({
      storedSnapshots: [
        { timestamp: '2026-11-07T10:00:00.000Z', portfolioValue: 10000, cashBalance: 3000 }
      ],
      livePoint: {
        timestamp: '2026-11-07T12:00:00.000Z',
        portfolioValue: 3000,
        cashBalance: 3000,
        quoteStatus: 'unavailable'
      }
    });
    const live = snapshots[snapshots.length - 1];
    assert.equal(live.source, 'live');
    assert.equal(live.quoteStatus, 'unavailable');
    assert.equal(live.portfolioValue, 3000);
  });
});
