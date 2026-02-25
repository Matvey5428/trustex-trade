/**
 * index.js
 * Точка входа приложения
 * В продакшене запускает и API и бота, локально только API
 */

const app = require('./app');
const { spawn } = require('child_process');

const PORT = process.env.PORT || 3000;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

app.listen(PORT, () => {
    console.log(`\n🚀 Сервер запущен: http://localhost:${PORT}\n`);
    
    // В продакшене автоматически запускаем бота
    if (IS_PRODUCTION && process.env.TELEGRAM_BOT_TOKEN) {
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
    }
});