# Development Setup Guide

## Prerequisites

1. **Node.js** (v20 or higher)
   - Download from [nodejs.org](https://nodejs.org/)
   - Verify: `node --version`

2. **Firebase CLI**
   - Install globally: `npm install -g firebase-tools`
   - Login: `firebase login`
   - Verify: `firebase --version`

3. **Java JDK** (for Firestore emulator - optional)
   - Download JDK 17+ from [Adoptium](https://adoptium.net/)
   - Needed only if you want to test Firestore locally

## Installation

1. **Install root dependencies:**
   ```bash
   npm install
   ```

2. **Install function dependencies:**
   ```bash
   cd functions
   npm install
   cd ..
   ```

## Recommended workflow: cloud-backed testing

The production app at https://finsight-ai-jd.web.app is the supported path for Auth, Firestore, secrets, and Mag7 cache.

1. Edit `public/` or `functions/`
2. Deploy what you changed:
   ```bash
   npm run deploy:hosting
   npm run deploy:functions
   ```
3. Smoke-test on the live URL (Sign-In, Mag7, briefing, Explain, Recommend, portfolio)

Local emulators are optional and incomplete without extra setup (below).

## Running Emulators (optional)

### Option 1: Full Emulator Suite
Requires **JDK 17+** for the Firestore emulator.
```bash
npm run dev
```
- Frontend: http://localhost:5000
- Functions: http://localhost:5001
- Firestore: http://localhost:8080
- Emulator UI: http://localhost:4000

**Note:** The frontend does **not** call `connectAuthEmulator` / `connectFirestoreEmulator`. Even with emulators running, Auth and Firestore still talk to **production** unless you add that wiring.

### Option 2: Hosting + Functions Only
```bash
npm run dev:all
```

### Option 3: Hosting Only
```bash
npm run dev:hosting
```
- Frontend: http://localhost:5000
- Without functions emulator, `/api/*` calls will fail locally

### Option 4: Functions Only
```bash
npm run dev:functions
```

## Environment Variables / Secrets

Production uses Firebase Functions secrets:
- `ALPHA_KEY` — Alpha Vantage
- `GEMINI_KEY` — Google Gemini

```bash
firebase functions:secrets:set ALPHA_KEY
firebase functions:secrets:set GEMINI_KEY
```

For local functions emulator, create gitignored secret files as documented by Firebase (`functions/.secret.local` or params), e.g.:
```
ALPHA_KEY=your_key_here
GEMINI_KEY=your_key_here
```
Do not commit these files.

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
├── package.json         # Root package.json with dev scripts
└── DEV_SETUP.md         # This file
```

## Troubleshooting

### Emulators won't start
- Make sure Firebase CLI is installed: `firebase --version`
- Check if ports 5000, 5001, 4000, 8080 are available
- Try: `firebase emulators:start --only hosting` to test hosting first

### Functions not working locally
- Ensure functions dependencies are installed: `cd functions && npm install`
- Check function logs in the emulator UI (http://localhost:4000)
- Verify API keys are set correctly

### CORS errors
- Functions already have `cors: true` configured
- Make sure you're using the emulator URL, not production

## Deployment

```bash
# Deploy everything
npm run deploy

# Deploy only hosting
npm run deploy:hosting

# Deploy only functions
npm run deploy:functions
```

## Useful Commands

```bash
# View Firebase project info
firebase projects:list

# View functions logs
firebase functions:log

# Test function locally
curl http://localhost:5001/finsight-ai-jd/us-east4/getDailyBriefing
```




