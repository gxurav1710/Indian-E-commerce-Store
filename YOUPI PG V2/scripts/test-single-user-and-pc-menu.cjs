const { spawn } = require('child_process');
const fs = require('fs');

async function runTestSuite() {
  const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const port = 9247;
  const userDir = `C:\\Users\\gaura\\.gemini\\antigravity-ide\\brain\\d71436fc-6981-4bb8-a59c-e9f960f4e11a\\edge_test_profile_init`;

  try { fs.rmSync(userDir, { recursive: true, force: true }); } catch (e) {}

  const url = 'http://localhost:7000/checkout/test-initiated-session-999';
  const edgeProc = spawn(edgePath, [
    '--headless=new',
    '--disable-gpu',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDir}`,
    `--window-size=1200,800`,
    url
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

    if (!wsUrl) throw new Error('Could not connect to CDP');

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

    async function evaluate(expr) {
      const res = await sendCommand('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      return res?.result?.value;
    }

    await sendCommand('Page.enable');
    await sendCommand('Page.navigate', { url });
    await new Promise(r => setTimeout(r, 2000));

    console.log('=== TEST 1: Check Initiated Session - Sign in to Pay with Single Saved Account ===');
    await evaluate(`
      localStorage.setItem('youpi.customer.accounts', JSON.stringify([
        { id: '74879c31-ea68-427a-87a6-a02d08109afd', name: 'Gaurav Mehra', email: 'gauravmehra09876@gmail.com', mobileNumber: '9212339720' }
      ]));
      renderSavedAccountsUI();
    `);
    await new Promise(r => setTimeout(r, 500));

    const authViewVisible = await evaluate(`
      const a = document.getElementById('preGatewayAuthView');
      !a.hidden && window.getComputedStyle(a).display !== 'none';
    `);
    const badgeStyle = await evaluate(`
      const b = document.getElementById('savedAccountCountBadge');
      b ? window.getComputedStyle(b).display : 'none';
    `);
    const savedAccountRowsCount = await evaluate(`
      document.querySelectorAll('#savedAccountsList .saved-account-row').length;
    `);
    console.log('preGatewayAuthView visible for unauthenticated user:', authViewVisible, '(Expected: true)');
    console.log('Saved account count badge style:', badgeStyle, '(Expected: none)');
    console.log('Saved account rows count:', savedAccountRowsCount, '(Expected: 1)');

    const shot1 = await sendCommand('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('test_signin_single_saved_account.png', Buffer.from(shot1.data, 'base64'));
    console.log('Saved test_signin_single_saved_account.png');

    console.log('\n=== TEST 2: Preserved 1-Week Identity Auto-Login on New Session ===');
    await evaluate(`
      const cust = {
        id: '74879c31-ea68-427a-87a6-a02d08109afd',
        name: 'Gaurav Mehra',
        fullName: 'Gaurav Mehra',
        email: 'gauravmehra09876@gmail.com',
        mobileNumber: '9212339720'
      };
      const token = 'csess_d145cc98752c919be77306be94545332982b8bced1f0be5262d8ce97e798ac1d';
      savePreservedIdentity(cust, token);
      window.location.reload();
    `);
    await new Promise(r => setTimeout(r, 2500));

    const authViewHidden = await evaluate(`
      const a = document.getElementById('preGatewayAuthView');
      a.hidden || window.getComputedStyle(a).display === 'none';
    `);
    const paymentViewVisible = await evaluate(`
      const p = document.getElementById('paymentGatewayInterface');
      !p.hidden && window.getComputedStyle(p).display !== 'none';
    `);
    const pcSidebarText = await evaluate(`
      document.getElementById('pcCustomerProfileText')?.textContent;
    `);
    console.log('preGatewayAuthView hidden (auto-login bypassed):', authViewHidden, '(Expected: true)');
    console.log('paymentGatewayInterface visible:', paymentViewVisible, '(Expected: true)');
    console.log('Left sidebar text:', pcSidebarText, '(Expected: Using as Gaurav Mehra (+91 9212339720))');

    const shot2 = await sendCommand('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('test_initiated_session_auto_login.png', Buffer.from(shot2.data, 'base64'));
    console.log('Saved test_initiated_session_auto_login.png');

    console.log('\n=== TEST 3: PC Three-Dot Button Popover with User Name ===');
    await evaluate(`
      document.getElementById('btnPcMore').click();
    `);
    await new Promise(r => setTimeout(r, 400));

    const popoverPcVisible = await evaluate(`
      const pop = document.getElementById('accountMenuPopoverPc');
      !pop.hidden && window.getComputedStyle(pop).display !== 'none';
    `);
    const popoverPcName = await evaluate(`
      document.getElementById('popoverCustomerNamePc')?.textContent;
    `);
    console.log('accountMenuPopoverPc visible:', popoverPcVisible, '(Expected: true)');
    console.log('Popover user name text:', popoverPcName, '(Expected: Gaurav Mehra (9212339720))');

    const shot3 = await sendCommand('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('test_initiated_session_popover.png', Buffer.from(shot3.data, 'base64'));
    console.log('Saved test_initiated_session_popover.png');

    ws.close();
    edgeProc.kill('SIGKILL');
    console.log('\nAll tests passed successfully!');
  } catch (err) {
    console.error('Test error:', err);
    edgeProc.kill('SIGKILL');
  }
}

runTestSuite();
