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
  assessChartRange,
  analyzeObservationGaps,
  chartSegmentShouldBreak,
  describeSnapshotKind,
  MAX_CONNECTED_GAP_MS
} = require('../functions/lib/portfolioHistory');
const Core = require('../public/finsight-core.js');

const RANGE_MS = {
  '1W': 7 * 24 * 60 * 60 * 1000,
  '1M': 30 * 24 * 60 * 60 * 1000,
  '3M': 90 * 24 * 60 * 60 * 1000,
  ALL: null
};

const HISTORY_WITH_YEAR_GAP = [
  {
    timestamp: '2025-11-27T18:00:00.000Z',
    portfolioValue: 10000,
    cashBalance: 10000,
    kind: 'init'
  },
  {
    timestamp: '2026-11-05T15:00:00.000Z',
    portfolioValue: 10020,
    cashBalance: 5000,
    kind: 'trade'
  },
  {
    timestamp: '2026-11-06T21:30:00.000Z',
    portfolioValue: 10840,
    cashBalance: 5000,
    kind: 'daily'
  },
  {
    timestamp: '2026-11-07T18:00:00.000Z',
    portfolioValue: 10850,
    cashBalance: 5000,
    source: 'live',
    kind: 'live'
  }
];

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

describe('long gaps and range filtering', () => {
  it('detects gaps longer than 7 calendar days without inventing points', () => {
    const gaps = analyzeObservationGaps(HISTORY_WITH_YEAR_GAP);
    assert.equal(gaps.hasLongGaps, true);
    assert.equal(gaps.longGapCount, 1);
    assert.ok(gaps.maxGapMs > MAX_CONNECTED_GAP_MS);
    assert.ok(gaps.maxGapDays >= 300);
    assert.equal(HISTORY_WITH_YEAR_GAP.length, 4);
  });

  it('breaks chart segments across long gaps but not across recent points', () => {
    const initMs = new Date(HISTORY_WITH_YEAR_GAP[0].timestamp).getTime();
    const tradeMs = new Date(HISTORY_WITH_YEAR_GAP[1].timestamp).getTime();
    const dailyMs = new Date(HISTORY_WITH_YEAR_GAP[2].timestamp).getTime();
    assert.equal(chartSegmentShouldBreak(initMs, tradeMs), true);
    assert.equal(chartSegmentShouldBreak(tradeMs, dailyMs), false);
  });

  it('ALL keeps the init observation and notes the long unmeasured gap', () => {
    const assessment = assessChartRange(HISTORY_WITH_YEAR_GAP, 'ALL', RANGE_MS);
    assert.equal(assessment.filtered.length, 4);
    assert.equal(assessment.filtered[0].kind, 'init');
    assert.equal(assessment.filtered[0].portfolioValue, 10000);
    assert.equal(assessment.gaps.hasLongGaps, true);
    assert.equal(assessment.sparse, true);
    assert.match(assessment.message, /7 days|unmeasured gap/i);
  });

  it('1W excludes the distant init point and keeps recent observations', () => {
    const filtered = filterSnapshotsByRange(HISTORY_WITH_YEAR_GAP, '1W', RANGE_MS);
    assert.ok(filtered.every((s) => s.kind !== 'init'));
    assert.ok(filtered.length >= 3);
    assert.ok(filtered.length < HISTORY_WITH_YEAR_GAP.length);
    const assessment = assessChartRange(HISTORY_WITH_YEAR_GAP, '1W', RANGE_MS);
    assert.equal(assessment.gaps.hasLongGaps, false);
    assert.ok(assessment.filtered.every((s) => s.kind !== 'init'));
  });

  it('labels observation kinds for tooltips', () => {
    assert.equal(describeSnapshotKind({ kind: 'init' }), 'Account initialization');
    assert.equal(describeSnapshotKind({ kind: 'trade' }), 'Trade snapshot');
    assert.equal(describeSnapshotKind({ kind: 'daily' }), 'Daily valuation');
    assert.equal(
      describeSnapshotKind({ kind: 'live', source: 'live' }),
      'Live portfolio estimate'
    );
  });
});

describe('FinSightCore chart helpers align with functions lib', () => {
  it('assessChartRange in core matches for empty range', () => {
    const a = Core.assessChartRange([], '1M');
    const b = assessChartRange([], '1M', RANGE_MS);
    assert.equal(a.pointCount, 0);
    assert.equal(b.pointCount, 0);
  });

  it('gap helpers match between core and functions lib', () => {
    const a = Core.analyzeObservationGaps(HISTORY_WITH_YEAR_GAP);
    const b = analyzeObservationGaps(HISTORY_WITH_YEAR_GAP);
    assert.equal(a.hasLongGaps, b.hasLongGaps);
    assert.equal(a.longGapCount, b.longGapCount);
    assert.equal(Core.MAX_CONNECTED_GAP_MS, MAX_CONNECTED_GAP_MS);
    assert.equal(
      Core.chartSegmentShouldBreak(
        new Date(HISTORY_WITH_YEAR_GAP[0].timestamp).getTime(),
        new Date(HISTORY_WITH_YEAR_GAP[1].timestamp).getTime()
      ),
      true
    );
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
