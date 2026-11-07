/**
 * Pure portfolio-history shaping for getPortfolioHistory (testable, no Firebase I/O).
 * Preserves legitimate snapshots; does not invent historical valuations.
 */

'use strict';

/**
 * Keep chronological order and drop only consecutive near-identical records
 * (same timestamp within 1s AND same cash + portfolio value).
 * Does NOT drop flat-but-legitimate trade snapshots.
 */
function dedupeIdenticalSnapshots(points) {
  if (!Array.isArray(points) || points.length === 0) return [];
  const ordered = [...points].sort(
    (a, b) => new Date(a.timestamp) - new Date(b.timestamp)
  );
  const out = [];
  for (const point of ordered) {
    const prev = out[out.length - 1];
    if (!prev) {
      out.push({ ...point });
      continue;
    }
    const dt = Math.abs(new Date(point.timestamp) - new Date(prev.timestamp));
    const sameValue =
      Number(point.portfolioValue) === Number(prev.portfolioValue) &&
      Number(point.cashBalance) === Number(prev.cashBalance);
    if (dt < 1000 && sameValue) {
      // Genuine duplicate write — keep the later record
      out[out.length - 1] = { ...point };
      continue;
    }
    out.push({ ...point });
  }
  return out;
}

/**
 * Build API snapshot list from Firestore points + optional live MTM.
 * Never prepends synthetic $10k history.
 * Never overwrites stored observations with live values.
 */
function buildPortfolioHistoryResponse({
  storedSnapshots = [],
  livePoint = null
} = {}) {
  const stored = dedupeIdenticalSnapshots(
    (storedSnapshots || []).map((s) => ({
      timestamp: s.timestamp,
      portfolioValue: Number(s.portfolioValue) || 0,
      cashBalance: Number(s.cashBalance) || 0,
      source: s.source || 'firestore',
      kind: s.kind || 'stored'
    }))
  );

  const snapshots = [...stored];
  let liveAttached = false;

  if (livePoint && livePoint.timestamp != null) {
    const live = {
      timestamp: livePoint.timestamp,
      portfolioValue: Number(livePoint.portfolioValue) || 0,
      cashBalance: Number(livePoint.cashBalance) || 0,
      source: 'live',
      kind: 'live',
      quoteStatus: livePoint.quoteStatus || 'unknown'
    };
    const last = snapshots[snapshots.length - 1];
    const identicalToLast =
      last &&
      Math.abs(new Date(live.timestamp) - new Date(last.timestamp)) < 1000 &&
      Number(live.portfolioValue) === Number(last.portfolioValue) &&
      Number(live.cashBalance) === Number(last.cashBalance);

    if (!identicalToLast) {
      snapshots.push(live);
      liveAttached = true;
    }
  }

  return {
    snapshots,
    meta: {
      storedCount: stored.length,
      liveAttached,
      syntheticHistory: false,
      startingCapitalReference: 10000
    }
  };
}

function filterSnapshotsByRange(snapshots, range, rangeMsMap) {
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

/**
 * Whether selected range has enough recorded observations for a meaningful view.
 */
function assessChartRange(snapshots, range, rangeMsMap) {
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
        'Only one snapshot in this range. Lines between trades are not measured daily values — make another trade or wait for a daily valuation to see change over time.'
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
      message: `${count} recorded snapshots spanning about ${days} day(s). This is less history than the ${range} window — gaps are unmeasured, not proven flat performance.`
    };
  }

  if (count < 3) {
    return {
      ok: true,
      sparse: true,
      pointCount: count,
      filtered,
      message: `${count} recorded snapshots. Chart connects observations only; values between points were not recorded.`
    };
  }

  return {
    ok: true,
    sparse: false,
    pointCount: count,
    filtered,
    message: ''
  };
}

module.exports = {
  dedupeIdenticalSnapshots,
  buildPortfolioHistoryResponse,
  filterSnapshotsByRange,
  assessChartRange
};
