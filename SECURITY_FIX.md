# Security Fix: Firebase API Key Restrictions

## Status
✅ **Firebase API keys are MEANT to be public** - this is normal and expected for Firebase web apps. However, we should add restrictions to limit usage.

## What to Do

### Option 1: Add Restrictions (Recommended - Keep Current Key)

1. **Go to Google Cloud Console:**
   - Visit: https://console.cloud.google.com/apis/credentials?project=finsight-ai-jd

2. **Find your API key:**
   - Look for key: `AIzaSyBN3LaYDWfhW9M2URxQXs6OZEvvjzIImnE`
   - Click on it to edit

3. **Add Application Restrictions:**
   - Under "Application restrictions", select **"HTTP referrers (websites)"**
   - Add these referrers:
     ```
     https://finsight-ai-jd.web.app/*
     https://finsight-ai-jd.firebaseapp.com/*
     http://localhost:*
     http://127.0.0.1:*
     ```
   - This limits the key to only work from your domain

4. **Add API Restrictions:**
   - Under "API restrictions", select **"Restrict key"**
   - Select only these APIs:
     - Firebase Authentication API
     - Cloud Firestore API
     - Firebase Installations API
     - Firebase Remote Config API (if used)
   - This prevents the key from being used for other Google services

5. **Click "Save"**

### Option 2: Regenerate Key (Extra Security)

If you want to be extra cautious:

1. **Create a new API key:**
   - In Google Cloud Console > APIs & Services > Credentials
   - Click "Create Credentials" > "API key"
   - Configure restrictions as above

2. **Update Firebase Project:**
   - Go to Firebase Console: https://console.firebase.google.com/project/finsight-ai-jd/settings/general
   - Under "Your apps", find your web app
   - Click the gear icon > "Config"
   - Copy the new `apiKey`

3. **Update code:**
   - Update `public/index.html` with the new `apiKey`
   - Deploy: `firebase deploy --only hosting`

4. **Delete old key:**
   - Go back to Credentials page
   - Delete the old exposed key

## Important Notes

- **Firebase web app API keys are public by design** - they're included in client-side JavaScript
- **Restrictions are the security layer** - they prevent unauthorized usage
- **The key itself is not a secret** - the restrictions protect you
- **This is different from server-side API keys** (like Gemini/Alpha Vantage) which should NEVER be public

## Current Security Status

✅ **Server-side keys (Gemini, Alpha Vantage):** Stored securely in Firebase Functions secrets
✅ **Firebase web app key:** Public (as intended), but needs restrictions added
⚠️ **Action needed:** Add HTTP referrer and API restrictions to Firebase key

## After Adding Restrictions

The key will only work from:
- Your production domain: `https://finsight-ai-jd.web.app`
- Your Firebase hosting: `https://finsight-ai-jd.firebaseapp.com`
- Local development: `http://localhost:*`

This prevents anyone else from using your key even if they see it in your GitHub repo.

