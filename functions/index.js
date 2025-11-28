const { onRequest } = require('firebase-functions/v2/https');
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

// Magnificent 7 stocks: AAPL, MSFT, GOOGL, AMZN, NVDA, META, TSLA
exports.getMagnificent7 = onRequest(
  { 
    region: 'us-east4', 
    cors: true,
    secrets: [alphaKey],
    timeoutSeconds: 70  // Fetch first 5 stocks (~60 seconds max)
  }, 
  async (req, res) => {
    logger.info('getMagnificent7 invoked');
    
    try {
      // Check cache first (5 minute cache)
      const cacheKey = 'magnificent7_stocks';
      const cacheRef = db.collection('cache').doc(cacheKey);
      const cacheDoc = await cacheRef.get();
      
      if (cacheDoc.exists) {
        const cachedData = cacheDoc.data();
        const cacheAge = Date.now() - cachedData.timestamp.toMillis();
        const fiveMinutes = 5 * 60 * 1000;
        
        if (cacheAge < fiveMinutes) {
          logger.info('Returning cached Magnificent 7 data', { age: Math.round(cacheAge / 1000) + 's', count: cachedData.stocks?.length || 0 });
          return res.json({
            stocks: cachedData.stocks || [],
            timestamp: cachedData.timestamp.toDate().toISOString(),
            partial: cachedData.partial || false,
            cached: true
          });
        }
      }

      const alphaKeyValue = alphaKey.value();
    
      if (!alphaKeyValue) {
        // If no API key but we have cached data, return it even if stale
        if (cacheDoc.exists) {
          const cachedData = cacheDoc.data();
          logger.warn('No API key, returning stale cache');
          return res.json({
            stocks: cachedData.stocks || [],
            timestamp: cachedData.timestamp.toDate().toISOString(),
            partial: cachedData.partial || false,
            cached: true
          });
        }
        logger.error('Missing Alpha Vantage API key');
        return res.status(500).json({ error: 'API key not configured. Please set ALPHA_KEY environment variable.' });
      }

      const magnificent7 = [
        { symbol: 'AAPL', name: 'Apple' },
        { symbol: 'MSFT', name: 'Microsoft' },
        { symbol: 'GOOGL', name: 'Alphabet' },
        { symbol: 'AMZN', name: 'Amazon' },
        { symbol: 'NVDA', name: 'Nvidia' },
        { symbol: 'META', name: 'Meta' },
        { symbol: 'TSLA', name: 'Tesla' }
      ];

      // Alpha Vantage free tier: 5 API calls per minute
      // Fetch stocks with optimized delays - return after first 5 to avoid timeout
      const stocks = [];
      const delayBetweenCalls = 12000; // 12 seconds between calls (5 calls per minute)
      const maxInitialFetch = 5; // Fetch first 5 stocks, return quickly
    
    // Fetch first batch quickly to avoid timeout
    for (let i = 0; i < Math.min(magnificent7.length, maxInitialFetch); i++) {
      const stock = magnificent7[i];
      
      try {
        const response = await axios.get('https://www.alphavantage.co/query', {
          params: {
            function: 'GLOBAL_QUOTE',
            symbol: stock.symbol,
            apikey: alphaKeyValue
          },
          timeout: 10000 // 10 second timeout per request
        });

        // Check for rate limit error
        if (response.data['Note'] || response.data['Information']) {
          logger.warn(`Rate limit hit for ${stock.symbol}`, { data: response.data });
          // If rate limited, return what we have so far
          break;
        }

        if (response.data['Global Quote'] && response.data['Global Quote']['05. price']) {
          const quote = response.data['Global Quote'];
          stocks.push({
            symbol: stock.symbol,
            name: stock.name,
            price: parseFloat(quote['05. price']),
            change: parseFloat(quote['09. change']),
            changePercent: parseFloat(quote['10. change percent'].replace('%', '')),
            high: parseFloat(quote['03. high']),
            low: parseFloat(quote['04. low'])
          });
          logger.info(`Successfully fetched ${stock.symbol}`, { price: quote['05. price'] });
        } else {
          logger.warn(`No price data for ${stock.symbol}`, { data: response.data });
        }
      } catch (error) {
        logger.error(`Error fetching ${stock.symbol}`, { 
          error: error.message,
          response: error.response?.data 
        });
        // Continue to next stock instead of failing completely
      }

      // Wait before next call (except after the last one in this batch)
      if (i < Math.min(magnificent7.length, maxInitialFetch) - 1) {
        await new Promise(resolve => setTimeout(resolve, delayBetweenCalls));
      }
    }

    const validStocks = stocks;
    const fetchedSymbols = validStocks.map(s => s.symbol);
    const missingSymbols = magnificent7
      .map(s => s.symbol)
      .filter(s => !fetchedSymbols.includes(s));

    logger.info('Magnificent 7 data fetched', { 
      count: validStocks.length,
      fetched: fetchedSymbols,
      missing: missingSymbols
    });

    // Return whatever stocks we got, even if partial
    // This allows the frontend to show available data even if rate-limited
    if (validStocks.length === 0) {
      logger.warn('No stocks fetched - likely rate limited, trying stale cache');
      // If we have cached data, return it even if stale
      if (cacheDoc.exists) {
        const cachedData = cacheDoc.data();
        logger.info('Returning stale cache due to rate limit');
        return res.json({
          stocks: cachedData.stocks || [],
          timestamp: cachedData.timestamp.toDate().toISOString(),
          partial: cachedData.partial || false,
          cached: true,
          rateLimited: true
        });
      }
      return res.status(503).json({ 
        error: 'Rate limit exceeded. Please try again in a minute.',
        stocks: [],
        timestamp: new Date().toISOString()
      });
    }

    // Cache the results
    const responseData = {
      stocks: validStocks,
      timestamp: new Date().toISOString(),
      partial: validStocks.length < magnificent7.length // Indicate if this is partial data
    };

    await cacheRef.set({
      stocks: validStocks,
      partial: responseData.partial,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });
    logger.info('Cached Magnificent 7 data', { count: validStocks.length });

    res.json(responseData);

  } catch (error) {
    logger.error('getMagnificent7 error', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Failed to fetch Magnificent 7 data', message: error.message });
  }
});

// Helper function to verify authentication
async function verifyAuth(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Error('Unauthorized: No token provided');
  }
  
  const token = authHeader.split('Bearer ')[1];
  const decodedToken = await admin.auth().verifyIdToken(token);
  return decodedToken.uid;
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
      logger.error('buyStock error', { error: error.message, stack: error.stack });
      res.status(500).json({ error: error.message });
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
      logger.error('sellStock error', { error: error.message, stack: error.stack });
      res.status(500).json({ error: error.message });
    }
  }
);

// Get portfolio history for charts
exports.getPortfolioHistory = onRequest(
  { 
    region: 'us-east4', 
    cors: true
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
      
      // If no snapshots exist, or only one snapshot exists, ensure we have at least 2 points
      // This ensures a meaningful chart with proper time separation
      if (snapshots.length <= 1) {
        const accountRef = db.collection('users').doc(userId).collection('account').doc('balance');
        const accountDoc = await accountRef.get();
        const cashBalance = accountDoc.exists ? (accountDoc.data().balance || 10000) : 10000;
        
        // Get all holdings to calculate current portfolio value
        const portfolioRef = db.collection('users').doc(userId).collection('portfolio');
        const portfolioSnapshot = await portfolioRef.get();
        
        let portfolioValue = cashBalance;
        for (const doc of portfolioSnapshot.docs) {
          const holding = doc.data();
          // Use avgPrice for snapshot (avoids rate limits)
          portfolioValue += holding.shares * (holding.avgPrice || 0);
        }
        
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
        
        // Add current snapshot at the end (only if it's different from existing)
        const now = new Date().toISOString();
        const lastSnapshot = snapshots[snapshots.length - 1];
        const timeDiff = Math.abs(new Date(now).getTime() - new Date(lastSnapshot.timestamp).getTime());
        
        // Only add current snapshot if it's more than 1 minute different from the last one
        if (timeDiff > 60000 || snapshots.length === 1) {
          snapshots.push({
            timestamp: now,
            portfolioValue: portfolioValue,
            cashBalance: cashBalance
          });
          
          // Also save current snapshot to Firestore for future use
          const snapshotRef = db.collection('users').doc(userId).collection('snapshots').doc();
          await snapshotRef.set({
            cashBalance: cashBalance,
            portfolioValue: portfolioValue,
            timestamp: admin.firestore.FieldValue.serverTimestamp()
          });
        }
      }
      
      res.json({
        success: true,
        snapshots: snapshots
      });
      
    } catch (error) {
      logger.error('getPortfolioHistory error', { error: error.message, stack: error.stack });
      res.status(500).json({ error: error.message });
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
      logger.error('addToWatchlist error', { error: error.message, stack: error.stack });
      res.status(500).json({ error: error.message });
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
      logger.error('removeFromWatchlist error', { error: error.message, stack: error.stack });
      res.status(500).json({ error: error.message });
    }
  }
);

