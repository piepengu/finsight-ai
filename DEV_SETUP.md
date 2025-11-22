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

## Running Development Server

### Option 1: Full Emulator Suite (Recommended)
This runs hosting, functions, and Firestore emulators:
```bash
npm run dev
```
- Frontend: http://localhost:5000
- Functions: http://localhost:5001
- Firestore: http://localhost:8080
- Emulator UI: http://localhost:4000

### Option 2: Hosting + Functions Only
```bash
npm run dev:all
```
- Frontend: http://localhost:5000
- Functions: http://localhost:5001

### Option 3: Hosting Only (Static Files)
```bash
npm run dev:hosting
```
- Frontend: http://localhost:5000
- Note: API calls will fail (no functions running)

### Option 4: Functions Only
```bash
npm run dev:functions
```
- Functions: http://localhost:5001
- Useful for testing API endpoints directly

## Development Workflow

1. **Start the emulators:**
   ```bash
   npm run dev
   ```

2. **Open your browser:**
   - Navigate to http://localhost:5000
   - The app will automatically use the local functions emulator

3. **Make changes:**
   - Edit files in `public/` for frontend changes
   - Edit files in `functions/` for backend changes
   - Changes are auto-reloaded (for hosting) or require restart (for functions)

4. **View emulator UI:**
   - Open http://localhost:4000 to see logs, Firestore data, etc.

## Environment Variables

The functions use environment variables for API keys:
- `ALPHA_KEY` - Alpha Vantage API key
- `GEMINI_KEY` - Google Gemini API key

These are configured in Firebase Functions config (production) or can be set locally:
```bash
# In functions/.env.local (not tracked in git)
ALPHA_KEY=your_key_here
GEMINI_KEY=your_key_here
```

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




