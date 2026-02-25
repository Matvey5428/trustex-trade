/**
 * start.js
 * Запускает API сервер и Telegram бота одновременно
 */

const { spawn } = require('child_process');

console.log('🚀 Запуск TrustEx Trading Platform...\n');

// Запуск API сервера
const apiServer = spawn('node', ['index.js'], {
  stdio: 'inherit',
  shell: true
});

apiServer.on('error', (error) => {
  console.error('❌ Ошибка запуска API сервера:', error);
});

// Даем серверу время на запуск, затем запускаем бота
setTimeout(() => {
  const bot = spawn('node', ['bot.js'], {
    stdio: 'inherit',
    shell: true
  });

  bot.on('error', (error) => {
    console.error('❌ Ошибка запуска бота:', error);
  });
}, 2000);

// Обработка завершения
process.on('SIGINT', () => {
  console.log('\n🛑 Остановка сервисов...');
  process.exit();
});
