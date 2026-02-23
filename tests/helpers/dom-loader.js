'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

/**
 * Load an HTML file into document.body, stripping <script> tags
 * to prevent auto-loading (we load scripts manually via require).
 */
function loadHtml(relativePath) {
  const fullPath = path.join(ROOT, relativePath);
  let html = fs.readFileSync(fullPath, 'utf-8');

  // Extract body content
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  if (bodyMatch) {
    html = bodyMatch[1];
  }

  // Strip script tags
  html = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');

  // Strip link tags (CSS won't load in jsdom anyway)
  html = html.replace(/<link[^>]*>/gi, '');

  document.body.innerHTML = html;
}

module.exports = { loadHtml, ROOT };
