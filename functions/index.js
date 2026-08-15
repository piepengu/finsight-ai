const { onRequest } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret } = require('firebase-functions/params');
const logger = require('firebase-functions/logger');
const axios = require('axios');
const admin = require('firebase-admin');

// Initialize Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

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

    // Fetch S&P 500 data from Alpha Vantage (using SPY ETF as proxy)
    let sp500Data = null;
    try {
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
          low: parseFloat(quote['04. low'])
        };
        logger.info('SP500 data fetched', { price: sp500Data.price });
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
const MAG7_FRESH_MS = 15 * 60 * 1000; // serve as fresh for 15 minutes
const MAG7_STALE_OK_MS = 6 * 60 * 60 * 1000; // prefer complete stale up to 6 hours
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

function mag7CachePayload(cachedData, extras = {}) {
  const stocks = cachedData.stocks || [];
  return {
    stocks,
    timestamp: cachedData.timestamp?.toDate
      ? cachedData.timestamp.toDate().toISOString()
      : cachedData.timestamp || new Date().toISOString(),
    partial: stocks.length < MAGNIFICENT_7.length,
    cached: true,
    ...extras
  };
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
 * Refresh Mag7 quotes with pacing. Merges into existing stocks and never
 * downgrades a more-complete cache with a worse partial set.
 */
async function refreshMagnificent7Cache(alphaKeyValue, options = {}) {
  const { maxFetches = 7, preferMissing = true } = options;
  const cacheRef = db.collection('cache').doc(MAG7_CACHE_KEY);
  const cacheDoc = await cacheRef.get();
  const previous = cacheDoc.exists ? (cacheDoc.data().stocks || []) : [];
  const bySymbol = new Map(previous.map((s) => [s.symbol, s]));

  let symbolsToFetch = MAGNIFICENT_7.map((s) => s.symbol);
  if (preferMissing) {
    const missing = symbolsToFetch.filter((sym) => !bySymbol.has(sym));
    const present = symbolsToFetch.filter((sym) => bySymbol.has(sym));
    symbolsToFetch = [...missing, ...present];
  }
  symbolsToFetch = symbolsToFetch.slice(0, maxFetches);

  let rateLimited = false;
  let fetchedCount = 0;

  for (let i = 0; i < symbolsToFetch.length; i++) {
    const symbol = symbolsToFetch[i];
    const meta = MAGNIFICENT_7.find((s) => s.symbol === symbol);

    try {
      const quote = await fetchMag7Quote(symbol, meta.name, alphaKeyValue);
      if (quote) {
        bySymbol.set(symbol, quote);
        fetchedCount += 1;
        logger.info(`Mag7 fetched ${symbol}`, { price: quote.price });
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
  const shouldWrite =
    merged.length > previousCount ||
    (merged.length === MAGNIFICENT_7.length && fetchedCount > 0) ||
    (previousCount === 0 && merged.length > 0);

  if (shouldWrite && merged.length > 0) {
    await cacheRef.set({
      stocks: merged,
      partial: merged.length < MAGNIFICENT_7.length,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });
    logger.info('Cached Magnificent 7 data', {
      count: merged.length,
      previousCount,
      fetchedCount,
      rateLimited
    });
  } else if (previousCount > 0 && merged.length < previousCount) {
    logger.info('Keeping previous Mag7 cache (more complete than refresh)', {
      previousCount,
      mergedCount: merged.length
    });
  }

  const finalDoc = await cacheRef.get();
  const finalData = finalDoc.exists ? finalDoc.data() : { stocks: merged, timestamp: { toDate: () => new Date() } };
  return {
    stocks: finalData.stocks || merged,
    partial: (finalData.stocks || merged).length < MAGNIFICENT_7.length,
    rateLimited,
    fetchedCount
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

    try {
      const cacheRef = db.collection('cache').doc(MAG7_CACHE_KEY);
      const cacheDoc = await cacheRef.get();

      if (cacheDoc.exists) {
        const cachedData = cacheDoc.data();
        const stocks = cachedData.stocks || [];
        const cacheAge = Date.now() - cachedData.timestamp.toMillis();

        if (cacheAge < MAG7_FRESH_MS && stocks.length > 0) {
          logger.info('Returning fresh Mag7 cache', {
            ageSec: Math.round(cacheAge / 1000),
            count: stocks.length
          });
          return res.json(mag7CachePayload(cachedData));
        }

        // Prefer a complete (or better) stale set over a slow partial live fetch
        if (
          stocks.length === MAGNIFICENT_7.length &&
          cacheAge < MAG7_STALE_OK_MS
        ) {
          logger.info('Returning complete stale Mag7 cache', {
            ageMin: Math.round(cacheAge / 60000),
            count: stocks.length
          });
          return res.json(mag7CachePayload(cachedData, { stale: true }));
        }
      }

      const alphaKeyValue = alphaKey.value();

      if (!alphaKeyValue) {
        if (cacheDoc.exists && (cacheDoc.data().stocks || []).length > 0) {
          logger.warn('No API key, returning stale Mag7 cache');
          return res.json(mag7CachePayload(cacheDoc.data(), { stale: true }));
        }
        logger.error('Missing Alpha Vantage API key');
        return res.status(500).json({
          error: 'API key not configured. Please set ALPHA_KEY environment variable.'
        });
      }

      // Fill missing symbols first (up to 5 calls / ~65s) to improve completeness
      const previousCount = cacheDoc.exists ? (cacheDoc.data().stocks || []).length : 0;
      const missingCount = MAGNIFICENT_7.length - previousCount;
      const maxFetches = missingCount > 0 ? Math.min(5, Math.max(missingCount, 2)) : 3;

      const refreshed = await refreshMagnificent7Cache(alphaKeyValue, {
        maxFetches,
        preferMissing: true
      });

      if (refreshed.stocks.length === 0) {
        return res.status(503).json({
          error: 'Rate limit exceeded. Please try again in a minute.',
          stocks: [],
          timestamp: new Date().toISOString()
        });
      }

      return res.json({
        stocks: refreshed.stocks,
        timestamp: new Date().toISOString(),
        partial: refreshed.partial,
        cached: false,
        rateLimited: refreshed.rateLimited || undefined
      });
    } catch (error) {
      logger.error('getMagnificent7 error', { error: error.message, stack: error.stack });

      try {
        const fallback = await db.collection('cache').doc(MAG7_CACHE_KEY).get();
        if (fallback.exists && (fallback.data().stocks || []).length > 0) {
          return res.json(mag7CachePayload(fallback.data(), { stale: true, error: true }));
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

// Pre-warm Mag7 cache so the banner is rarely cold (Blaze + Cloud Scheduler)
exports.refreshMagnificent7CacheJob = onSchedule(
  {
    schedule: 'every 20 minutes',
    region: 'us-east4',
    secrets: [alphaKey],
    timeoutSeconds: 300,
    retryCount: 0
  },
  async () => {
    const alphaKeyValue = alphaKey.value();
    if (!alphaKeyValue) {
      logger.error('Mag7 schedule: ALPHA_KEY missing');
      return;
    }
    logger.info('Mag7 scheduled refresh starting');
    await refreshMagnificent7Cache(alphaKeyValue, {
      maxFetches: 7,
      preferMissing: true
    });
    logger.info('Mag7 scheduled refresh finished');
  }
);
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
async function getStockPrice(symbol, alphaKeyValue) {
  const cacheKey = `stock_price_${symbol}`;
  const cacheRef = db.collection('cache').doc(cacheKey);
  const cacheDoc = await cacheRef.get();
  
  // Check if cached data exists and is less than 5 minutes old
  if (cacheDoc.exists) {
    const cachedData = cacheDoc.data();
    const cacheAge = Date.now() - cachedData.timestamp.toMillis();
    const fiveMinutes = 5 * 60 * 1000;
    
    if (cacheAge < fiveMinutes) {
      logger.info(`Using cached price for ${symbol}`, { price: cachedData.price, age: Math.round(cacheAge / 1000) + 's' });
      return cachedData.price;
    }
  }

  // Fetch fresh price from API
  const response = await axios.get('https://www.alphavantage.co/query', {
    params: {
      function: 'GLOBAL_QUOTE',
      symbol: symbol,
      apikey: alphaKeyValue
    }
  });

  if (response.data['Note'] || response.data['Information']) {
    // If rate limited, try to return cached data even if stale
    if (cacheDoc.exists) {
      const cachedData = cacheDoc.data();
      logger.warn(`Rate limited, using stale cache for ${symbol}`, { price: cachedData.price });
      return cachedData.price;
    }
    throw new Error('Alpha Vantage API rate limit exceeded. Please try again later.');
  }

  if (!response.data['Global Quote'] || !response.data['Global Quote']['05. price']) {
    throw new Error(`Invalid stock symbol: ${symbol}`);
  }

  const price = parseFloat(response.data['Global Quote']['05. price']);
  
  // Cache the price
  await cacheRef.set({
    price: price,
    symbol: symbol,
    timestamp: admin.firestore.FieldValue.serverTimestamp()
  });
  
  logger.info(`Cached price for ${symbol}`, { price });
  return price;
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
  try {
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
  } catch (error) {
    logger.error('Error logging transaction', { error: error.message });
    // Don't fail the transaction if logging fails
  }
}

// Helper function to record portfolio snapshot
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
    
    // Calculate total portfolio value
    // Use avgPrice as fallback to avoid rate limits - we'll get fresh prices when displaying
    for (const doc of portfolioSnapshot.docs) {
      const holding = doc.data();
      // Use avgPrice as fallback to avoid API rate limits during snapshot creation
      // The frontend will fetch fresh prices when displaying holdings
      const currentValue = holding.shares * (holding.avgPrice || 0);
      portfolioValue += currentValue;
    }
    
    // Record snapshot
    const snapshotRef = db.collection('users').doc(userId).collection('snapshots').doc();
    await snapshotRef.set({
      cashBalance: cashBalance,
      portfolioValue: portfolioValue,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });
    
    logger.info('Portfolio snapshot recorded', { userId, portfolioValue, cashBalance, holdingsCount: portfolioSnapshot.docs.length });
  } catch (error) {
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
      const price = await getStockPrice(symbol, alphaKeyValue);
      
      res.json({ symbol, price });
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
      // Verify authentication
      const userId = await verifyAuth(req);
      
      // Get snapshots, ordered by timestamp
      const snapshotsRef = db.collection('users').doc(userId).collection('snapshots');
      const snapshotsQuery = snapshotsRef.orderBy('timestamp', 'desc').limit(100); // Last 100 snapshots
      const snapshotsSnapshot = await snapshotsQuery.get();
      
      const snapshots = [];
      snapshotsSnapshot.forEach((doc) => {
        const data = doc.data();
        snapshots.push({
          timestamp: data.timestamp?.toDate().toISOString() || new Date().toISOString(),
          portfolioValue: data.portfolioValue || 0,
          cashBalance: data.cashBalance || 0
        });
      });
      
      // Reverse to get chronological order (oldest first)
      snapshots.reverse();
      
      // Get current account balance and holdings for latest snapshot
      const accountRef = db.collection('users').doc(userId).collection('account').doc('balance');
      const accountDoc = await accountRef.get();
      const cashBalance = accountDoc.exists ? (accountDoc.data().balance || 10000) : 10000;
      
      const portfolioRef = db.collection('users').doc(userId).collection('portfolio');
      const portfolioSnapshot = await portfolioRef.get();
      
      // Calculate current portfolio value with current market prices (for latest snapshot)
      let currentPortfolioValue = cashBalance;
      const holdings = [];
      for (const doc of portfolioSnapshot.docs) {
        const holding = doc.data();
        holdings.push({ symbol: doc.id, ...holding });
        // For now, use avgPrice as fallback - we'll try to fetch current prices below
        currentPortfolioValue += holding.shares * (holding.avgPrice || 0);
      }
      
      // Try to fetch current prices for the latest snapshot (limit to avoid rate limits)
      if (holdings.length > 0 && holdings.length <= 5) {
        try {
          const alphaKeyValue = alphaKey.value();
          let updatedValue = cashBalance;
          for (const holding of holdings) {
            try {
              const currentPrice = await getStockPrice(holding.symbol, alphaKeyValue);
              updatedValue += holding.shares * currentPrice;
            } catch (err) {
              // Fallback to avgPrice if price fetch fails
              updatedValue += holding.shares * (holding.avgPrice || 0);
            }
          }
          currentPortfolioValue = updatedValue;
        } catch (err) {
          // If fetching prices fails, use avgPrice calculation
          logger.warn('Could not fetch current prices for portfolio history, using avgPrice', { error: err.message });
        }
      }
      
      // If no snapshots exist, or only one snapshot exists, ensure we have at least 2 points
      // This ensures a meaningful chart with proper time separation
      if (snapshots.length <= 1) {
        // Determine the earliest timestamp we have
        let earliestTimestamp;
        if (snapshots.length === 0) {
          // No snapshots: create one from 1 day ago
          earliestTimestamp = Date.now() - 86400000; // 1 day ago
        } else {
          // We have 1 snapshot: create one from 1 day before it
          const firstSnapshotTime = new Date(snapshots[0].timestamp).getTime();
          earliestTimestamp = firstSnapshotTime - 86400000; // 1 day before first snapshot
        }
        
        // Insert synthetic starting point at the beginning
        snapshots.unshift({
          timestamp: new Date(earliestTimestamp).toISOString(),
          portfolioValue: 10000, // Starting capital
          cashBalance: 10000
        });
      }
      
      // Always add/update the latest snapshot with current portfolio value
      const now = new Date().toISOString();
      const lastSnapshot = snapshots[snapshots.length - 1];
      const timeDiff = lastSnapshot ? Math.abs(new Date(now).getTime() - new Date(lastSnapshot.timestamp).getTime()) : Infinity;
      
      // Add current snapshot if it's more than 30 seconds different from the last one, or if it's the first one
      if (timeDiff > 30000 || snapshots.length === 0) {
        // Update or add the latest snapshot
        if (snapshots.length > 0 && timeDiff < 3600000) { // Less than 1 hour old, update it
          snapshots[snapshots.length - 1] = {
            timestamp: now,
            portfolioValue: currentPortfolioValue,
            cashBalance: cashBalance
          };
        } else {
          // Add new snapshot
          snapshots.push({
            timestamp: now,
            portfolioValue: currentPortfolioValue,
            cashBalance: cashBalance
          });
        }
      } else if (snapshots.length > 0) {
        // Update the last snapshot's value even if timestamp is close
        snapshots[snapshots.length - 1].portfolioValue = currentPortfolioValue;
        snapshots[snapshots.length - 1].cashBalance = cashBalance;
      }
      
      res.json({
        success: true,
        snapshots: snapshots
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

