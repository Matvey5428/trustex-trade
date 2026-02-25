/**
 * index.js
 * Точка входа приложения
 * Запускает Express сервер с использованием конфигурации из app.js
 */

const app = require('./app');

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`\n🚀 Сервер запущен: http://localhost:${PORT}/trading\n`);
});