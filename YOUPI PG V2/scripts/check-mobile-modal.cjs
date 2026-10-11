const { spawn } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');

async function check() {
  const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const port = 9555;
  const userDir = path.join(os.tmpdir(), 'edge_check_' + Date.now());
  const edgeProc = spawn(edgePath, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-fre',
    '--guest',
    '--remote-debugging-port=' + port,
    '--user-data-dir=' + userDir,
    '--window-size=375,812',
    'about:blank'
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
    const ws = new WebSocket(wsUrl);
    await new Promise(r => ws.onopen = r);

    let id = 1;
    function send(m, p = {}) {
      return new Promise(res => {
        const curId = id++;
        const handler = (e) => {
          const d = JSON.parse(e.data);
          if (d.id === curId) { ws.removeEventListener('message', handler); res(d.result); }
        };
        ws.addEventListener('message', handler);
        ws.send(JSON.stringify({ id: curId, method: m, params: p }));
      });
    }

    await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
    await send('Page.enable');
    await send('Page.navigate', { url: 'http://localhost:5000/' });
    await new Promise(r => setTimeout(r, 2000));

    await send('Runtime.evaluate', { expression: 'purchasePack("Starter Pack", 100, 100.00)' });
    await new Promise(r => setTimeout(r, 2500));

    const res = await send('Runtime.evaluate', {
      expression: `(() => {
        const c = document.querySelector(".youpi-checkout-container");
        if (!c) return { found: false };
        const rect = c.getBoundingClientRect();
        return {
          found: true,
          className: c.className,
          rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height, bottom: rect.bottom },
          transform: window.getComputedStyle(c).transform,
          display: window.getComputedStyle(c).display,
          opacity: window.getComputedStyle(c).opacity
        };
      })()`,
      returnByValue: true
    });
    console.log('Mobile container metrics:', JSON.stringify(res.result?.value, null, 2));

    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('mobile_modal_test.png', Buffer.from(shot.data, 'base64'));
    console.log('Saved mobile_modal_test.png');

    ws.close();
  } finally {
    edgeProc.kill('SIGKILL');
  }
}
check().catch(console.error);
