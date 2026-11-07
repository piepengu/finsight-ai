/**
 * Unit tests for FinSightCore helpers (Node).
 * Run: node --test tests/finsight-core.test.js
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../public/finsight-core.js');

describe('computePortfolioTotals', () => {
  it('includes cash and holdings', () => {
    const t = Core.computePortfolioTotals(8000, 2500.5);
    assert.equal(t.totalValue, 10500.5);
    assert.equal(t.totalPL, 500.5);
    assert.equal(t.startingCapital, 10000);
  });

  it('handles empty holdings as zero', () => {
    const t = Core.computePortfolioTotals(10000, 0);
    assert.equal(t.totalValue, 10000);
    assert.equal(t.totalPL, 0);
  });

  it('treats non-finite holdings as zero (loading-safe)', () => {
    const t = Core.computePortfolioTotals(9000, Number.NaN);
    assert.equal(t.holdingsMarketValue, 0);
    assert.equal(t.totalValue, 9000);
  });
});

describe('holdingsCostBasis', () => {
  it('sums totalCost when present', () => {
    assert.equal(
      Core.holdingsCostBasis([
        { totalCost: 1000, shares: 10, avgPrice: 50 },
        { totalCost: 500, shares: 5, avgPrice: 100 }
      ]),
      1500
    );
  });

  it('falls back to shares * avgPrice', () => {
    assert.equal(
      Core.holdingsCostBasis([{ shares: 4, avgPrice: 25 }]),
      100
    );
  });

  it('returns 0 for empty holdings', () => {
    assert.equal(Core.holdingsCostBasis([]), 0);
    assert.equal(Core.holdingsCostBasis(null), 0);
  });
});

describe('createGenerationTracker (stale quote / rapid updates)', () => {
  it('invalidates older generations', () => {
    const gen = Core.createGenerationTracker();
    const first = gen.next();
    assert.equal(gen.isCurrent(first), true);
    const second = gen.next();
    assert.equal(gen.isCurrent(first), false);
    assert.equal(gen.isCurrent(second), true);
  });

  it('invalidate bumps past in-flight work (sign-out)', () => {
    const gen = Core.createGenerationTracker();
    const inFlight = gen.next();
    gen.invalidate();
    assert.equal(gen.isCurrent(inFlight), false);
  });
});

describe('formatCompanyHeading', () => {
  it('avoids duplicated ticker AAPL (AAPL)', () => {
    assert.equal(Core.formatCompanyHeading('AAPL', 'AAPL'), 'AAPL');
    assert.equal(Core.formatCompanyHeading('aapl', 'AAPL'), 'AAPL');
  });

  it('formats normal company names once', () => {
    assert.equal(Core.formatCompanyHeading('Apple Inc', 'AAPL'), 'Apple Inc (AAPL)');
  });

  it('does not double-wrap if already includes symbol', () => {
    assert.equal(Core.formatCompanyHeading('Apple Inc (AAPL)', 'AAPL'), 'Apple Inc (AAPL)');
  });
});

describe('parseMoneyText', () => {
  it('parses US currency with commas', () => {
    assert.equal(Core.parseMoneyText('$10,832.86'), 10832.86);
  });
});

describe('waitUntil (auth init)', () => {
  it('resolves true when predicate becomes ready within timeout', async () => {
    let ready = false;
    setTimeout(() => { ready = true; }, 30);
    const ok = await Core.waitUntil(() => ready, { timeoutMs: 1000, intervalMs: 10 });
    assert.equal(ok, true);
  });

  it('resolves false on timeout', async () => {
    const ok = await Core.waitUntil(() => false, { timeoutMs: 40, intervalMs: 10 });
    assert.equal(ok, false);
  });
});

describe('signed-in / signed-out portfolio transition model', () => {
  it('reset path: cash default + zero holdings', () => {
    const afterSignOut = Core.computePortfolioTotals(10000, 0);
    assert.equal(afterSignOut.totalValue, 10000);
    assert.equal(afterSignOut.totalPL, 0);
  });

  it('rapid holdings updates: only latest generation applies', () => {
    const gen = Core.createGenerationTracker();
    const stale = gen.next();
    // Newer snapshot arrives before stale quotes finish
    const fresh = gen.next();
    const provisional = Core.holdingsCostBasis([{ shares: 2, avgPrice: 50 }]);
    assert.equal(provisional, 100);
    assert.equal(gen.isCurrent(stale), false);
    assert.equal(gen.isCurrent(fresh), true);
    const applied = Core.computePortfolioTotals(9900, provisional);
    assert.equal(applied.totalValue, 10000);
  });
});
