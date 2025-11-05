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

window.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('fetch-btn');
  if (btn) {
    btn.addEventListener('click', fetchBriefing);
  }
});
