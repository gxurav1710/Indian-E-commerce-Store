import { TelegramMonitoringBot } from './bot.js';

async function main() {
  console.log('=============================================================================');
  console.log('        UNIFIED E-COMMERCE PLATFORM - TELEGRAM MONITORING BOT SERVICE        ');
  console.log('=============================================================================');

  const bot = new TelegramMonitoringBot();
  bot.startPolling();

  console.log('[TelegramBot] Monitoring service active.');

  const shutdown = () => {
    console.log('\n[TelegramBot] Stopping Telegram bot...');
    bot.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(err => {
  console.error('[TelegramBot] Fatal error:', err);
  process.exit(1);
});
