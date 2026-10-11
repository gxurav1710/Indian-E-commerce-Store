import { AndroidObserverDriver } from './driver.js';

/**
 * Android Notification Push Simulator CLI.
 * Simulates real status bar notifications being captured on an Android device
 * and dispatched to the self-hosted YOUPI Payment Gateway.
 */

const API_BASE = process.env.BASE_PAYMENT_API_URL || 'http://localhost:6100';
const ENROLLMENT_SECRET = process.env.ANDROID_ENROLLMENT_SECRET || 'android_pairing_enrollment_secret_key_32_chars';

async function main() {
  console.log('========================================================');
  console.log('📱 YOUPI Android Payment Observer Notification Simulator');
  console.log('========================================================');

  const driver = new AndroidObserverDriver({
    apiBaseUrl: API_BASE,
    deviceName: 'Pixel 8 Pro (Simulated)',
    deviceModel: 'Google Pixel 8 Pro'
  });

  // Step 1: Pair simulated device
  console.log('\n[1/3] Enrolling & Pairing Android Device with Gateway...');
  const pairData = await driver.pair(ENROLLMENT_SECRET);
  console.log(`[✓] Device Paired! Assigned ID: ${pairData.deviceId}`);

  // Step 2: Send Heartbeat
  console.log('\n[2/3] Emitting Liveness Heartbeat...');
  const hb = await driver.sendHeartbeat();
  console.log(`[✓] Heartbeat Acknowledged at: ${hb.timestamp}`);

  // Step 3: Simulate Incoming UPI Notification
  console.log('\n[3/3] Simulating Incoming PhonePe UPI Notification...');
  const sampleNotification = {
    amount: '200.00',
    utr: `UTR${Math.floor(100000000000 + Math.random() * 900000000000)}`,
    senderVpa: 'customer@paytm',
    notificationText: 'Payment of ₹200.00 received from customer@paytm on PhonePe. UTR: 123456789012'
  };

  console.log(`• App: PhonePe (com.phonepe.app)`);
  console.log(`• Amount: ₹${sampleNotification.amount}`);
  console.log(`• UTR: ${sampleNotification.utr}`);
  console.log(`• Text: "${sampleNotification.notificationText}"`);

  console.log('\nSigning payload with HMAC-SHA256 and dispatching to /api/v1/pollers/android/events...');
  const result = await driver.submitObservation(sampleNotification);

  console.log(`\n========================================================`);
  console.log(`Response Status: HTTP ${result.status}`);
  console.log(`Observation Ingest Result:`, JSON.stringify(result.body, null, 2));
  console.log(`========================================================`);

  if (result.status === 200) {
    console.log('🟢 Observation successfully recorded and fed into Attribution Engine!');
  } else {
    console.log('🔴 Observation was rejected or failed.');
  }
}

main().catch(err => {
  console.error('Simulator Error:', err.message);
  process.exit(1);
});
