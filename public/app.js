async function callHello() {
  const out = document.getElementById('out');
  out.textContent = 'Loading…';
  try {
    const res = await fetch('/api/hello');
    const data = await res.json();
    out.textContent = JSON.stringify(data, null, 2);
  } catch (err) {
    out.textContent = 'Error: ' + (err && err.message ? err.message : String(err));
  }
}

window.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('call-btn');
  if (btn) btn.addEventListener('click', callHello);
});

