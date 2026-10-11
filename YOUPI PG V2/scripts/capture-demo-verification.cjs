const { capture } = require('./take-screenshot.cjs');

async function main() {
  console.log('1. Capturing Desktop View...');
  await capture({
    url: 'http://localhost:5000/',
    width: 1280,
    height: 900,
    outputPath: 'demo_store_restored_desktop.png',
    delayMs: 2000
  });

  console.log('2. Capturing Mobile View...');
  await capture({
    url: 'http://localhost:5000/',
    width: 375,
    height: 812,
    outputPath: 'demo_store_restored_mobile.png',
    delayMs: 2000
  });

  console.log('3. Capturing Modal Checkout...');
  await capture({
    url: 'http://localhost:5000/',
    width: 1280,
    height: 900,
    outputPath: 'demo_store_restored_modal.png',
    delayMs: 2000,
    evalExpr: 'document.getElementById("btnInitiateCheckout").click()'
  });

  console.log('Done capturing all verification screenshots!');
}

main().catch(err => {
  console.error('Capture failed:', err);
  process.exit(1);
});
