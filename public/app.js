/** Latest briefing payload for shareable card generation */
let lastBriefingData = null;

function getBriefingShareUrl() {
  const url = new URL(window.location.href);
  url.hash = 'briefing';
  url.search = '';
  return url.toString();
}

function formatSignedPercent(value) {
  if (value == null || Number.isNaN(Number(value))) return '—';
  const n = Number(value);
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

function truncateText(text, maxLen) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= maxLen) return clean;
  return `${clean.slice(0, maxLen - 1).trim()}…`;
}

function wrapCanvasText(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';

  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
      if (lines.length >= maxLines) break;
    } else {
      line = test;
    }
  }
  if (lines.length < maxLines && line) lines.push(line);
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    let last = lines[maxLines - 1];
    while (ctx.measureText(`${last}…`).width > maxWidth && last.length > 0) {
      last = last.slice(0, -1);
    }
    lines[maxLines - 1] = `${last}…`;
  }

  lines.forEach((l, i) => ctx.fillText(l, x, y + i * lineHeight));
  return lines.length;
}

function buildShareCaption(data) {
  const date = data?.date || 'Today';
  const sp = data?.markets?.sp500;
  const btc = data?.markets?.crypto?.btc;
  const bits = [`FinSight AI — today's market in plain English (${date})`];
  if (sp) bits.push(`S&P 500 (SPY) $${sp.price.toFixed(2)} (${formatSignedPercent(sp.changePercent)})`);
  if (btc) bits.push(`BTC $${Number(btc.price).toLocaleString()} (${formatSignedPercent(btc.change24h)} 24h)`);
  bits.push(truncateText(data?.summary, 180));
  bits.push('Educational only — not financial advice.');
  bits.push(getBriefingShareUrl());
  return bits.join('\n');
}

async function renderBriefingShareCard(data) {
  const W = 1200;
  const H = 630;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  try {
    await document.fonts.ready;
  } catch (_) { /* ignore */ }

  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, '#e8f4f2');
  grad.addColorStop(0.45, '#f4f7f6');
  grad.addColorStop(1, '#dbeafe');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = 'rgba(15, 118, 110, 0.12)';
  ctx.beginPath();
  ctx.arc(1040, -40, 280, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(3, 105, 161, 0.1)';
  ctx.beginPath();
  ctx.arc(-40, 520, 260, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = 'rgba(255, 253, 249, 0.92)';
  roundRect(ctx, 48, 48, W - 96, H - 96, 28);
  ctx.fill();

  ctx.fillStyle = '#0f766e';
  ctx.fillRect(48, 48, 14, H - 96);

  ctx.fillStyle = '#102a2e';
  ctx.font = '800 42px Syne, Avenir Next, Segoe UI, sans-serif';
  ctx.fillText('FinSight AI', 90, 120);

  ctx.fillStyle = '#6b8589';
  ctx.font = '600 22px Figtree, Segoe UI, sans-serif';
  ctx.fillText("Today's market in plain English", 90, 158);

  const dateLabel = data?.date || 'Today';
  ctx.font = '700 18px Figtree, Segoe UI, sans-serif';
  const dateW = Math.ceil(ctx.measureText(dateLabel).width) + 36;
  ctx.fillStyle = '#ccfbf1';
  roundRect(ctx, 90, 180, dateW, 40, 20);
  ctx.fill();
  ctx.fillStyle = '#115e59';
  ctx.fillText(dateLabel, 108, 207);

  const metrics = [];
  const sp = data?.markets?.sp500;
  const btc = data?.markets?.crypto?.btc;
  const eth = data?.markets?.crypto?.eth;
  if (sp) {
    metrics.push({
      label: 'S&P 500',
      value: `$${sp.price.toFixed(2)}`,
      change: formatSignedPercent(sp.changePercent),
      up: sp.changePercent >= 0
    });
  }
  if (btc) {
    metrics.push({
      label: 'Bitcoin',
      value: `$${Number(btc.price).toLocaleString()}`,
      change: formatSignedPercent(btc.change24h),
      up: btc.change24h >= 0
    });
  }
  if (eth) {
    metrics.push({
      label: 'Ethereum',
      value: `$${Number(eth.price).toLocaleString()}`,
      change: formatSignedPercent(eth.change24h),
      up: eth.change24h >= 0
    });
  }

  const cardW = metrics.length === 1 ? 320 : metrics.length === 2 ? 300 : 280;
  const gap = 18;
  const totalW = metrics.length * cardW + Math.max(0, metrics.length - 1) * gap;
  let mx = 90;
  if (metrics.length && totalW < W - 180) {
    /* keep left-aligned under brand */
  }

  metrics.forEach((m, i) => {
    const x = mx + i * (cardW + gap);
    const y = 250;
    ctx.fillStyle = '#ffffff';
    roundRect(ctx, x, y, cardW, 118, 16);
    ctx.fill();
    ctx.strokeStyle = '#d7e4e6';
    ctx.lineWidth = 2;
    roundRect(ctx, x, y, cardW, 118, 16);
    ctx.stroke();

    ctx.fillStyle = '#6b8589';
    ctx.font = '700 14px Figtree, Segoe UI, sans-serif';
    ctx.fillText(m.label.toUpperCase(), x + 18, y + 32);

    ctx.fillStyle = '#102a2e';
    ctx.font = '800 28px Syne, Avenir Next, Segoe UI, sans-serif';
    ctx.fillText(m.value, x + 18, y + 68);

    ctx.fillStyle = m.up ? '#047857' : '#be123c';
    ctx.font = '700 18px Figtree, Segoe UI, sans-serif';
    ctx.fillText(m.change, x + 18, y + 98);
  });

  const summaryTop = metrics.length ? 400 : 250;
  ctx.fillStyle = '#134e4a';
  ctx.font = '700 18px Figtree, Segoe UI, sans-serif';
  ctx.fillText('AI summary', 90, summaryTop);

  ctx.fillStyle = '#3d5a5f';
  ctx.font = '500 22px Figtree, Segoe UI, sans-serif';
  wrapCanvasText(ctx, data?.summary || 'Summary unavailable', 90, summaryTop + 34, W - 220, 30, 4);

  ctx.fillStyle = '#6b8589';
  ctx.font = '500 16px Figtree, Segoe UI, sans-serif';
  ctx.fillText('Educational only — not financial advice  ·  finsight-ai-jd.web.app', 90, H - 70);

  return canvas;
}

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function showShareToast(message) {
  const el = document.getElementById('share-toast');
  if (!el) return;
  el.textContent = message;
  clearTimeout(showShareToast._t);
  showShareToast._t = setTimeout(() => {
    if (el.textContent === message) el.textContent = '';
  }, 2500);
}

function bindBriefingShareActions() {
  const downloadBtn = document.getElementById('share-download-btn');
  const copyLinkBtn = document.getElementById('share-copy-link-btn');
  const copyTextBtn = document.getElementById('share-copy-text-btn');
  const nativeBtn = document.getElementById('share-native-btn');

  if (downloadBtn) {
    downloadBtn.addEventListener('click', async () => {
      if (!lastBriefingData) return;
      downloadBtn.disabled = true;
      try {
        const canvas = await renderBriefingShareCard(lastBriefingData);
        const dateSlug = String(lastBriefingData.date || 'today').replace(/[^\w.-]+/g, '-');
        const link = document.createElement('a');
        link.download = `finsight-briefing-${dateSlug}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
        showShareToast('Card downloaded');
      } catch (err) {
        console.error(err);
        showShareToast('Could not create image');
      } finally {
        downloadBtn.disabled = false;
      }
    });
  }

  if (copyLinkBtn) {
    copyLinkBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(getBriefingShareUrl());
        showShareToast('Link copied');
      } catch (_) {
        showShareToast('Could not copy link');
      }
    });
  }

  if (copyTextBtn) {
    copyTextBtn.addEventListener('click', async () => {
      if (!lastBriefingData) return;
      try {
        await navigator.clipboard.writeText(buildShareCaption(lastBriefingData));
        showShareToast('Caption copied');
      } catch (_) {
        showShareToast('Could not copy text');
      }
    });
  }

  if (nativeBtn) {
    if (!navigator.share) {
      nativeBtn.hidden = true;
    } else {
      nativeBtn.addEventListener('click', async () => {
        if (!lastBriefingData) return;
        try {
          const canvas = await renderBriefingShareCard(lastBriefingData);
          const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
          const file = blob
            ? new File([blob], 'finsight-briefing.png', { type: 'image/png' })
            : null;
          const payload = {
            title: 'FinSight AI — today\'s market',
            text: buildShareCaption(lastBriefingData),
            url: getBriefingShareUrl()
          };
          if (file && navigator.canShare?.({ files: [file] })) {
            await navigator.share({ ...payload, files: [file] });
          } else {
            await navigator.share(payload);
          }
          showShareToast('Shared');
        } catch (err) {
          if (err?.name !== 'AbortError') showShareToast('Share cancelled');
        }
      });
    }
  }
}

function renderBriefingShareBar() {
  const canNative = typeof navigator.share === 'function';
  return `
    <div class="briefing-share" role="group" aria-label="Share today's briefing">
      <span class="briefing-share-label">Share</span>
      <button type="button" id="share-download-btn" class="btn-share primary">Download card</button>
      <button type="button" id="share-copy-link-btn" class="btn-share">Copy link</button>
      <button type="button" id="share-copy-text-btn" class="btn-share">Copy caption</button>
      <button type="button" id="share-native-btn" class="btn-share"${canNative ? '' : ' hidden'}>Share…</button>
      <span id="share-toast" class="share-toast" aria-live="polite"></span>
    </div>
  `;
}

async function fetchBriefing() {
  const btn = document.getElementById('fetch-btn');
  const output = document.getElementById('output');
  
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Loading...';
  }
  output.innerHTML = '<div class="loading"><span class="loading-pulse" aria-hidden="true"></span>Loading today\'s market briefing...</div>';

  try {
    const res = await fetch('/api/briefing');
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }
    const data = await res.json();
    lastBriefingData = data;

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
          <div class="market-meta">
            High $${sp.high.toFixed(2)} · Low $${sp.low.toFixed(2)}
          </div>
        </div>
      `;
    }

    if (data.markets?.crypto) {
      const crypto = data.markets.crypto;
      
      if (crypto.btc) {
        const btcChangeClass = crypto.btc.change24h >= 0 ? 'positive' : 'negative';
        marketsHTML += `
          <div class="market-card crypto-btc">
            <h3>Bitcoin (BTC)</h3>
            <div class="price">$${crypto.btc.price.toLocaleString()}</div>
            <div class="change ${btcChangeClass}">
              ${crypto.btc.change24h >= 0 ? '+' : ''}${crypto.btc.change24h.toFixed(2)}% <span style="font-weight:500;color:var(--muted)">24h</span>
            </div>
          </div>
        `;
      }

      if (crypto.eth) {
        const ethChangeClass = crypto.eth.change24h >= 0 ? 'positive' : 'negative';
        marketsHTML += `
          <div class="market-card crypto-eth">
            <h3>Ethereum (ETH)</h3>
            <div class="price">$${crypto.eth.price.toLocaleString()}</div>
            <div class="change ${ethChangeClass}">
              ${crypto.eth.change24h >= 0 ? '+' : ''}${crypto.eth.change24h.toFixed(2)}% <span style="font-weight:500;color:var(--muted)">24h</span>
            </div>
          </div>
        `;
      }
    }

    output.innerHTML = `
      <div class="briefing">
        <div class="briefing-date">${data.date || 'Today'}</div>
        ${marketsHTML ? `<div class="markets">${marketsHTML}</div>` : ''}
        <div class="summary">
          <h2>AI summary</h2>
          <p>${data.summary || 'Summary unavailable'}</p>
        </div>
        ${renderBriefingShareBar()}
      </div>
    `;
    bindBriefingShareActions();

  } catch (err) {
    lastBriefingData = null;
    output.innerHTML = `
      <div class="error">
        <strong>Error loading briefing:</strong><br>
        ${err.message || String(err)}
      </div>
    `;
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Refresh';
    }
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
      if (data.stale || data.cached) {
        const label = data.stale
          ? 'Showing recently cached prices (refreshing in background)'
          : 'Showing cached data';
        stocksHTML += `<div class="magnificent7-note">${label}</div>`;
      } else if (data.partial) {
        stocksHTML += '<div class="magnificent7-note">Showing available stocks (some may be rate-limited)</div>';
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

const LEARNING_TIPS = [
  {
    title: 'What is a stock?',
    body: 'A stock is a tiny slice of ownership in a company. If the company does well over time, that slice can become more valuable — but prices also go down, so you can lose money too.'
  },
  {
    title: 'What does the green/red % mean?',
    body: 'The percentage shows how much a price moved today versus yesterday’s close. Green usually means up; red means down. One day of movement does not tell the whole story — investors often look at weeks and years.'
  },
  {
    title: 'What is P&L?',
    body: 'P&L means profit and loss. In your practice portfolio, it compares what you paid for shares with what they are worth now. Positive P&L means you are “up” on paper; negative means you are “down.”'
  },
  {
    title: 'Why do prices move?',
    body: 'Prices change when more people want to buy than sell (price tends to rise), or the opposite (price tends to fall). News, earnings, the economy, and investor mood all play a role.'
  },
  {
    title: 'What is the S&P 500?',
    body: 'The S&P 500 tracks about 500 large U.S. companies. FinSight uses the SPY ETF as a simple stand-in so you can see how “the overall market” is doing in one number.'
  },
  {
    title: 'Cash vs portfolio value',
    body: 'Cash is money you have not invested yet. Portfolio value is cash plus the current value of your holdings. Together they show your total practice account.'
  },
  {
    title: 'Diversification (keep it simple)',
    body: 'Putting all practice money into one stock is riskier than spreading it across a few companies or an ETF. If one idea fails, the others can help cushion the hit.'
  },
  {
    title: 'Long-term vs short-term',
    body: 'Day-to-day swings are normal. Many long-term investors focus on years, not hours. FinSight’s practice trades are for learning — not for chasing every tiny price move.'
  },
  {
    title: 'What is a watchlist?',
    body: 'A watchlist is a list of stocks you want to follow without buying yet. Use it to learn how prices change before you practice a trade.'
  },
  {
    title: 'AI tips are for learning',
    body: 'Explain It and recommendations use AI to teach concepts. They are not personal advice and can be wrong. Always read the disclaimer and think for yourself.'
  }
];

let learningTipIndex = 0;

function renderLearningTip(index) {
  const tip = LEARNING_TIPS[index];
  if (!tip) return;
  const titleEl = document.getElementById('learning-tip-title');
  const bodyEl = document.getElementById('learning-tip-body');
  const metaEl = document.getElementById('learning-tip-meta');
  if (!titleEl || !bodyEl || !metaEl) return;
  titleEl.textContent = tip.title;
  bodyEl.textContent = tip.body;
  metaEl.textContent = `Tip ${index + 1} of ${LEARNING_TIPS.length}`;
}

function showNextLearningTip() {
  learningTipIndex = (learningTipIndex + 1) % LEARNING_TIPS.length;
  renderLearningTip(learningTipIndex);
}

function showPrevLearningTip() {
  learningTipIndex = (learningTipIndex - 1 + LEARNING_TIPS.length) % LEARNING_TIPS.length;
  renderLearningTip(learningTipIndex);
}

function initLearningTips() {
  // Start on a tip that rotates by day so returning visitors see variety
  const daySeed = Math.floor(Date.now() / 86400000);
  learningTipIndex = daySeed % LEARNING_TIPS.length;
  renderLearningTip(learningTipIndex);
  const nextBtn = document.getElementById('learning-tip-next');
  const prevBtn = document.getElementById('learning-tip-prev');
  if (nextBtn) nextBtn.addEventListener('click', showNextLearningTip);
  if (prevBtn) prevBtn.addEventListener('click', showPrevLearningTip);
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
  
  // Load portfolio chart
  loadPortfolioChart(userId);
  
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
  
  // Listen to portfolio snapshots for chart updates
  const snapshotsRef = collection(window.firebaseDb, 'users', userId, 'snapshots');
  const snapshotsQuery = query(snapshotsRef, orderBy('timestamp', 'desc'), limit(1));
  onSnapshot(snapshotsQuery, () => {
    // Reload chart when new snapshot is added
    loadPortfolioChart(userId);
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
  
  // Update chart with current value
  updatePortfolioChart();
}

// Portfolio chart
let portfolioChart = null;

async function loadPortfolioChart(userId) {
  try {
    const token = await window.firebaseAuth.currentUser?.getIdToken();
    if (!token) return;

    const res = await fetch('/api/portfolioHistory', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (!res.ok) {
      console.error('Failed to load portfolio history');
      return;
    }

    const data = await res.json();
    if (!data.success || !data.snapshots || data.snapshots.length === 0) {
      // Show message if no data
      const canvas = document.getElementById('portfolio-chart');
      if (canvas) {
        const chartContainer = canvas.parentElement;
        chartContainer.innerHTML = '<p style="text-align: center; color: #6b7280; padding: 2rem;">No historical data yet. Make some trades to see your portfolio grow!</p>';
      }
      return;
    }

    renderPortfolioChart(data.snapshots);
  } catch (error) {
    console.error('Error loading portfolio chart:', error);
    // Show error message
    const canvas = document.getElementById('portfolio-chart');
    if (canvas) {
      const chartContainer = canvas.parentElement;
      chartContainer.innerHTML = `<p style="text-align: center; color: #dc2626; padding: 2rem;">Error loading chart: ${error.message}</p>`;
    }
  }
}

function renderPortfolioChart(snapshots) {
  const canvas = document.getElementById('portfolio-chart');
  if (!canvas) {
    console.error('Portfolio chart canvas not found');
    return;
  }

  // If no snapshots, show a message
  if (!snapshots || snapshots.length === 0) {
    const chartContainer = canvas.parentElement;
    chartContainer.innerHTML = '<p style="text-align: center; color: #6b7280; padding: 2rem;">No historical data yet. Make some trades to see your portfolio grow!</p>';
    return;
  }

  const ctx = canvas.getContext('2d');

  // Prepare data
  const labels = snapshots.map((s, index) => {
    const date = new Date(s.timestamp);
    // Check if this point is close to the previous one (within 1 hour)
    const showSeconds = index > 0 && 
      Math.abs(date.getTime() - new Date(snapshots[index - 1].timestamp).getTime()) < 3600000;
    
    if (showSeconds) {
      // Show seconds when points are close together
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } else {
      // Normal format for points that are far apart
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    }
  });
  
  const portfolioValues = snapshots.map(s => s.portfolioValue || 0);
  const startingCapital = 10000;
  const baseline = new Array(snapshots.length).fill(startingCapital);

  // Destroy existing chart if it exists
  if (portfolioChart) {
    portfolioChart.destroy();
  }

  // Create new chart
  portfolioChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'Portfolio Value',
          data: portfolioValues,
          borderColor: '#2563eb',
          backgroundColor: 'rgba(37, 99, 235, 0.1)',
          borderWidth: 2,
          fill: true,
          tension: 0.4,
          pointRadius: 3,
          pointHoverRadius: 5
        },
        {
          label: 'Starting Capital ($10,000)',
          data: baseline,
          borderColor: '#9ca3af',
          backgroundColor: 'transparent',
          borderWidth: 1,
          borderDash: [5, 5],
          fill: false,
          pointRadius: 0
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          position: 'top'
        },
        tooltip: {
          mode: 'index',
          intersect: false,
          callbacks: {
            label: function(context) {
              return context.dataset.label + ': $' + context.parsed.y.toFixed(2);
            }
          }
        }
      },
      scales: {
        y: {
          beginAtZero: false,
          ticks: {
            callback: function(value) {
              return '$' + value.toFixed(0);
            }
          },
          grid: {
            color: 'rgba(0, 0, 0, 0.05)'
          }
        },
        x: {
          grid: {
            display: false
          }
        }
      },
      interaction: {
        mode: 'nearest',
        axis: 'x',
        intersect: false
      }
    }
  });
}

async function updatePortfolioChart() {
  if (!window.firebaseAuth.currentUser) return;
  
  // Reload chart data to include latest snapshot
  await loadPortfolioChart(window.firebaseAuth.currentUser.uid);
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
    const signinPrompt = document.getElementById('signin-prompt');

    if (user) {
      // User is signed in
      loginBtn.style.display = 'none';
      userInfo.style.display = 'block';
      userName.textContent = user.displayName || user.email;
      portfolioSection.style.display = 'block';
      if (signinPrompt) signinPrompt.style.display = 'none';
      setupPortfolioListeners(user.uid);
      setupWatchlistListener(user.uid);
    } else {
      // User is signed out
      loginBtn.style.display = 'block';
      userInfo.style.display = 'none';
      portfolioSection.style.display = 'none';
      document.getElementById('watchlist-section').style.display = 'none';
      if (signinPrompt) signinPrompt.style.display = 'flex';
    }
  });
}

// Watchlist Functions
async function addToWatchlist() {
  const symbolInput = document.getElementById('watchlist-symbol');
  const messageDiv = document.getElementById('watchlist-message');
  const addBtn = document.getElementById('add-watchlist-btn');
  
  const symbol = symbolInput.value.trim().toUpperCase();
  
  if (!symbol) {
    messageDiv.innerHTML = '<div class="error" style="padding: 0.75rem; background: #fee2e2; color: #991b1b; border-radius: 6px;">Please enter a stock symbol</div>';
    setTimeout(() => { messageDiv.innerHTML = ''; }, 3000);
    return;
  }

  if (!window.firebaseAuth || !window.firebaseAuth.currentUser) {
    messageDiv.innerHTML = '<div class="error" style="padding: 0.75rem; background: #fee2e2; color: #991b1b; border-radius: 6px;">Please sign in to use watchlist</div>';
    setTimeout(() => { messageDiv.innerHTML = ''; }, 3000);
    return;
  }

  addBtn.disabled = true;
  addBtn.textContent = 'Adding...';
  messageDiv.innerHTML = '';

  try {
    const token = await window.firebaseAuth.currentUser.getIdToken();
    const res = await fetch('/api/addToWatchlist', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ symbol })
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Failed to add to watchlist');
    }

    // Success
    symbolInput.value = '';
    messageDiv.innerHTML = `<div style="padding: 0.75rem; background: #d1fae5; color: #065f46; border-radius: 6px; animation: slideIn 0.3s ease-out;">✓ ${symbol} added to watchlist</div>`;
    setTimeout(() => { messageDiv.innerHTML = ''; }, 3000);

  } catch (error) {
    messageDiv.innerHTML = `<div class="error" style="padding: 0.75rem; background: #fee2e2; color: #991b1b; border-radius: 6px;">Error: ${error.message}</div>`;
    setTimeout(() => { messageDiv.innerHTML = ''; }, 5000);
  } finally {
    addBtn.disabled = false;
    addBtn.textContent = 'Add';
  }
}

async function removeFromWatchlist(symbol) {
  if (!window.firebaseAuth || !window.firebaseAuth.currentUser) {
    return;
  }

  if (!confirm(`Remove ${symbol} from watchlist?`)) {
    return;
  }

  try {
    const token = await window.firebaseAuth.currentUser.getIdToken();
    const res = await fetch('/api/removeFromWatchlist', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ symbol })
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Failed to remove from watchlist');
    }

  } catch (error) {
    console.error('Error removing from watchlist:', error);
    alert(`Error removing ${symbol}: ${error.message}`);
  }
}

// Make removeFromWatchlist globally accessible
window.removeFromWatchlist = removeFromWatchlist;

async function updateWatchlistTable(watchlistItems) {
  const tbody = document.getElementById('watchlist-tbody');
  
  if (!watchlistItems || watchlistItems.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" style="padding: 2rem; text-align: center; color: #6b7280;">No stocks in watchlist. Add some stocks to track!</td></tr>';
    return;
  }

  // Fetch prices for all watchlist items
  const pricePromises = watchlistItems.map(async (item) => {
    try {
      const token = await window.firebaseAuth.currentUser.getIdToken();
      const res = await fetch(`/api/stockPrice?symbol=${item.symbol}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (res.ok) {
        const data = await res.json();
        return {
          symbol: item.symbol,
          price: data.price || 0,
          change: data.change || 0,
          changePercent: data.changePercent || 0
        };
      }
      return {
        symbol: item.symbol,
        price: 0,
        change: 0,
        changePercent: 0
      };
    } catch (error) {
      console.error(`Error fetching price for ${item.symbol}:`, error);
      return {
        symbol: item.symbol,
        price: 0,
        change: 0,
        changePercent: 0
      };
    }
  });

  const prices = await Promise.all(pricePromises);

  // Build table rows
  let html = '';
  prices.forEach((stock) => {
    const changeClass = stock.changePercent >= 0 ? 'positive' : 'negative';
    const changeSign = stock.changePercent >= 0 ? '+' : '';
    
    html += `
      <tr>
        <td style="padding: 1rem; font-weight: 600;">${stock.symbol}</td>
        <td style="padding: 1rem; text-align: right; font-weight: 600;">$${stock.price.toFixed(2)}</td>
        <td style="padding: 1rem; text-align: right;">
          <span class="change ${changeClass}" style="font-weight: 600;">
            ${changeSign}${stock.changePercent.toFixed(2)}%
            (${changeSign}$${stock.change.toFixed(2)})
          </span>
        </td>
        <td style="padding: 1rem; text-align: center;">
          <button onclick="removeFromWatchlist('${stock.symbol}')" style="padding: 0.5rem 1rem; background: #dc2626; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 0.9rem;">Remove</button>
        </td>
      </tr>
    `;
  });

  tbody.innerHTML = html;
}

function setupWatchlistListener(userId) {
  if (!window.firebaseDb || !window.firebaseFirestoreFunctions) return;

  const { collection, onSnapshot } = window.firebaseFirestoreFunctions;
  
  // Show watchlist section
  document.getElementById('watchlist-section').style.display = 'block';

  // Listen to watchlist collection
  const watchlistRef = collection(window.firebaseDb, 'users', userId, 'watchlist');
  onSnapshot(watchlistRef, async (snapshot) => {
    const watchlistItems = [];
    snapshot.forEach((doc) => {
      watchlistItems.push({ symbol: doc.id, ...doc.data() });
    });
    await updateWatchlistTable(watchlistItems);
  });
}

// Explain It Feature
async function explainCompany() {
  const symbolInput = document.getElementById('explain-symbol');
  const messageDiv = document.getElementById('explain-message');
  const resultDiv = document.getElementById('explain-result');
  const explainBtn = document.getElementById('explain-btn');
  
  const symbol = symbolInput.value.trim().toUpperCase();
  
  if (!symbol) {
    messageDiv.innerHTML = '<div class="error" style="padding: 0.75rem; background: #fee2e2; color: #991b1b; border-radius: 6px;">Please enter a stock symbol</div>';
    setTimeout(() => { messageDiv.innerHTML = ''; }, 3000);
    return;
  }

  explainBtn.disabled = true;
  explainBtn.textContent = 'Explaining...';
  messageDiv.innerHTML = '<div style="color: #2563eb; padding: 0.5rem; background: #dbeafe; border-radius: 4px;">⏳ Fetching company information...</div>';
  resultDiv.style.display = 'none';

  try {
    const res = await fetch(`/api/explainCompany?symbol=${encodeURIComponent(symbol)}`);
    
    let data;
    try {
      data = await res.json();
    } catch (parseError) {
      // If response isn't JSON, create a generic error
      throw new Error(`Server error: ${res.status} ${res.statusText}`);
    }

    if (!res.ok) {
      // Create error with response data
      const error = new Error(data.error || 'Failed to explain company');
      error.suggestion = data.suggestion;
      throw error;
    }

    // Display result
    document.getElementById('explain-company-name').textContent = `${data.companyName} (${data.symbol})`;
    document.getElementById('explain-content').textContent = data.explanation;
    
    let priceInfo = '';
    if (data.sector) {
      priceInfo += `${data.sector}`;
      if (data.industry) {
        priceInfo += ` • ${data.industry}`;
      }
    }
    if (data.price) {
      const changeClass = data.priceChange?.changePercent >= 0 ? 'positive' : 'negative';
      const changeSign = data.priceChange?.changePercent >= 0 ? '+' : '';
      priceInfo += priceInfo ? ' • ' : '';
      priceInfo += `Current Price: $${data.price.toFixed(2)} (${changeSign}${data.priceChange?.changePercent.toFixed(2)}%)`;
    }
    document.getElementById('explain-price-info').textContent = priceInfo || 'Price information unavailable';
    
    // Show multiple matches info if available
    if (data.searchInfo && data.searchInfo.otherMatches && data.searchInfo.otherMatches.length > 0) {
      const matchesHtml = `
        <div style="margin-top: 1rem; padding: 0.75rem; background: #fef3c7; border-left: 4px solid #f59e0b; border-radius: 6px; font-size: 0.9rem; color: #92400e;">
          <strong>💡 Other matches found:</strong> ${data.searchInfo.otherMatches.map(m => `${m.name} (${m.symbol})`).join(', ')}
        </div>
      `;
      document.getElementById('explain-price-info').insertAdjacentHTML('afterend', matchesHtml);
    }
    
    resultDiv.style.display = 'block';
    messageDiv.innerHTML = '';
    symbolInput.value = '';

    // Scroll to result
    resultDiv.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  } catch (error) {
    let errorHtml = `<div class="error" style="padding: 0.75rem; background: #fee2e2; color: #991b1b; border-radius: 6px; animation: slideIn 0.3s ease-out;">❌ ${error.message || 'An error occurred'}</div>`;
    
    if (error.suggestion) {
      errorHtml += `<div style="margin-top: 0.5rem; padding: 0.75rem; background: #fef3c7; color: #92400e; border-radius: 6px; font-size: 0.9rem;">💡 ${error.suggestion}</div>`;
    }
    
    messageDiv.innerHTML = errorHtml;
    setTimeout(() => { messageDiv.innerHTML = ''; }, 8000);
  } finally {
    explainBtn.disabled = false;
    explainBtn.textContent = 'Explain';
  }
}

// Stock Recommendation Feature
async function getStockRecommendation() {
  const symbolInput = document.getElementById('recommendation-symbol');
  const messageDiv = document.getElementById('recommendation-message');
  const resultDiv = document.getElementById('recommendation-result');
  const recommendationBtn = document.getElementById('recommendation-btn');
  
  const symbol = symbolInput.value.trim().toUpperCase();
  
  if (!symbol) {
    messageDiv.innerHTML = '<div class="error" style="padding: 0.75rem; background: #fee2e2; color: #991b1b; border-radius: 6px;">Please enter a stock symbol</div>';
    setTimeout(() => { messageDiv.innerHTML = ''; }, 3000);
    return;
  }

  recommendationBtn.disabled = true;
  recommendationBtn.textContent = 'Analyzing...';
  messageDiv.innerHTML = '<div style="color: #059669; padding: 0.5rem; background: #d1fae5; border-radius: 4px;">⏳ Analyzing stock and generating recommendation...</div>';
  resultDiv.style.display = 'none';

  try {
    const res = await fetch(`/api/stockRecommendation?symbol=${encodeURIComponent(symbol)}`);
    
    let data;
    try {
      data = await res.json();
    } catch (parseError) {
      // If response isn't JSON, create a generic error
      throw new Error(`Server error: ${res.status} ${res.statusText}`);
    }

    if (!res.ok) {
      // Create error with response data
      const error = new Error(data.error || 'Failed to get recommendation');
      error.suggestion = data.suggestion;
      throw error;
    }

    // Display result
    document.getElementById('recommendation-company-name').textContent = `${data.companyName} (${data.symbol})`;
    
    const changeClass = data.priceChange?.changePercent >= 0 ? 'positive' : 'negative';
    const changeSign = data.priceChange?.changePercent >= 0 ? '+' : '';
    document.getElementById('recommendation-price').innerHTML = `
      $${data.currentPrice.toFixed(2)} 
      <span class="change ${changeClass}" style="font-size: 0.9rem; margin-left: 0.5rem;">
        ${changeSign}$${data.priceChange?.change.toFixed(2)} (${changeSign}${data.priceChange?.changePercent.toFixed(2)}%)
      </span>
    `;
    
    // Recommendation badge
    const badge = document.getElementById('recommendation-badge');
    const rec = data.recommendation;
    if (rec === 'BUY') {
      badge.textContent = '🟢 BUY';
      badge.style.background = '#d1fae5';
      badge.style.color = '#065f46';
    } else if (rec === 'HOLD') {
      badge.textContent = '🟡 HOLD';
      badge.style.background = '#fef3c7';
      badge.style.color = '#92400e';
    } else {
      badge.textContent = '🔴 SELL';
      badge.style.background = '#fee2e2';
      badge.style.color = '#991b1b';
    }
    
    document.getElementById('recommendation-confidence').textContent = data.confidence;
    document.getElementById('recommendation-risk').textContent = data.riskLevel;
    document.getElementById('recommendation-horizon').textContent = data.timeHorizon;
    document.getElementById('recommendation-reasoning').textContent = data.reasoning;
    
    // Key points
    const keyPointsList = document.getElementById('recommendation-keypoints');
    if (data.keyPoints && data.keyPoints.length > 0) {
      keyPointsList.innerHTML = data.keyPoints.map(point => `<li>${point}</li>`).join('');
    } else {
      keyPointsList.innerHTML = '<li>No key points available</li>';
    }
    
    document.getElementById('recommendation-disclaimer').textContent = data.disclaimer;
    
    // Show multiple matches info if available
    if (data.searchInfo && data.searchInfo.otherMatches && data.searchInfo.otherMatches.length > 0) {
      const matchesHtml = `
        <div style="margin-top: 1rem; padding: 0.75rem; background: #fef3c7; border-left: 4px solid #f59e0b; border-radius: 6px; font-size: 0.9rem; color: #92400e;">
          <strong>💡 Other matches found:</strong> ${data.searchInfo.otherMatches.map(m => `${m.name} (${m.symbol})`).join(', ')}
        </div>
      `;
      const disclaimerDiv = document.getElementById('recommendation-disclaimer').parentElement;
      disclaimerDiv.insertAdjacentHTML('beforebegin', matchesHtml);
    }
    
    resultDiv.style.display = 'block';
    messageDiv.innerHTML = '';
    symbolInput.value = '';

    // Scroll to result
    resultDiv.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  } catch (error) {
    let errorHtml = `<div class="error" style="padding: 0.75rem; background: #fee2e2; color: #991b1b; border-radius: 6px; animation: slideIn 0.3s ease-out;">❌ ${error.message || 'An error occurred'}</div>`;
    
    if (error.suggestion) {
      errorHtml += `<div style="margin-top: 0.5rem; padding: 0.75rem; background: #fef3c7; color: #92400e; border-radius: 6px; font-size: 0.9rem;">💡 ${error.suggestion}</div>`;
    }
    
    messageDiv.innerHTML = errorHtml;
    setTimeout(() => { messageDiv.innerHTML = ''; }, 8000);
  } finally {
    recommendationBtn.disabled = false;
    recommendationBtn.textContent = 'Get Recommendation';
  }
}

window.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('fetch-btn');
  if (btn) {
    btn.addEventListener('click', fetchBriefing);
  }
  
  // Auto-load Mag7, briefing (server-cached), and learning tips
  loadMagnificent7();
  fetchBriefing().then(() => {
    if (window.location.hash === '#briefing') {
      document.getElementById('briefing-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
  initLearningTips();

  // Setup auth
  setTimeout(() => {
    initAuth();
    document.getElementById('login-btn').addEventListener('click', signInWithGoogle);
    const signinPromptBtn = document.getElementById('signin-prompt-btn');
    if (signinPromptBtn) {
      signinPromptBtn.addEventListener('click', signInWithGoogle);
    }
    document.getElementById('logout-btn').addEventListener('click', signOutUser);
    document.getElementById('buy-btn').addEventListener('click', buyStock);
    document.getElementById('sell-btn').addEventListener('click', sellStock);
    document.getElementById('add-watchlist-btn').addEventListener('click', addToWatchlist);
    
    // Explain It feature
    document.getElementById('explain-btn').addEventListener('click', explainCompany);
    document.getElementById('explain-symbol').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        explainCompany();
      }
    });
    
    // Stock Recommendation feature
    document.getElementById('recommendation-btn').addEventListener('click', getStockRecommendation);
    document.getElementById('recommendation-symbol').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        getStockRecommendation();
      }
    });
    
    // Allow Enter key to add to watchlist
    const watchlistSymbolInput = document.getElementById('watchlist-symbol');
    if (watchlistSymbolInput) {
      watchlistSymbolInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          addToWatchlist();
        }
      });
    }
  }, 1000); // Wait for Firebase to initialize
});
