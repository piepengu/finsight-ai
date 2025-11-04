const { onRequest } = require('firebase-functions/v2/https');
const logger = require('firebase-functions/logger');
const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const functions = require('firebase-functions');

exports.helloWorld = onRequest({ region: 'us-east4', cors: true }, (req, res) => {
  logger.info('helloWorld invoked', { method: req.method, path: req.path });
  res.json({ ok: true, message: 'Hello from FinSight AI (us-east4)!' });
});

exports.getDailyBriefing = onRequest({ region: 'us-east4', cors: true }, async (req, res) => {
  logger.info('getDailyBriefing invoked');
  
  try {
    const config = functions.config();
    const alphaKey = config.alpha?.key;
    const geminiKey = config.gemini?.key;

    if (!alphaKey || !geminiKey) {
      logger.error('Missing API keys', { hasAlpha: !!alphaKey, hasGemini: !!geminiKey });
      return res.status(500).json({ error: 'API keys not configured' });
    }

    // Fetch S&P 500 data from Alpha Vantage (using SPY ETF as proxy)
    let sp500Data = null;
    try {
      const alphaResponse = await axios.get('https://www.alphavantage.co/query', {
        params: {
          function: 'GLOBAL_QUOTE',
          symbol: 'SPY',
          apikey: alphaKey
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

    // Generate AI summary using Gemini
    let aiSummary = 'Unable to generate summary at this time.';
    try {
      const genAI = new GoogleGenerativeAI(geminiKey);
      const model = genAI.getGenerativeModel({ model: 'gemini-pro' });

      const prompt = `You are a financial education assistant for young investors. Provide a brief, educational summary (2-3 sentences) of today's market movements:

S&P 500 (SPY): ${sp500Data ? `$${sp500Data.price.toFixed(2)} (${sp500Data.changePercent > 0 ? '+' : ''}${sp500Data.changePercent.toFixed(2)}%)` : 'Data unavailable'}
Bitcoin: ${cryptoData ? `$${cryptoData.btc.price.toLocaleString()} (${cryptoData.btc.change24h > 0 ? '+' : ''}${cryptoData.btc.change24h.toFixed(2)}%)` : 'Data unavailable'}
Ethereum: ${cryptoData ? `$${cryptoData.eth.price.toLocaleString()} (${cryptoData.eth.change24h > 0 ? '+' : ''}${cryptoData.eth.change24h.toFixed(2)}%)` : 'Data unavailable'}

Explain what these movements mean in simple terms for beginners. Keep it educational and encouraging.`;

      const result = await model.generateContent(prompt);
      const response = await result.response;
      aiSummary = response.text();
      logger.info('Gemini summary generated', { length: aiSummary.length });
    } catch (error) {
      logger.error('Gemini API error', { error: error.message });
    }

    // Return comprehensive response
    res.json({
      date: marketData.date,
      markets: {
        sp500: sp500Data,
        crypto: cryptoData
      },
      summary: aiSummary
    });

  } catch (error) {
    logger.error('getDailyBriefing error', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Failed to fetch daily briefing', message: error.message });
  }
});

