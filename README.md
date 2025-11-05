# FinSight AI

Daily AI-powered market briefing for young investors.

## Quick Start

### Prerequisites
- Node.js v20+
- Firebase CLI (`npm install -g firebase-tools`)
- Firebase account (login with `firebase login`)

### Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   cd functions && npm install && cd ..
   ```

3. Start development server:
   ```bash
   npm run dev
   ```

4. Open your browser:
   - Frontend: http://localhost:5000
   - Emulator UI: http://localhost:4000

## Available Scripts

- `npm run dev` - Start all Firebase emulators (hosting + functions + Firestore)
- `npm run dev:all` - Start hosting + functions emulators
- `npm run dev:hosting` - Start only hosting emulator
- `npm run dev:functions` - Start only functions emulator
- `npm run deploy` - Deploy to Firebase
- `npm run deploy:hosting` - Deploy only hosting
- `npm run deploy:functions` - Deploy only functions

## Project Structure

```
finsight-ai/
├── public/              # Frontend (HTML, CSS, JS)
│   ├── index.html
│   ├── app.js
│   └── styles.css
├── functions/           # Backend (Firebase Functions)
│   ├── index.js
│   └── package.json
├── firebase.json        # Firebase configuration
└── package.json         # Root package.json with dev scripts
```

## Features

- 📊 Real-time S&P 500 (SPY) data from Alpha Vantage
- ₿ Bitcoin and Ethereum prices from CoinGecko
- 🤖 AI-powered market summaries using Google Gemini
- 🎨 Modern, responsive UI

## Development

For detailed development setup instructions, see [DEV_SETUP.md](./DEV_SETUP.md).

## Deployment

The app is deployed to Firebase Hosting:
- Production: https://finsight-ai-jd.web.app

## License

MIT
