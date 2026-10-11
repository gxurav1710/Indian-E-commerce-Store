const { spawn } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');

async function test() {
  const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const port = 9444;
  const userDir = path.join(os.tmpdir(), 'edge_debug_' + Date.now());
  const edgeProc = spawn(edgePath, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-fre',
    '--guest',
    '--remote-debugging-port=' + port,
    '--user-data-dir=' + userDir,
    'http://localhost:5000/'
  ], { stdio: 'ignore' });

  try {
    let wsUrl = null;
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 200));
      try {
        const res = await fetch('http://127.0.0.1:' + port + '/json/list');
        const list = await res.json();
        const p = list.find(x => x.type === 'page');
        if (p && p.webSocketDebuggerUrl) { wsUrl = p.webSocketDebuggerUrl; break; }
      } catch (e) {}
    }
    if (!wsUrl) throw new Error('No wsUrl');

    const ws = new WebSocket(wsUrl);
    await new Promise(r => ws.onopen = r);

    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.method === 'Runtime.consoleAPICalled') {
        console.log('[Browser Console]', msg.params.args.map(a => a.value !== undefined ? a.value : a.description).join(' '));
      } else if (msg.method === 'Runtime.exceptionThrown') {
        console.error('[Browser Exception]', msg.params.exceptionDetails);
      }
    };

    let id = 1;
    function send(m, p = {}) {
      return new Promise(res => {
        const curId = id++;
        const handler = (e) => {
          const d = JSON.parse(e.data);
          if (d.id === curId) {
            ws.removeEventListener('message', handler);
            res(d.result);
          }
        };
        ws.addEventListener('message', handler);
        ws.send(JSON.stringify({ id: curId, method: m, params: p }));
      });
    }

    await send('Runtime.enable');
    await send('Page.enable');
    await new Promise(r => setTimeout(r, 1500));

    console.log('[Runner] Calling purchasePack...');
    await send('Runtime.evaluate', {
      expression: 'purchasePack("Starter Pack", 100, 100.00)'
    });

    await new Promise(r => setTimeout(r, 2500));

    const check = await send('Runtime.evaluate', {
      expression: 'document.querySelector(".youpi-checkout-backdrop")?.className',
      returnByValue: true
    });
    console.log('[Runner] Backdrop className:', check?.value);

    const iframeCheck = await send('Runtime.evaluate', {
      expression: 'document.querySelector(".youpi-checkout-iframe")?.src',
      returnByValue: true
    });
    console.log('[Runner] Iframe src:', iframeCheck?.value);

    // Capture screenshot
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('demo_store_live_modal.png', Buffer.from(shot.data, 'base64'));
    console.log('[Runner] Captured demo_store_live_modal.png');

    // Emulate Mobile Device (390x844)
    console.log('[Runner] Emulating mobile viewport (390x844)...');
    await send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true
    });
    await new Promise(r => setTimeout(r, 800));

    const shotMob = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('demo_store_live_mobile_modal.png', Buffer.from(shotMob.data, 'base64'));
    console.log('[Runner] Captured demo_store_live_mobile_modal.png');

    ws.close();
  } finally {
    edgeProc.kill('SIGKILL');
    try { fs.rmSync(userDir, { recursive: true, force: true }); } catch (e) {}
  }
}
test().catch(console.error);
