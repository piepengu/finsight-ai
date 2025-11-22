# Setting Up API Keys Securely

## Problem
Your Gemini API key was exposed in the source code and Google revoked it. API keys should NEVER be hardcoded in source code, especially if your repository is public.

## Solution: Use Firebase Functions Secrets

Firebase Functions has a built-in secrets management system that securely stores API keys.

## Steps to Fix

### 1. Get a New Gemini API Key

1. Go to [Google AI Studio](https://aistudio.google.com/app/apikey)
2. Click "Create API Key"
3. Copy the new API key (starts with `AIzaSy...`)

### 2. Set API Keys as Firebase Secrets

Run these commands in your terminal:

```bash
# Set Gemini API key
firebase functions:secrets:set GEMINI_KEY

# When prompted, paste your new Gemini API key and press Enter

# Set Alpha Vantage API key (if you have a new one)
firebase functions:secrets:set ALPHA_KEY

# When prompted, paste your Alpha Vantage API key and press Enter
```

### 3. Update functions/index.js to Use Secrets

The code has already been updated to require environment variables. You need to configure the functions to access the secrets.

Add this to your `functions/index.js` at the top (after the requires):

```javascript
// Configure functions to use secrets
const { defineSecret } = require('firebase-functions/params');

// Define secrets
const geminiKey = defineSecret('GEMINI_KEY');
const alphaKey = defineSecret('ALPHA_KEY');
```

Then update your function definitions to include the secrets:

```javascript
exports.getDailyBriefing = onRequest(
  { 
    region: 'us-east4', 
    cors: true,
    secrets: [geminiKey, alphaKey]  // Add this
  }, 
  async (req, res) => {
    // Use geminiKey.value() and alphaKey.value() instead of process.env
    const geminiKeyValue = geminiKey.value();
    const alphaKeyValue = alphaKey.value();
    // ... rest of code
  }
);
```

### 4. Deploy the Functions

After setting secrets and updating code:

```bash
firebase deploy --only functions
```

## Alternative: Quick Fix (Less Secure)

If you need a quick fix for testing, you can temporarily set environment variables:

```bash
# Set environment variables (these are visible in Firebase Console)
firebase functions:config:set gemini.key="YOUR_NEW_GEMINI_KEY"
firebase functions:config:set alpha.key="YOUR_ALPHA_KEY"

# Then update code to use:
const geminiKeyValue = functions.config().gemini?.key;
const alphaKeyValue = functions.config().alpha?.key;
```

**Note:** This method is less secure than secrets, but works for Functions v1. For Functions v2, use secrets (method above).

## Security Best Practices

✅ **DO:**
- Use Firebase Functions Secrets for sensitive keys
- Keep API keys out of source code
- Use `.gitignore` to exclude any config files with keys
- Rotate keys if they're ever exposed

❌ **DON'T:**
- Hardcode API keys in source code
- Commit API keys to Git
- Share API keys in screenshots or documentation
- Use the same key in multiple projects

## Verify Your Setup

After deploying, test your function:

```bash
curl https://us-east4-finsight-ai-jd.cloudfunctions.net/getDailyBriefing
```

If it works, you should see market data and an AI summary (if quota allows).

