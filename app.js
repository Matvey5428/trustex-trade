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

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(PATHS.PUBLIC));

// Routes
app.get('/', (req, res) => {
  res.sendFile(require('path').join(PATHS.PUBLIC, 'index.html'));
});

app.get('/trading', (req, res) => {
  res.sendFile(require('path').join(PATHS.PUBLIC, 'trading.html'));
});

app.get('/terminal', (req, res) => {
  res.sendFile(require('path').join(PATHS.PUBLIC, 'terminal.html'));
});

app.use('/api', apiRoutes);

// Error handlers
app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
