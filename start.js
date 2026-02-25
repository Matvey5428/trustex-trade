/**
 * start.js
 * Универсальный запускатор для production и development
 * Запускает и API сервер и Telegram бота
 */

const { spawn } = require('child_process');

console.log('🚀 TrustEx Trading Platform');
console.log('================================\n');

// Запускаем API сервер
console.log('📡 Запуск API сервера...');
const apiProcess = spawn('node', ['index.js'], {
  stdio: 'inherit',
  shell: true
});

apiProcess.on('error', (error) => {
  console.error('❌ Ошибка запуска API сервера:', error);
  process.exit(1);
});

// Ждем 3 секунды и запускаем бота
setTimeout(() => {
  console.log('\n🤖 Запуск Telegram бота...');
  const botProcess = spawn('node', ['bot.js'], {
    stdio: 'inherit',
    shell: true
  });

  botProcess.on('error', (error) => {
    console.error('❌ Ошибка запуска бота:', error);
  });
}, 3000);

// Обработка завершения
process.on('SIGINT', () => {
  console.log('\n\n🛑 Остановка всех сервисов...');
  process.exit();
});

process.on('SIGTERM', () => {
  console.log('\n\n🛑 Остановка всех сервисов...');
  process.exit();
});
