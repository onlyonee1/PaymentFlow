'use strict';

const el = (id) => document.getElementById(id);
const setStatus = (message) => { el('status').textContent = message; };
const formatAmount = (amount, currency = 'XLM') => `${Number(amount).toLocaleString(undefined, { maximumFractionDigits: 7 })} ${currency}`;
const params = new URLSearchParams(location.hash.slice(1));
const qrToken = params.get('qr');
let receiptToken = params.get('receipt');
let submission;
let worker;

async function request(endpoint, body, key) {
  const response = await fetch(`/api/parent-pay/${endpoint}`, {
    method: 'POST',
    credentials: 'omit',
    headers: { 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'The request could not be completed.');
  return data;
}

function walletDetails(intent) {
  const { walletAddress, amount, memo, network } = intent;
  receiptToken = intent.receiptToken;
  el('network').textContent = network === 'mainnet' ? 'Mainnet' : 'Testnet';
  el('wallet-amount').textContent = formatAmount(amount);
  el('address').textContent = walletAddress;
  el('memo').textContent = memo;
  el('intent-deadline').textContent = new Date(intent.expiresAt).toLocaleString();
  const payment = new URLSearchParams({
    destination: walletAddress,
    amount: Number(amount).toFixed(7),
    memo,
    memo_type: 'MEMO_TEXT',
  });
  if (network !== 'mainnet') payment.set('network_passphrase', 'Test SDF Network ; September 2015');
  el('open-wallet').href = `web+stellar:pay?${payment}`;
  el('receipt-link').href = `/pay#receipt=${encodeURIComponent(receiptToken)}`;
  history.replaceState(null, '', el('receipt-link').href);
  el('wallet').hidden = false;
  el('pay-form').hidden = true;
  setStatus('Payment details are ready.');
}

function workerRequest(type, receipt) {
  if (!worker) return Promise.resolve([]);
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timeout = setTimeout(() => {
      channel.port1.close();
      reject(new Error('Offline storage did not respond.'));
    }, 4000);
    channel.port1.onmessage = ({ data }) => {
      clearTimeout(timeout);
      channel.port1.close();
      if (data.error) reject(new Error(data.error));
      else resolve(data.receipts);
    };
    worker.postMessage({ type, receipt }, [channel.port2]);
  });
}

function receiptElement(receipt, tag) {
  const item = document.createElement(tag);
  item.className = 'receipt';
  const name = document.createElement('strong');
  name.textContent = `${receipt.schoolName} · ${formatAmount(receipt.amount, receipt.currency)}`;
  const detail = document.createElement('p');
  const date = receipt.confirmedAt ? new Date(receipt.confirmedAt).toLocaleString() : 'Confirmed';
  detail.textContent = date;
  const hash = document.createElement('p');
  hash.textContent = `Transaction ${receipt.txHash}`;
  item.append(name, detail, hash);
  return item;
}

function renderSaved(receipts) {
  el('saved-receipts').replaceChildren(...receipts.map(receipt => receiptElement(receipt, 'li')));
  el('clear-receipts').hidden = receipts.length === 0;
}

async function setupWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.register('/parent-pay/sw.js', { scope: '/pay' });
    const active = registration.active ? registration : await navigator.serviceWorker.ready;
    worker = active.active;
    renderSaved(await workerRequest('list'));
  } catch {
    el('offline-label').textContent = 'Offline receipt storage is unavailable in this browser.';
  }
}

async function checkReceipt() {
  const button = el('check-receipt');
  button.disabled = true;
  try {
    const receipt = await request('receipt', { token: receiptToken });
    if (receipt.pending) {
      setStatus('Payment is not confirmed yet. Try again after your wallet shows that it was sent.');
      return;
    }
    el('latest-receipt').replaceChildren(receiptElement(receipt, 'article'));
    setStatus('Payment confirmed.');
    try {
      await offlineStorage;
      renderSaved(await workerRequest('save', receipt));
    } catch {
      el('offline-label').textContent = 'This receipt could not be saved for offline use.';
    }
  } catch (err) {
    setStatus(navigator.onLine ? err.message : 'You are offline. Saved receipts are available below.');
  } finally {
    button.disabled = false;
  }
}

el('pay-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const studentId = el('student-id').value.trim();
  const button = event.currentTarget.querySelector('button');
  if (submission?.studentId !== studentId) submission = { studentId, key: crypto.randomUUID() };
  button.disabled = true;
  setStatus('Preparing your payment…');
  try {
    walletDetails(await request('intent', { token: qrToken, studentId }, submission.key));
  } catch (err) {
    setStatus(navigator.onLine ? err.message : 'Connect to the internet to prepare a payment.');
  } finally {
    button.disabled = false;
  }
});

el('check-receipt').addEventListener('click', checkReceipt);
el('clear-receipts').addEventListener('click', async () => {
  try {
    renderSaved(await workerRequest('clear'));
    setStatus('Saved receipts cleared.');
  } catch {
    setStatus('Could not clear saved receipts.');
  }
});

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  const install = el('install');
  install.hidden = false;
  install.onclick = async () => {
    install.hidden = true;
    await event.prompt();
  };
});

const offlineStorage = setupWorker();
if (qrToken) {
  setStatus('Opening your payment link…');
  request('link', { token: qrToken }).then(({ feeName, schoolName, amount }) => {
    el('fee-name').textContent = feeName;
    el('school-name').textContent = schoolName;
    el('amount').textContent = formatAmount(amount);
    el('pay-form').hidden = false;
    setStatus('Enter your student ID to pay this fee.');
  }).catch(err => setStatus(navigator.onLine ? err.message : 'Connect to the internet to open the payment link.'));
} else if (receiptToken) {
  const refresh = el('check-receipt');
  el('receipts').insertBefore(refresh, el('latest-receipt'));
  if (navigator.onLine) checkReceipt();
  else setStatus('You are offline. Saved receipts are available below.');
}
