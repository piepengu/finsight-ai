async function fetchBriefing() {
  const btn = document.getElementById('fetch-btn');
  const output = document.getElementById('output');
  
  btn.disabled = true;
  btn.textContent = 'Loading...';
  output.innerHTML = '<div class="loading">Fetching market data and generating AI summary...</div>';

  try {
    const res = await fetch('/api/briefing');
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }
    const data = await res.json();

    // Format market data for display
    let marketsHTML = '';
    
    if (data.markets?.sp500) {
      const sp = data.markets.sp500;
      const changeClass = sp.changePercent >= 0 ? 'positive' : 'negative';
      marketsHTML += `
        <div class="market-card">
          <h3>S&P 500 (SPY)</h3>
          <div class="price">$${sp.price.toFixed(2)}</div>
          <div class="change ${changeClass}">
            ${sp.changePercent >= 0 ? '+' : ''}${sp.changePercent.toFixed(2)}%
            (${sp.change >= 0 ? '+' : ''}$${sp.change.toFixed(2)})
          </div>
          <div style="font-size: 0.85rem; color: #6b7280; margin-top: 0.5rem;">
            High: $${sp.high.toFixed(2)} | Low: $${sp.low.toFixed(2)}
          </div>
        </div>
      `;
    }

    if (data.markets?.crypto) {
      const crypto = data.markets.crypto;
      
      if (crypto.btc) {
        const btcChangeClass = crypto.btc.change24h >= 0 ? 'positive' : 'negative';
        marketsHTML += `
          <div class="market-card">
            <h3>Bitcoin (BTC)</h3>
            <div class="price">$${crypto.btc.price.toLocaleString()}</div>
            <div class="change ${btcChangeClass}">
              ${crypto.btc.change24h >= 0 ? '+' : ''}${crypto.btc.change24h.toFixed(2)}%
            </div>
          </div>
        `;
      }

      if (crypto.eth) {
        const ethChangeClass = crypto.eth.change24h >= 0 ? 'positive' : 'negative';
        marketsHTML += `
          <div class="market-card">
            <h3>Ethereum (ETH)</h3>
            <div class="price">$${crypto.eth.price.toLocaleString()}</div>
            <div class="change ${ethChangeClass}">
              ${crypto.eth.change24h >= 0 ? '+' : ''}${crypto.eth.change24h.toFixed(2)}%
            </div>
          </div>
        `;
      }
    }

    // Build final HTML
    output.innerHTML = `
      <div class="briefing">
        <div class="date">📅 ${data.date || 'Today'}</div>
        ${marketsHTML ? `<div class="markets">${marketsHTML}</div>` : ''}
        <div class="summary">
          <h2>🤖 AI Summary</h2>
          <p>${data.summary || 'Summary unavailable'}</p>
        </div>
      </div>
    `;

  } catch (err) {
    output.innerHTML = `
      <div class="error">
        <strong>Error loading briefing:</strong><br>
        ${err.message || String(err)}
      </div>
    `;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Get Today\'s Briefing';
  }
}

async function loadMagnificent7() {
  const bannerContent = document.getElementById('magnificent7-content');
  
  try {
    // Add timeout to prevent hanging
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 95000); // 95 second timeout
    
    const res = await fetch('/api/magnificent7', { signal: controller.signal });
    clearTimeout(timeoutId);
    
    if (!res.ok) {
      if (res.status === 503) {
        throw new Error('Service temporarily unavailable. Please refresh the page in a moment.');
      }
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }
    const data = await res.json();

    if (data.stocks && data.stocks.length > 0) {
      let stocksHTML = '<div class="magnificent7-grid">';
      
      data.stocks.forEach(stock => {
        const changeClass = stock.changePercent >= 0 ? 'positive' : 'negative';
        stocksHTML += `
          <div class="magnificent7-item">
            <div class="symbol">${stock.symbol}</div>
            <div class="name">${stock.name}</div>
            <div class="price">$${stock.price.toFixed(2)}</div>
            <div class="change ${changeClass}">
              ${stock.changePercent >= 0 ? '+' : ''}${stock.changePercent.toFixed(2)}%
            </div>
          </div>
        `;
      });
      
      stocksHTML += '</div>';
      if (data.cached) {
        stocksHTML += '<div style="text-align: center; margin-top: 0.5rem; font-size: 0.75rem; color: rgba(255,255,255,0.7);">📦 Showing cached data</div>';
      } else if (data.partial) {
        stocksHTML += '<div style="text-align: center; margin-top: 0.5rem; font-size: 0.8rem; color: rgba(255,255,255,0.8);">Showing available stocks (some may be rate-limited)</div>';
      }
      bannerContent.innerHTML = stocksHTML;
    } else {
      bannerContent.innerHTML = '<div class="magnificent7-loading">Stock data temporarily unavailable due to rate limits. Please refresh in a minute.</div>';
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      bannerContent.innerHTML = '<div class="magnificent7-loading">Loading is taking longer than expected. Please refresh the page.</div>';
    } else {
      bannerContent.innerHTML = `<div class="magnificent7-loading">${err.message || 'Error loading stocks. Please refresh the page.'}</div>`;
    }
  }
}

// Authentication functions
async function signInWithGoogle() {
  try {
    if (!window.firebaseAuth || !window.googleProvider || !window.firebaseAuthFunctions) {
      throw new Error('Firebase not initialized. Please check Firebase config.');
    }
    await window.firebaseAuthFunctions.signInWithPopup(window.firebaseAuth, window.googleProvider);
  } catch (error) {
    console.error('Sign in error:', error);
    alert('Error signing in: ' + error.message);
  }
}

async function signOutUser() {
  try {
    if (!window.firebaseAuth || !window.firebaseAuthFunctions) return;
    await window.firebaseAuthFunctions.signOut(window.firebaseAuth);
  } catch (error) {
    console.error('Sign out error:', error);
  }
}

// Portfolio functions
async function buyStock() {
  const symbol = document.getElementById('stock-symbol').value.toUpperCase().trim();
  const quantity = parseInt(document.getElementById('stock-quantity').value);
  const messageDiv = document.getElementById('trading-message');
  
  if (!symbol || !quantity || quantity < 1) {
    messageDiv.innerHTML = '<div class="error">Please enter a valid symbol and quantity.</div>';
    return;
  }

  const buyBtn = document.getElementById('buy-btn');
  buyBtn.disabled = true;
  buyBtn.textContent = 'Buying...';
  buyBtn.style.opacity = '0.7';
  messageDiv.innerHTML = '<div style="color: #2563eb; padding: 0.5rem; background: #dbeafe; border-radius: 4px;">⏳ Processing purchase...</div>';

  try {
    const token = await window.firebaseAuth.currentUser.getIdToken();
    const res = await fetch('/api/buyStock', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ symbol, quantity })
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to buy stock');
    }

    // Show success message with animation
    messageDiv.innerHTML = `<div style="color: #059669; padding: 0.75rem; background: #d1fae5; border-radius: 6px; font-weight: 600; animation: slideIn 0.3s ease-out;">✅ Successfully bought ${quantity} share(s) of ${symbol} at $${data.price.toFixed(2)}!</div>`;
    document.getElementById('stock-symbol').value = '';
    document.getElementById('stock-quantity').value = '';
    
    // Clear message after 5 seconds
    setTimeout(() => {
      messageDiv.innerHTML = '';
    }, 5000);
  } catch (err) {
    messageDiv.innerHTML = `<div class="error" style="animation: slideIn 0.3s ease-out;">❌ Error: ${err.message}</div>`;
    setTimeout(() => {
      messageDiv.innerHTML = '';
    }, 5000);
  } finally {
    buyBtn.disabled = false;
    buyBtn.textContent = 'Buy';
    buyBtn.style.opacity = '1';
  }
}

async function sellStock() {
  const symbol = document.getElementById('stock-symbol').value.toUpperCase().trim();
  const quantity = parseInt(document.getElementById('stock-quantity').value);
  const messageDiv = document.getElementById('trading-message');
  
  if (!symbol || !quantity || quantity < 1) {
    messageDiv.innerHTML = '<div class="error">Please enter a valid symbol and quantity.</div>';
    return;
  }

  const sellBtn = document.getElementById('sell-btn');
  sellBtn.disabled = true;
  sellBtn.textContent = 'Selling...';
  sellBtn.style.opacity = '0.7';
  messageDiv.innerHTML = '<div style="color: #dc2626; padding: 0.5rem; background: #fee2e2; border-radius: 4px;">⏳ Processing sale...</div>';

  try {
    const token = await window.firebaseAuth.currentUser.getIdToken();
    const res = await fetch('/api/sellStock', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ symbol, quantity })
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to sell stock');
    }

    // Show success message with animation
    const profitText = data.profitLoss >= 0 
      ? ` (Profit: $${data.profitLoss.toFixed(2)})` 
      : ` (Loss: $${Math.abs(data.profitLoss).toFixed(2)})`;
    messageDiv.innerHTML = `<div style="color: #059669; padding: 0.75rem; background: #d1fae5; border-radius: 6px; font-weight: 600; animation: slideIn 0.3s ease-out;">✅ Successfully sold ${quantity} share(s) of ${symbol} at $${data.price.toFixed(2)}${profitText}</div>`;
    document.getElementById('stock-symbol').value = '';
    document.getElementById('stock-quantity').value = '';
    
    // Clear message after 5 seconds
    setTimeout(() => {
      messageDiv.innerHTML = '';
    }, 5000);
  } catch (err) {
    messageDiv.innerHTML = `<div class="error" style="animation: slideIn 0.3s ease-out;">❌ Error: ${err.message}</div>`;
    setTimeout(() => {
      messageDiv.innerHTML = '';
    }, 5000);
  } finally {
    sellBtn.disabled = false;
    sellBtn.textContent = 'Sell';
    sellBtn.style.opacity = '1';
  }
}

// Load portfolio data from Firestore
function setupPortfolioListeners(userId) {
  if (!window.firebaseDb || !window.firebaseFirestoreFunctions) return;

  const { doc, onSnapshot, collection, query, orderBy, limit } = window.firebaseFirestoreFunctions;
  
  // Listen to account balance
  const accountRef = doc(window.firebaseDb, 'users', userId, 'account', 'balance');
  onSnapshot(accountRef, (snapshot) => {
    if (snapshot.exists()) {
      const data = snapshot.data();
      const balance = data.balance || 10000.00;
      document.getElementById('cash-balance').textContent = `$${balance.toFixed(2)}`;
      updatePortfolioValue();
    } else {
      // Account not initialized yet, show default
      document.getElementById('cash-balance').textContent = '$10,000.00';
    }
  });

  // Listen to portfolio holdings
  const portfolioRef = collection(window.firebaseDb, 'users', userId, 'portfolio');
  onSnapshot(portfolioRef, async (snapshot) => {
    const holdings = [];
    snapshot.forEach((doc) => {
      holdings.push({ symbol: doc.id, ...doc.data() });
    });
    await updateHoldingsTable(holdings);
  });

  // Listen to transaction history (last 50 transactions)
  const transactionsRef = collection(window.firebaseDb, 'users', userId, 'transactions');
  const transactionsQuery = query(transactionsRef, orderBy('timestamp', 'desc'), limit(50));
  onSnapshot(transactionsQuery, (snapshot) => {
    const transactions = [];
    snapshot.forEach((doc) => {
      transactions.push({ id: doc.id, ...doc.data() });
    });
    updateTransactionHistory(transactions);
  });
}

async function updateHoldingsTable(holdings) {
  const tbody = document.getElementById('holdings-tbody');
  
  if (holdings.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="padding: 2rem; text-align: center; color: #6b7280;">No holdings yet. Start trading!</td></tr>';
    return;
  }

  // Fetch current prices for all holdings
  const holdingsWithPrices = await Promise.all(holdings.map(async (holding) => {
    try {
      const res = await fetch(`/api/stockPrice?symbol=${holding.symbol}`);
      const data = await res.json();
      return { ...holding, currentPrice: data.price || 0 };
    } catch (err) {
      return { ...holding, currentPrice: holding.avgPrice || 0 };
    }
  }));

  let totalValue = 0;
  let html = '';
  
  holdingsWithPrices.forEach((holding) => {
    const value = holding.shares * holding.currentPrice;
    const cost = holding.totalCost || (holding.shares * holding.avgPrice);
    const pl = value - cost;
    const plPercent = cost > 0 ? ((pl / cost) * 100) : 0;
    totalValue += value;

    const plClass = pl >= 0 ? 'positive' : 'negative';
    html += `
      <tr>
        <td style="padding: 1rem; font-weight: 600;">${holding.symbol}</td>
        <td style="padding: 1rem; text-align: right;">${holding.shares}</td>
        <td style="padding: 1rem; text-align: right;">$${holding.avgPrice.toFixed(2)}</td>
        <td style="padding: 1rem; text-align: right;">$${holding.currentPrice.toFixed(2)}</td>
        <td style="padding: 1rem; text-align: right;">$${value.toFixed(2)}</td>
        <td style="padding: 1rem; text-align: right;" class="change ${plClass}">
          ${pl >= 0 ? '+' : ''}$${pl.toFixed(2)} (${plPercent >= 0 ? '+' : ''}${plPercent.toFixed(2)}%)
        </td>
      </tr>
    `;
  });

  tbody.innerHTML = html;
  updatePortfolioValue(totalValue);
}

function updatePortfolioValue(holdingsValue = 0) {
  const cashBalance = parseFloat(document.getElementById('cash-balance').textContent.replace('$', '').replace(',', ''));
  const totalValue = cashBalance + holdingsValue;
  const startingCapital = 10000;
  const totalPL = totalValue - startingCapital;
  const plClass = totalPL >= 0 ? 'positive' : 'negative';

  document.getElementById('portfolio-value').textContent = `$${totalValue.toFixed(2)}`;
  const plElement = document.getElementById('total-pl');
  plElement.textContent = `${totalPL >= 0 ? '+' : ''}$${totalPL.toFixed(2)}`;
  plElement.className = `change ${plClass}`;
  plElement.style.color = totalPL >= 0 ? '#059669' : '#dc2626';
}

function updateTransactionHistory(transactions) {
  const tbody = document.getElementById('transaction-tbody');
  
  if (transactions.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="padding: 2rem; text-align: center; color: #6b7280;">No transactions yet.</td></tr>';
    return;
  }

  let html = '';
  transactions.forEach((tx) => {
    const date = tx.timestamp ? new Date(tx.timestamp.toDate ? tx.timestamp.toDate() : tx.timestamp).toLocaleString() : 'N/A';
    const typeClass = tx.type === 'buy' ? 'positive' : 'negative';
    const typeText = tx.type === 'buy' ? 'Buy' : 'Sell';
    
    html += `
      <tr>
        <td style="padding: 1rem; color: #6b7280; font-size: 0.9rem;">${date}</td>
        <td style="padding: 1rem;"><span class="change ${typeClass}" style="font-weight: 600;">${typeText}</span></td>
        <td style="padding: 1rem; font-weight: 600;">${tx.symbol}</td>
        <td style="padding: 1rem; text-align: right;">${tx.shares}</td>
        <td style="padding: 1rem; text-align: right;">$${tx.price.toFixed(2)}</td>
        <td style="padding: 1rem; text-align: right; font-weight: 600;">$${tx.totalAmount.toFixed(2)}</td>
      </tr>
    `;
  });

  tbody.innerHTML = html;
}

// Initialize auth state listener
function initAuth() {
  if (!window.firebaseAuth || !window.firebaseAuthFunctions) {
    console.error('Firebase Auth not initialized');
    return;
  }

  window.firebaseAuthFunctions.onAuthStateChanged(window.firebaseAuth, (user) => {
    const loginBtn = document.getElementById('login-btn');
    const userInfo = document.getElementById('user-info');
    const userName = document.getElementById('user-name');
    const portfolioSection = document.getElementById('portfolio-section');

    if (user) {
      // User is signed in
      loginBtn.style.display = 'none';
      userInfo.style.display = 'block';
      userName.textContent = user.displayName || user.email;
      portfolioSection.style.display = 'block';
      setupPortfolioListeners(user.uid);
    } else {
      // User is signed out
      loginBtn.style.display = 'block';
      userInfo.style.display = 'none';
      portfolioSection.style.display = 'none';
    }
  });
}

window.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('fetch-btn');
  if (btn) {
    btn.addEventListener('click', fetchBriefing);
  }
  
  // Load Magnificent 7 banner on page load
  loadMagnificent7();

  // Setup auth
  setTimeout(() => {
    initAuth();
    document.getElementById('login-btn').addEventListener('click', signInWithGoogle);
    document.getElementById('logout-btn').addEventListener('click', signOutUser);
    document.getElementById('buy-btn').addEventListener('click', buyStock);
    document.getElementById('sell-btn').addEventListener('click', sellStock);
  }, 1000); // Wait for Firebase to initialize
});
