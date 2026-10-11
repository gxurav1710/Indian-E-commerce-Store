const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const assetsDir = path.resolve(__dirname, '../apps/coin-wallet-store/public/assets');
const brainDir = 'C:\\Users\\gaura\\.gemini\\antigravity-ide\\brain\\4ec97a6f-185f-4cb5-83cc-5867c322550f';

if (!fs.existsSync(assetsDir)) {
  fs.mkdirSync(assetsDir, { recursive: true });
}

async function captureOne({ url, width, height, filename, evalFn }) {
  const port = 9300 + Math.floor(Math.random() * 500);
  const userDir = path.join(brainDir, `edge_profile_${port}`);

  const edgeProc = spawn(edgePath, [
    '--headless=new',
    '--disable-gpu',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDir}`,
    `--window-size=${width},${height}`,
    url
  ], { stdio: 'ignore' });

  try {
    let wsUrl = null;
    for (let i = 0; i < 35; i++) {
      await new Promise(r => setTimeout(r, 200));
      try {
        const res = await fetch(`http://127.0.0.1:${port}/json/list`);
        const list = await res.json();
        const page = list.find(p => p.type === 'page');
        if (page && page.webSocketDebuggerUrl) {
          wsUrl = page.webSocketDebuggerUrl;
          break;
        }
      } catch (e) {}
    }

    if (!wsUrl) throw new Error(`Could not connect to CDP on port ${port}`);

    const ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });

    let msgId = 1;
    function sendCommand(method, params = {}) {
      return new Promise((resolve) => {
        const id = msgId++;
        const onMessage = (event) => {
          const data = JSON.parse(event.data);
          if (data.id === id) {
            ws.removeEventListener('message', onMessage);
            resolve(data.result);
          }
        };
        ws.addEventListener('message', onMessage);
        ws.send(JSON.stringify({ id, method, params }));
      });
    }

    await sendCommand('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: width <= 768
    });

    await new Promise(r => setTimeout(r, 1600));

    if (evalFn) {
      await sendCommand('Runtime.evaluate', {
        expression: `(${evalFn.toString()})()`
      });
      await new Promise(r => setTimeout(r, 800));
    }

    const shotResult = await sendCommand('Page.captureScreenshot', { format: 'png' });
    const buffer = Buffer.from(shotResult.data, 'base64');

    const assetPath = path.join(assetsDir, filename);
    fs.writeFileSync(assetPath, buffer);
    console.log(`Saved ${filename} to ${assetPath} (${buffer.length} bytes)`);

    const brainPath = path.join(brainDir, filename);
    try { fs.writeFileSync(brainPath, buffer); } catch (e) {}

    ws.close();
  } finally {
    edgeProc.kill('SIGKILL');
    try { fs.rmSync(userDir, { recursive: true, force: true }); } catch (e) {}
  }
}

async function run() {
  console.log('Capturing all 5 authentic payment gateway assets with latest UI & fixed card icons...');

  // 1. PC Checkout
  await captureOne({
    url: 'http://localhost:7000/checkout/6c48283f-985a-4e97-a764-ff153c3ccc79',
    width: 1200,
    height: 800,
    filename: 'gateway_pc_checkout.png',
    evalFn: () => {
      activeCustomer = { id: 'demo-cust', name: 'Gaurav Sharma', mobileNumber: '9212339720' };
      setGatewayAuthMode(false);
      hideAllContent();
      const upiContent = document.getElementById('viewUpiContent');
      if (upiContent) upiContent.hidden = false;
      const mBar = document.getElementById('paymentMethodSelectorBar');
      if (mBar) mBar.style.display = 'flex';
      const qrContainer = document.getElementById('qrImageContainer');
      if (qrContainer) {
        qrContainer.innerHTML = '<img src="/checkout/6c48283f-985a-4e97-a764-ff153c3ccc79/qr.svg" style="width:100%;height:100%;object-fit:contain;" />';
      }
      const h = document.getElementById('upiServerHealthIndicator');
      if (h) h.className = 'ypg-server-health-indicator is-working';
      const hl = document.getElementById('serverStatusLabel');
      if (hl) hl.textContent = 'Server Is Working';
      const da = document.getElementById('serverDowntimeAlert');
      if (da) da.style.display = 'none';
    }
  });

  // 2. Mobile Checkout
  await captureOne({
    url: 'http://localhost:7000/checkout/6c48283f-985a-4e97-a764-ff153c3ccc79',
    width: 412,
    height: 880,
    filename: 'gateway_mobile_checkout.png',
    evalFn: () => {
      activeCustomer = { id: 'demo-cust', name: 'Gaurav Sharma', mobileNumber: '9212339720' };
      setGatewayAuthMode(false);
      hideAllContent();
      const upiContent = document.getElementById('viewUpiContent');
      if (upiContent) upiContent.hidden = false;
      const qrContainer = document.getElementById('qrImageContainer');
      if (qrContainer) {
        qrContainer.innerHTML = '<img src="/checkout/6c48283f-985a-4e97-a764-ff153c3ccc79/qr.svg" style="width:100%;height:100%;object-fit:contain;" />';
      }
      const h = document.getElementById('upiServerHealthIndicator');
      if (h) h.className = 'ypg-server-health-indicator is-working';
      const hl = document.getElementById('serverStatusLabel');
      if (hl) hl.textContent = 'Server Is Working';
      const da = document.getElementById('serverDowntimeAlert');
      if (da) da.style.display = 'none';
    }
  });

  // 3. Merchant Operations
  await captureOne({
    url: 'http://localhost:6001',
    width: 1280,
    height: 850,
    filename: 'gateway_merchant_operations.png',
    evalFn: () => {
      if (typeof switchSection === 'function') switchSection('operations');
    }
  });

  // 4. Developer Dark Hub
  await captureOne({
    url: 'http://localhost:6001',
    width: 1280,
    height: 850,
    filename: 'gateway_developer_dark_hub.png',
    evalFn: () => {
      if (typeof switchSection === 'function') switchSection('developerHub');
    }
  });

  // 5. White-Label Customizer
  await captureOne({
    url: 'http://localhost:6001',
    width: 1280,
    height: 850,
    filename: 'gateway_whitelabel_customizer.png',
    evalFn: () => {
      if (typeof switchSection === 'function') switchSection('storeSettings');
    }
  });

  console.log('All 5 authentic assets updated successfully!');
}

run().catch(err => {
  console.error('Capture failed:', err);
  process.exit(1);
});
