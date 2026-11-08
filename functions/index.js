const { onRequest } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret } = require('firebase-functions/params');
const logger = require('firebase-functions/logger');
const axios = require('axios');
const admin = require('firebase-admin');
const { buildPortfolioHistoryResponse } = require('./lib/portfolioHistory');
const {
  evaluateDailyScheduleGate,
  computeCompleteDailyValuation,
  uniqueHoldingSymbols,
  planNetworkFetches,
  mergeQuoteMaps,
  buildDailySnapshotPayload,
  dailySnapshotDocId,
  DEFAULT_DAILY_JOB_NETWORK_BUDGET,
  ALPHA_FREE_DAILY_LIMIT
} = require('./lib/dailyValuation');
const { quotesFromMag7Cache, quoteFromStockPriceCache } = require('./lib/quoteResolve');
const {
  createBudgetReserver,
  CATEGORY_SCHEDULED_MAG7,
  CATEGORY_ONDEMAND_MAG7,
  CATEGORY_PORTFOLIO,
  CATEGORY_INTERACTIVE,
  CATEGORY_BRIEFING,
  CATEGORY_BENCHMARK,
  ALPHA_SCHEDULED_MAG7_MAX,
  ALPHA_ONDEMAND_MAG7_MAX,
  ALPHA_PORTFOLIO_NETWORK_MAX,
  ALPHA_SOFT_DAILY_LIMIT,
  expectedDailyUsageBands
} = require('./lib/alphaBudget');
const {
  mag7Fingerprint,
  missingMag7Symbols,
  mag7CacheCoversSession,
  shouldRefreshMag7OnDemand,
  buildMarketDataLabels
} = require('./lib/sessionQuotes');
const { latestCompletedSessionDateKey, tradingDateKeyEt } = require('./lib/marketCalendar');
const {
  parseAlphaDailySeries,
  buildBenchmarkComparison,
  SPY_BENCHMARK_LABEL
} = require('./lib/benchmarkCompare');

const SPY_BENCHMARK_CACHE_KEY = 'spy_daily_benchmark';
const SPY_BENCHMARK_LOCK_KEY = 'spy_benchmark_refresh_lock';

// Initialize Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();
const reserveAlphaBudget = createBudgetReserver(db, admin.firestore.FieldValue);

// Define secrets for secure API key storage
const geminiKey = defineSecret('GEMINI_KEY');
const alphaKey = defineSecret('ALPHA_KEY');

exports.helloWorld = onRequest({ region: 'us-east4', cors: true }, (req, res) => {
  logger.info('helloWorld invoked', { method: req.method, path: req.path });
  res.json({ ok: true, message: 'Hello from FinSight AI (us-east4)!' });
});

exports.getDailyBriefing = onRequest(
  { 
    region: 'us-east4', 
    cors: true,
    secrets: [geminiKey, alphaKey]
  }, 
  async (req, res) => {
    logger.info('getDailyBriefing invoked');
    
    try {
      // Check cache first (cache for 1 hour)
      const today = new Date().toISOString().split('T')[0];
      const cacheKey = `daily_briefing_${today}`;
      const cacheRef = db.collection('cache').doc(cacheKey);
      const cacheDoc = await cacheRef.get();
      
      if (cacheDoc.exists) {
        const cachedData = cacheDoc.data();
        const cacheAge = Date.now() - cachedData.timestamp.toMillis();
        const oneHour = 60 * 60 * 1000;
        
        if (cacheAge < oneHour) {
          logger.info('Returning cached daily briefing', { age: Math.round(cacheAge / 1000 / 60) + ' minutes' });
          return res.json(cachedData.data);
        }
      }

      // Get API keys from secrets
      const alphaKeyValue = alphaKey.value();
      const geminiKeyValue = geminiKey.value();

    if (!alphaKeyValue || !geminiKeyValue) {
      logger.error('Missing API keys', { hasAlpha: !!alphaKeyValue, hasGemini: !!geminiKeyValue });
      return res.status(500).json({ error: 'API keys not configured' });
    }

    // Fetch S&P 500 data from Alpha Vantage (using SPY ETF as proxy) — shared daily budget
    let sp500Data = null;
    try {
      const spyReserve = await reserveAlphaBudget.reserve(CATEGORY_BRIEFING, 1, new Date());
      if (!spyReserve.ok) {
        logger.warn('SPY fetch skipped — shared Alpha budget exhausted', { reason: spyReserve.reason });
      } else {
        const alphaResponse = await axios.get('https://www.alphavantage.co/query', {
          params: {
            function: 'GLOBAL_QUOTE',
            symbol: 'SPY',
            apikey: alphaKeyValue
          }
        });

        if (alphaResponse.data['Global Quote'] && alphaResponse.data['Global Quote']['05. price']) {
          const quote = alphaResponse.data['Global Quote'];
          sp500Data = {
            symbol: 'SPY',
            price: parseFloat(quote['05. price']),
            change: parseFloat(quote['09. change']),
            changePercent: parseFloat(quote['10. change percent'].replace('%', '')),
            high: parseFloat(quote['03. high']),
            low: parseFloat(quote['04. low']),
            delayed: true,
            realtime: false
          };
          logger.info('SP500 data fetched', { price: sp500Data.price });
        }
      }
    } catch (error) {
      logger.error('Alpha Vantage API error', { error: error.message });
    }

    // Fetch BTC and ETH prices from CoinGecko public API
    let cryptoData = null;
    try {
      const coingeckoResponse = await axios.get('https://api.coingecko.com/api/v3/simple/price', {
        params: {
          ids: 'bitcoin,ethereum',
          vs_currencies: 'usd',
          include_24hr_change: true,
          include_24hr_vol: true
        }
      });

      if (coingeckoResponse.data.bitcoin && coingeckoResponse.data.ethereum) {
        cryptoData = {
          btc: {
            price: coingeckoResponse.data.bitcoin.usd,
            change24h: coingeckoResponse.data.bitcoin.usd_24h_change || 0,
            volume24h: coingeckoResponse.data.bitcoin.usd_24h_vol || 0
          },
          eth: {
            price: coingeckoResponse.data.ethereum.usd,
            change24h: coingeckoResponse.data.ethereum.usd_24h_change || 0,
            volume24h: coingeckoResponse.data.ethereum.usd_24h_vol || 0
          }
        };
        logger.info('Crypto data fetched', { btc: cryptoData.btc.price, eth: cryptoData.eth.price });
      }
    } catch (error) {
      logger.error('CoinGecko API error', { error: error.message });
    }

    // Prepare data for Gemini
    const marketData = {
      date: new Date().toISOString().split('T')[0],
      sp500: sp500Data,
      crypto: cryptoData
    };

    // Generate AI summary using Gemini REST API directly
    let aiSummary = 'Unable to generate summary at this time.';
    try {
      const prompt = `You are a financial education assistant for young investors. Provide a brief, educational summary (2-3 sentences) of today's market movements:

S&P 500 (SPY): ${sp500Data ? `$${sp500Data.price.toFixed(2)} (${sp500Data.changePercent > 0 ? '+' : ''}${sp500Data.changePercent.toFixed(2)}%)` : 'Data unavailable'}
Bitcoin: ${cryptoData ? `$${cryptoData.btc.price.toLocaleString()} (${cryptoData.btc.change24h > 0 ? '+' : ''}${cryptoData.btc.change24h.toFixed(2)}%)` : 'Data unavailable'}
Ethereum: ${cryptoData ? `$${cryptoData.eth.price.toLocaleString()} (${cryptoData.eth.change24h > 0 ? '+' : ''}${cryptoData.eth.change24h.toFixed(2)}%)` : 'Data unavailable'}

Explain what these movements mean in simple terms for beginners. Keep it educational and encouraging.`;

      // First, try to get available models to find one that works
      let modelName = null;
      const retiredPreviewModels = [
        'gemini-2.0-flash-lite-preview',
        'gemini-2.0-flash-lite-preview-02-05',
        'gemini-2.0-flash-thinking-exp',
        'gemini-2.0-flash-thinking-exp-01-21',
        'gemini-2.0-flash-thinking-exp-1219',
        'gemini-2.5-flash-lite-preview-06-17',
        'gemini-2.5-flash-preview-05-20',
        'gemini-2.5-pro-preview-06-05',
        'gemini-2.5-pro-preview-03-25',
        'gemini-2.5-pro-preview-05-06'
      ];
      
      try {
        const modelsResponse = await axios.get(
          `https://generativelanguage.googleapis.com/v1beta/models?key=${geminiKeyValue}`
        );
        
        if (modelsResponse.data?.models) {
          // Find a model that supports generateContent, prioritizing stable (non-preview) models
          const availableModels = modelsResponse.data.models.filter(
            (m) => m.supportedGenerationMethods?.includes('generateContent') &&
                   !retiredPreviewModels.some(retired => m.name.includes(retired))
          );
          
          // Prioritize stable models over preview models
          const stableModel = availableModels.find(m => !m.name.includes('preview'));
          const previewModel = availableModels.find(m => m.name.includes('preview'));
          
          const selectedModel = stableModel || previewModel;
          if (selectedModel) {
            modelName = selectedModel.name.replace('models/', '');
            logger.info('Found available model', { model: modelName, isStable: !!stableModel });
          }
        }
      } catch (listError) {
        logger.warn('Could not list models, will try default', { error: listError.message });
      }

      // Try common model names in order of preference
      // Prioritize stable (non-preview) models per Google's recommendation
      const modelNamesToTry = modelName 
        ? [modelName] 
        : [
            'gemini-2.5-flash',           // Stable Flash model
            'gemini-2.5-pro',             // Stable Pro model
            'gemini-2.5-flash-lite',      // Stable Flash Lite
            'gemini-2.5-flash-preview-09-2025',  // New preview (not retired)
            'gemini-2.5-flash-lite-preview-09-2025', // New preview (not retired)
            'gemini-1.5-flash',           // Fallback
            'gemini-1.5-pro',             // Fallback
            'gemini-pro'                   // Legacy fallback
          ];
      
      let lastError = null;
      for (const tryModel of modelNamesToTry) {
        try {
          logger.info('Trying Gemini model', { model: tryModel });
          const geminiResponse = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/${tryModel}:generateContent?key=${geminiKeyValue}`,
            {
              contents: [{
                parts: [{
                  text: prompt
                }]
              }]
            },
            {
              headers: {
                'Content-Type': 'application/json'
              }
            }
          );

          if (geminiResponse.data?.candidates?.[0]?.content?.parts?.[0]?.text) {
            aiSummary = geminiResponse.data.candidates[0].content.parts[0].text;
            logger.info('Gemini summary generated via REST API', { model: tryModel, length: aiSummary.length });
            break; // Success, exit loop
          } else {
            logger.warn('Unexpected Gemini API response format', { model: tryModel, data: geminiResponse.data });
          }
        } catch (error) {
          lastError = error;
          logger.warn('Model failed, trying next', { model: tryModel, error: error.response?.data?.error?.message || error.message });
          continue; // Try next model
        }
      }

      if (!aiSummary || aiSummary === 'Unable to generate summary at this time.') {
        throw lastError || new Error('All model attempts failed');
      }
    } catch (error) {
      logger.error('Gemini API error', { error: error.message, stack: error.stack, response: error.response?.data });
      
      // Check for quota/rate limit errors
      const errorMessage = error.response?.data?.error?.message || error.message;
      if (errorMessage.includes('quota') || errorMessage.includes('Quota exceeded')) {
        aiSummary = '⚠️ Gemini API quota exceeded. Please check your API key quota limits or wait a moment and try again. Market data is still available above.';
      } else {
        aiSummary = `Unable to generate AI summary: ${errorMessage}`;
      }
    }

    // Prepare response
    const response = {
      date: marketData.date,
      markets: {
        sp500: sp500Data,
        crypto: cryptoData
      },
      summary: aiSummary
    };

    // Cache the response
    await cacheRef.set({
      data: response,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });
    logger.info('Cached daily briefing', { date: marketData.date });

    // Return comprehensive response
    res.json(response);

  } catch (error) {
    logger.error('getDailyBriefing error', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Failed to fetch daily briefing', message: error.message });
  }
});

const MAGNIFICENT_7 = [
  { symbol: 'AAPL', name: 'Apple' },
  { symbol: 'MSFT', name: 'Microsoft' },
  { symbol: 'GOOGL', name: 'Alphabet' },
  { symbol: 'AMZN', name: 'Amazon' },
  { symbol: 'NVDA', name: 'Nvidia' },
  { symbol: 'META', name: 'Meta' },
  { symbol: 'TSLA', name: 'Tesla' }
];

const MAG7_CACHE_KEY = 'magnificent7_stocks';
const MAG7_REFRESH_LOCK_KEY = 'mag7_refresh_lock';
const ALPHA_CALL_GAP_MS = 13000; // free tier ~5 calls/minute

function isAlphaVantageRateLimit(data) {
  const msg = data?.Note || data?.['Error Message'] || data?.Information;
  if (!msg) return false;
  const lower = String(msg).toLowerCase();
  // "Thank you for using Alpha Vantage" Informational messages are NOT rate limits
  return (
    lower.includes('rate limit') ||
    lower.includes('calls per minute') ||
    lower.includes('api call frequency') ||
    lower.includes('thank you for using alpha vantage! our standard api call frequency')
  );
}

function mag7TimestampIso(cachedData) {
  if (!cachedData?.timestamp) return null;
  if (cachedData.timestamp.toDate) return cachedData.timestamp.toDate().toISOString();
  return new Date(cachedData.timestamp).toISOString();
}

function mag7CachePayload(cachedData, extras = {}) {
  const stocks = cachedData.stocks || [];
  const now = extras.now || new Date();
  const sessionDate =
    cachedData.sessionDate || latestCompletedSessionDateKey(now);
  const asOf = mag7TimestampIso(cachedData) || new Date().toISOString();
  const {
    now: _nowIgnored,
    source,
    cached,
    quotaExhausted,
    stale,
    error,
    refreshSkipped,
    rateLimited,
    ...safeExtras
  } = extras;
  const labels = buildMarketDataLabels({
    now,
    sessionDateKey: sessionDate,
    asOfIso: asOf,
    cached: cached !== false,
    partial: stocks.length < MAGNIFICENT_7.length,
    quotaExhausted: !!quotaExhausted,
    source: source || 'cache'
  });
  return {
    stocks,
    timestamp: asOf,
    asOf,
    sessionDate,
    partial: stocks.length < MAGNIFICENT_7.length,
    cached: cached !== false,
    stale: !!stale,
    error: error || undefined,
    refreshSkipped: refreshSkipped || undefined,
    rateLimited: rateLimited || undefined,
    realtime: false,
    delayed: true,
    priceLabel: labels.summary,
    freshness: labels.freshness,
    ...safeExtras
  };
}

async function acquireMag7RefreshLock(owner, ttlMs = 120000) {
  const ref = db.collection('cache').doc(MAG7_REFRESH_LOCK_KEY);
  const nowMs = Date.now();
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() : null;
    if (data?.lockedUntil && data.lockedUntil > nowMs && data.owner !== owner) {
      return { acquired: false, owner: data.owner };
    }
    tx.set(ref, {
      owner,
      lockedUntil: nowMs + ttlMs,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    return { acquired: true, owner };
  });
}

async function releaseMag7RefreshLock(owner) {
  const ref = db.collection('cache').doc(MAG7_REFRESH_LOCK_KEY);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    if (snap.data().owner !== owner) return;
    tx.delete(ref);
  });
}

async function fetchMag7Quote(symbol, name, alphaKeyValue) {
  const response = await axios.get('https://www.alphavantage.co/query', {
    params: {
      function: 'GLOBAL_QUOTE',
      symbol,
      apikey: alphaKeyValue
    },
    timeout: 10000
  });

  if (isAlphaVantageRateLimit(response.data)) {
    const err = new Error('RATE_LIMIT');
    err.rateLimited = true;
    err.details = response.data.Note || response.data.Information;
    throw err;
  }

  const quote = response.data['Global Quote'];
  if (!quote || !quote['05. price']) {
    return null;
  }

  return {
    symbol,
    name,
    price: parseFloat(quote['05. price']),
    change: parseFloat(quote['09. change']),
    changePercent: parseFloat(String(quote['10. change percent']).replace('%', '')),
    high: parseFloat(quote['03. high']),
    low: parseFloat(quote['04. low'])
  };
}

/**
 * Refresh Mag7 quotes with pacing + shared daily budget.
 * Merges into existing stocks; never downgrades a more-complete cache.
 * Dedupes by only fetching symbols still missing for the target session.
 */
async function refreshMagnificent7Cache(alphaKeyValue, options = {}) {
  const {
    maxFetches = ALPHA_SCHEDULED_MAG7_MAX,
    preferMissing = true,
    budgetCategory = CATEGORY_SCHEDULED_MAG7,
    sessionDateKey = latestCompletedSessionDateKey(new Date()),
    symbolsFilter = null,
    now = new Date()
  } = options;

  const cacheRef = db.collection('cache').doc(MAG7_CACHE_KEY);
  const cacheDoc = await cacheRef.get();
  const previousData = cacheDoc.exists ? cacheDoc.data() : {};
  const previous = previousData.stocks || [];
  const bySymbol = new Map(previous.map((s) => [s.symbol, s]));

  let symbolsToFetch = Array.isArray(symbolsFilter) && symbolsFilter.length
    ? symbolsFilter.map((s) => String(s).toUpperCase())
    : MAGNIFICENT_7.map((s) => s.symbol);

  if (preferMissing) {
    const missing = missingMag7Symbols(previous);
    if (previousData.sessionDate === sessionDateKey && missing.length > 0) {
      symbolsToFetch = missing;
    } else if (previousData.sessionDate === sessionDateKey && missing.length === 0) {
      return {
        stocks: previous,
        partial: false,
        rateLimited: false,
        fetchedCount: 0,
        skipped: true,
        reason: 'session_already_complete',
        sessionDate: sessionDateKey
      };
    } else if (missing.length > 0 && previousData.sessionDate === sessionDateKey) {
      symbolsToFetch = missing;
    }
  }

  symbolsToFetch = [...new Set(symbolsToFetch)].slice(0, Math.max(0, maxFetches));
  if (symbolsToFetch.length === 0) {
    return {
      stocks: previous,
      partial: previous.length < MAGNIFICENT_7.length,
      rateLimited: false,
      fetchedCount: 0,
      skipped: true,
      reason: 'nothing_to_fetch',
      sessionDate: previousData.sessionDate || null
    };
  }

  const reservation = await reserveAlphaBudget.reserve(budgetCategory, symbolsToFetch.length, now);
  if (!reservation.ok || reservation.grant <= 0) {
    logger.warn('Mag7 refresh blocked by shared API budget', {
      category: budgetCategory,
      reason: reservation.reason,
      wanted: symbolsToFetch.length
    });
    return {
      stocks: previous,
      partial: previous.length < MAGNIFICENT_7.length,
      rateLimited: false,
      fetchedCount: 0,
      skipped: true,
      reason: reservation.reason || 'budget_exhausted',
      quotaExhausted: true,
      sessionDate: previousData.sessionDate || null
    };
  }

  symbolsToFetch = symbolsToFetch.slice(0, reservation.grant);

  let rateLimited = false;
  let fetchedCount = 0;

  for (let i = 0; i < symbolsToFetch.length; i++) {
    const symbol = symbolsToFetch[i];
    const meta = MAGNIFICENT_7.find((s) => s.symbol === symbol) || { symbol, name: symbol };

    try {
      const quote = await fetchMag7Quote(symbol, meta.name, alphaKeyValue);
      if (quote) {
        bySymbol.set(symbol, quote);
        fetchedCount += 1;
        logger.info(`Mag7 fetched ${symbol}`, { price: quote.price, sessionDateKey });
      } else {
        logger.warn(`Mag7 no quote for ${symbol}`);
      }
    } catch (error) {
      if (error.rateLimited) {
        rateLimited = true;
        logger.warn(`Mag7 rate limited at ${symbol}`, { details: error.details });
        break;
      }
      logger.error(`Mag7 error fetching ${symbol}`, { error: error.message });
    }

    if (i < symbolsToFetch.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, ALPHA_CALL_GAP_MS));
    }
  }

  const merged = MAGNIFICENT_7
    .map((meta) => bySymbol.get(meta.symbol))
    .filter(Boolean);

  const previousCount = previous.length;
  const fingerprint = mag7Fingerprint(merged);
  const complete = merged.length === MAGNIFICENT_7.length;
  const shouldWrite =
    merged.length > previousCount ||
    (complete && fetchedCount > 0) ||
    (previousCount === 0 && merged.length > 0) ||
    fetchedCount > 0;

  if (shouldWrite && merged.length > 0) {
    const payload = {
      stocks: merged,
      partial: !complete,
      sessionDate: complete ? sessionDateKey : (previousData.sessionDate || null),
      dataFingerprint: fingerprint,
      lastFetchAttemptSession: sessionDateKey,
      lastFetchAttemptAt: admin.firestore.FieldValue.serverTimestamp(),
      lastFetchFingerprint: fingerprint,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    };
    // If still incomplete, keep prior sessionDate when it was better; mark attempt only
    if (!complete) {
      payload.sessionDate = previousData.sessionDate || null;
    }
    await cacheRef.set(payload, { merge: true });
    logger.info('Cached Magnificent 7 data', {
      count: merged.length,
      previousCount,
      fetchedCount,
      rateLimited,
      sessionDateKey,
      complete
    });
  } else {
    await cacheRef.set({
      lastFetchAttemptSession: sessionDateKey,
      lastFetchAttemptAt: admin.firestore.FieldValue.serverTimestamp(),
      lastFetchFingerprint: fingerprint || previousData.dataFingerprint || null
    }, { merge: true });
    if (previousCount > 0 && merged.length < previousCount) {
      logger.info('Keeping previous Mag7 cache (more complete than refresh)', {
        previousCount,
        mergedCount: merged.length
      });
    }
  }

  const finalDoc = await cacheRef.get();
  const finalData = finalDoc.exists ? finalDoc.data() : { stocks: merged };
  return {
    stocks: finalData.stocks || merged,
    partial: (finalData.stocks || merged).length < MAGNIFICENT_7.length,
    rateLimited,
    fetchedCount,
    sessionDate: finalData.sessionDate || null,
    quotaExhausted: false
  };
}

// Magnificent 7 stocks: AAPL, MSFT, GOOGL, AMZN, NVDA, META, TSLA
exports.getMagnificent7 = onRequest(
  {
    region: 'us-east4',
    cors: true,
    secrets: [alphaKey],
    timeoutSeconds: 120
  },
  async (req, res) => {
    logger.info('getMagnificent7 invoked');
    const now = new Date();
    const sessionDateKey = latestCompletedSessionDateKey(now);

    try {
      const cacheRef = db.collection('cache').doc(MAG7_CACHE_KEY);
      const cacheDoc = await cacheRef.get();
      const cachedData = cacheDoc.exists ? cacheDoc.data() : null;

      if (mag7CacheCoversSession(cachedData, sessionDateKey)) {
        logger.info('Returning Mag7 cache for completed session', { sessionDateKey });
        return res.json(mag7CachePayload(cachedData, { now, cached: true, source: 'cache' }));
      }

      const decision = shouldRefreshMag7OnDemand(cachedData, now);
      if (!decision.refresh) {
        if (cachedData?.stocks?.length) {
          return res.json(mag7CachePayload(cachedData, {
            now,
            cached: true,
            stale: true,
            source: 'cache',
            refreshSkipped: decision.reason
          }));
        }
      }

      const alphaKeyValue = alphaKey.value();
      if (!alphaKeyValue) {
        if (cachedData?.stocks?.length) {
          return res.json(mag7CachePayload(cachedData, { now, stale: true, cached: true }));
        }
        return res.status(500).json({
          error: 'API key not configured. Please set ALPHA_KEY environment variable.'
        });
      }

      const lockOwner = `ondemand_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const lock = await acquireMag7RefreshLock(lockOwner);
      if (!lock.acquired) {
        // Another request is filling the cache — return best available
        if (cachedData?.stocks?.length) {
          return res.json(mag7CachePayload(cachedData, {
            now,
            cached: true,
            stale: true,
            refreshSkipped: 'lock_held'
          }));
        }
        return res.status(503).json({
          error: 'Market data refresh already in progress. Please try again shortly.',
          stocks: [],
          timestamp: now.toISOString(),
          realtime: false,
          delayed: true
        });
      }

      try {
        // Re-read after lock (another visitor may have finished)
        const latest = await cacheRef.get();
        const latestData = latest.exists ? latest.data() : null;
        if (mag7CacheCoversSession(latestData, sessionDateKey)) {
          return res.json(mag7CachePayload(latestData, { now, cached: true, source: 'cache' }));
        }

        const missing = shouldRefreshMag7OnDemand(latestData, now).missingSymbols;
        const refreshed = await refreshMagnificent7Cache(alphaKeyValue, {
          maxFetches: Math.min(ALPHA_ONDEMAND_MAG7_MAX, missing.length || ALPHA_ONDEMAND_MAG7_MAX),
          preferMissing: true,
          budgetCategory: CATEGORY_ONDEMAND_MAG7,
          sessionDateKey,
          symbolsFilter: missing.length ? missing : null,
          now
        });

        if (!refreshed.stocks.length) {
          return res.status(503).json({
            error: refreshed.quotaExhausted
              ? 'Daily market-data budget reached. Please try again tomorrow.'
              : 'Market data temporarily unavailable.',
            stocks: [],
            timestamp: now.toISOString(),
            realtime: false,
            delayed: true,
            quotaExhausted: !!refreshed.quotaExhausted
          });
        }

        const after = (await cacheRef.get()).data() || refreshed;
        return res.json(mag7CachePayload(after, {
          now,
          cached: refreshed.fetchedCount === 0,
          source: refreshed.fetchedCount > 0 ? 'network' : 'cache',
          quotaExhausted: !!refreshed.quotaExhausted,
          rateLimited: refreshed.rateLimited || undefined
        }));
      } finally {
        await releaseMag7RefreshLock(lockOwner);
      }
    } catch (error) {
      logger.error('getMagnificent7 error', { error: error.message, stack: error.stack });

      try {
        const fallback = await db.collection('cache').doc(MAG7_CACHE_KEY).get();
        if (fallback.exists && (fallback.data().stocks || []).length > 0) {
          return res.json(mag7CachePayload(fallback.data(), { now, stale: true, error: true, cached: true }));
        }
      } catch (_) {
        // ignore fallback errors
      }

      res.status(500).json({
        error: 'Failed to fetch Magnificent 7 data',
        message: error.message
      });
    }
  }
);

/**
 * Weekday 4:30 PM Eastern — Mag7 EOD refresh, then complete daily portfolio valuations.
 * Replaces the former every-20-minute Mag7 job (free-tier safe).
 */
exports.refreshMagnificent7CacheJob = onSchedule(
  {
    schedule: '30 16 * * 1-5',
    timeZone: 'America/New_York',
    region: 'us-east4',
    secrets: [alphaKey],
    timeoutSeconds: 540,
    memory: '512MiB',
    retryCount: 0
  },
  async () => {
    const now = new Date();
    await runEndOfDayMarketRefresh({
      alphaKeyValue: alphaKey.value(),
      now
    });
  }
);

/**
 * Backup MTM pass at 4:45 PM Eastern — valuation only (no Mag7 refetch).
 * Idempotent daily snapshot IDs; safe if the 4:30 job already wrote snapshots.
 */
exports.recordDailyPortfolioValuationsJob = onSchedule(
  {
    schedule: '45 16 * * 1-5',
    timeZone: 'America/New_York',
    region: 'us-east4',
    secrets: [alphaKey],
    timeoutSeconds: 540,
    memory: '512MiB',
    retryCount: 0
  },
  async () => {
    await runDailyPortfolioValuations({
      alphaKeyValue: alphaKey.value(),
      networkBudget: ALPHA_PORTFOLIO_NETWORK_MAX,
      now: new Date()
    });
  }
);

/**
 * Coordinated EOD: trading-day gate → Mag7 under scheduled budget → portfolio MTM.
 */
async function runEndOfDayMarketRefresh({ alphaKeyValue, now = new Date() } = {}) {
  const gate = evaluateDailyScheduleGate(now);
  if (!gate.run) {
    logger.info('End-of-day market refresh skipped', gate);
    await db.collection('cache').doc(`eod_refresh_run_${gate.dateKey}`).set({
      status: 'skipped',
      reason: gate.reason,
      finishedAt: admin.firestore.FieldValue.serverTimestamp(),
      usageBands: expectedDailyUsageBands()
    }, { merge: true });
    return { status: 'skipped', ...gate };
  }

  if (!alphaKeyValue) {
    logger.error('End-of-day refresh: ALPHA_KEY missing');
    return { status: 'error', reason: 'missing_alpha_key' };
  }

  const sessionDateKey = gate.dateKey;
  logger.info('End-of-day Mag7 refresh starting', {
    sessionDateKey,
    softLimit: ALPHA_SOFT_DAILY_LIMIT,
    bands: expectedDailyUsageBands()
  });

  const lockOwner = `scheduled_${sessionDateKey}`;
  const lock = await acquireMag7RefreshLock(lockOwner, 300000);
  let mag7Result = { fetchedCount: 0, skipped: !lock.acquired, reason: lock.acquired ? null : 'lock_held' };

  try {
    if (lock.acquired) {
      mag7Result = await refreshMagnificent7Cache(alphaKeyValue, {
        maxFetches: ALPHA_SCHEDULED_MAG7_MAX,
        preferMissing: true,
        budgetCategory: CATEGORY_SCHEDULED_MAG7,
        sessionDateKey,
        now
      });
    }
  } finally {
    if (lock.acquired) await releaseMag7RefreshLock(lockOwner);
  }

  const valuation = await runDailyPortfolioValuations({
    alphaKeyValue,
    networkBudget: ALPHA_PORTFOLIO_NETWORK_MAX,
    now
  });

  // Refresh SPY compact daily history at most once per completed session (shared budget).
  let spyBenchmark = { refreshed: false, skipped: true, reason: 'not_attempted' };
  try {
    spyBenchmark = await getOrRefreshSpyDailyBenchmark({
      alphaKeyValue,
      now,
      allowNetwork: true
    });
  } catch (err) {
    logger.warn('EOD SPY benchmark refresh failed', { error: err.message });
    spyBenchmark = { refreshed: false, skipped: true, reason: err.message };
  }

  const summary = {
    status: 'completed',
    sessionDateKey,
    mag7: {
      fetchedCount: mag7Result.fetchedCount || 0,
      skipped: !!mag7Result.skipped,
      reason: mag7Result.reason || null,
      quotaExhausted: !!mag7Result.quotaExhausted
    },
    valuation,
    spyBenchmark: {
      refreshed: !!spyBenchmark.refreshed,
      cached: !!spyBenchmark.cached,
      barCount: Array.isArray(spyBenchmark.bars) ? spyBenchmark.bars.length : 0,
      asOfSession: spyBenchmark.asOfSession || null,
      reason: spyBenchmark.reason || null
    }
  };

  await db.collection('cache').doc(`eod_refresh_run_${sessionDateKey}`).set({
    ...summary,
    finishedAt: admin.firestore.FieldValue.serverTimestamp(),
    usageBands: expectedDailyUsageBands()
  }, { merge: true });

  logger.info('End-of-day market refresh finished', summary);
  return summary;
}

exports.__runEndOfDayMarketRefresh = runEndOfDayMarketRefresh;

function spyBenchmarkPayloadFromCache(cached, extras = {}) {
  const bars = Array.isArray(cached?.bars) ? cached.bars : [];
  return {
    ok: bars.length > 0,
    bars,
    cached: true,
    refreshed: false,
    asOfSession: cached?.asOfSession || null,
    fetchedAt: cached?.fetchedAtIso || null,
    source: cached?.source || 'alpha_vantage_time_series_daily_compact',
    label: SPY_BENCHMARK_LABEL,
    ...extras
  };
}

async function acquireSpyBenchmarkRefreshLock(owner, ttlMs = 120000) {
  const ref = db.collection('cache').doc(SPY_BENCHMARK_LOCK_KEY);
  const nowMs = Date.now();
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() : null;
    if (data?.lockedUntil && data.lockedUntil > nowMs && data.owner !== owner) {
      return { acquired: false, owner: data.owner };
    }
    tx.set(ref, {
      owner,
      lockedUntil: nowMs + ttlMs,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    return { acquired: true, owner };
  });
}

async function releaseSpyBenchmarkRefreshLock(owner) {
  const ref = db.collection('cache').doc(SPY_BENCHMARK_LOCK_KEY);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    if (snap.data().owner !== owner) return;
    tx.delete(ref);
  });
}

/**
 * Read SPY TIME_SERIES_DAILY compact cache; refresh at most once per completed ET session.
 * Uses shared Alpha budget (CATEGORY_BENCHMARK) + a refresh lock so concurrent visitors
 * cannot stampede Alpha on cache misses / rate limits. Never fabricates bars.
 */
async function getOrRefreshSpyDailyBenchmark({
  alphaKeyValue,
  now = new Date(),
  allowNetwork = true
} = {}) {
  const session = latestCompletedSessionDateKey(now);
  const cacheRef = db.collection('cache').doc(SPY_BENCHMARK_CACHE_KEY);
  const cacheDoc = await cacheRef.get();
  const cached = cacheDoc.exists ? cacheDoc.data() : null;
  const cachedBars = Array.isArray(cached?.bars) ? cached.bars : [];

  if (cachedBars.length > 0 && cached.asOfSession === session) {
    return spyBenchmarkPayloadFromCache(cached, { reason: 'session_cache_hit', ok: true });
  }

  // Failed/rate-limited attempt already recorded for this session — do not retry.
  if (cached?.lastFetchAttemptSession === session && cached?.lastFetchFailed) {
    if (cachedBars.length > 0) {
      return spyBenchmarkPayloadFromCache(cached, {
        reason: cached.lastFetchFailureReason || 'prior_session_attempt_failed',
        stale: true,
        ok: true
      });
    }
    return {
      ok: false,
      bars: [],
      cached: false,
      refreshed: false,
      reason: cached.lastFetchFailureReason || 'prior_session_attempt_failed',
      label: SPY_BENCHMARK_LABEL
    };
  }

  if (!allowNetwork || !alphaKeyValue) {
    if (cachedBars.length > 0) {
      return spyBenchmarkPayloadFromCache(cached, {
        reason: alphaKeyValue ? 'stale_cache_no_network' : 'missing_alpha_key',
        stale: true,
        ok: true
      });
    }
    return {
      ok: false,
      bars: [],
      cached: false,
      refreshed: false,
      reason: alphaKeyValue ? 'no_cache' : 'missing_alpha_key',
      label: SPY_BENCHMARK_LABEL
    };
  }

  const lockOwner = `spy_${session}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const lock = await acquireSpyBenchmarkRefreshLock(lockOwner);
  if (!lock.acquired) {
    // Another request is refreshing — serve best available cache; do not start a second Alpha call.
    if (cachedBars.length > 0) {
      return spyBenchmarkPayloadFromCache(cached, {
        reason: 'lock_held',
        stale: cached.asOfSession !== session,
        ok: true
      });
    }
    return {
      ok: false,
      bars: [],
      cached: false,
      refreshed: false,
      reason: 'refresh_in_progress',
      label: SPY_BENCHMARK_LABEL
    };
  }

  try {
    // Re-check after lock — winner may have finished.
    const latestDoc = await cacheRef.get();
    const latest = latestDoc.exists ? latestDoc.data() : null;
    const latestBars = Array.isArray(latest?.bars) ? latest.bars : [];
    if (latestBars.length > 0 && latest.asOfSession === session) {
      return spyBenchmarkPayloadFromCache(latest, { reason: 'session_cache_hit_after_lock', ok: true });
    }
    if (latest?.lastFetchAttemptSession === session && latest?.lastFetchFailed) {
      if (latestBars.length > 0) {
        return spyBenchmarkPayloadFromCache(latest, {
          reason: latest.lastFetchFailureReason || 'prior_session_attempt_failed',
          stale: true,
          ok: true
        });
      }
      return {
        ok: false,
        bars: [],
        cached: false,
        refreshed: false,
        reason: latest.lastFetchFailureReason || 'prior_session_attempt_failed',
        label: SPY_BENCHMARK_LABEL
      };
    }

    const reservation = await reserveAlphaBudget.reserve(CATEGORY_BENCHMARK, 1, now);
    if (!reservation.ok || reservation.grant < 1) {
      if (latestBars.length > 0 || cachedBars.length > 0) {
        return spyBenchmarkPayloadFromCache(latestBars.length ? latest : cached, {
          reason: reservation.reason || 'budget_exhausted',
          stale: true,
          quotaExhausted: true,
          ok: true
        });
      }
      return {
        ok: false,
        bars: [],
        cached: false,
        refreshed: false,
        reason: reservation.reason || 'budget_exhausted',
        quotaExhausted: true,
        label: SPY_BENCHMARK_LABEL
      };
    }

    try {
      const response = await axios.get('https://www.alphavantage.co/query', {
        params: {
          function: 'TIME_SERIES_DAILY',
          symbol: 'SPY',
          outputsize: 'compact',
          apikey: alphaKeyValue
        },
        timeout: 20000
      });

      const parsed = parseAlphaDailySeries(response.data);
      if (!parsed.ok || parsed.bars.length === 0) {
        const failReason = parsed.reason || 'parse_failed';
        logger.warn('SPY daily series parse failed', { reason: failReason });
        await cacheRef.set(
          {
            lastFetchAttemptSession: session,
            lastFetchFailed: true,
            lastFetchFailureReason: String(failReason).slice(0, 240),
            lastFetchAttemptAt: admin.firestore.FieldValue.serverTimestamp()
          },
          { merge: true }
        );
        if (latestBars.length > 0 || cachedBars.length > 0) {
          return spyBenchmarkPayloadFromCache(latestBars.length ? latest : cached, {
            reason: failReason,
            stale: true,
            ok: true
          });
        }
        return {
          ok: false,
          bars: [],
          cached: false,
          refreshed: false,
          reason: failReason,
          label: SPY_BENCHMARK_LABEL
        };
      }

      const fetchedAtIso = new Date().toISOString();
      const payload = {
        symbol: 'SPY',
        bars: parsed.bars,
        asOfSession: session,
        fetchedAtIso,
        source: 'alpha_vantage_time_series_daily_compact',
        label: SPY_BENCHMARK_LABEL,
        barCount: parsed.bars.length,
        firstDate: parsed.bars[0].date,
        lastDate: parsed.bars[parsed.bars.length - 1].date,
        lastFetchAttemptSession: session,
        lastFetchFailed: false,
        lastFetchFailureReason: null,
        timestamp: admin.firestore.FieldValue.serverTimestamp()
      };
      await cacheRef.set(payload, { merge: true });
      logger.info('Cached SPY daily benchmark', {
        bars: parsed.bars.length,
        asOfSession: session,
        firstDate: payload.firstDate,
        lastDate: payload.lastDate
      });

      return {
        ok: true,
        bars: parsed.bars,
        cached: false,
        refreshed: true,
        asOfSession: session,
        fetchedAt: fetchedAtIso,
        source: payload.source,
        label: SPY_BENCHMARK_LABEL,
        reason: 'network_refresh'
      };
    } catch (err) {
      logger.error('SPY daily fetch error', { error: err.message });
      await cacheRef.set(
        {
          lastFetchAttemptSession: session,
          lastFetchFailed: true,
          lastFetchFailureReason: String(err.message || 'fetch_error').slice(0, 240),
          lastFetchAttemptAt: admin.firestore.FieldValue.serverTimestamp()
        },
        { merge: true }
      );
      if (latestBars.length > 0 || cachedBars.length > 0) {
        return spyBenchmarkPayloadFromCache(latestBars.length ? latest : cached, {
          reason: err.message,
          stale: true,
          ok: true
        });
      }
      return {
        ok: false,
        bars: [],
        cached: false,
        refreshed: false,
        reason: err.message,
        label: SPY_BENCHMARK_LABEL
      };
    }
  } finally {
    await releaseSpyBenchmarkRefreshLock(lockOwner);
  }
}

exports.__getOrRefreshSpyDailyBenchmark = getOrRefreshSpyDailyBenchmark;

/** Public/read SPY compact daily cache (refreshes at most once per session under budget). */
exports.getSpyBenchmark = onRequest(
  {
    region: 'us-east4',
    cors: true,
    secrets: [alphaKey],
    timeoutSeconds: 60
  },
  async (req, res) => {
    try {
      const result = await getOrRefreshSpyDailyBenchmark({
        alphaKeyValue: alphaKey.value(),
        now: new Date(),
        allowNetwork: true
      });
      const status = result.ok ? 200 : result.quotaExhausted ? 503 : 503;
      res.status(result.ok ? 200 : status).json({
        success: !!result.ok,
        symbol: 'SPY',
        bars: result.bars || [],
        cached: !!result.cached,
        refreshed: !!result.refreshed,
        stale: !!result.stale,
        asOfSession: result.asOfSession || null,
        fetchedAt: result.fetchedAt || null,
        source: result.source || null,
        label: result.label || SPY_BENCHMARK_LABEL,
        reason: result.reason || null,
        quotaExhausted: !!result.quotaExhausted
      });
    } catch (error) {
      handleHttpError(res, error, 'getSpyBenchmark error');
    }
  }
);

/**
 * Shared daily valuation runner (also unit-testable via dependency injection in lib tests).
 */
async function runDailyPortfolioValuations({
  alphaKeyValue,
  networkBudget = DEFAULT_DAILY_JOB_NETWORK_BUDGET,
  now = new Date(),
  maxQuoteAgeMs = 8 * 60 * 60 * 1000
} = {}) {
  const gate = evaluateDailyScheduleGate(now);
  if (!gate.run) {
    logger.info('Daily valuation skipped', gate);
    await db.collection('cache').doc(`daily_valuation_run_${gate.dateKey}`).set({
      status: 'skipped',
      reason: gate.reason,
      finishedAt: admin.firestore.FieldValue.serverTimestamp(),
      alphaFreeDailyLimitHint: ALPHA_FREE_DAILY_LIMIT
    }, { merge: true });
    return { status: 'skipped', ...gate };
  }

  const dateKey = gate.dateKey;
  const docId = dailySnapshotDocId(now);
  logger.info('Daily valuation starting', {
    dateKey,
    docId,
    networkBudget,
    alphaFreeDailyLimitHint: ALPHA_FREE_DAILY_LIMIT
  });

  // Discover users via Auth (avoids collectionGroup index requirements), then keep those with accounts
  const userIds = [];
  let pageToken;
  do {
    const page = await admin.auth().listUsers(1000, pageToken);
    for (const u of page.users) userIds.push(u.uid);
    pageToken = page.pageToken;
  } while (pageToken);

  const users = [];
  for (const userId of userIds) {
    const accountDoc = await db.collection('users').doc(userId).collection('account').doc('balance').get();
    if (!accountDoc.exists) continue; // not a paper-trading account yet
    const cashBalance = Number(accountDoc.data().balance) || 0;
    const portfolioSnap = await db.collection('users').doc(userId).collection('portfolio').get();
    const holdings = [];
    portfolioSnap.forEach((h) => {
      holdings.push({ symbol: h.id, shares: Number(h.data().shares) || 0, ...h.data() });
    });
    users.push({ userId, cashBalance, holdings });
  }

  // Shared quote map across all users (one fetch per ticker)
  let quotesBySymbol = {};
  const mag7Doc = await db.collection('cache').doc(MAG7_CACHE_KEY).get();
  if (mag7Doc.exists) {
    quotesBySymbol = mergeQuoteMaps(
      quotesBySymbol,
      quotesFromMag7Cache(mag7Doc.data(), now, maxQuoteAgeMs)
    );
  }

  const required = uniqueHoldingSymbols(users.map((u) => u.holdings));
  for (const symbol of required) {
    if (quotesBySymbol[symbol]) continue;
    const cacheDoc = await db.collection('cache').doc(`stock_price_${symbol}`).get();
    if (!cacheDoc.exists) continue;
    const q = quoteFromStockPriceCache(symbol, cacheDoc.data(), now, maxQuoteAgeMs);
    if (q) quotesBySymbol[symbol] = q;
  }

  const plan = planNetworkFetches(required, quotesBySymbol, networkBudget);
  let networkUsed = 0;

  if (alphaKeyValue && plan.toFetch.length > 0) {
    const reservation = await reserveAlphaBudget.reserve(
      CATEGORY_PORTFOLIO,
      plan.toFetch.length,
      now
    );
    const toFetch = plan.toFetch.slice(0, reservation.grant || 0);
    if (!reservation.ok || toFetch.length === 0) {
      logger.warn('Daily valuation network fetches skipped (shared budget)', {
        wanted: plan.toFetch.length,
        reason: reservation.reason
      });
    }

    for (let i = 0; i < toFetch.length; i++) {
      const symbol = toFetch[i];
      try {
        if (i > 0) {
          await new Promise((r) => setTimeout(r, ALPHA_CALL_GAP_MS));
        }
        // Bypass interactive budget — already reserved under portfolio category
        const quote = await getStockQuote(symbol, alphaKeyValue, {
          bypassBudget: true,
          maxCacheAgeMs: 8 * 60 * 60 * 1000
        });
        if (quote && Number.isFinite(quote.price) && quote.price > 0) {
          quotesBySymbol[symbol] = {
            price: quote.price,
            asOf: quote.asOf || new Date().toISOString(),
            source: 'network'
          };
          networkUsed += 1;
        }
      } catch (err) {
        logger.warn('Daily valuation network quote failed', { symbol, error: err.message });
      }
    }
  }

  const summary = {
    usersSeen: users.length,
    written: 0,
    skippedExisting: 0,
    skippedIncomplete: 0,
    skippedErrors: 0,
    networkUsed,
    requiredSymbols: required.length,
    cachedSymbols: Object.keys(quotesBySymbol).length
  };

  for (const user of users) {
    const snapRef = db.collection('users').doc(user.userId).collection('snapshots').doc(docId);
    const existing = await snapRef.get();
    if (existing.exists) {
      summary.skippedExisting += 1;
      continue;
    }

    const valuation = computeCompleteDailyValuation({
      cashBalance: user.cashBalance,
      holdings: user.holdings,
      quotesBySymbol
    });

    if (!valuation.ok) {
      summary.skippedIncomplete += 1;
      logger.info('Daily valuation skipped for user (incomplete)', {
        userId: user.userId,
        reason: valuation.reason,
        missingSymbols: valuation.missingSymbols || []
      });
      continue;
    }

    try {
      const payload = buildDailySnapshotPayload({ valuation, now, quoteStatus: 'ok' });
      await snapRef.create({
        ...payload,
        timestamp: admin.firestore.FieldValue.serverTimestamp()
      });
      summary.written += 1;
    } catch (err) {
      // create() fails if doc already exists (race) — treat as idempotent success
      if (err.code === 6 || /already exists/i.test(String(err.message))) {
        summary.skippedExisting += 1;
      } else {
        summary.skippedErrors += 1;
        logger.error('Daily valuation write failed', { userId: user.userId, error: err.message });
      }
    }
  }

  await db.collection('cache').doc(`daily_valuation_run_${dateKey}`).set({
    status: 'completed',
    ...summary,
    dateKey,
    finishedAt: admin.firestore.FieldValue.serverTimestamp(),
    alphaFreeDailyLimitHint: ALPHA_FREE_DAILY_LIMIT
  }, { merge: true });

  logger.info('Daily valuation finished', summary);
  return { status: 'completed', dateKey, ...summary };
}

// Exported for tests / manual ops scripts (not an HTTP endpoint)
exports.__runDailyPortfolioValuations = runDailyPortfolioValuations;
// Helper function to verify authentication
async function verifyAuth(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    const err = new Error('Unauthorized: No token provided');
    err.statusCode = 401;
    throw err;
  }
  
  const token = authHeader.split('Bearer ')[1];
  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    return decodedToken.uid;
  } catch (e) {
    const err = new Error('Unauthorized: Invalid or expired token');
    err.statusCode = 401;
    throw err;
  }
}

function handleHttpError(res, error, logLabel) {
  const status = error.statusCode || (String(error.message || '').startsWith('Unauthorized') ? 401 : 500);
  logger.error(logLabel, { error: error.message, stack: error.stack, status });
  res.status(status).json({ error: error.message });
}

// Helper function to get stock price with caching (5 minute cache)
function hasChangeFields(cachedData) {
  return cachedData &&
    typeof cachedData.change === 'number' &&
    typeof cachedData.changePercent === 'number' &&
    Number.isFinite(cachedData.change) &&
    Number.isFinite(cachedData.changePercent);
}

function quoteFromCache(cachedData) {
  if (!cachedData || cachedData.price == null || Number.isNaN(Number(cachedData.price))) {
    return null;
  }
  const withChange = hasChangeFields(cachedData);
  return {
    symbol: cachedData.symbol,
    price: Number(cachedData.price),
    change: withChange ? Number(cachedData.change) : null,
    changePercent: withChange ? Number(cachedData.changePercent) : null,
    previousClose: cachedData.previousClose != null ? Number(cachedData.previousClose) : null,
    high: cachedData.high != null ? Number(cachedData.high) : null,
    low: cachedData.low != null ? Number(cachedData.low) : null,
    incomplete: !withChange
  };
}

/**
 * Full quote (price + daily change). Used by watchlist / stockPrice HTTP API.
 * Respects shared daily Alpha budget unless bypassBudget is set (pre-reserved callers).
 */
async function getStockQuote(symbol, alphaKeyValue, options = {}) {
  const {
    bypassBudget = false,
    maxCacheAgeMs = 5 * 60 * 1000,
    budgetCategory = CATEGORY_INTERACTIVE,
    now = new Date()
  } = options;

  const cacheKey = `stock_price_${symbol}`;
  const cacheRef = db.collection('cache').doc(cacheKey);
  const cacheDoc = await cacheRef.get();

  if (cacheDoc.exists) {
    const cachedData = cacheDoc.data();
    const cacheAge = cachedData.timestamp?.toMillis
      ? Date.now() - cachedData.timestamp.toMillis()
      : Number.POSITIVE_INFINITY;

    // Only reuse cache when it includes change fields (older price-only entries are incomplete)
    if (cacheAge < maxCacheAgeMs && hasChangeFields(cachedData)) {
      logger.info(`Using cached quote for ${symbol}`, {
        price: cachedData.price,
        changePercent: cachedData.changePercent,
        age: Math.round(cacheAge / 1000) + 's'
      });
      const cached = quoteFromCache(cachedData);
      return {
        ...cached,
        asOf: cachedData.timestamp?.toDate
          ? cachedData.timestamp.toDate().toISOString()
          : null,
        cached: true,
        delayed: true,
        realtime: false
      };
    }
  }

  if (!bypassBudget) {
    const reservation = await reserveAlphaBudget.reserve(budgetCategory, 1, now);
    if (!reservation.ok || reservation.grant < 1) {
      if (cacheDoc.exists && hasChangeFields(cacheDoc.data())) {
        const stale = quoteFromCache(cacheDoc.data());
        logger.warn(`Budget exhausted, using stale quote cache for ${symbol}`);
        return {
          ...stale,
          cached: true,
          delayed: true,
          realtime: false,
          quotaExhausted: true,
          asOf: cacheDoc.data().timestamp?.toDate
            ? cacheDoc.data().timestamp.toDate().toISOString()
            : null
        };
      }
      throw new Error('Daily market-data budget reached. Please try again tomorrow.');
    }
  }

  const response = await axios.get('https://www.alphavantage.co/query', {
    params: {
      function: 'GLOBAL_QUOTE',
      symbol: symbol,
      apikey: alphaKeyValue
    }
  });

  if (response.data['Note'] || response.data['Information']) {
    if (cacheDoc.exists) {
      const cachedData = cacheDoc.data();
      // Prefer a complete stale quote over a price-only entry that would fake +0.00%
      if (hasChangeFields(cachedData)) {
        const stale = quoteFromCache(cachedData);
        logger.warn(`Rate limited, using stale quote cache for ${symbol}`, {
          price: stale.price,
          changePercent: stale.changePercent
        });
        return {
          ...stale,
          cached: true,
          delayed: true,
          realtime: false,
          asOf: cachedData.timestamp?.toDate
            ? cachedData.timestamp.toDate().toISOString()
            : null
        };
      }
    }
    throw new Error('Alpha Vantage API rate limit exceeded. Please try again later.');
  }

  if (!response.data['Global Quote'] || !response.data['Global Quote']['05. price']) {
    throw new Error(`Invalid stock symbol: ${symbol}`);
  }

  const quote = response.data['Global Quote'];
  const price = parseFloat(quote['05. price']);
  const change = parseFloat(quote['09. change'] || '0');
  const changePercent = parseFloat(String(quote['10. change percent'] || '0').replace('%', ''));
  const previousClose = parseFloat(quote['08. previous close'] || '0');
  const high = parseFloat(quote['03. high'] || '0');
  const low = parseFloat(quote['04. low'] || '0');
  const asOf = new Date().toISOString();

  const payload = {
    symbol,
    price,
    change: Number.isFinite(change) ? change : 0,
    changePercent: Number.isFinite(changePercent) ? changePercent : 0,
    previousClose: Number.isFinite(previousClose) ? previousClose : null,
    high: Number.isFinite(high) ? high : null,
    low: Number.isFinite(low) ? low : null,
    sessionDate: tradingDateKeyEt(now),
    timestamp: admin.firestore.FieldValue.serverTimestamp()
  };

  await cacheRef.set(payload);
  logger.info(`Cached quote for ${symbol}`, {
    price: payload.price,
    changePercent: payload.changePercent
  });

  return {
    symbol: payload.symbol,
    price: payload.price,
    change: payload.change,
    changePercent: payload.changePercent,
    previousClose: payload.previousClose,
    high: payload.high,
    low: payload.low,
    incomplete: false,
    asOf,
    cached: false,
    delayed: true,
    realtime: false
  };
}

/** Price-only helper for buy/sell/portfolio math (keeps callers returning a number). */
async function getStockPrice(symbol, alphaKeyValue) {
  const quote = await getStockQuote(symbol, alphaKeyValue);
  return quote.price;
}

/** Reserve interactive Alpha capacity or throw a friendly quota error. */
async function reserveInteractiveAlphaOrThrow(count = 1, now = new Date()) {
  const reservation = await reserveAlphaBudget.reserve(CATEGORY_INTERACTIVE, count, now);
  if (!reservation.ok || reservation.grant < count) {
    const err = new Error('Daily market-data budget reached. Please try again tomorrow.');
    err.quotaExhausted = true;
    err.statusCode = 503;
    throw err;
  }
  return reservation;
}

// Helper function to search for stock symbol by company name or symbol
async function searchSymbol(input, alphaKeyValue, logger) {
  const trimmedInput = input.trim().toUpperCase();
  
  // Check if input looks like a symbol (3-5 uppercase letters, possibly with numbers)
  const symbolPattern = /^[A-Z]{1,5}$/;
  const isLikelySymbol = symbolPattern.test(trimmedInput);
  
  // If it looks like a symbol, try it directly first
  if (isLikelySymbol) {
    try {
      await reserveInteractiveAlphaOrThrow(1);
      const quoteResponse = await axios.get('https://www.alphavantage.co/query', {
        params: {
          function: 'GLOBAL_QUOTE',
          symbol: trimmedInput,
          apikey: alphaKeyValue
        }
      });
      
      // Check for rate limit or API errors
      if (quoteResponse.data.Note || quoteResponse.data['Error Message'] || quoteResponse.data['Information']) {
        const errorMsg = quoteResponse.data.Note || quoteResponse.data['Error Message'] || quoteResponse.data['Information'];
        const errorLower = errorMsg.toLowerCase();
        
        // Check if it's actually a rate limit (not just an info message)
        const isRateLimit = errorLower.includes('rate limit') || 
                           errorLower.includes('call frequency') || 
                           errorLower.includes('5 calls per minute');
        
        if (isRateLimit) {
          logger.warn('Direct symbol lookup rate limited', { symbol: trimmedInput, error: errorMsg });
          // Don't throw here, fall through to search which might work
        } else {
          // For other messages (like "Thank you for using Alpha Vantage"), just log and continue
          logger.info('Direct symbol lookup info message', { symbol: trimmedInput, message: errorMsg });
        }
      }
      
      // Check if we got valid quote data
      if (quoteResponse.data['Global Quote'] && quoteResponse.data['Global Quote']['05. price']) {
        const quote = quoteResponse.data['Global Quote'];
        // Return quote data to avoid redundant API call later
        return {
          symbol: quote['01. symbol'],
          name: quote['01. symbol'], // Name not in quote, will be fetched later
          matchType: 'direct',
          quoteData: {
            symbol: quote['01. symbol'],
            price: parseFloat(quote['05. price']),
            change: parseFloat(quote['09. change']),
            changePercent: parseFloat(quote['10. change percent'].replace('%', '')),
            high: parseFloat(quote['03. high']),
            low: parseFloat(quote['04. low']),
            volume: quote['06. volume'],
            previousClose: parseFloat(quote['08. previous close'])
          }
        };
      }
    } catch (error) {
      logger.warn('Direct symbol lookup failed, trying search', { symbol: trimmedInput, error: error.message });
      // Don't throw here, fall through to search
    }
  }
  
  // Search by keywords (company name or symbol)
  try {
    await reserveInteractiveAlphaOrThrow(1);
    const searchResponse = await axios.get('https://www.alphavantage.co/query', {
      params: {
        function: 'SYMBOL_SEARCH',
        keywords: input.trim(),
        apikey: alphaKeyValue
      }
    });
    
    // Check for rate limit or API errors
    if (searchResponse.data.Note || searchResponse.data['Error Message'] || searchResponse.data['Information']) {
      const errorMsg = searchResponse.data.Note || searchResponse.data['Error Message'] || searchResponse.data['Information'];
      const errorLower = errorMsg.toLowerCase();
      
      // Check if it's actually a rate limit (consistent with direct lookup logic)
      // Note: "Thank you for using Alpha Vantage" is an informational message, NOT a rate limit
      // Note: "api call" is too generic and may catch non-rate-limit messages
      const isRateLimit = errorLower.includes('rate limit') || 
                         errorLower.includes('call frequency') || 
                         errorLower.includes('5 calls per minute');
      
      if (isRateLimit) {
        throw new Error(`Alpha Vantage API rate limit reached. Please wait a minute and try again. (Free tier allows 5 calls per minute)`);
      } else {
        // For other messages (like "Thank you for using Alpha Vantage"), just log and continue
        // The API might still return valid data even with these messages
        logger.info('Alpha Vantage API info message', { message: errorMsg });
        // Continue to check if we have matches anyway
      }
    }
    
    if (searchResponse.data.bestMatches && searchResponse.data.bestMatches.length > 0) {
      // Filter for US stocks (Region: United States) and prefer equity types
      const usStocks = searchResponse.data.bestMatches.filter(
        match => match['4. region'] === 'United States' && 
                 (match['3. type'] === 'Equity' || match['3. type'] === 'ETF')
      );
      
      if (usStocks.length > 0) {
        const bestMatch = usStocks[0];
        return {
          symbol: bestMatch['1. symbol'],
          name: bestMatch['2. name'],
          matchType: 'search',
          allMatches: usStocks.slice(0, 5).map(m => ({
            symbol: m['1. symbol'],
            name: m['2. name'],
            type: m['3. type'],
            region: m['4. region']
          }))
        };
      }
      
      // If no US stocks, return first match anyway
      const firstMatch = searchResponse.data.bestMatches[0];
      return {
        symbol: firstMatch['1. symbol'],
        name: firstMatch['2. name'],
        matchType: 'search',
        allMatches: searchResponse.data.bestMatches.slice(0, 5).map(m => ({
          symbol: m['1. symbol'],
          name: m['2. name'],
          type: m['3. type'],
          region: m['4. region']
        }))
      };
    }
    
    throw new Error(`No matches found for "${input}"`);
  } catch (error) {
    logger.error('Symbol search error', { input, error: error.message });
    throw error;
  }
}

// Helper function to initialize user account
async function initializeAccount(userId) {
  const accountRef = db.collection('users').doc(userId).collection('account').doc('balance');
  const accountDoc = await accountRef.get();
  
  if (!accountDoc.exists) {
    await accountRef.set({
      balance: 10000.00,
      totalInvested: 0.00,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    logger.info('Account initialized for user', { userId });
    
    // Create initial portfolio snapshot (no holdings yet, so portfolio value = cash balance)
    const snapshotRef = db.collection('users').doc(userId).collection('snapshots').doc();
    await snapshotRef.set({
      kind: 'init',
      cashBalance: 10000.00,
      portfolioValue: 10000.00,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });
    logger.info('Initial portfolio snapshot created', { userId });
  }
  
  return accountRef;
}

// Helper function to log transaction
async function logTransaction(userId, type, symbol, shares, price, totalAmount) {
  const transactionRef = db.collection('users').doc(userId).collection('transactions').doc();
  await transactionRef.set({
    type: type, // 'buy' or 'sell'
    symbol: symbol,
    shares: shares,
    price: price,
    totalAmount: totalAmount,
    timestamp: admin.firestore.FieldValue.serverTimestamp()
  });
  logger.info('Transaction logged', { userId, type, symbol, shares });
}

// Helper function to record portfolio snapshot (mark-to-market when quotes are available)
async function recordPortfolioSnapshot(userId, alphaKeyValue) {
  try {
    // Get account balance
    const accountRef = db.collection('users').doc(userId).collection('account').doc('balance');
    const accountDoc = await accountRef.get();
    if (!accountDoc.exists) {
      logger.warn('Cannot record snapshot: account does not exist', { userId });
      return;
    }
    
    const cashBalance = accountDoc.data().balance || 0;
    
    // Get all holdings
    const portfolioRef = db.collection('users').doc(userId).collection('portfolio');
    const portfolioSnapshot = await portfolioRef.get();
    
    let portfolioValue = cashBalance;
    
    // Prefer live quotes so chart history reflects market moves, not just cost basis
    for (let i = 0; i < portfolioSnapshot.docs.length; i++) {
      const doc = portfolioSnapshot.docs[i];
      const holding = doc.data();
      const symbol = doc.id;
      let price = holding.avgPrice || 0;
      if (alphaKeyValue) {
        try {
          if (i > 0) {
            await new Promise((resolve) => setTimeout(resolve, 1200));
          }
          price = await getStockPrice(symbol, alphaKeyValue);
        } catch (err) {
          logger.warn('Snapshot falling back to avgPrice', { symbol, error: err.message });
          price = holding.avgPrice || 0;
        }
      }
      portfolioValue += holding.shares * price;
    }
    
    // Trade-time observation (auto-id). Daily valuations use idempotent daily_YYYY-MM-DD ids.
    const snapshotRef = db.collection('users').doc(userId).collection('snapshots').doc();
    await snapshotRef.set({
      kind: 'trade',
      cashBalance: cashBalance,
      portfolioValue: portfolioValue,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });
    
    logger.info('Portfolio snapshot recorded', { userId, portfolioValue, cashBalance, holdingsCount: portfolioSnapshot.docs.length });  } catch (error) {
    logger.error('Error recording portfolio snapshot', { error: error.message, stack: error.stack });
    // Don't fail the transaction if snapshot fails
  }
}

// Get stock price endpoint
exports.getStockPrice = onRequest(
  { 
    region: 'us-east4', 
    cors: true,
    secrets: [alphaKey]
  },
  async (req, res) => {
    try {
      const symbol = req.query.symbol?.toUpperCase();
      if (!symbol) {
        return res.status(400).json({ error: 'Symbol parameter required' });
      }

      const alphaKeyValue = alphaKey.value();
      const quote = await getStockQuote(symbol, alphaKeyValue);

      res.json({
        symbol: quote.symbol || symbol,
        price: quote.price,
        change: quote.change,
        changePercent: quote.changePercent,
        previousClose: quote.previousClose,
        high: quote.high,
        low: quote.low
      });
    } catch (error) {
      logger.error('getStockPrice error', { error: error.message });
      res.status(500).json({ error: error.message });
    }
  }
);

// Buy stock function
exports.buyStock = onRequest(
  { 
    region: 'us-east4', 
    cors: true,
    secrets: [alphaKey]
  },
  async (req, res) => {
    try {
      // Verify authentication
      const userId = await verifyAuth(req);
      
      const { symbol, quantity } = req.body;
      
      if (!symbol || !quantity || quantity < 1) {
        return res.status(400).json({ error: 'Invalid symbol or quantity' });
      }

      const stockSymbol = symbol.toUpperCase();
      const shares = parseInt(quantity);
      const alphaKeyValue = alphaKey.value();

      // Initialize account if needed
      const accountRef = await initializeAccount(userId);
      
      // Get current stock price
      const currentPrice = await getStockPrice(stockSymbol, alphaKeyValue);
      const totalCost = shares * currentPrice;

      // Check balance
      const accountDoc = await accountRef.get();
      const currentBalance = accountDoc.data().balance;
      
      if (currentBalance < totalCost) {
        return res.status(400).json({ error: `Insufficient balance. Need $${totalCost.toFixed(2)}, have $${currentBalance.toFixed(2)}` });
      }

      // Update balance
      await accountRef.update({
        balance: admin.firestore.FieldValue.increment(-totalCost),
        totalInvested: admin.firestore.FieldValue.increment(totalCost)
      });

      // Update portfolio
      const portfolioRef = db.collection('users').doc(userId).collection('portfolio').doc(stockSymbol);
      const portfolioDoc = await portfolioRef.get();

      if (portfolioDoc.exists) {
        // Update existing position
        const existing = portfolioDoc.data();
        const newShares = existing.shares + shares;
        const newTotalCost = existing.totalCost + totalCost;
        const newAvgPrice = newTotalCost / newShares;

        await portfolioRef.update({
          shares: newShares,
          avgPrice: newAvgPrice,
          totalCost: newTotalCost,
          lastUpdated: admin.firestore.FieldValue.serverTimestamp()
        });
      } else {
        // Create new position
        await portfolioRef.set({
          shares: shares,
          avgPrice: currentPrice,
          totalCost: totalCost,
          firstPurchased: admin.firestore.FieldValue.serverTimestamp(),
          lastUpdated: admin.firestore.FieldValue.serverTimestamp()
        });
      }

      const newBalance = currentBalance - totalCost;
      logger.info('Stock purchased', { userId, symbol: stockSymbol, shares, price: currentPrice, totalCost });

      // Log transaction
      await logTransaction(userId, 'buy', stockSymbol, shares, currentPrice, totalCost);

      // Record portfolio snapshot
      await recordPortfolioSnapshot(userId, alphaKeyValue);

      res.json({
        success: true,
        symbol: stockSymbol,
        shares,
        price: currentPrice,
        totalCost,
        newBalance
      });

    } catch (error) {
      handleHttpError(res, error, 'buyStock error');
    }
  }
);

// Sell stock function
exports.sellStock = onRequest(
  { 
    region: 'us-east4', 
    cors: true,
    secrets: [alphaKey]
  },
  async (req, res) => {
    try {
      // Verify authentication
      const userId = await verifyAuth(req);
      
      const { symbol, quantity } = req.body;
      
      if (!symbol || !quantity || quantity < 1) {
        return res.status(400).json({ error: 'Invalid symbol or quantity' });
      }

      const stockSymbol = symbol.toUpperCase();
      const sharesToSell = parseInt(quantity);
      const alphaKeyValue = alphaKey.value();

      // Check portfolio
      const portfolioRef = db.collection('users').doc(userId).collection('portfolio').doc(stockSymbol);
      const portfolioDoc = await portfolioRef.get();

      if (!portfolioDoc.exists) {
        return res.status(400).json({ error: `You don't own any shares of ${stockSymbol}` });
      }

      const holding = portfolioDoc.data();
      if (holding.shares < sharesToSell) {
        return res.status(400).json({ error: `Insufficient shares. You own ${holding.shares} shares, trying to sell ${sharesToSell}` });
      }

      // Get current stock price
      const currentPrice = await getStockPrice(stockSymbol, alphaKeyValue);
      const proceeds = sharesToSell * currentPrice;
      const originalCost = (holding.totalCost / holding.shares) * sharesToSell;
      const profitLoss = proceeds - originalCost;

      // Update balance
      const accountRef = db.collection('users').doc(userId).collection('account').doc('balance');
      await accountRef.update({
        balance: admin.firestore.FieldValue.increment(proceeds)
      });

      // Update portfolio
      const newShares = holding.shares - sharesToSell;
      if (newShares === 0) {
        // Remove position if selling all
        await portfolioRef.delete();
      } else {
        // Update position
        const newTotalCost = holding.totalCost - originalCost;
        await portfolioRef.update({
          shares: newShares,
          totalCost: newTotalCost,
          avgPrice: newTotalCost / newShares,
          lastUpdated: admin.firestore.FieldValue.serverTimestamp()
        });
      }

      const accountDoc = await accountRef.get();
      const newBalance = accountDoc.data().balance;

      logger.info('Stock sold', { userId, symbol: stockSymbol, shares: sharesToSell, price: currentPrice, proceeds, profitLoss });

      // Log transaction
      await logTransaction(userId, 'sell', stockSymbol, sharesToSell, currentPrice, proceeds);

      // Record portfolio snapshot
      await recordPortfolioSnapshot(userId, alphaKeyValue);

      res.json({
        success: true,
        symbol: stockSymbol,
        shares: sharesToSell,
        price: currentPrice,
        proceeds,
        profitLoss,
        newBalance
      });

    } catch (error) {
      handleHttpError(res, error, 'sellStock error');
    }
  }
);

// Get portfolio history for charts
exports.getPortfolioHistory = onRequest(
  { 
    region: 'us-east4', 
    cors: true,
    secrets: [alphaKey]
  },
  async (req, res) => {
    try {
      const userId = await verifyAuth(req);

      const snapshotsRef = db.collection('users').doc(userId).collection('snapshots');
      const snapshotsQuery = snapshotsRef.orderBy('timestamp', 'desc').limit(100);
      const snapshotsSnapshot = await snapshotsQuery.get();

      const storedSnapshots = [];
      snapshotsSnapshot.forEach((docSnap) => {
        const data = docSnap.data();
        const ts = data.timestamp?.toDate?.() || null;
        if (!ts) return;
        storedSnapshots.push({
          timestamp: ts.toISOString(),
          portfolioValue: Number(data.portfolioValue) || 0,
          cashBalance: Number(data.cashBalance) || 0,
          source: 'firestore',
          kind: data.kind || 'stored'
        });
      });

      const accountRef = db.collection('users').doc(userId).collection('account').doc('balance');
      const accountDoc = await accountRef.get();
      const cashBalance = accountDoc.exists ? (accountDoc.data().balance || 10000) : 10000;

      const portfolioRef = db.collection('users').doc(userId).collection('portfolio');
      const portfolioSnapshot = await portfolioRef.get();
      const holdings = [];
      for (const docSnap of portfolioSnapshot.docs) {
        holdings.push({ symbol: docSnap.id, ...docSnap.data() });
      }

      // Live mark-to-market for a separate "now" observation (does not rewrite stored history)
      let currentPortfolioValue = cashBalance;
      let quoteStatus = 'ok';
      let pricedHoldings = 0;
      let failedHoldings = 0;

      if (holdings.length > 0) {
        try {
          const alphaKeyValue = alphaKey.value();
          for (let i = 0; i < holdings.length; i++) {
            const holding = holdings[i];
            try {
              if (i > 0) {
                await new Promise((resolve) => setTimeout(resolve, 1200));
              }
              const currentPrice = await getStockPrice(holding.symbol, alphaKeyValue);
              currentPortfolioValue += holding.shares * currentPrice;
              pricedHoldings += 1;
            } catch (err) {
              // Do not invent a market value from avgPrice for the live observation.
              // Omit that holding from live MTM and mark quote quality.
              failedHoldings += 1;
              logger.warn('Live portfolio history quote failed; holding omitted from live point', {
                symbol: holding.symbol,
                error: err.message
              });
            }
          }
          if (failedHoldings > 0 && pricedHoldings > 0) quoteStatus = 'partial';
          if (failedHoldings > 0 && pricedHoldings === 0) {
            quoteStatus = 'unavailable';
            currentPortfolioValue = cashBalance;
          }
        } catch (err) {
          logger.warn('Could not fetch current prices for live portfolio history point', { error: err.message });
          quoteStatus = 'unavailable';
          currentPortfolioValue = cashBalance;
        }
      }

      // Never plot an incomplete live mark as a full portfolio value
      const liveComplete = holdings.length === 0 || quoteStatus === 'ok';
      const livePoint = liveComplete
        ? {
            timestamp: new Date().toISOString(),
            portfolioValue: currentPortfolioValue,
            cashBalance,
            quoteStatus
          }
        : null;

      const { snapshots, meta } = buildPortfolioHistoryResponse({
        storedSnapshots,
        livePoint
      });

      const wantBenchmark =
        String(req.query.includeBenchmark || '').toLowerCase() === '1' ||
        String(req.query.includeBenchmark || '').toLowerCase() === 'true';

      let benchmark = null;
      if (wantBenchmark) {
        const spy = await getOrRefreshSpyDailyBenchmark({
          alphaKeyValue: alphaKey.value(),
          now: new Date(),
          allowNetwork: true
        });
        const comparison = buildBenchmarkComparison({
          portfolioSnapshots: snapshots,
          spyBars: spy.bars || []
        });
        benchmark = {
          ...comparison,
          spyBars: spy.bars || [],
          cache: {
            ok: !!spy.ok,
            cached: !!spy.cached,
            refreshed: !!spy.refreshed,
            stale: !!spy.stale,
            asOfSession: spy.asOfSession || null,
            fetchedAt: spy.fetchedAt || null,
            source: spy.source || null,
            barCount: Array.isArray(spy.bars) ? spy.bars.length : 0,
            reason: spy.reason || null,
            quotaExhausted: !!spy.quotaExhausted
          }
        };
      }

      res.json({
        success: true,
        snapshots,
        currentPortfolioValue: liveComplete ? currentPortfolioValue : null,
        cashBalance,
        benchmark,
        meta: {
          ...meta,
          liveQuoteStatus: quoteStatus,
          liveSkipped: !liveComplete,
          liveSkipReason: liveComplete ? null : 'incomplete_quotes',
          holdingsCount: holdings.length,
          pricedHoldings,
          failedHoldings,
          spyBenchmarkLabel: SPY_BENCHMARK_LABEL
        }
      });
    } catch (error) {
      handleHttpError(res, error, 'getPortfolioHistory error');
    }
  }
);

// Add stock to watchlist
exports.addToWatchlist = onRequest(
  { 
    region: 'us-east4', 
    cors: true
  },
  async (req, res) => {
    try {
      if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
      }

      const userId = await verifyAuth(req);
      const { symbol } = req.body;

      if (!symbol) {
        return res.status(400).json({ error: 'Stock symbol is required' });
      }

      const stockSymbol = symbol.toUpperCase().trim();
      
      // Validate symbol format (basic check)
      if (!/^[A-Z]{1,5}$/.test(stockSymbol)) {
        return res.status(400).json({ error: 'Invalid stock symbol format' });
      }

      // Add to watchlist
      const watchlistRef = db.collection('users').doc(userId).collection('watchlist').doc(stockSymbol);
      await watchlistRef.set({
        symbol: stockSymbol,
        addedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      logger.info('Stock added to watchlist', { userId, symbol: stockSymbol });
      res.json({ success: true, message: `${stockSymbol} added to watchlist` });

    } catch (error) {
      handleHttpError(res, error, 'addToWatchlist error');
    }
  }
);

// Remove stock from watchlist
exports.removeFromWatchlist = onRequest(
  { 
    region: 'us-east4', 
    cors: true
  },
  async (req, res) => {
    try {
      if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
      }

      const userId = await verifyAuth(req);
      const { symbol } = req.body;

      if (!symbol) {
        return res.status(400).json({ error: 'Stock symbol is required' });
      }

      const stockSymbol = symbol.toUpperCase().trim();

      // Remove from watchlist
      const watchlistRef = db.collection('users').doc(userId).collection('watchlist').doc(stockSymbol);
      await watchlistRef.delete();

      logger.info('Stock removed from watchlist', { userId, symbol: stockSymbol });
      res.json({ success: true, message: `${stockSymbol} removed from watchlist` });

    } catch (error) {
      handleHttpError(res, error, 'removeFromWatchlist error');
    }
  }
);

// Helper function to call Gemini API with model fallback
async function callGeminiAPI(prompt, geminiKeyValue, logger) {
  const retiredPreviewModels = [
    'gemini-2.0-flash-lite-preview',
    'gemini-2.0-flash-lite-preview-02-05',
    'gemini-2.0-flash-thinking-exp',
    'gemini-2.0-flash-thinking-exp-01-21',
    'gemini-2.0-flash-thinking-exp-1219',
    'gemini-2.5-flash-lite-preview-06-17',
    'gemini-2.5-flash-preview-05-20',
    'gemini-2.5-pro-preview-06-05',
    'gemini-2.5-pro-preview-03-25',
    'gemini-2.5-pro-preview-05-06'
  ];
  
  let modelName = null;
  try {
    const modelsResponse = await axios.get(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${geminiKeyValue}`
    );
    
    if (modelsResponse.data?.models) {
      const availableModels = modelsResponse.data.models.filter(
        (m) => m.supportedGenerationMethods?.includes('generateContent') &&
               !retiredPreviewModels.some(retired => m.name.includes(retired))
      );
      
      const stableModel = availableModels.find(m => !m.name.includes('preview'));
      const previewModel = availableModels.find(m => m.name.includes('preview'));
      
      const selectedModel = stableModel || previewModel;
      if (selectedModel) {
        modelName = selectedModel.name.replace('models/', '');
        logger.info('Found available model', { model: modelName, isStable: !!stableModel });
      }
    }
  } catch (listError) {
    logger.warn('Could not list models, will try default', { error: listError.message });
  }

  const modelNamesToTry = modelName 
    ? [modelName] 
    : [
        'gemini-2.5-flash',
        'gemini-2.5-pro',
        'gemini-2.5-flash-lite',
        'gemini-2.5-flash-preview-09-2025',
        'gemini-2.5-flash-lite-preview-09-2025',
        'gemini-1.5-flash',
        'gemini-1.5-pro',
        'gemini-pro'
      ];
  
  let lastError = null;
  for (const tryModel of modelNamesToTry) {
    try {
      logger.info('Trying Gemini model', { model: tryModel });
      const geminiResponse = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/${tryModel}:generateContent?key=${geminiKeyValue}`,
        {
          contents: [{
            parts: [{
              text: prompt
            }]
          }]
        },
        {
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );

      if (geminiResponse.data?.candidates?.[0]?.content?.parts?.[0]?.text) {
        const result = geminiResponse.data.candidates[0].content.parts[0].text;
        logger.info('Gemini response generated', { model: tryModel, length: result.length });
        return result;
      } else {
        logger.warn('Unexpected Gemini API response format', { model: tryModel, data: geminiResponse.data });
      }
    } catch (error) {
      lastError = error;
      logger.warn('Model failed, trying next', { model: tryModel, error: error.response?.data?.error?.message || error.message });
      continue;
    }
  }

  throw lastError || new Error('All model attempts failed');
}

// Explain It Feature: Explain what a company does
exports.explainCompany = onRequest(
  {
    region: 'us-east4',
    cors: true,
    secrets: [geminiKey, alphaKey]
  },
  async (req, res) => {
    const input = (req.query.symbol || req.query.name || '').trim();
    logger.info('explainCompany invoked', { input });
    
    try {
      if (!input) {
        return res.status(400).json({ error: 'Stock symbol or company name is required' });
      }

      const alphaKeyValue = alphaKey.value();
      const geminiKeyValue = geminiKey.value();

      if (!alphaKeyValue || !geminiKeyValue) {
        logger.error('Missing API keys');
        return res.status(500).json({ error: 'API keys not configured' });
      }

      // Search for symbol (handles both symbol and company name)
      let symbolResult;
      try {
        symbolResult = await searchSymbol(input, alphaKeyValue, logger);
      } catch (error) {
        logger.error('Symbol search failed', { input, error: error.message });
        
        // Check if it's a rate limit error
        if (error.message.includes('rate limit') || error.message.includes('API rate limit')) {
          return res.status(503).json({ 
            error: error.message,
            suggestion: 'Alpha Vantage free tier has rate limits (5 calls per minute). Please wait a minute before trying again.'
          });
        }
        
        return res.status(404).json({ 
          error: `Could not find stock for "${input}". ${error.message.includes('Alpha Vantage') ? error.message : 'Please check the symbol or company name and try again.'}`,
          suggestion: 'Try searching with the stock ticker symbol (e.g., AAPL) or full company name (e.g., Apple Inc)'
        });
      }

      const symbol = symbolResult.symbol;
      const resolvedName = symbolResult.name;
      const hasMultipleMatches = symbolResult.allMatches && symbolResult.allMatches.length > 1;

      // Use quote data from searchSymbol if available (avoids redundant API call)
      let priceData = symbolResult.quoteData || null;

      // Fetch company overview from Alpha Vantage
      let companyData = null;
      try {
        await reserveInteractiveAlphaOrThrow(1);
        const overviewResponse = await axios.get('https://www.alphavantage.co/query', {
          params: {
            function: 'OVERVIEW',
            symbol: symbol,
            apikey: alphaKeyValue
          }
        });

        if (overviewResponse.data && overviewResponse.data.Symbol) {
          companyData = {
            symbol: overviewResponse.data.Symbol,
            name: overviewResponse.data.Name,
            description: overviewResponse.data.Description,
            sector: overviewResponse.data.Sector,
            industry: overviewResponse.data.Industry,
            marketCap: overviewResponse.data.MarketCapitalization,
            peRatio: overviewResponse.data.PERatio,
            dividendYield: overviewResponse.data.DividendYield,
            eps: overviewResponse.data.EPS,
            beta: overviewResponse.data.Beta
          };
          logger.info('Company overview fetched', { symbol, name: companyData.name });
        } else if (overviewResponse.data.Note || overviewResponse.data['Error Message']) {
          throw new Error(overviewResponse.data.Note || overviewResponse.data['Error Message'] || 'API rate limit or invalid symbol');
        }
      } catch (error) {
        logger.error('Alpha Vantage API error', { error: error.message });
        // Continue even if overview fails, we can still use price data
      }

      // Fetch current price data as fallback (only if not already fetched by searchSymbol)
      if (!priceData) {
        try {
          await reserveInteractiveAlphaOrThrow(1);
          const quoteResponse = await axios.get('https://www.alphavantage.co/query', {
            params: {
              function: 'GLOBAL_QUOTE',
              symbol: symbol,
              apikey: alphaKeyValue
            }
          });

          if (quoteResponse.data['Global Quote'] && quoteResponse.data['Global Quote']['05. price']) {
            const quote = quoteResponse.data['Global Quote'];
            priceData = {
              price: parseFloat(quote['05. price']),
              change: parseFloat(quote['09. change']),
              changePercent: parseFloat(quote['10. change percent'].replace('%', ''))
            };
          }
        } catch (error) {
          logger.warn('Could not fetch price data', { error: error.message });
        }
      } else {
        // Use price data from searchSymbol, convert to expected format
        priceData = {
          price: priceData.price,
          change: priceData.change,
          changePercent: priceData.changePercent
        };
        logger.info('Using price data from searchSymbol (avoided redundant API call)', { symbol, price: priceData.price });
      }

      if (!companyData && !priceData) {
        return res.status(404).json({ 
          error: `Could not find information for ${symbol}. Please check the symbol and try again.`,
          suggestion: 'Try searching with the stock ticker symbol (e.g., AAPL) or full company name (e.g., Apple Inc)'
        });
      }

      // Generate AI explanation using Gemini
      let explanation = 'Unable to generate explanation at this time.';
      try {
        const prompt = `You are a financial education assistant for young investors. Explain what ${companyData?.name || symbol} (${symbol}) does in simple, beginner-friendly terms.

${companyData ? `
Company Information:
- Name: ${companyData.name}
- Sector: ${companyData.sector || 'N/A'}
- Industry: ${companyData.industry || 'N/A'}
- Description: ${companyData.description || 'N/A'}
${companyData.marketCap ? `- Market Cap: $${parseInt(companyData.marketCap).toLocaleString()}` : ''}
${companyData.peRatio ? `- P/E Ratio: ${companyData.peRatio}` : ''}
` : ''}
${priceData ? `
Current Stock Price: $${priceData.price.toFixed(2)} (${priceData.changePercent >= 0 ? '+' : ''}${priceData.changePercent.toFixed(2)}%)
` : ''}

Provide a clear, concise explanation (3-4 sentences) that:
1. Explains what the company does in simple terms
2. Describes what products or services they offer
3. Mentions the industry/sector they operate in
4. Keeps it educational and easy to understand for beginners

Focus on making it accessible and interesting for young investors who may not be familiar with the company.`;

        explanation = await callGeminiAPI(prompt, geminiKeyValue, logger);
      } catch (error) {
        logger.error('Gemini API error', { error: error.message });
        const errorMessage = error.response?.data?.error?.message || error.message;
        if (errorMessage.includes('quota') || errorMessage.includes('Quota exceeded')) {
          explanation = '⚠️ AI explanation temporarily unavailable due to API quota limits. Please try again later.';
        } else {
          explanation = `Unable to generate AI explanation: ${errorMessage}`;
        }
      }

      // Return response
      res.json({
        success: true,
        symbol: symbol,
        companyName: companyData?.name || resolvedName || symbol,
        sector: companyData?.sector || null,
        industry: companyData?.industry || null,
        explanation: explanation,
        price: priceData?.price || null,
        priceChange: priceData ? {
          change: priceData.change,
          changePercent: priceData.changePercent
        } : null,
        searchInfo: hasMultipleMatches ? {
          input: input,
          matchedSymbol: symbol,
          otherMatches: symbolResult.allMatches.slice(1, 4).map(m => ({
            symbol: m.symbol,
            name: m.name
          }))
        } : null
      });

    } catch (error) {
      logger.error('explainCompany error', { error: error.message, stack: error.stack });
      res.status(500).json({ error: 'Failed to explain company', message: error.message });
    }
  }
);

// Stock Recommendation Feature: Get buy/hold/sell recommendation
exports.getStockRecommendation = onRequest(
  {
    region: 'us-east4',
    cors: true,
    secrets: [geminiKey, alphaKey]
  },
  async (req, res) => {
    const input = (req.query.symbol || req.query.name || '').trim();
    logger.info('getStockRecommendation invoked', { input });
    
    try {
      if (!input) {
        return res.status(400).json({ error: 'Stock symbol or company name is required' });
      }

      const alphaKeyValue = alphaKey.value();
      const geminiKeyValue = geminiKey.value();

      if (!alphaKeyValue || !geminiKeyValue) {
        logger.error('Missing API keys');
        return res.status(500).json({ error: 'API keys not configured' });
      }

      // Search for symbol (handles both symbol and company name)
      let symbolResult;
      try {
        symbolResult = await searchSymbol(input, alphaKeyValue, logger);
      } catch (error) {
        logger.error('Symbol search failed', { input, error: error.message });
        
        // Check if it's a rate limit error
        if (error.message.includes('rate limit') || error.message.includes('API rate limit')) {
          return res.status(503).json({ 
            error: error.message,
            suggestion: 'Alpha Vantage free tier has rate limits (5 calls per minute). Please wait a minute before trying again.'
          });
        }
        
        return res.status(404).json({ 
          error: `Could not find stock for "${input}". ${error.message.includes('Alpha Vantage') ? error.message : 'Please check the symbol or company name and try again.'}`,
          suggestion: 'Try searching with the stock ticker symbol (e.g., AAPL) or full company name (e.g., Apple Inc)'
        });
      }

      const symbol = symbolResult.symbol;
      const resolvedName = symbolResult.name;
      const hasMultipleMatches = symbolResult.allMatches && symbolResult.allMatches.length > 1;

      // Use quote data from searchSymbol if available (avoids redundant API call)
      let quoteData = symbolResult.quoteData || null;

      // Only fetch quote if we don't already have it from searchSymbol
      if (!quoteData) {
        try {
          await reserveInteractiveAlphaOrThrow(1);
          const quoteResponse = await axios.get('https://www.alphavantage.co/query', {
            params: {
              function: 'GLOBAL_QUOTE',
              symbol: symbol,
              apikey: alphaKeyValue
            }
          });

        // Log the response for debugging
        logger.info('Quote API response', { 
          symbol, 
          hasGlobalQuote: !!quoteResponse.data['Global Quote'],
          hasPrice: !!(quoteResponse.data['Global Quote'] && quoteResponse.data['Global Quote']['05. price']),
          hasNote: !!quoteResponse.data.Note,
          hasError: !!quoteResponse.data['Error Message'],
          hasInfo: !!quoteResponse.data['Information']
        });

        if (quoteResponse.data['Global Quote'] && quoteResponse.data['Global Quote']['05. price']) {
          const quote = quoteResponse.data['Global Quote'];
          quoteData = {
            symbol: quote['01. symbol'],
            price: parseFloat(quote['05. price']),
            change: parseFloat(quote['09. change']),
            changePercent: parseFloat(quote['10. change percent'].replace('%', '')),
            high: parseFloat(quote['03. high']),
            low: parseFloat(quote['04. low']),
            volume: quote['06. volume'],
            previousClose: parseFloat(quote['08. previous close'])
          };
          logger.info('Quote data extracted successfully', { symbol, price: quoteData.price });
        } else {
          // Check for API messages/errors
          if (quoteResponse.data.Note || quoteResponse.data['Error Message'] || quoteResponse.data['Information']) {
            const errorMsg = quoteResponse.data.Note || quoteResponse.data['Error Message'] || quoteResponse.data['Information'];
            const errorLower = errorMsg.toLowerCase();
            
            // Check if it's actually a rate limit
            const isRateLimit = errorLower.includes('rate limit') || 
                               errorLower.includes('call frequency') || 
                               errorLower.includes('5 calls per minute');
            
            if (isRateLimit) {
              logger.warn('Rate limit detected in quote fetch', { symbol, message: errorMsg });
              throw new Error(`Alpha Vantage API rate limit reached. Please wait a minute and try again. (Free tier allows 5 calls per minute)`);
            } else {
              // For other messages, log but don't throw - might be informational
              logger.warn('Alpha Vantage API message (no quote data)', { symbol, message: errorMsg, fullResponse: quoteResponse.data });
            }
          } else {
            // No quote data and no error message - symbol might be invalid or data format issue
            logger.warn('No quote data returned for symbol', { 
              symbol, 
              hasGlobalQuote: !!quoteResponse.data['Global Quote'],
              globalQuoteKeys: quoteResponse.data['Global Quote'] ? Object.keys(quoteResponse.data['Global Quote']) : null,
              responseKeys: Object.keys(quoteResponse.data || {})
            });
          }
        }
      } catch (error) {
        logger.error('Alpha Vantage quote error', { symbol, error: error.message, stack: error.stack });
        
        // Check if it's a rate limit error
        if (error.message.includes('rate limit')) {
          return res.status(503).json({ 
            error: error.message,
            suggestion: 'Alpha Vantage free tier has rate limits (5 calls per minute). Please wait a minute before trying again.'
          });
        }
        
        return res.status(500).json({ error: `Could not fetch stock data for ${symbol}: ${error.message}` });
        }
      } else {
        logger.info('Using quote data from searchSymbol (avoided redundant API call)', { symbol, price: quoteData.price });
      }

      if (!quoteData) {
        logger.error('Quote data is null after fetch attempt', { 
          symbol, 
          resolvedName,
          searchResult: symbolResult 
        });
        return res.status(404).json({ 
          error: `Could not find stock data for ${symbol}. The symbol may be invalid, the market may be closed, or Alpha Vantage may not have data for this symbol.`,
          suggestion: 'Please verify the stock symbol and try again. Note: Some symbols may not be available on Alpha Vantage free tier. You can also try searching by company name instead.'
        });
      }

      // Fetch company overview for additional context
      let companyData = null;
      try {
        await reserveInteractiveAlphaOrThrow(1);
        const overviewResponse = await axios.get('https://www.alphavantage.co/query', {
          params: {
            function: 'OVERVIEW',
            symbol: symbol,
            apikey: alphaKeyValue
          }
        });

        if (overviewResponse.data && overviewResponse.data.Symbol) {
          companyData = {
            name: overviewResponse.data.Name,
            sector: overviewResponse.data.Sector,
            industry: overviewResponse.data.Industry,
            peRatio: overviewResponse.data.PERatio,
            dividendYield: overviewResponse.data.DividendYield,
            eps: overviewResponse.data.EPS,
            beta: overviewResponse.data.Beta,
            fiftyTwoWeekHigh: overviewResponse.data['52WeekHigh'],
            fiftyTwoWeekLow: overviewResponse.data['52WeekLow']
          };
        }
      } catch (error) {
        logger.warn('Could not fetch company overview', { error: error.message });
        // Continue without overview data
      }

      // Generate AI recommendation using Gemini
      let recommendation = null;
      try {
        const prompt = `You are a financial education assistant for young investors. Analyze ${companyData?.name || symbol} (${symbol}) and provide a buy/hold/sell recommendation.

Stock Data:
- Current Price: $${quoteData.price.toFixed(2)}
- Change Today: ${quoteData.change >= 0 ? '+' : ''}$${quoteData.change.toFixed(2)} (${quoteData.changePercent >= 0 ? '+' : ''}${quoteData.changePercent.toFixed(2)}%)
- Day High: $${quoteData.high.toFixed(2)}
- Day Low: $${quoteData.low.toFixed(2)}
- Previous Close: $${quoteData.previousClose.toFixed(2)}
- Volume: ${parseInt(quoteData.volume).toLocaleString()}

${companyData ? `
Company Information:
- Name: ${companyData.name}
- Sector: ${companyData.sector || 'N/A'}
- Industry: ${companyData.industry || 'N/A'}
${companyData.peRatio ? `- P/E Ratio: ${companyData.peRatio}` : ''}
${companyData.dividendYield ? `- Dividend Yield: ${companyData.dividendYield}%` : ''}
${companyData.eps ? `- EPS: $${companyData.eps}` : ''}
${companyData.beta ? `- Beta: ${companyData.beta}` : ''}
${companyData.fiftyTwoWeekHigh ? `- 52-Week High: $${companyData.fiftyTwoWeekHigh}` : ''}
${companyData.fiftyTwoWeekLow ? `- 52-Week Low: $${companyData.fiftyTwoWeekLow}` : ''}
` : ''}

Provide a recommendation in the following JSON format:
{
  "recommendation": "BUY" | "HOLD" | "SELL",
  "confidence": "HIGH" | "MEDIUM" | "LOW",
  "reasoning": "2-3 sentences explaining your reasoning in beginner-friendly terms",
  "keyPoints": ["point 1", "point 2", "point 3"],
  "riskLevel": "LOW" | "MEDIUM" | "HIGH",
  "timeHorizon": "SHORT" | "MEDIUM" | "LONG"
}

Important guidelines:
- This is for educational purposes only, not actual investment advice
- Consider the stock's recent performance, volatility, and fundamentals
- Be conservative and educational in your approach
- Explain risks clearly
- Keep reasoning simple and accessible for beginners
- If data is limited, indicate lower confidence

Return ONLY valid JSON, no additional text.`;

        const aiResponse = await callGeminiAPI(prompt, geminiKeyValue, logger);
        
        // Try to parse JSON from response (Gemini might add extra text)
        let jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          recommendation = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error('Could not parse recommendation JSON');
        }

        // Validate recommendation structure
        if (!recommendation.recommendation || !['BUY', 'HOLD', 'SELL'].includes(recommendation.recommendation)) {
          throw new Error('Invalid recommendation format');
        }

      } catch (error) {
        logger.error('Gemini recommendation error', { error: error.message });
        const errorMessage = error.response?.data?.error?.message || error.message;
        if (errorMessage.includes('quota') || errorMessage.includes('Quota exceeded')) {
          return res.status(503).json({ 
            error: 'AI recommendation temporarily unavailable due to API quota limits. Please try again later.',
            price: quoteData.price,
            priceChange: {
              change: quoteData.change,
              changePercent: quoteData.changePercent
            }
          });
        }
        return res.status(500).json({ error: `Failed to generate recommendation: ${errorMessage}` });
      }

      // Return response
      res.json({
        success: true,
        symbol: symbol,
        companyName: companyData?.name || resolvedName || symbol,
        currentPrice: quoteData.price,
        priceChange: {
          change: quoteData.change,
          changePercent: quoteData.changePercent
        },
        recommendation: recommendation.recommendation,
        confidence: recommendation.confidence || 'MEDIUM',
        reasoning: recommendation.reasoning || 'Analysis completed',
        keyPoints: recommendation.keyPoints || [],
        riskLevel: recommendation.riskLevel || 'MEDIUM',
        timeHorizon: recommendation.timeHorizon || 'MEDIUM',
        disclaimer: 'This recommendation is for educational purposes only and should not be considered as financial advice. Always do your own research and consult with a financial advisor before making investment decisions.',
        searchInfo: hasMultipleMatches ? {
          input: input,
          matchedSymbol: symbol,
          otherMatches: symbolResult.allMatches.slice(1, 4).map(m => ({
            symbol: m.symbol,
            name: m.name
          }))
        } : null
      });

    } catch (error) {
      logger.error('getStockRecommendation error', { error: error.message, stack: error.stack });
      res.status(500).json({ error: 'Failed to get stock recommendation', message: error.message });
    }
  }
);

