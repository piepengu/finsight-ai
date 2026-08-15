# FinSight AI

Daily AI-powered market briefing and virtual portfolio simulator for young investors.

**Live:** https://finsight-ai-jd.web.app

## Features

- Daily market briefing (S&P 500 via SPY, Bitcoin, Ethereum) with Gemini AI summary
- Magnificent 7 price banner (cached + scheduled refresh)
- Virtual portfolio simulator (Google Sign-In, buy/sell, P&L, Chart.js history)
- Watchlist
- Explain It — beginner-friendly company summaries
- AI stock recommendations (educational only)

## Quick Start

### Prerequisites

- Node.js v20+
- Firebase CLI (`npm install -g firebase-tools` or use local `npx firebase`)
- Firebase login (`firebase login`) linked to project `finsight-ai-jd`
- API secrets already set in production: `ALPHA_KEY`, `GEMINI_KEY`

### Installation

```bash
npm install
cd functions && npm install && cd ..
```

### Development

**Recommended (matches production Auth/Firestore/secrets):** use deployed Cloud Functions and Hosting, or deploy hosting locally while calling cloud APIs.

```bash
# Static hosting only (API calls hit production rewrites when deployed;
# locally, prefer testing against https://finsight-ai-jd.web.app)
npm run dev:hosting
```

Full emulators (`npm run dev`) need JDK 17+ for Firestore and local secret wiring in `functions/.env` / `.secret.local`. The frontend does not connect to Auth/Firestore emulators by default — see [DEV_SETUP.md](./DEV_SETUP.md).

### Deploy

```bash
npm run deploy
# or
npm run deploy:hosting
npm run deploy:functions
```

## Project Structure

```
finsight-ai/
├── public/              # Frontend (HTML, CSS, JS)
├── functions/           # Cloud Functions (Node 20)
├── firebase.json
└── package.json
```

## Security notes

- Vendor API keys live in Firebase Functions secrets — never in the client.
- The Firebase web `apiKey` is public by design; restrict it with HTTP referrers in Google Cloud Console (see [SECURITY_FIX.md](./SECURITY_FIX.md)).

## License

MIT
