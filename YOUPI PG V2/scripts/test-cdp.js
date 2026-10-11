import { BrowserLauncher } from '../packages/observer-sdk/src/browser-launcher.js';

async function testCDP() {
  console.log('Testing BrowserLauncher findBrowserExecutable...');
  try {
    const exe = BrowserLauncher.findBrowserExecutable();
    console.log('Found browser executable:', exe);
  } catch (e) {
    console.log('Error finding browser:', e.message);
  }

  console.log('Checking targets on port 9222 (Google Messages)...');
  const t9222 = await BrowserLauncher.getTargets(9222);
  console.log('Port 9222 targets count:', t9222.length);
  for (const t of t9222) {
    console.log(' -', t.type, t.title, t.url);
  }

  console.log('Checking targets on port 9223 (Gmail)...');
  const t9223 = await BrowserLauncher.getTargets(9223);
  console.log('Port 9223 targets count:', t9223.length);
  for (const t of t9223) {
    console.log(' -', t.type, t.title, t.url);
  }
}

testCDP();
