# FinSight AI

Daily AI market briefing and **virtual portfolio simulator** for young investors — learn markets with Gemini summaries, practice trades, and plain-English stock explainers.

**Live demo:** https://finsight-ai-jd.web.app

## Overview

FinSight is a Firebase full-stack app: a static frontend talks to Cloud Functions that pull market data, cache Magnificent 7 quotes, and call Gemini for briefings, explanations, and educational recommendations. Auth + Firestore power a paper-trading portfolio and watchlist.

## Architecture

```
Browser (public/)  ──►  Firebase Hosting
                         │
                         ├── Cloud Functions (us-east4)
                         │     market APIs · Gemini · Mag7 cache job
                         └── Auth + Firestore (portfolio / watchlist)
```

## Tech stack

| Layer | Tools |
|-------|--------|
| Frontend | HTML / CSS / JS, Chart.js, Firebase Auth client |
| Backend | Node 20 Cloud Functions, Firebase Admin |
| AI / data | Google Gemini, Alpha Vantage (and related quote sources) |
| Infra | Firebase Hosting, Firestore, scheduled Mag7 cache refresh |

## Features

- Auto-loading daily briefing (S&P 500 / SPY, BTC, ETH + AI summary)
- Magnificent 7 banner with stale-full cache + scheduled refresh
- Virtual portfolio (Google Sign-In, buy/sell, P&L, history chart)
- Watchlist, Explain It, educational stock recommendations
- Beginner learning tips and educational disclaimers throughout

## Quickstart

```bash
git clone https://github.com/piepengu/finsight-ai.git
cd finsight-ai
npm install
cd functions && npm install && cd ..
cp functions/.env.example functions/.env   # local secrets only if using emulators
```

**Prerequisites:** Node 20+, Firebase CLI, access to project `finsight-ai-jd`.

Production secrets (`ALPHA_KEY`, `GEMINI_KEY`) live in **Firebase Functions secrets** — not in the client. See [DEV_SETUP.md](./DEV_SETUP.md).

```bash
# Prefer testing against the live site, or deploy hosting only:
npm run deploy:hosting
# Full stack:
npm run deploy
```

## Security

- Vendor API keys stay in Functions secrets / `.env` (gitignored)
- The Firebase web `apiKey` is public by design; restrict HTTP referrers in GCP (see [SECURITY_FIX.md](./SECURITY_FIX.md))

## License

MIT — see [LICENSE](./LICENSE).
