/**
 * Shared Alpha Vantage daily budget planning (pure / testable).
 * Soft cap stays below the provider free-tier limit; interactive work is reserved.
 */

'use strict';

const { tradingDateKeyEt } = require('./marketCalendar');

/** Official free-tier ceiling (documented). */
const ALPHA_PROVIDER_DAILY_LIMIT = 25;

/** Soft app-wide ceiling — safety margin under the provider limit. */
const ALPHA_SOFT_DAILY_LIMIT = 20;

/**
 * Capacity held back for interactive stock search, research, trades, and briefing.
 * Scheduled / on-demand Mag7 + portfolio MTM must not consume this reserve.
 */
const ALPHA_INTERACTIVE_RESERVE = 8;

/** Max Mag7 network fetches in the daily scheduled refresh. */
const ALPHA_SCHEDULED_MAG7_MAX = 7;

/** Max Mag7 on-demand fills when visitors open a cold cache. */
const ALPHA_ONDEMAND_MAG7_MAX = 5;

/** Max non-Mag7 portfolio quote fetches during daily valuation. */
const ALPHA_PORTFOLIO_NETWORK_MAX = 5;

const CATEGORY_SCHEDULED_MAG7 = 'scheduled_mag7';
const CATEGORY_ONDEMAND_MAG7 = 'ondemand_mag7';
const CATEGORY_PORTFOLIO = 'portfolio';
const CATEGORY_INTERACTIVE = 'interactive';
const CATEGORY_BRIEFING = 'briefing';

const MARKET_DATA_CATEGORIES = new Set([
  CATEGORY_SCHEDULED_MAG7,
  CATEGORY_ONDEMAND_MAG7,
  CATEGORY_PORTFOLIO
]);

function budgetDocId(date = new Date()) {
  return `alpha_budget_${tradingDateKeyEt(date)}`;
}

function emptyBudgetState(date = new Date()) {
  return {
    dateKey: tradingDateKeyEt(date),
    used: 0,
    softLimit: ALPHA_SOFT_DAILY_LIMIT,
    providerLimit: ALPHA_PROVIDER_DAILY_LIMIT,
    interactiveReserve: ALPHA_INTERACTIVE_RESERVE,
    byCategory: {}
  };
}

/**
 * How many calls a category may still take given current usage.
 * Interactive may use the full soft remaining; market jobs leave the interactive reserve.
 */
function remainingForCategory(state, category) {
  const used = Number(state?.used) || 0;
  const softLimit = Number(state?.softLimit) || ALPHA_SOFT_DAILY_LIMIT;
  const reserve = Number(state?.interactiveReserve) || ALPHA_INTERACTIVE_RESERVE;
  const softRemaining = Math.max(0, softLimit - used);

  if (MARKET_DATA_CATEGORIES.has(category)) {
    const marketCeiling = Math.max(0, softLimit - reserve);
    const marketRemaining = Math.max(0, marketCeiling - used);
    return Math.min(softRemaining, marketRemaining);
  }

  return softRemaining;
}

/**
 * Plan a reservation. Pure — does not mutate state.
 * @returns {{ ok: boolean, grant: number, reason?: string, remainingAfter?: number }}
 */
function planBudgetReservation(state, category, requestCount) {
  const want = Math.max(0, Math.floor(Number(requestCount) || 0));
  if (want === 0) {
    return { ok: true, grant: 0, remainingAfter: remainingForCategory(state, category) };
  }

  const available = remainingForCategory(state, category);
  if (available <= 0) {
    return {
      ok: false,
      grant: 0,
      reason: MARKET_DATA_CATEGORIES.has(category) ? 'market_budget_exhausted' : 'soft_budget_exhausted',
      remainingAfter: 0
    };
  }

  const grant = Math.min(want, available);
  return {
    ok: grant > 0,
    grant,
    reason: grant < want ? 'partial_grant' : undefined,
    remainingAfter: available - grant
  };
}

/** Apply a successful reservation onto a cloned state object. */
function applyBudgetReservation(state, category, grant) {
  const next = {
    ...state,
    used: (Number(state.used) || 0) + grant,
    byCategory: { ...(state.byCategory || {}) }
  };
  next.byCategory[category] = (Number(next.byCategory[category]) || 0) + grant;
  return next;
}

/**
 * Simulate concurrent reservation attempts against the same starting snapshot
 * (optimistic concurrency): each attempt sees the original state; only grants
 * that still fit after prior winners are applied succeed.
 */
function resolveConcurrentReservations(initialState, attempts) {
  let state = { ...initialState, byCategory: { ...(initialState.byCategory || {}) } };
  const results = [];

  // First-come wins in attempt order (models serialized Firestore transactions).
  for (const attempt of attempts) {
    const plan = planBudgetReservation(state, attempt.category, attempt.requestCount);
    if (!plan.ok || plan.grant <= 0) {
      results.push({ ...plan, ok: false, grant: 0 });
      continue;
    }
    state = applyBudgetReservation(state, attempt.category, plan.grant);
    results.push({ ok: true, grant: plan.grant, remainingAfter: remainingForCategory(state, attempt.category) });
  }

  return { state, results };
}

function expectedDailyUsageBands() {
  return {
    providerLimit: ALPHA_PROVIDER_DAILY_LIMIT,
    softLimit: ALPHA_SOFT_DAILY_LIMIT,
    interactiveReserve: ALPHA_INTERACTIVE_RESERVE,
    scheduledMag7Max: ALPHA_SCHEDULED_MAG7_MAX,
    onDemandMag7Max: ALPHA_ONDEMAND_MAG7_MAX,
    portfolioNetworkMax: ALPHA_PORTFOLIO_NETWORK_MAX,
    /** Typical quiet day: one Mag7 EOD fill + small interactive headroom */
    typicalScheduled: ALPHA_SCHEDULED_MAG7_MAX,
    typicalInteractiveHeadroom: ALPHA_INTERACTIVE_RESERVE,
    note: 'Scheduled Mag7 (≤7) + portfolio extras (≤5) share the market pool (softLimit − reserve = 12). Interactive keeps ≥8.'
  };
}

/**
 * Firestore-backed concurrency-safe reservation.
 * @param {*} db admin.firestore()
 * @param {*} FieldValue admin.firestore.FieldValue
 */
function createBudgetReserver(db, FieldValue) {
  async function reserve(category, requestCount, now = new Date()) {
    const ref = db.collection('cache').doc(budgetDocId(now));
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const base = emptyBudgetState(now);
      const state = snap.exists
        ? {
            ...base,
            ...snap.data(),
            byCategory: { ...(base.byCategory || {}), ...((snap.data() && snap.data().byCategory) || {}) }
          }
        : base;
      const plan = planBudgetReservation(state, category, requestCount);
      if (!plan.ok || plan.grant <= 0) {
        return { ...plan, ok: false, grant: 0, state };
      }
      const next = applyBudgetReservation(state, category, plan.grant);
      tx.set(
        ref,
        {
          dateKey: next.dateKey,
          used: next.used,
          softLimit: next.softLimit,
          providerLimit: next.providerLimit,
          interactiveReserve: next.interactiveReserve,
          byCategory: next.byCategory,
          updatedAt: FieldValue.serverTimestamp()
        },
        { merge: true }
      );
      return { ...plan, state: next };
    });
  }

  async function readState(now = new Date()) {
    const snap = await db.collection('cache').doc(budgetDocId(now)).get();
    if (!snap.exists) return emptyBudgetState(now);
    return { ...emptyBudgetState(now), ...snap.data() };
  }

  return { reserve, readState };
}

module.exports = {
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
  CATEGORY_BRIEFING,
  budgetDocId,
  emptyBudgetState,
  remainingForCategory,
  planBudgetReservation,
  applyBudgetReservation,
  resolveConcurrentReservations,
  expectedDailyUsageBands,
  createBudgetReserver
};
