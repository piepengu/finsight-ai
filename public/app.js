/** Latest briefing payload for shareable card generation */
let lastBriefingData = null;

/** U.S. currency display — round for presentation only, never for calculations */
const usdCurrencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

function formatMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return usdCurrencyFormatter.format(n);
}

/** Signed P&L / day-change money: +$1,234.56 / -$50.00 / $0.00 */
function formatMoneySigned(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  if (n > 0) return `+${usdCurrencyFormatter.format(n)}`;
  return usdCurrencyFormatter.format(n);
}

const {
  parseMoneyText,
  computePortfolioTotals,
  holdingsCostBasis,
  createGenerationTracker,
  formatCompanyHeading,
  waitUntil,
  DEFAULT_CHART_RANGE_MS,
  MAX_CONNECTED_GAP_MS,
  SPY_BENCHMARK_LABEL,
  filterSnapshotsByRange: coreFilterSnapshotsByRange,
  assessChartRange,
  chartSegmentShouldBreak,
  describeSnapshotKind,
  buildBenchmarkComparison
} = window.FinSightCore;

function formatPercent(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(digits)}%`;
}

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
  if (sp) bits.push(`S&P 500 (SPY) ${formatMoney(sp.price)} (${formatSignedPercent(sp.changePercent)})`);
  if (btc) bits.push(`BTC ${formatMoney(btc.price)} (${formatSignedPercent(btc.change24h)} 24h)`);
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
      value: formatMoney(sp.price),
      change: formatSignedPercent(sp.changePercent),
      up: sp.changePercent >= 0
    });
  }
  if (btc) {
    metrics.push({
      label: 'Bitcoin',
      value: formatMoney(btc.price),
      change: formatSignedPercent(btc.change24h),
      up: btc.change24h >= 0
    });
  }
  if (eth) {
    metrics.push({
      label: 'Ethereum',
      value: formatMoney(eth.price),
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
          <div class="price">${formatMoney(sp.price)}</div>
          <div class="change ${changeClass}">
            ${formatSignedPercent(sp.changePercent)}
            (${formatMoneySigned(sp.change)})
          </div>
          <div class="market-meta">
            High ${formatMoney(sp.high)} · Low ${formatMoney(sp.low)}
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
            <div class="price">${formatMoney(crypto.btc.price)}</div>
            <div class="change ${btcChangeClass}">
              ${formatSignedPercent(crypto.btc.change24h)} <span style="font-weight:500;color:var(--muted)">24h</span>
            </div>
          </div>
        `;
      }

      if (crypto.eth) {
        const ethChangeClass = crypto.eth.change24h >= 0 ? 'positive' : 'negative';
        marketsHTML += `
          <div class="market-card crypto-eth">
            <h3>Ethereum (ETH)</h3>
            <div class="price">${formatMoney(crypto.eth.price)}</div>
            <div class="change ${ethChangeClass}">
              ${formatSignedPercent(crypto.eth.change24h)} <span style="font-weight:500;color:var(--muted)">24h</span>
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
    const updatedEl = document.getElementById('briefing-updated');
    if (updatedEl) {
      if (data.date) {
        updatedEl.hidden = false;
        updatedEl.textContent = `Last updated: ${data.date}`;
      } else {
        updatedEl.hidden = true;
      }
    }
    bindBriefingShareActions();

  } catch (err) {
    lastBriefingData = null;
    const updatedEl = document.getElementById('briefing-updated');
    if (updatedEl) updatedEl.hidden = true;
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

/** Prefill practice trade after sign-in when user clicked Practice on Mag7 while signed out */
let pendingTradeSymbol = null;

function isSignedIn() {
  return !!(window.firebaseAuth && window.firebaseAuth.currentUser);
}

function promptSignInForPractice(symbol) {
  const sym = String(symbol || '').trim().toUpperCase();
  if (!sym) return;

  pendingTradeSymbol = sym;

  const prompt = document.getElementById('signin-prompt');
  const promptCopy = prompt?.querySelector('p');
  if (promptCopy) {
    promptCopy.textContent = `Sign in free to practice a virtual trade in ${sym} — then buy 1 share and watch P&L update.`;
  }

  prompt?.classList.add('signin-prompt-highlight');
  clearTimeout(promptSignInForPractice._t);
  promptSignInForPractice._t = setTimeout(() => {
    prompt?.classList.remove('signin-prompt-highlight');
  }, 2200);

  navigateTo('dashboard');
  setTimeout(() => prompt?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
}

function practiceFromMag7(symbol) {
  const sym = String(symbol || '').trim().toUpperCase();
  if (!sym) return;

  if (isSignedIn()) {
    prepareTradeFromWatchlist(sym);
    return;
  }
  promptSignInForPractice(sym);
}

function applyPendingTradeAfterSignIn() {
  if (!pendingTradeSymbol || !isSignedIn()) return;
  const sym = pendingTradeSymbol;
  pendingTradeSymbol = null;
  // Portfolio section appears after auth; wait a tick for display:block
  setTimeout(() => prepareTradeFromWatchlist(sym), 250);
}

function handleMag7Action(event) {
  const btn = event.target.closest('[data-mag7-action]');
  if (!btn) return;

  const action = btn.dataset.mag7Action;
  const symbol = btn.dataset.symbol;
  if (!symbol) return;

  if (action === 'explain') {
    explainFromWatchlist(symbol);
  } else if (action === 'practice') {
    practiceFromMag7(symbol);
  }
}

function setMag7TargetsHTML(html) {
  document.querySelectorAll('[data-mag7-target]').forEach((el) => {
    el.classList.remove('magnificent7-loading');
    el.innerHTML = html;
  });
}

async function loadMagnificent7() {
  const targets = document.querySelectorAll('[data-mag7-target]');
  if (!targets.length) return;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 95000);

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
        const safeSymbol = escapeHtml(stock.symbol);
        const safeName = escapeHtml(stock.name || stock.symbol);
        stocksHTML += `
          <div class="magnificent7-item">
            <div class="symbol">${safeSymbol}</div>
            <div class="name">${safeName}</div>
            <div class="price">${formatMoney(stock.price)}</div>
            <div class="change ${changeClass}">
              ${formatSignedPercent(stock.changePercent)}
            </div>
            <div class="magnificent7-item-actions">
              <button type="button" class="btn-mag7 btn-mag7-explain" data-mag7-action="explain" data-symbol="${safeSymbol}">Explain</button>
              <button type="button" class="btn-mag7 btn-mag7-practice" data-mag7-action="practice" data-symbol="${safeSymbol}">Practice</button>
            </div>
          </div>
        `;
      });

      stocksHTML += '</div>';
      const asOfText = data.asOf
        ? `As of ${new Date(data.asOf).toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' })} ET`
        : '';
      const sessionText = data.sessionDate ? `Session ${escapeHtml(data.sessionDate)}` : '';
      const metaBits = [sessionText, asOfText].filter(Boolean).join(' · ');
      const statusLabel = data.priceLabel
        || (data.partial
          ? 'Partial Mag7 set — some symbols unavailable.'
          : 'Delayed / end-of-day prices (not real-time).');
      stocksHTML += `<div class="magnificent7-note">${escapeHtml(statusLabel)}${metaBits ? `<br><span class="magnificent7-asof">${escapeHtml(metaBits)}</span>` : ''}</div>`;
      setMag7TargetsHTML(stocksHTML);
    } else {
      setMag7TargetsHTML('<div class="magnificent7-loading">Stock data temporarily unavailable due to rate limits. Please refresh in a minute.</div>');
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      setMag7TargetsHTML('<div class="magnificent7-loading">Loading is taking longer than expected. Please refresh the page.</div>');
    } else {
      setMag7TargetsHTML(`<div class="magnificent7-loading">${err.message || 'Error loading stocks. Please refresh the page.'}</div>`);
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

function readTradeForm() {
  const symbol = (document.getElementById('stock-symbol')?.value || '').trim().toUpperCase();
  const quantityRaw = document.getElementById('stock-quantity')?.value;
  const quantity = Number.parseInt(String(quantityRaw ?? '').trim(), 10);
  return { symbol, quantity };
}

function tradeFormValidationMessage(symbol, quantity) {
  if (!symbol && (!Number.isFinite(quantity) || quantity < 1)) {
    return 'Enter a stock symbol (e.g., TSM) and a quantity of at least 1.';
  }
  if (!symbol) {
    return 'Enter a stock symbol (e.g., TSM or AAPL).';
  }
  if (!Number.isFinite(quantity) || quantity < 1) {
    return 'Enter a whole-number quantity of at least 1.';
  }
  return '';
}

// Portfolio functions
async function buyStock() {
  const { symbol, quantity } = readTradeForm();
  const messageDiv = document.getElementById('trading-message');
  const validationError = tradeFormValidationMessage(symbol, quantity);

  if (validationError) {
    messageDiv.innerHTML = `<div class="error">${validationError}</div>`;
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
    messageDiv.innerHTML = `<div style="color: #059669; padding: 0.75rem; background: #d1fae5; border-radius: 6px; font-weight: 600; animation: slideIn 0.3s ease-out;">✅ Successfully bought ${quantity} share(s) of ${symbol} at ${formatMoney(data.price)}!</div>`;
    document.getElementById('stock-symbol').value = '';
    document.getElementById('stock-quantity').value = '1';
    
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
  const { symbol, quantity } = readTradeForm();
  const messageDiv = document.getElementById('trading-message');
  const validationError = tradeFormValidationMessage(symbol, quantity);

  if (validationError) {
    messageDiv.innerHTML = `<div class="error">${validationError}</div>`;
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
      ? ` (Profit: ${formatMoney(data.profitLoss)})` 
      : ` (Loss: ${formatMoney(Math.abs(data.profitLoss))})`;
    messageDiv.innerHTML = `<div style="color: #059669; padding: 0.75rem; background: #d1fae5; border-radius: 6px; font-weight: 600; animation: slideIn 0.3s ease-out;">✅ Successfully sold ${quantity} share(s) of ${symbol} at ${formatMoney(data.price)}${profitText}</div>`;
    document.getElementById('stock-symbol').value = '';
    document.getElementById('stock-quantity').value = '1';
    
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

/**
 * Holdings can exist without matching transaction rows (older buys before logging
 * was reliable, or log failures that still completed the trade). Backfill one buy
 * record per missing symbol from the holding's first purchase data.
 */
async function backfillMissingTransactions(userId) {
  if (!window.firebaseDb || !window.firebaseFirestoreFunctions) return;
  const { collection, getDocs, addDoc } = window.firebaseFirestoreFunctions;
  if (!getDocs || !addDoc) return;

  try {
    const portfolioSnap = await getDocs(
      collection(window.firebaseDb, 'users', userId, 'portfolio')
    );
    const txSnap = await getDocs(
      collection(window.firebaseDb, 'users', userId, 'transactions')
    );

    const symbolsWithBuy = new Set();
    txSnap.forEach((docSnap) => {
      const data = docSnap.data() || {};
      if (data.type === 'buy' && data.symbol) {
        symbolsWithBuy.add(String(data.symbol).toUpperCase());
      }
    });

    for (const holdingDoc of portfolioSnap.docs) {
      const symbol = holdingDoc.id.toUpperCase();
      if (symbolsWithBuy.has(symbol)) continue;

      const holding = holdingDoc.data() || {};
      const shares = Number(holding.shares) || 0;
      if (shares <= 0) continue;

      const price = Number(holding.avgPrice) || 0;
      const totalAmount = holding.totalCost != null
        ? Number(holding.totalCost)
        : shares * price;
      const timestamp = holding.firstPurchased || holding.lastUpdated || new Date();

      await addDoc(collection(window.firebaseDb, 'users', userId, 'transactions'), {
        type: 'buy',
        symbol,
        shares,
        price,
        totalAmount,
        timestamp,
        backfilled: true
      });
      console.info(`Backfilled missing buy transaction for ${symbol}`);
    }
  } catch (err) {
    console.warn('Transaction backfill skipped:', err.message || err);
  }
}

/** Latest known portfolio inputs — never derive totals from the DOM alone */
let latestCashBalance = 10000;
let latestHoldingsMarketValue = 0;
let holdingsQuotesLoading = false;
const holdingsQuoteGen = createGenerationTracker();
const watchlistQuoteGen = createGenerationTracker();
const firestoreUnsubscribers = [];
let authUnsubscriber = null;

function trackFirestoreListener(unsubscribe) {
  if (typeof unsubscribe === 'function') {
    firestoreUnsubscribers.push(unsubscribe);
  }
}

function teardownFirestoreListeners() {
  while (firestoreUnsubscribers.length) {
    const unsub = firestoreUnsubscribers.pop();
    try {
      unsub();
    } catch (err) {
      console.warn('Firestore unsubscribe failed:', err);
    }
  }
  holdingsQuoteGen.invalidate();
  watchlistQuoteGen.invalidate();
}

function resetPortfolioState() {
  latestCashBalance = 10000;
  latestHoldingsMarketValue = 0;
  holdingsQuotesLoading = false;
  setCashDisplays(latestCashBalance);
  refreshPortfolioTotalsDisplay();
  const holdingsBody = document.getElementById('holdings-tbody');
  if (holdingsBody) {
    holdingsBody.innerHTML = '<tr><td colspan="6" class="empty-state">No holdings yet. Start paper trading to build a portfolio.</td></tr>';
  }
  const txBody = document.getElementById('transaction-tbody');
  if (txBody) {
    txBody.innerHTML = '<tr><td colspan="6" class="empty-state">No transactions yet.</td></tr>';
  }
  if (portfolioChart) {
    try { portfolioChart.destroy(); } catch (_) { /* ignore */ }
    portfolioChart = null;
  }
  portfolioChartSnapshots = [];
  portfolioChartMeta = null;
  portfolioSpyBars = [];
  portfolioSpyCacheMeta = null;
  portfolioChartView = 'value';
  setBenchmarkSourceNote('');
  setChartRangeNote('');
  updateChartViewButtons();
}

function teardownUserSubscriptions() {
  teardownFirestoreListeners();
  resetPortfolioState();
}

function refreshPortfolioTotalsDisplay() {
  const { totalValue, totalPL } = computePortfolioTotals(
    latestCashBalance,
    latestHoldingsMarketValue
  );
  const plClass = totalPL >= 0 ? 'positive' : 'negative';
  const valueText = formatMoney(totalValue);
  const plText = formatMoneySigned(totalPL);
  const plColor = totalPL >= 0 ? 'var(--good)' : 'var(--bad)';

  const portfolioValue = document.getElementById('portfolio-value');
  if (portfolioValue) {
    portfolioValue.textContent = valueText;
    portfolioValue.dataset.loading = holdingsQuotesLoading ? 'true' : 'false';
  }
  const dashValue = document.getElementById('dash-portfolio-value');
  if (dashValue) dashValue.textContent = valueText;

  const plElement = document.getElementById('total-pl');
  if (plElement) {
    plElement.textContent = plText;
    plElement.className = `stat-value change ${plClass}`;
    plElement.style.color = plColor;
  }
  const dashPl = document.getElementById('dash-total-pl');
  if (dashPl) {
    dashPl.textContent = plText;
    dashPl.className = `stat-value change ${plClass}`;
    dashPl.style.color = plColor;
  }
}

/** @deprecated use refreshPortfolioTotalsDisplay — kept for any residual callers */
function updatePortfolioValue(holdingsValue) {
  if (holdingsValue != null && Number.isFinite(Number(holdingsValue))) {
    latestHoldingsMarketValue = Number(holdingsValue);
  }
  refreshPortfolioTotalsDisplay();
}

function setCashDisplays(balance) {
  const text = formatMoney(balance);
  ['cash-balance', 'dash-cash-balance', 'trade-cash-balance'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  });
}

function setLatestCashBalance(balance) {
  const n = Number(balance);
  latestCashBalance = Number.isFinite(n) ? n : 10000;
  setCashDisplays(latestCashBalance);
  refreshPortfolioTotalsDisplay();
}

// Load portfolio data from Firestore
function setupPortfolioListeners(userId) {
  if (!window.firebaseDb || !window.firebaseFirestoreFunctions) return;

  const { doc, onSnapshot, collection, query, orderBy, limit } = window.firebaseFirestoreFunctions;

  // Repair history gaps once per page load
  if (!window.__txBackfillStarted) {
    window.__txBackfillStarted = true;
    backfillMissingTransactions(userId);
  }

  const accountRef = doc(window.firebaseDb, 'users', userId, 'account', 'balance');
  trackFirestoreListener(onSnapshot(accountRef, (snapshot) => {
    if (snapshot.exists()) {
      const data = snapshot.data();
      setLatestCashBalance(data.balance ?? 10000);
    } else {
      setLatestCashBalance(10000);
    }
  }));

  const portfolioRef = collection(window.firebaseDb, 'users', userId, 'portfolio');
  trackFirestoreListener(onSnapshot(portfolioRef, async (snapshot) => {
    const holdings = [];
    snapshot.forEach((docSnap) => {
      holdings.push({ symbol: docSnap.id, ...docSnap.data() });
    });
    await updateHoldingsTable(holdings);
  }));

  const transactionsRef = collection(window.firebaseDb, 'users', userId, 'transactions');
  const transactionsQuery = query(transactionsRef, orderBy('timestamp', 'desc'), limit(50));
  trackFirestoreListener(onSnapshot(transactionsQuery, (snapshot) => {
    const transactions = [];
    snapshot.forEach((docSnap) => {
      transactions.push({ id: docSnap.id, ...docSnap.data() });
    });
    updateTransactionHistory(transactions);
  }));

  // Chart refreshes only when snapshot docs change — not on every totals recalculation
  const snapshotsRef = collection(window.firebaseDb, 'users', userId, 'snapshots');
  const snapshotsQuery = query(snapshotsRef, orderBy('timestamp', 'desc'), limit(1));
  trackFirestoreListener(onSnapshot(snapshotsQuery, () => {
    loadPortfolioChart(userId);
  }));
}

async function updateHoldingsTable(holdings) {
  const tbody = document.getElementById('holdings-tbody');
  if (!tbody) return;

  const generation = holdingsQuoteGen.next();

  if (!holdings || holdings.length === 0) {
    latestHoldingsMarketValue = 0;
    holdingsQuotesLoading = false;
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No holdings yet. Start paper trading to build a portfolio.</td></tr>';
    refreshPortfolioTotalsDisplay();
    return;
  }

  // Provisional totals from cost basis so cash-only flicker never appears while quotes load
  latestHoldingsMarketValue = holdingsCostBasis(holdings);
  holdingsQuotesLoading = true;
  refreshPortfolioTotalsDisplay();
  tbody.innerHTML = `<tr><td colspan="6" class="empty-state">Updating holdings prices…</td></tr>`;

  const holdingsWithPrices = [];
  for (let i = 0; i < holdings.length; i++) {
    if (!holdingsQuoteGen.isCurrent(generation)) return;

    const holding = holdings[i];
    if (i > 0) {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      if (!holdingsQuoteGen.isCurrent(generation)) return;
    }
    try {
      const token = await window.firebaseAuth?.currentUser?.getIdToken();
      if (!holdingsQuoteGen.isCurrent(generation)) return;
      const res = await fetch(`/api/stockPrice?symbol=${encodeURIComponent(holding.symbol)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      const data = await res.json();
      const price = Number(data.price);
      if (res.ok && Number.isFinite(price) && price > 0) {
        holdingsWithPrices.push({ ...holding, currentPrice: price, priceAvailable: true });
      } else {
        holdingsWithPrices.push({ ...holding, currentPrice: null, priceAvailable: false });
      }
    } catch (err) {
      holdingsWithPrices.push({ ...holding, currentPrice: null, priceAvailable: false });
    }
  }

  if (!holdingsQuoteGen.isCurrent(generation)) return;

  let totalValue = 0;
  let html = '';

  holdingsWithPrices.forEach((holding) => {
    const cost = holding.totalCost || (holding.shares * holding.avgPrice);
    const safeSymbol = escapeHtml(holding.symbol);

    if (!holding.priceAvailable) {
      html += `
        <tr>
          <td style="padding: 1rem; font-weight: 600;">${safeSymbol}</td>
          <td style="padding: 1rem; text-align: right;">${holding.shares}</td>
          <td style="padding: 1rem; text-align: right;">${formatMoney(holding.avgPrice)}</td>
          <td style="padding: 1rem; text-align: right; color: var(--muted);">—</td>
          <td style="padding: 1rem; text-align: right; color: var(--muted);">—</td>
          <td style="padding: 1rem; text-align: right; color: var(--muted);">Price unavailable</td>
        </tr>
      `;
      totalValue += cost;
      return;
    }

    const value = holding.shares * holding.currentPrice;
    const pl = value - cost;
    const plPercent = cost > 0 ? ((pl / cost) * 100) : 0;
    totalValue += value;

    const plClass = pl >= 0 ? 'positive' : 'negative';
    html += `
      <tr>
        <td style="padding: 1rem; font-weight: 600;">${safeSymbol}</td>
        <td style="padding: 1rem; text-align: right;">${holding.shares}</td>
        <td style="padding: 1rem; text-align: right;">${formatMoney(holding.avgPrice)}</td>
        <td style="padding: 1rem; text-align: right;">${formatMoney(holding.currentPrice)}</td>
        <td style="padding: 1rem; text-align: right;">${formatMoney(value)}</td>
        <td style="padding: 1rem; text-align: right;" class="change ${plClass}">
          ${formatMoneySigned(pl)} (${formatSignedPercent(plPercent)})
        </td>
      </tr>
    `;
  });

  if (!holdingsQuoteGen.isCurrent(generation)) return;

  tbody.innerHTML = html;
  latestHoldingsMarketValue = totalValue;
  holdingsQuotesLoading = false;
  refreshPortfolioTotalsDisplay();
}

// Portfolio chart
let portfolioChart = null;
let portfolioChartSnapshots = [];
let portfolioChartMeta = null;
let portfolioChartRange = 'ALL';
/** @type {'value' | 'compare'} */
let portfolioChartView = 'value';
/** Cached SPY compact bars from last history fetch */
let portfolioSpyBars = [];
let portfolioSpyCacheMeta = null;

const CHART_RANGE_MS = DEFAULT_CHART_RANGE_MS || {
  '1W': 7 * 24 * 60 * 60 * 1000,
  '1M': 30 * 24 * 60 * 60 * 1000,
  '3M': 90 * 24 * 60 * 60 * 1000,
  ALL: null
};

function filterSnapshotsByRange(snapshots, range) {
  return coreFilterSnapshotsByRange(snapshots, range, CHART_RANGE_MS);
}

function setChartRangeNote(message, { sparse = false } = {}) {
  const note = document.getElementById('chart-range-note');
  if (!note) return;
  if (!message) {
    note.hidden = true;
    note.textContent = '';
    note.classList.remove('is-sparse');
    return;
  }
  note.hidden = false;
  note.textContent = message;
  note.classList.toggle('is-sparse', !!sparse);
}

function updateChartRangeButtons() {
  const buttons = document.querySelectorAll('.chart-range-btn');
  if (!buttons.length) return;
  buttons.forEach((btn) => {
    const range = btn.dataset.range;
    const assessment = assessChartRange(portfolioChartSnapshots, range, CHART_RANGE_MS);
    // Allow selecting any range that has data; sparse ranges stay enabled with a note
    btn.disabled = assessment.pointCount === 0 && range !== 'ALL';
    btn.setAttribute('aria-pressed', range === portfolioChartRange ? 'true' : 'false');
  });
}

function setPortfolioChartRange(range) {
  const next = CHART_RANGE_MS[range] !== undefined ? range : 'ALL';
  portfolioChartRange = next;
  updateChartRangeButtons();
  refreshPortfolioChartRender();
}

function setPortfolioChartView(view) {
  portfolioChartView = view === 'compare' ? 'compare' : 'value';
  updateChartViewButtons();
  refreshPortfolioChartRender();
}

function updateChartViewButtons() {
  document.querySelectorAll('.chart-view-btn').forEach((btn) => {
    btn.setAttribute('aria-pressed', btn.dataset.chartView === portfolioChartView ? 'true' : 'false');
  });
}

function setBenchmarkSourceNote(text) {
  const el = document.getElementById('chart-benchmark-source');
  if (!el) return;
  if (!text) {
    el.hidden = true;
    el.textContent = '';
    return;
  }
  el.hidden = false;
  el.textContent = text;
}

function refreshPortfolioChartRender() {
  const assessment = assessChartRange(portfolioChartSnapshots, portfolioChartRange, CHART_RANGE_MS);
  if (portfolioChartView === 'compare') {
    renderPortfolioCompareChart(assessment.filtered, assessment);
  } else {
    setBenchmarkSourceNote('');
    renderPortfolioChart(assessment.filtered, assessment);
  }
}

function initChartRanges() {
  const group = document.getElementById('chart-ranges');
  if (!group || group.dataset.bound) return;
  group.dataset.bound = '1';
  group.addEventListener('click', (e) => {
    const btn = e.target.closest('.chart-range-btn');
    if (!btn || btn.disabled) return;
    setPortfolioChartRange(btn.dataset.range);
  });
}

function initChartViewToggle() {
  const group = document.getElementById('chart-view-toggle');
  if (!group || group.dataset.bound) return;
  group.dataset.bound = '1';
  group.addEventListener('click', (e) => {
    const btn = e.target.closest('.chart-view-btn');
    if (!btn) return;
    setPortfolioChartView(btn.dataset.chartView);
  });
  updateChartViewButtons();
}

async function loadPortfolioChart(userId) {
  try {
    const token = await window.firebaseAuth.currentUser?.getIdToken();
    if (!token) return;

    const res = await fetch('/api/portfolioHistory?includeBenchmark=1', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (!res.ok) {
      console.error('Failed to load portfolio history');
      return;
    }

    const data = await res.json();
    portfolioChartMeta = data.meta || null;
    portfolioSpyBars = Array.isArray(data.benchmark?.spyBars) ? data.benchmark.spyBars : [];
    portfolioSpyCacheMeta = data.benchmark?.cache || null;

    if (!data.success || !data.snapshots || data.snapshots.length === 0) {
      portfolioChartSnapshots = [];
      portfolioSpyBars = [];
      updateChartRangeButtons();
      setChartRangeNote('No recorded portfolio snapshots yet. Trades create history points; daily valuations fill quiet trading days.', { sparse: true });
      setBenchmarkSourceNote('');
      ensurePortfolioChartCanvas();
      if (portfolioChart) {
        try { portfolioChart.destroy(); } catch (_) { /* ignore */ }
        portfolioChart = null;
      }
      const frame = document.querySelector('#portfolio-chart-section .chart-frame');
      if (frame) {
        frame.innerHTML = '<p class="empty-state">No historical observations yet.</p><canvas id="portfolio-chart" hidden></canvas>';
      }
      return;
    }

    portfolioChartSnapshots = data.snapshots;
    initChartRanges();
    initChartViewToggle();
    updateChartRangeButtons();
    refreshPortfolioChartRender();
  } catch (error) {
    console.error('Error loading portfolio chart:', error);
    setChartRangeNote(`Error loading chart: ${error.message}`, { sparse: true });
  }
}

function formatChartLabel(date, { includeTime = false, includeSeconds = false } = {}) {
  const opts = {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  };
  if (includeTime) {
    opts.hour = '2-digit';
    opts.minute = '2-digit';
    if (includeSeconds) opts.second = '2-digit';
  }
  return date.toLocaleString('en-US', opts);
}

function ensurePortfolioChartCanvas() {
  const frame = document.querySelector('#portfolio-chart-section .chart-frame');
  if (!frame) return null;
  let canvas = document.getElementById('portfolio-chart');
  if (!canvas) {
    frame.innerHTML = '<canvas id="portfolio-chart"></canvas>';
    canvas = document.getElementById('portfolio-chart');
  }
  canvas.hidden = false;
  // Remove empty-state paragraphs left from prior empty loads
  frame.querySelectorAll('.empty-state').forEach((el) => el.remove());
  return canvas;
}

function renderPortfolioChart(snapshots, assessment) {
  const canvas = ensurePortfolioChartCanvas();
  if (!canvas) {
    console.error('Portfolio chart canvas not found');
    return;
  }

  const noteAssessment = assessment || assessChartRange(snapshots, portfolioChartRange, CHART_RANGE_MS);
  setChartRangeNote(noteAssessment.message || '', { sparse: noteAssessment.sparse });

  if (!snapshots || snapshots.length === 0) {
    if (portfolioChart) {
      try { portfolioChart.destroy(); } catch (_) { /* ignore */ }
      portfolioChart = null;
    }
    canvas.parentElement.insertAdjacentHTML(
      'afterbegin',
      '<p class="empty-state">No recorded snapshots in this range.</p>'
    );
    canvas.hidden = true;
    return;
  }

  const ordered = [...snapshots].sort(
    (a, b) => new Date(a.timestamp) - new Date(b.timestamp)
  );

  const ctx = canvas.getContext('2d');
  const spanMs = new Date(ordered[ordered.length - 1].timestamp) - new Date(ordered[0].timestamp);
  const multiDay = spanMs > 36 * 60 * 60 * 1000;
  const sparse = ordered.length < 4 || !!noteAssessment.sparse;

  const series = ordered.map((s) => ({
    x: new Date(s.timestamp).getTime(),
    y: Number(s.portfolioValue) || 0,
    meta: s
  }));

  const startRef = Number(portfolioChartMeta?.startingCapitalReference) || 10000;
  const baseline = [
    { x: series[0].x, y: startRef },
    { x: series[series.length - 1].x, y: startRef }
  ];

  if (portfolioChart) {
    portfolioChart.destroy();
  }

  // Time scale: chronological spacing. No tension curves that invent midpoints.
  // Segments longer than MAX_CONNECTED_GAP_MS (7 days) are not drawn.
  const gapLimitMs = Number(MAX_CONNECTED_GAP_MS) || 7 * 24 * 60 * 60 * 1000;
  portfolioChart = new Chart(ctx, {
    type: 'line',
    data: {
      datasets: [
        {
          label: 'Recorded portfolio value',
          data: series,
          borderColor: '#0f766e',
          backgroundColor: 'transparent',
          borderWidth: 2,
          fill: false,
          tension: 0,
          showLine: ordered.length >= 2,
          pointRadius: sparse ? 5 : 3,
          pointHoverRadius: 7,
          pointBackgroundColor: '#0f766e',
          pointBorderColor: '#ffffff',
          pointBorderWidth: 1,
          spanGaps: false,
          segment: {
            borderColor: (ctx) => {
              const from = ctx.p0?.parsed?.x;
              const to = ctx.p1?.parsed?.x;
              if (chartSegmentShouldBreak(from, to, gapLimitMs)) {
                return 'rgba(0,0,0,0)';
              }
              return undefined;
            }
          }
        },
        {
          label: 'Starting capital (reference)',
          data: baseline,
          borderColor: '#9ca3af',
          backgroundColor: 'transparent',
          borderWidth: 1,
          borderDash: [6, 4],
          fill: false,
          tension: 0,
          pointRadius: 0,
          pointHoverRadius: 0
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      parsing: false,
      plugins: {
        legend: {
          display: true,
          position: 'top'
        },
        tooltip: {
          mode: 'index',
          intersect: false,
          filter: function(item) {
            // Starting-capital reference is always shown; portfolio points need a value
            if (item.datasetIndex === 1) return true;
            return item.parsed?.y != null && Number.isFinite(item.parsed.y);
          },
          callbacks: {
            title: function(items) {
              const portfolioItem = items.find((i) => i.datasetIndex === 0) || items[0];
              const raw = portfolioItem?.raw;
              const ts = raw?.x ?? portfolioItem?.parsed?.x;
              if (ts == null) return '';
              return formatChartLabel(new Date(ts), { includeTime: true });
            },
            label: function(context) {
              const y = context.parsed?.y;
              const label = context.dataset.label || '';
              if (context.datasetIndex === 1) {
                return `${label}: ${formatMoney(startRef)}`;
              }
              if (y == null || !Number.isFinite(y)) return null;
              const meta = context.raw?.meta || {};
              const kindLabel =
                typeof describeSnapshotKind === 'function'
                  ? describeSnapshotKind(meta)
                  : meta.kind || 'Recorded snapshot';
              return `${kindLabel}: ${formatMoney(y)}`;
            },
            afterBody: function(items) {
              const portfolioItem = items.find((i) => i.datasetIndex === 0);
              const meta = portfolioItem?.raw?.meta;
              if (!meta) return [];
              const lines = [];
              if (meta.source === 'live' && meta.quoteStatus && meta.quoteStatus !== 'ok') {
                lines.push(`Live quotes: ${meta.quoteStatus}`);
              }
              if (meta.cashBalance != null) {
                lines.push(`Cash: ${formatMoney(meta.cashBalance)}`);
              }
              return lines;
            }
          }
        }
      },
      scales: {
        y: {
          beginAtZero: false,
          ticks: {
            callback: function(value) {
              return formatMoney(value);
            }
          },
          grid: {
            color: 'rgba(0, 0, 0, 0.04)'
          }
        },
        x: {
          type: 'time',
          time: {
            tooltipFormat: 'MMM d, yyyy HH:mm',
            displayFormats: {
              hour: 'MMM d Ha',
              day: 'MMM d',
              week: 'MMM d',
              month: 'MMM yyyy'
            }
          },
          adapters: {},
          grid: {
            display: false
          },
          ticks: {
            maxRotation: 45,
            autoSkip: true,
            maxTicksLimit: multiDay ? 6 : 5
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

function renderPortfolioCompareChart(filteredSnapshots, assessment) {
  const canvas = ensurePortfolioChartCanvas();
  if (!canvas) return;

  const comparison =
    typeof buildBenchmarkComparison === 'function'
      ? buildBenchmarkComparison({
          portfolioSnapshots: filteredSnapshots || [],
          spyBars: portfolioSpyBars || []
        })
      : { ok: false, reason: 'missing_helper', message: 'Comparison helper unavailable.', portfolioSeries: [], spySeries: [] };

  if (!comparison.ok || !comparison.portfolioSeries?.length) {
    // Keep Portfolio Value ($) intact via ensurePortfolioChartCanvas when switching back;
    // hide technical source notes while comparison data is missing.
    const emptyMessage =
      comparison.message ||
      'S&P 500 comparison data is temporarily unavailable. Please check back after the next market-data refresh.';
    const noteParts = [];
    if (assessment?.message) noteParts.push(assessment.message);
    // Show the unavailable copy once in the chart frame, not also in the range note.
    if (comparison.reason !== 'benchmark_unavailable' && comparison.message) {
      noteParts.push(comparison.message);
    }
    setChartRangeNote(noteParts.join(' ') || '', {
      sparse: !!(assessment?.sparse || !comparison.ok)
    });
    setBenchmarkSourceNote('');
    if (portfolioChart) {
      try { portfolioChart.destroy(); } catch (_) { /* ignore */ }
      portfolioChart = null;
    }
    canvas.parentElement.insertAdjacentHTML(
      'afterbegin',
      `<p class="empty-state">${escapeHtml(emptyMessage)}</p>`
    );
    canvas.hidden = true;
    return;
  }

  const notes = [];
  if (assessment?.message) notes.push(assessment.message);
  if (comparison.message) notes.push(comparison.message);
  setChartRangeNote(notes.filter(Boolean).join(' ') || '', {
    sparse: !!(assessment?.sparse || !comparison.ok)
  });

  const cache = portfolioSpyCacheMeta || {};
  const label = comparison.meta?.spyLabel || SPY_BENCHMARK_LABEL || 'SPY (S&P 500 ETF proxy)';
  const asOf = cache.fetchedAt || cache.asOfSession || comparison.meta?.spyLastDate || null;
  const asOfText = asOf
    ? `Last updated: ${typeof asOf === 'string' && asOf.includes('T')
      ? new Date(asOf).toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' }) + ' ET'
      : asOf}`
    : 'Last updated: unavailable';
  setBenchmarkSourceNote(`Benchmark: ${label}. Source: Alpha Vantage TIME_SERIES_DAILY (compact). ${asOfText}.`);

  const portfolioSeries = comparison.portfolioSeries;
  const spySeries = comparison.spySeries || [];
  const gapLimitMs = Number(MAX_CONNECTED_GAP_MS) || 7 * 24 * 60 * 60 * 1000;
  const spanMs =
    portfolioSeries.length > 1
      ? portfolioSeries[portfolioSeries.length - 1].x - portfolioSeries[0].x
      : 0;
  const multiDay = spanMs > 36 * 60 * 60 * 1000;

  if (portfolioChart) {
    portfolioChart.destroy();
  }

  portfolioChart = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      datasets: [
        {
          label: 'My portfolio return',
          data: portfolioSeries,
          borderColor: '#0f766e',
          backgroundColor: 'transparent',
          borderWidth: 2,
          fill: false,
          tension: 0,
          showLine: portfolioSeries.length >= 2,
          pointRadius: 5,
          pointHoverRadius: 7,
          pointBackgroundColor: '#0f766e',
          pointBorderColor: '#ffffff',
          pointBorderWidth: 1,
          spanGaps: false,
          order: 1,
          segment: {
            borderColor: (ctx) => {
              const from = ctx.p0?.parsed?.x;
              const to = ctx.p1?.parsed?.x;
              if (chartSegmentShouldBreak(from, to, gapLimitMs)) return 'rgba(0,0,0,0)';
              return undefined;
            }
          }
        },
        {
          label: 'SPY (daily closes)',
          data: spySeries,
          borderColor: '#64748b',
          backgroundColor: 'transparent',
          borderWidth: 1.5,
          borderDash: [4, 3],
          fill: false,
          tension: 0,
          showLine: spySeries.length >= 2,
          pointRadius: 0,
          pointHoverRadius: 4,
          pointHitRadius: 6,
          spanGaps: false,
          order: 2
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      parsing: false,
      plugins: {
        legend: {
          display: true,
          position: 'top'
        },
        tooltip: {
          mode: 'index',
          intersect: false,
          callbacks: {
            title: function(items) {
              const ts = items[0]?.parsed?.x ?? items[0]?.raw?.x;
              if (ts == null) return '';
              return formatChartLabel(new Date(ts), { includeTime: true });
            },
            label: function(context) {
              const y = context.parsed?.y;
              if (y == null || !Number.isFinite(y)) return null;
              if (context.datasetIndex === 1) {
                const date = context.raw?.meta?.date;
                return `SPY daily${date ? ` (${date})` : ''}: ${formatPercent(y)}`;
              }
              const meta = context.raw?.meta || {};
              const kindLabel =
                typeof describeSnapshotKind === 'function'
                  ? describeSnapshotKind(meta)
                  : 'Portfolio';
              return `${kindLabel}: ${formatPercent(y)}`;
            },
            afterBody: function(items) {
              const portfolioItem = items.find((i) => i.datasetIndex === 0);
              const meta = portfolioItem?.raw?.meta;
              if (!meta) return [];
              const lines = [];
              if (meta.spyAsOfDate != null && meta.spyClose != null) {
                lines.push(`Aligned SPY close (${meta.spyAsOfDate}): ${formatMoney(meta.spyClose)}`);
              }
              if (meta.portfolioValue != null) {
                lines.push(`Portfolio value: ${formatMoney(meta.portfolioValue)}`);
              }
              return lines;
            }
          }
        }
      },
      scales: {
        y: {
          beginAtZero: false,
          ticks: {
            callback: function(value) {
              return formatPercent(value, 1);
            }
          },
          title: {
            display: true,
            text: 'Return since comparison start',
            color: '#64748b',
            font: { size: 11 }
          },
          grid: {
            color: 'rgba(0, 0, 0, 0.04)'
          }
        },
        x: {
          type: 'time',
          time: {
            tooltipFormat: 'MMM d, yyyy HH:mm',
            displayFormats: {
              hour: 'MMM d Ha',
              day: 'MMM d',
              week: 'MMM d',
              month: 'MMM yyyy'
            }
          },
          adapters: {},
          grid: {
            display: false
          },
          ticks: {
            maxRotation: 45,
            autoSkip: true,
            maxTicksLimit: multiDay ? 6 : 5
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
        <td style="padding: 1rem; text-align: right;">${formatMoney(tx.price)}</td>
        <td style="padding: 1rem; text-align: right; font-weight: 600;">${formatMoney(tx.totalAmount)}</td>
      </tr>
    `;
  });

  tbody.innerHTML = html;
}

const AUTH_SECTIONS = ['portfolio', 'trade', 'watchlist'];
const PUBLIC_SECTIONS = ['dashboard', 'markets', 'research', 'portfolio', 'trade', 'watchlist'];

function setSignedInUI(isSignedIn) {
  const pairs = [
    ['portfolio-section', 'portfolio-auth-gate'],
    ['trade-content', 'trade-auth-gate'],
    ['watchlist-section', 'watchlist-auth-gate']
  ];
  pairs.forEach(([contentId, gateId]) => {
    const content = document.getElementById(contentId);
    const gate = document.getElementById(gateId);
    if (content) content.style.display = isSignedIn ? 'block' : 'none';
    if (gate) gate.classList.toggle('is-visible', !isSignedIn);
  });
  const dashStrip = document.getElementById('dashboard-portfolio-strip');
  if (dashStrip) dashStrip.hidden = !isSignedIn;
}

function navigateTo(sectionId, { replace = false } = {}) {
  const id = PUBLIC_SECTIONS.includes(sectionId) ? sectionId : 'dashboard';
  document.querySelectorAll('.app-section').forEach((el) => {
    el.classList.toggle('is-active', el.dataset.section === id);
  });
  document.querySelectorAll('[data-nav]').forEach((link) => {
    const active = link.getAttribute('data-nav') === id;
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  const nextHash = `#${id}`;
  if (replace) {
    history.replaceState(null, '', nextHash);
  } else if (location.hash !== nextHash) {
    history.pushState(null, '', nextHash);
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function sectionFromHash() {
  const raw = (location.hash || '#dashboard').replace(/^#/, '');
  // legacy aliases
  if (raw === 'briefing') return 'dashboard';
  if (raw === 'portfolio-section') return 'portfolio';
  if (raw === 'explain-section' || raw === 'recommendation-section') return 'research';
  return PUBLIC_SECTIONS.includes(raw) ? raw : 'dashboard';
}

function initHashNavigation() {
  document.querySelectorAll('[data-nav]').forEach((link) => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      navigateTo(link.getAttribute('data-nav'));
    });
  });
  window.addEventListener('hashchange', () => navigateTo(sectionFromHash(), { replace: true }));
  navigateTo(sectionFromHash(), { replace: true });
}

function syncResearchInputs(symbol) {
  const value = String(symbol || '').trim().toUpperCase();
  const research = document.getElementById('research-symbol');
  const explain = document.getElementById('explain-symbol');
  const recommend = document.getElementById('recommendation-symbol');
  if (research && value) research.value = value;
  if (explain) explain.value = value || (research?.value || '').trim().toUpperCase();
  if (recommend) recommend.value = value || (research?.value || '').trim().toUpperCase();
}

function setResearchTab(tab) {
  const overview = document.getElementById('panel-overview');
  const recommendation = document.getElementById('panel-recommendation');
  const tabOverview = document.getElementById('tab-overview');
  const tabRec = document.getElementById('tab-recommendation');
  const isOverview = tab !== 'recommendation';
  if (overview) overview.classList.toggle('is-active', isOverview);
  if (recommendation) {
    recommendation.classList.toggle('is-active', !isOverview);
    recommendation.hidden = isOverview;
  }
  if (tabOverview) tabOverview.setAttribute('aria-selected', isOverview ? 'true' : 'false');
  if (tabRec) tabRec.setAttribute('aria-selected', isOverview ? 'false' : 'true');
}

async function analyzeResearch() {
  const research = document.getElementById('research-symbol');
  const symbol = (research?.value || '').trim().toUpperCase();
  if (!symbol) {
    const msg = document.getElementById('explain-message');
    if (msg) {
      msg.innerHTML = '<div class="error">Enter a stock symbol or company name.</div>';
      setTimeout(() => { msg.innerHTML = ''; }, 3000);
    }
    return;
  }
  syncResearchInputs(symbol);
  setResearchTab('overview');
  navigateTo('research', { replace: true });
  const analyzeBtn = document.getElementById('research-analyze-btn');
  if (analyzeBtn) {
    analyzeBtn.disabled = true;
    analyzeBtn.textContent = 'Analyzing...';
  }
  try {
    await Promise.all([
      explainCompany(symbol),
      getStockRecommendation()
    ]);
  } finally {
    if (analyzeBtn) {
      analyzeBtn.disabled = false;
      analyzeBtn.textContent = 'Analyze';
    }
  }
}

function initResearchUI() {
  document.querySelectorAll('[data-research-tab]').forEach((tab) => {
    tab.addEventListener('click', () => setResearchTab(tab.dataset.researchTab));
  });
  const analyzeBtn = document.getElementById('research-analyze-btn');
  if (analyzeBtn) analyzeBtn.addEventListener('click', analyzeResearch);
  const researchInput = document.getElementById('research-symbol');
  if (researchInput) {
    researchInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') analyzeResearch();
    });
  }
}

// Initialize auth state listener
function initAuth() {
  if (!window.firebaseAuth || !window.firebaseAuthFunctions) {
    console.error('Firebase Auth not initialized');
    return false;
  }

  if (typeof authUnsubscriber === 'function') {
    try { authUnsubscriber(); } catch (_) { /* ignore */ }
    authUnsubscriber = null;
  }

  authUnsubscriber = window.firebaseAuthFunctions.onAuthStateChanged(window.firebaseAuth, (user) => {
    const loginBtn = document.getElementById('login-btn');
    const userInfo = document.getElementById('user-info');
    const userName = document.getElementById('user-name');
    const signinPrompt = document.getElementById('signin-prompt');

    // Tear down prior listeners and clear UI before re-subscribing (sign-out or account switch)
    teardownFirestoreListeners();
    resetPortfolioState();

    if (user) {
      if (loginBtn) loginBtn.style.display = 'none';
      if (userInfo) {
        userInfo.style.display = 'flex';
        userInfo.classList.add('is-visible');
      }
      if (userName) userName.textContent = user.displayName || user.email;
      setSignedInUI(true);
      if (signinPrompt) signinPrompt.style.display = 'none';
      setupPortfolioListeners(user.uid);
      setupWatchlistListener(user.uid);
      applyPendingTradeAfterSignIn();
    } else {
      if (loginBtn) loginBtn.style.display = 'inline-flex';
      if (userInfo) {
        userInfo.style.display = 'none';
        userInfo.classList.remove('is-visible');
      }
      setSignedInUI(false);
      if (signinPrompt) {
        signinPrompt.style.display = 'flex';
        const promptCopy = signinPrompt.querySelector('p');
        if (promptCopy) {
          promptCopy.textContent = 'Use a free account for your virtual portfolio, practice trades, P&L tracking, and a personal watchlist.';
        }
        signinPrompt.classList.remove('signin-prompt-highlight');
      }
    }
  });
  return true;
}

async function bootstrapAuthAndControls() {
  const ready = await waitUntil(
    () => !!(window.firebaseAuth && window.firebaseAuthFunctions),
    { timeoutMs: 15000, intervalMs: 50 }
  );
  if (!ready) {
    console.error('Firebase Auth failed to initialize within timeout');
    return false;
  }
  initAuth();
  document.getElementById('login-btn')?.addEventListener('click', signInWithGoogle);
  document.getElementById('signin-prompt-btn')?.addEventListener('click', signInWithGoogle);
  document.getElementById('logout-btn')?.addEventListener('click', signOutUser);
  document.getElementById('buy-btn')?.addEventListener('click', buyStock);
  document.getElementById('sell-btn')?.addEventListener('click', sellStock);
  document.getElementById('add-watchlist-btn')?.addEventListener('click', addToWatchlist);
  document.getElementById('watchlist-tbody')?.addEventListener('click', handleWatchlistAction);
  document.getElementById('explain-btn')?.addEventListener('click', explainCompany);
  document.getElementById('recommendation-btn')?.addEventListener('click', getStockRecommendation);

  const watchlistSymbolInput = document.getElementById('watchlist-symbol');
  if (watchlistSymbolInput) {
    watchlistSymbolInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') addToWatchlist();
    });
  }
  return true;
}

// Watchlist Functions
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function prepareTradeFromWatchlist(symbol) {
  const sym = String(symbol || '').trim().toUpperCase();
  if (!sym) return;

  const symbolInput = document.getElementById('stock-symbol');
  const qtyInput = document.getElementById('stock-quantity');
  const messageDiv = document.getElementById('trading-message');

  if (symbolInput) symbolInput.value = sym;
  if (qtyInput) qtyInput.value = '1';
  if (messageDiv) messageDiv.innerHTML = '';

  navigateTo('trade');
  symbolInput?.focus();
}

function explainFromWatchlist(symbol) {
  const sym = String(symbol || '').trim().toUpperCase();
  if (!sym) return;

  syncResearchInputs(sym);
  setResearchTab('overview');
  navigateTo('research');
  // Full research path: Overview + Recommendation for a consistent Analyze experience
  analyzeResearch();
}

function handleWatchlistAction(event) {
  const btn = event.target.closest('[data-watchlist-action]');
  if (!btn) return;

  const action = btn.dataset.watchlistAction;
  const symbol = btn.dataset.symbol;
  if (!symbol) return;

  if (action === 'explain') {
    explainFromWatchlist(symbol);
  } else if (action === 'trade') {
    prepareTradeFromWatchlist(symbol);
  } else if (action === 'remove') {
    removeFromWatchlist(symbol);
  }
}

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

// Make removeFromWatchlist globally accessible (legacy onclick + table actions)
window.removeFromWatchlist = removeFromWatchlist;

async function updateWatchlistTable(watchlistItems) {
  const tbody = document.getElementById('watchlist-tbody');
  if (!tbody) return;

  const generation = watchlistQuoteGen.next();

  if (!watchlistItems || watchlistItems.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty-state">No stocks in watchlist. Add some stocks to track!</td></tr>';
    return;
  }

  // Fetch quotes one-by-one to reduce Alpha Vantage rate-limit collisions
  const prices = [];
  for (let i = 0; i < watchlistItems.length; i++) {
    if (!watchlistQuoteGen.isCurrent(generation)) return;

    const item = watchlistItems[i];
    if (i > 0) {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      if (!watchlistQuoteGen.isCurrent(generation)) return;
    }
    try {
      const token = await window.firebaseAuth.currentUser.getIdToken();
      if (!watchlistQuoteGen.isCurrent(generation)) return;
      const res = await fetch(`/api/stockPrice?symbol=${encodeURIComponent(item.symbol)}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (res.ok) {
        const data = await res.json();
        const price = Number(data.price);
        const change = data.change == null ? null : Number(data.change);
        const changePercent = data.changePercent == null ? null : Number(data.changePercent);
        prices.push({
          symbol: item.symbol,
          price: Number.isFinite(price) ? price : 0,
          change: Number.isFinite(change) ? change : null,
          changePercent: Number.isFinite(changePercent) ? changePercent : null
        });
      } else {
        prices.push({
          symbol: item.symbol,
          price: null,
          change: null,
          changePercent: null,
          error: true
        });
      }
    } catch (error) {
      console.error(`Error fetching price for ${item.symbol}:`, error);
      prices.push({
        symbol: item.symbol,
        price: null,
        change: null,
        changePercent: null,
        error: true
      });
    }
  }

  if (!watchlistQuoteGen.isCurrent(generation)) return;

  // Build table rows
  let html = '';
  prices.forEach((stock) => {
    const safeSymbol = escapeHtml(stock.symbol);
    const priceText = stock.price == null ? '—' : formatMoney(stock.price);
    let changeHtml = '<span style="color: var(--muted);">—</span>';
    if (stock.changePercent != null && stock.change != null) {
      const changeClass = stock.changePercent >= 0 ? 'positive' : 'negative';
      changeHtml = `
        <span class="change ${changeClass}" style="font-weight: 600;">
          ${formatSignedPercent(stock.changePercent)}
          (${formatMoneySigned(stock.change)})
        </span>
      `;
    }

    html += `
      <tr>
        <td style="padding: 1rem; font-weight: 600;">${safeSymbol}</td>
        <td style="padding: 1rem; text-align: right; font-weight: 600;">${priceText}</td>
        <td style="padding: 1rem; text-align: right;">${changeHtml}</td>
        <td style="padding: 1rem; text-align: center;">
          <div class="watchlist-actions">
            <button type="button" class="btn-table btn-table-explain" data-watchlist-action="explain" data-symbol="${safeSymbol}">Explain</button>
            <button type="button" class="btn-table btn-table-trade" data-watchlist-action="trade" data-symbol="${safeSymbol}">Trade</button>
            <button type="button" class="btn-table btn-table-remove" data-watchlist-action="remove" data-symbol="${safeSymbol}">Remove</button>
          </div>
        </td>
      </tr>
    `;
  });

  tbody.innerHTML = html;
}

function setupWatchlistListener(userId) {
  if (!window.firebaseDb || !window.firebaseFirestoreFunctions) return;

  const { collection, onSnapshot } = window.firebaseFirestoreFunctions;

  const watchlistRef = collection(window.firebaseDb, 'users', userId, 'watchlist');
  trackFirestoreListener(onSnapshot(watchlistRef, async (snapshot) => {
    const watchlistItems = [];
    snapshot.forEach((docSnap) => {
      watchlistItems.push({ symbol: docSnap.id, ...docSnap.data() });
    });
    await updateWatchlistTable(watchlistItems);
  }));
}

// Explain It Feature
async function explainCompany(symbolOverride) {
  const symbolInput = document.getElementById('explain-symbol');
  const messageDiv = document.getElementById('explain-message');
  const resultDiv = document.getElementById('explain-result');
  const explainBtn = document.getElementById('explain-btn');
  const researchInput = document.getElementById('research-symbol');

  // Click handlers pass a PointerEvent as the first arg — only accept real symbol strings
  if (typeof symbolOverride === 'string' && symbolOverride.trim()) {
    syncResearchInputs(symbolOverride);
  } else if (researchInput?.value?.trim()) {
    syncResearchInputs(researchInput.value);
  }

  const symbol = (symbolInput?.value || '').trim().toUpperCase();

  if (!symbol) {
    if (messageDiv) {
      messageDiv.innerHTML = '<div class="error">Please enter a stock symbol</div>';
      setTimeout(() => { messageDiv.innerHTML = ''; }, 3000);
    }
    return;
  }

  if (explainBtn) {
    explainBtn.disabled = true;
    explainBtn.textContent = 'Explaining...';
  }
  if (messageDiv) {
    messageDiv.innerHTML = '<div class="info-banner">Fetching company information...</div>';
  }
  if (resultDiv) resultDiv.style.display = 'none';

  try {
    const res = await fetch(`/api/explainCompany?symbol=${encodeURIComponent(symbol)}`);

    let data;
    try {
      data = await res.json();
    } catch (parseError) {
      throw new Error(`Server error: ${res.status} ${res.statusText}`);
    }

    if (!res.ok) {
      const error = new Error(data.error || 'Failed to explain company');
      error.suggestion = data.suggestion;
      throw error;
    }

    document.getElementById('explain-company-name').textContent = formatCompanyHeading(data.companyName, data.symbol);
    document.getElementById('explain-content').textContent = data.explanation;

    let priceInfo = '';
    if (data.sector) {
      priceInfo += `${data.sector}`;
      if (data.industry) priceInfo += ` • ${data.industry}`;
    }
    if (data.price) {
      priceInfo += priceInfo ? ' • ' : '';
      priceInfo += `${formatMoney(data.price)} (${formatSignedPercent(data.priceChange?.changePercent ?? 0)})`;
    }
    const priceEl = document.getElementById('explain-price-info');
    if (priceEl) {
      priceEl.textContent = priceInfo || 'Price information unavailable';
      const stale = priceEl.parentElement?.querySelector('.other-matches');
      if (stale) stale.remove();
      if (data.searchInfo?.otherMatches?.length) {
        const matches = document.createElement('div');
        matches.className = 'other-matches';
        matches.innerHTML = `<strong>Other matches:</strong> ${data.searchInfo.otherMatches.map(m => `${escapeHtml(m.name)} (${escapeHtml(m.symbol)})`).join(', ')}`;
        priceEl.insertAdjacentElement('afterend', matches);
      }
    }

    if (resultDiv) resultDiv.style.display = 'block';
    if (messageDiv) messageDiv.innerHTML = '';
    syncResearchInputs(data.symbol || symbol);

  } catch (error) {
    let errorHtml = `<div class="error">${error.message || 'An error occurred'}</div>`;
    if (error.suggestion) {
      errorHtml += `<div class="info-banner" style="margin-top:0.5rem;">${error.suggestion}</div>`;
    }
    if (messageDiv) {
      messageDiv.innerHTML = errorHtml;
      setTimeout(() => { messageDiv.innerHTML = ''; }, 8000);
    }
  } finally {
    if (explainBtn) {
      explainBtn.disabled = false;
      explainBtn.textContent = 'Explain';
    }
  }
}

// Stock Recommendation Feature
async function getStockRecommendation() {
  const symbolInput = document.getElementById('recommendation-symbol');
  const messageDiv = document.getElementById('recommendation-message');
  const resultDiv = document.getElementById('recommendation-result');
  const recommendationBtn = document.getElementById('recommendation-btn');
  const researchInput = document.getElementById('research-symbol');

  if (researchInput?.value?.trim()) {
    syncResearchInputs(researchInput.value);
  }

  const symbol = (symbolInput?.value || '').trim().toUpperCase();

  if (!symbol) {
    if (messageDiv) {
      messageDiv.innerHTML = '<div class="error">Please enter a stock symbol</div>';
      setTimeout(() => { messageDiv.innerHTML = ''; }, 3000);
    }
    return;
  }

  if (recommendationBtn) {
    recommendationBtn.disabled = true;
    recommendationBtn.textContent = 'Analyzing...';
  }
  if (messageDiv) {
    messageDiv.innerHTML = '<div class="info-banner">Analyzing stock and generating recommendation...</div>';
  }
  if (resultDiv) resultDiv.style.display = 'none';

  try {
    const res = await fetch(`/api/stockRecommendation?symbol=${encodeURIComponent(symbol)}`);

    let data;
    try {
      data = await res.json();
    } catch (parseError) {
      throw new Error(`Server error: ${res.status} ${res.statusText}`);
    }

    if (!res.ok) {
      const error = new Error(data.error || 'Failed to get recommendation');
      error.suggestion = data.suggestion;
      throw error;
    }

    document.getElementById('recommendation-company-name').textContent = formatCompanyHeading(data.companyName, data.symbol);

    const changeClass = data.priceChange?.changePercent >= 0 ? 'positive' : 'negative';
    document.getElementById('recommendation-price').innerHTML = `
      ${formatMoney(data.currentPrice)}
      <span class="change ${changeClass}" style="font-size: 0.9rem; margin-left: 0.5rem;">
        ${formatMoneySigned(data.priceChange?.change || 0)} (${formatSignedPercent(data.priceChange?.changePercent || 0)})
      </span>
    `;

    const badge = document.getElementById('recommendation-badge');
    const rec = data.recommendation;
    if (badge) {
      if (rec === 'BUY') {
        badge.textContent = 'BUY';
        badge.className = 'rec-badge rec-buy';
      } else if (rec === 'HOLD') {
        badge.textContent = 'HOLD';
        badge.className = 'rec-badge rec-hold';
      } else {
        badge.textContent = 'SELL';
        badge.className = 'rec-badge rec-sell';
      }
      badge.removeAttribute('style');
    }

    document.getElementById('recommendation-confidence').textContent = data.confidence;
    document.getElementById('recommendation-risk').textContent = data.riskLevel;
    document.getElementById('recommendation-horizon').textContent = data.timeHorizon;
    document.getElementById('recommendation-reasoning').textContent = data.reasoning;

    const keyPointsList = document.getElementById('recommendation-keypoints');
    if (keyPointsList) {
      if (data.keyPoints && data.keyPoints.length > 0) {
        keyPointsList.innerHTML = data.keyPoints.map(point => `<li>${escapeHtml(point)}</li>`).join('');
      } else {
        keyPointsList.innerHTML = '<li>No key points available</li>';
      }
    }

    const disclaimer = document.getElementById('recommendation-disclaimer');
    if (disclaimer) disclaimer.textContent = data.disclaimer;

    const section = document.getElementById('recommendation-section');
    section?.querySelector('.other-matches')?.remove();
    if (data.searchInfo?.otherMatches?.length && section) {
      const matches = document.createElement('div');
      matches.className = 'other-matches';
      matches.innerHTML = `<strong>Other matches:</strong> ${data.searchInfo.otherMatches.map(m => `${escapeHtml(m.name)} (${escapeHtml(m.symbol)})`).join(', ')}`;
      disclaimer?.parentElement?.insertAdjacentElement('beforebegin', matches);
    }

    if (resultDiv) resultDiv.style.display = 'block';
    if (messageDiv) messageDiv.innerHTML = '';
    syncResearchInputs(data.symbol || symbol);

  } catch (error) {
    let errorHtml = `<div class="error">${error.message || 'An error occurred'}</div>`;
    if (error.suggestion) {
      errorHtml += `<div class="info-banner" style="margin-top:0.5rem;">${error.suggestion}</div>`;
    }
    if (messageDiv) {
      messageDiv.innerHTML = errorHtml;
      setTimeout(() => { messageDiv.innerHTML = ''; }, 8000);
    }
  } finally {
    if (recommendationBtn) {
      recommendationBtn.disabled = false;
      recommendationBtn.textContent = 'Get Recommendation';
    }
  }
}

window.addEventListener('DOMContentLoaded', () => {
  initHashNavigation();
  initResearchUI();
  initChartRanges();
  setSignedInUI(false);

  const btn = document.getElementById('fetch-btn');
  if (btn) btn.addEventListener('click', fetchBriefing);

  document.querySelectorAll('[data-mag7-target]').forEach((el) => {
    el.addEventListener('click', handleMag7Action);
  });
  document.querySelectorAll('[data-signin-gate]').forEach((el) => {
    el.addEventListener('click', signInWithGoogle);
  });

  loadMagnificent7();
  fetchBriefing();
  initLearningTips();
  bootstrapAuthAndControls();
});
