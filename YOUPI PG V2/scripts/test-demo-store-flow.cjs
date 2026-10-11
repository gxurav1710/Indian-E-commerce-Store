const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

async function testFlow() {
  const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const port = 9300 + Math.floor(Math.random() * 500);
  const userDir = path.join(os.tmpdir(), `edge_test_profile_${port}`);

  console.log(`[Test] Launching Edge on port ${port}...`);
  const edgeProc = spawn(edgePath, [
    '--headless=new',
    '--disable-gpu',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDir}`,
    '--window-size=1280,900',
    'http://localhost:5000/'
  ], { stdio: 'ignore' });

  try {
    let wsUrl = null;
    for (let i = 0; i < 40; i++) {
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

    if (!wsUrl) throw new Error(`Failed to obtain CDP webSocketDebuggerUrl on port ${port}`);

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

    await sendCommand('Page.enable');
    await sendCommand('DOM.enable');
    await sendCommand('Runtime.enable');

    console.log('[Test] Waiting for store page to load...');
    await new Promise(r => setTimeout(r, 2000));

    // Verify initial DOM elements
    const pageTitleRes = await sendCommand('Runtime.evaluate', { expression: 'document.title' });
    console.log('[Test] Page title:', pageTitleRes.result?.value);

    // Click ₹1.00 instant test button
    console.log('[Test] Clicking ₹1.00 instant test checkout button...');
    await sendCommand('Runtime.evaluate', {
      expression: `
        (function() {
          const btn = document.querySelector('.btn-test-micro') || document.querySelector('.btn-buy-pack');
          if (btn) btn.click();
          return !!btn;
        })()
      `
    });

    // Wait for checkout session to be created and modal iframe to render
    console.log('[Test] Waiting 3s for checkout modal & iframe...');
    await new Promise(r => setTimeout(r, 3000));

    // Check modal presence
    const modalCheck = await sendCommand('Runtime.evaluate', {
      expression: `
        (function() {
          const backdrop = document.querySelector('.youpi-checkout-backdrop');
          const iframe = document.querySelector('.youpi-checkout-iframe');
          return {
            backdropActive: backdrop ? backdrop.classList.contains('active') : false,
            iframeSrc: iframe ? iframe.src : null
          };
        })()
      `,
      returnByValue: true
    });
    console.log('[Test] Modal status:', JSON.stringify(modalCheck.result?.value));

    // Capture desktop modal screenshot
    const shotDesk = await sendCommand('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('demo_store_modal_open.png', Buffer.from(shotDesk.data, 'base64'));
    console.log('[Test] Saved demo_store_modal_open.png');

    // Emulate Mobile Device (iPhone 14 / Android viewport: 390x844)
    console.log('[Test] Emulating mobile viewport (390x844)...');
    await sendCommand('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true
    });
    await new Promise(r => setTimeout(r, 800));

    const shotMobile = await sendCommand('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('demo_store_mobile_modal_open.png', Buffer.from(shotMobile.data, 'base64'));
    console.log('[Test] Saved demo_store_mobile_modal_open.png');

    ws.close();
    console.log('🎉 Flow test complete!');
  } finally {
    edgeProc.kill('SIGKILL');
    try { fs.rmSync(userDir, { recursive: true, force: true }); } catch (e) {}
  }
}

testFlow().catch(e => {
  console.error('[Test Failed]:', e);
  process.exit(1);
});
