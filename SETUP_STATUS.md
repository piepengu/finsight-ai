# Portfolio Feature Setup Status

## Status: Complete

Firebase web config, Google Auth, portfolio functions, and Hosting are already set up for project `finsight-ai-jd`.

**Live app:** https://finsight-ai-jd.web.app

## What is deployed

- `buyStock`, `sellStock`, `getStockPrice`, `getPortfolioHistory`
- Watchlist, Explain It, stock recommendations, daily briefing, Mag7
- Firestore rules (users only access their own data)
- API keys via Functions secrets (`ALPHA_KEY`, `GEMINI_KEY`)

## Optional / ops checklist

1. **Restrict the Firebase web API key** — see [SECURITY_FIX.md](./SECURITY_FIX.md)
2. **Smoke-test Sign-In** on production: portfolio $10k init, buy/sell, chart, watchlist
3. **Deploy after local changes:**
   ```bash
   npx firebase login --reauth
   npx firebase deploy --only hosting,functions --project finsight-ai-jd
   ```

## Local development

Prefer cloud-backed testing. Emulators are optional and incomplete without JDK + emulator wiring — see [DEV_SETUP.md](./DEV_SETUP.md).
