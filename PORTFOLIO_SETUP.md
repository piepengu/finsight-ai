# Portfolio Feature Setup Guide

## ✅ What's Been Completed

1. ✅ Firestore security rules updated
2. ✅ Portfolio UI added (buy/sell form, holdings table, balance display)
3. ✅ Authentication UI added (login/logout buttons)
4. ✅ Backend functions created:
   - `buyStock` - Buy stocks
   - `sellStock` - Sell stocks
   - `getStockPrice` - Get current stock price
5. ✅ Real-time Firestore listeners for portfolio updates
6. ✅ Firebase hosting rewrites configured

## 🔧 Setup Steps Required

### Step 1: Enable Firebase Authentication

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Select your project: `finsight-ai-jd`
3. Click on **Authentication** in the left sidebar
4. Click **Get Started** (if not already enabled)
5. Go to the **Sign-in method** tab
6. Click on **Google** provider
7. Enable it and set:
   - **Project support email**: Your email
   - **Project public-facing name**: FinSight AI
8. Click **Save**

### Step 2: Create Web App and Get Config

1. In Firebase Console, click the gear icon ⚙️ next to **Project Overview**
2. Select **Project settings**
3. Scroll down to **Your apps** section
4. Click the **Web** icon (`</>`) to add a web app
5. Register app:
   - **App nickname**: FinSight AI Web
   - **Firebase Hosting**: Check "Also set up Firebase Hosting"
   - Click **Register app**
6. Copy the `firebaseConfig` object that appears
7. It should look like:
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

### Step 3: Update Firebase Config in Code

1. Open `public/index.html`
2. Find the `firebaseConfig` object (around line 12)
3. Replace the placeholder values with your actual config from Step 2
4. **Important**: Make sure you use the Firebase API key (not the Gemini key!)

### Step 4: Deploy Firestore Rules

```bash
firebase deploy --only firestore:rules
```

### Step 5: Deploy Functions

```bash
firebase deploy --only functions
```

### Step 6: Deploy Hosting

```bash
firebase deploy --only hosting
```

## 🧪 Testing

1. Visit your site: https://finsight-ai-jd.web.app
2. Click **Sign in with Google**
3. After signing in, you should see:
   - Your name in the top right
   - Portfolio section with $10,000 starting balance
   - Buy/Sell form
4. Try buying a stock:
   - Enter symbol: `AAPL`
   - Quantity: `1`
   - Click **Buy**
5. Check your portfolio:
   - Holdings table should show your purchase
   - Balance should decrease
   - Portfolio value should update

## 📁 Firestore Structure

After setup, your Firestore will have this structure:

```
users/
  {userId}/
    account/
      balance/
        balance: 10000.00
        totalInvested: 0.00
        createdAt: timestamp
    portfolio/
      {stockSymbol}/
        shares: number
        avgPrice: number
        totalCost: number
        firstPurchased: timestamp
        lastUpdated: timestamp
```

## 🔒 Security

- Users can only read/write their own data (enforced by Firestore rules)
- All API calls require authentication token
- API keys stored securely in Firebase Secrets

## 🐛 Troubleshooting

### "Firebase not initialized" error
- Check that Firebase config is correct in `index.html`
- Make sure you're using the Firebase API key (not Gemini key)

### "Unauthorized" error when buying/selling
- Make sure you're signed in
- Check that Firebase Authentication is enabled in console

### Portfolio not showing
- Check browser console for errors
- Verify Firestore rules are deployed
- Make sure you're signed in

### Stock price not loading
- Alpha Vantage API might be rate-limited
- Check function logs: `firebase functions:log`

## 📝 Next Steps

After setup is complete, you can:
- Test buying and selling stocks
- View real-time portfolio updates
- Check P&L calculations
- Test with multiple stocks

## 🎉 Features

- ✅ Google Sign-In authentication
- ✅ $10,000 starting virtual money
- ✅ Buy stocks with real-time prices
- ✅ Sell stocks from portfolio
- ✅ Real-time portfolio updates
- ✅ P&L calculations
- ✅ Average price calculation for multiple purchases
- ✅ Secure API endpoints

