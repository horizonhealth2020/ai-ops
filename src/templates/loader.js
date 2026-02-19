'use strict';

const fs = require('fs');
const path = require('path');

const cache = new Map();

function load(industryVertical) {
  if (cache.has(industryVertical)) return cache.get(industryVertical);

  const filePath = path.join(__dirname, `${industryVertical}.txt`);

  if (!fs.existsSync(filePath)) {
    console.warn(`No template found for vertical "${industryVertical}", using generic fallback.`);
    return cache.get('_generic') || 'You are a helpful voice assistant. Be professional and concise.';
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  cache.set(industryVertical, content);
  return content;
}

module.exports = { load };
