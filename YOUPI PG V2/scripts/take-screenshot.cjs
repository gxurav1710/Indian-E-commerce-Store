const { spawn } = require('child_process');
const fs = require('fs');

async function capture({ url, width, height, outputPath, delayMs = 1500, evalExpr = '' }) {
  const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const port = 9222 + Math.floor(Math.random() * 100);
  const userDir = `C:\\Users\\gaura\\.gemini\\antigravity-ide\\brain\\4ec97a6f-185f-4cb5-83cc-5867c322550f\\edge_profile_${port}`;

  const edgeProc = spawn(edgePath, [
    '--headless=new',
    '--disable-gpu',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDir}`,
    `--window-size=${width},${height}`,
    url
  ], { stdio: 'ignore' });

  try {
    // Wait for CDP port
    let wsUrl = null;
    for (let i = 0; i < 30; i++) {
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

    if (!wsUrl) {
      throw new Error(`Failed to obtain CDP webSocketDebuggerUrl on port ${port}`);
    }

    // Connect WebSocket
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

    // Emulate device metrics
    await sendCommand('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: width <= 768
    });

    await sendCommand('Page.enable');
    await sendCommand('Page.navigate', { url });

    // Wait for JS rendering
    await new Promise(r => setTimeout(r, delayMs + 1000));

    // Execute optional JS evaluation if provided
    if (evalExpr) {
      await sendCommand('Runtime.evaluate', { expression: evalExpr });
      await new Promise(r => setTimeout(r, 2500));
    }

    // Capture screenshot
    const shotResult = await sendCommand('Page.captureScreenshot', { format: 'png' });
    const buffer = Buffer.from(shotResult.data, 'base64');
    fs.writeFileSync(outputPath, buffer);
    console.log(`Saved screenshot to ${outputPath} (${buffer.length} bytes)`);

    ws.close();
  } finally {
    edgeProc.kill('SIGKILL');
    try { fs.rmSync(userDir, { recursive: true, force: true }); } catch (e) {}
  }
}

const args = process.argv.slice(2);
const url = args[0] || 'http://localhost:7000/checkout/2c9bd48f-3a0a-46c0-913e-3e2f01401ace';
const width = parseInt(args[1], 10) || 1200;
const height = parseInt(args[2], 10) || 800;
const outputPath = args[3] || 'screenshot.png';
const evalExpr = args[4] || '';

capture({ url, width, height, outputPath, evalExpr }).catch(err => {
  console.error(err);
  process.exit(1);
});
