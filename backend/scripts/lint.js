const { execFileSync } = require('child_process');
const { readdirSync } = require('fs');
const { join } = require('path');

const root = join(__dirname, '..');
const excluded = new Set(['node_modules', 'coverage', 'tests']);
const files = [];
const collect = (directory) => readdirSync(directory, { withFileTypes: true }).forEach((entry) => {
  const path = join(directory, entry.name);
  if (entry.isDirectory() && !excluded.has(entry.name)) collect(path);
  if (entry.isFile() && entry.name.endsWith('.js')) files.push(path);
});
collect(root);
for (const file of files) execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
console.log(`Syntax-checked ${files.length} backend JavaScript files.`);
