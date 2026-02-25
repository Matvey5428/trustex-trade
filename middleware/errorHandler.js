/**
 * middleware/errorHandler.js
 * Middleware для обработки ошибок и несуществующих маршрутов
 */

/**
 * Middleware для обработки 404 - маршрут не найден
 */
const notFoundHandler = (req, res) => {
  res.status(404).json({
    success: false,
    error: 'Маршрут не найден',
    path: req.path,
    method: req.method,
  });
};

/**
 * Middleware для обработки глобальных ошибок
 * Должен быть добавлен в последний очередь
 */
const errorHandler = (err, req, res, next) => {
  console.error('❌ Ошибка:', err);

  res.status(err.status || 500).json({
    success: false,
    error: err.message || 'Внутренняя ошибка сервера',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
};

module.exports = {
  notFoundHandler,
  errorHandler,
};
