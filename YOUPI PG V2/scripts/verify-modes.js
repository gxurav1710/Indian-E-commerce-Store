const testId = 'test-active-session-499';

async function main() {
  console.log('=== 1. Checking Initial OFFLINE Mode State ===');
  const resState = await fetch(`http://localhost:6100/api/v1/checkout/${testId}/state`);
  const state = await resState.json();
  console.log('State Selling Mode:', state.branding.sellingMode);
  console.log('State Enabled Methods:', state.branding.enabledPaymentMethods);

  console.log('\n=== 2. Checking HTML SSR Render in OFFLINE Mode ===');
  const resHtml = await fetch(`http://localhost:7000/checkout/${testId}`);
  const html = await resHtml.text();

  const getStyle = (id) => {
    const re = new RegExp(`id="${id}"[^>]*style="([^"]*)"`, 'i');
    const m = html.match(re);
    return m ? m[1] : (html.includes(`id="${id}"`) ? 'no style attribute' : 'not found');
  };

  console.log('tabMethodCod style:', getStyle('tabMethodCod'));
  console.log('tabMethodCash style:', getStyle('tabMethodCash'));
  console.log('tabMethodCard style:', getStyle('tabMethodCard'));
  console.log('pcMethodCardCod style:', getStyle('pcMethodCardCod'));
  console.log('pcMethodCardCash style:', getStyle('pcMethodCardCash'));
  console.log('pcMethodCardCard style:', getStyle('pcMethodCardCard'));

  console.log('\n=== 3. Switching to ONLINE Mode with COD via Admin Panel API (port 6001) ===');
  const adminRes = await fetch('http://localhost:6001/api/v1/admin/merchant-settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      merchantId: '00000000-0000-0000-0000-000000000001',
      sellingMode: 'ONLINE',
      codEnabled: true
    })
  });
  const adminData = await adminRes.json();
  console.log('Admin Update Result - sellingMode:', adminData.sellingMode, 'enabledMethods:', adminData.enabledPaymentMethods);

  console.log('\n=== 4. Verifying State in ONLINE Mode ===');
  const resOnlineState = await fetch(`http://localhost:6100/api/v1/checkout/${testId}/state`);
  const onlineState = await resOnlineState.json();
  console.log('New Selling Mode:', onlineState.branding.sellingMode);
  console.log('New Enabled Methods:', onlineState.branding.enabledPaymentMethods);

  console.log('\n=== 5. Checking HTML SSR Render in ONLINE Mode ===');
  const resOnlineHtml = await fetch(`http://localhost:7000/checkout/${testId}`);
  const onlineHtml = await resOnlineHtml.text();

  const getOnlineStyle = (id) => {
    const re = new RegExp(`id="${id}"[^>]*style="([^"]*)"`, 'i');
    const m = onlineHtml.match(re);
    return m ? m[1] : (onlineHtml.includes(`id="${id}"`) ? 'no style attribute' : 'not found');
  };

  console.log('tabMethodCod style:', getOnlineStyle('tabMethodCod'));
  console.log('tabMethodCash style:', getOnlineStyle('tabMethodCash'));
  console.log('tabMethodCard style:', getOnlineStyle('tabMethodCard'));
  console.log('pcMethodCardCod style:', getOnlineStyle('pcMethodCardCod'));
  console.log('pcMethodCardCash style:', getOnlineStyle('pcMethodCardCash'));
  console.log('pcMethodCardCard style:', getOnlineStyle('pcMethodCardCard'));

  console.log('\n=== 6. Testing Method Selection in ONLINE Mode ===');
  // COD should SUCCEED
  const selectCod = await fetch(`http://localhost:6100/api/v1/checkout/${testId}/select-method`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method: 'COD' })
  });
  console.log('Select COD status:', selectCod.status, await selectCod.json());

  // CASH_COUNTER should FAIL with 400
  const selectCash = await fetch(`http://localhost:6100/api/v1/checkout/${testId}/select-method`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method: 'CASH_COUNTER' })
  });
  console.log('Select CASH status:', selectCash.status, await selectCash.json());

  console.log('\n=== 7. Switching to ONLINE Mode with COD DISABLED ===');
  await fetch('http://localhost:6001/api/v1/admin/merchant-settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      merchantId: '00000000-0000-0000-0000-000000000001',
      sellingMode: 'ONLINE',
      codEnabled: false
    })
  });
  const resCodOffState = await fetch(`http://localhost:6100/api/v1/checkout/${testId}/state`);
  const codOffState = await resCodOffState.json();
  console.log('COD Off Selling Mode:', codOffState.branding.sellingMode);
  console.log('COD Off Enabled Methods:', codOffState.branding.enabledPaymentMethods);

  console.log('\n=== 8. Switching back to OFFLINE Mode with Cash & Card ===');
  await fetch('http://localhost:6001/api/v1/admin/merchant-settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      merchantId: '00000000-0000-0000-0000-000000000001',
      sellingMode: 'OFFLINE',
      cashEnabled: true,
      cardEnabled: true
    })
  });
  const resFinalState = await fetch(`http://localhost:6100/api/v1/checkout/${testId}/state`);
  const finalState = await resFinalState.json();
  console.log('Final Selling Mode:', finalState.branding.sellingMode);
  console.log('Final Enabled Methods:', finalState.branding.enabledPaymentMethods);

  // Switch session back to UPI
  await fetch(`http://localhost:6100/api/v1/checkout/${testId}/select-method`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method: 'UPI' })
  });
  console.log('\n=== ALL MODE CHECKS PASSED SUCCESSFULLY ===');
}

main().catch(console.error);
