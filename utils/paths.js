/**
 * utils/paths.js
 */

const path = require('path');
const fs = require('fs');

const ROOT_DIR = path.resolve(__dirname, '..');

const PATHS = {
  PUBLIC: path.resolve(ROOT_DIR, 'public'),
  DATABASE: path.resolve(ROOT_DIR, 'database.json'),
  ROOT: ROOT_DIR,
};

function diagnoseStructure() {
  console.log('--- Диагностика структуры проекта ---');
  console.log('Рабочая директория:', ROOT_DIR);
  
  Object.entries(PATHS).forEach(([key, filePath]) => {
    const exists = fs.existsSync(filePath);
    const status = exists ? '✅' : '❌';
    console.log(`${status} ${key}: ${filePath}`);
  });
}

function getPublicFile(filename) {
  return path.join(PATHS.PUBLIC, filename);
}

module.exports = {
  PATHS,
  diagnoseStructure,
  getPublicFile,
};
