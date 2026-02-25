/**
 * utils/paths.js
 * Утилиты для работы с путями проекта
 * Централизованное место для конфигурации всех путей
 */

const path = require('path');
const fs = require('fs');

// Основная директория проекта
const ROOT_DIR = path.resolve(__dirname, '..');

// Пути к основным папкам
const PATHS = {
  PUBLIC: path.resolve(ROOT_DIR, 'public'),
  DATABASE: path.resolve(ROOT_DIR, 'database.json'),
  ROOT: ROOT_DIR,
};

/**
 * Проверяет наличие необходимых файлов и директорий
 * Выводит диагностику в консоль
 */
function diagnoseStructure() {
  console.log('--- Диагностика структуры проекта ---');
  console.log('Рабочая директория:', ROOT_DIR);
  
  Object.entries(PATHS).forEach(([key, filePath]) => {
    const exists = fs.existsSync(filePath);
    const status = exists ? '✅' : '❌';
    console.log(`${status} ${key}: ${filePath}`);
  });
}

/**
 * Возвращает путь к файлу в папке public
 * @param {string} filename - Имя файла
 * @returns {string} Полный путь к файлу
 */
function getPublicFile(filename) {
  return path.join(PATHS.PUBLIC, filename);
}

module.exports = {
  PATHS,
  diagnoseStructure,
  getPublicFile,
};
