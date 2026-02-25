/**
 * app.js
 * Главный файл конфигурации Express приложения
 * Здесь настраивается вся конфигурация, middleware и маршруты
 */

const express = require('express');
const { PATHS, diagnoseStructure } = require('./utils/paths');
const apiRoutes = require('./routes/api');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');

// Создаем Express приложение
const app = express();

// ===== ДИАГНОСТИКА =====
console.log('\n--- ИНИЦИАЛИЗАЦИЯ ПРИЛОЖЕНИЯ ---');
diagnoseStructure();

// ===== MIDDLEWARE =====

// Парсер JSON данных
app.use(express.json());

// Парсер URL-encoded данных
app.use(express.urlencoded({ extended: true }));

// Раздача статических файлов из папки public
app.use(express.static(PATHS.PUBLIC));

// Логирование запросов (простое)
app.use((req, res, next) => {
  console.log(`📨 ${req.method} ${req.path}`);
  next();
});

console.log('✅ API Routes загружены, тип:', typeof apiRoutes);

// ===== МАРШРУТЫ =====

// Главная страница - редирект на trading
app.get('/', (req, res) => {
  res.redirect('/trading');
});

// Торговля - раздача terminal.html
app.get('/trading', (req, res) => {
  res.sendFile(require('path').join(PATHS.PUBLIC, 'terminal.html'));
});

// API маршруты
console.log('Подключаю API маршруты...');
app.use('/api', apiRoutes);
console.log('✅ API маршруты подключены на /api');

// ===== ОБРАБОТКА ОШИБОК =====

// 404 - маршрут не найден
app.use(notFoundHandler);

// Глобальный обработчик ошибок
app.use(errorHandler);

module.exports = app;
