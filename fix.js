const fs = require('fs');
const path = 'c:/Users/Gui/Desktop/Icarus/frontend/app.js';

let content = fs.readFileSync(path, 'utf8');

// Fix: remove /api/ prefix from inventory routes (backend uses /inventory directly)
const fixes = [
  ['${API_URL}/api/inventory', '${API_URL}/inventory'],
];

for (const [search, replace] of fixes) {
  const count = (content.match(new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
  if (count > 0) {
    content = content.split(search).join(replace);
    console.log(`Fixed ${count}x: ${search} -> ${replace}`);
  }
}

fs.writeFileSync(path, content, 'utf8');
console.log('Done!');
