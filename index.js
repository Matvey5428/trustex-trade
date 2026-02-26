/**
 * index.js
 * Точка входа приложения
 * В продакшене запускает и API и бота, локально только API
 */

const app = require('./app');
const { spawn } = require('child_process');

const PORT = process.env.PORT || 3000;
const SHOULD_START_BOT = Boolean(process.env.TELEGRAM_BOT_TOKEN);

app.listen(PORT, () => {
    console.log(`\n🚀 Сервер запущен: http://localhost:${PORT}\n`);
    
    // Автоматически запускаем бота, если задан TELEGRAM_BOT_TOKEN
    if (SHOULD_START_BOT) {
        console.log('🤖 Запуск Telegram бота...');
        setTimeout(() => {
            const bot = spawn('node', ['bot.js'], {
                stdio: 'inherit',
                shell: true
            });

            bot.on('error', (error) => {
                console.error('❌ Ошибка запуска бота:', error);
            });
        }, 2000);
    } else {
        console.warn('⚠️ TELEGRAM_BOT_TOKEN не задан, бот не будет запущен');
    }
});