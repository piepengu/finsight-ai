# Quick Setup Guide - Get Firebase Config

Since the browser requires sign-in, please follow these steps manually:

## Step 1: Get Firebase Web App Config

1. **Open your browser** and go to:
   https://console.firebase.google.com/project/finsight-ai-jd/settings/general

2. **Scroll down** to the **"Your apps"** section

3. **Click the Web icon** (`</>`) to add a web app

4. **Register the app:**
   - App nickname: `FinSight AI Web`
   - Check "Also set up Firebase Hosting" (optional)
   - Click **Register app**

5. **Copy the `firebaseConfig` object** that appears - it will look like:
   ```javascript
   const firebaseConfig = {
     apiKey: "AIza...",
     authDomain: "finsight-ai-jd.firebaseapp.com",
     projectId: "finsight-ai-jd",
     storageBucket: "finsight-ai-jd.appspot.com",
     messagingSenderId: "99481735828",
     appId: "1:99481735828:web:..."
   };
   ```

6. **Send me the config** and I'll update the code for you!

## Step 2: Enable Google Sign-In

1. Go to: https://console.firebase.google.com/project/finsight-ai-jd/authentication

2. Click **Get Started** (if not already enabled)

3. Go to the **Sign-in method** tab

4. Click on **Google** provider

5. **Enable it** and set:
   - Project support email: Your email
   - Project public-facing name: FinSight AI

6. Click **Save**

## Alternative: I can help you update the code

If you can get the `apiKey` and `appId` values, I can update the code for you. Just tell me:
- The `apiKey` value
- The `appId` value

And I'll update `public/index.html` and redeploy!

