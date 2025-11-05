const { onRequest } = require('firebase-functions/v2/https');
const logger = require('firebase-functions/logger');
const axios = require('axios');

exports.helloWorld = onRequest({ region: 'us-east4', cors: true }, (req, res) => {
  logger.info('helloWorld invoked', { method: req.method, path: req.path });
  res.json({ ok: true, message: 'Hello from FinSight AI (us-east4)!' });
});

exports.getDailyBriefing = onRequest({ region: 'us-east4', cors: true }, async (req, res) => {
  logger.info('getDailyBriefing invoked');
  
  try {
    // Use environment variables with fallback to hardcoded values for now
    // TODO: Migrate to proper secrets management
    const alphaKeyValue = process.env.ALPHA_KEY || 'Y35R43GW6L6NOWND';
    const geminiKeyValue = process.env.GEMINI_KEY || 'AIzaSyAR0cUEIWvD1f6UIHC0zCPz9YoUg-VQaKI';

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

