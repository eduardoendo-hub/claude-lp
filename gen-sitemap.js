#!/usr/bin/env node
/**
 * gen-sitemap.js — gera sitemap.xml com lastmod = data atual do build.
 *
 * Roda no Docker build (Dockerfile chama isso depois dos injectors).
 * Mantem sitemap fresh sem hardcoded dates.
 *
 * Config opcional via tracking-config.json:
 *   seo.sitemap_urls = [{ loc, changefreq?, priority?, image? }, ...]
 *
 * Se nao houver config, gera so a home.
 */
const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, 'tracking-config.json');
const OUT_PATH = path.join(__dirname, 'sitemap.xml');

const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
const seo = cfg.seo || {};
const canonical = seo.canonical_url || 'https://claude.impacta.com.br/';
const ogImage = seo.og_image_url || null;

const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

const defaultUrls = [
  {
    loc: canonical,
    changefreq: 'daily',
    priority: '1.0',
    image: ogImage
      ? {
          loc: ogImage,
          title: seo.course?.name || 'Formação Claude Pro',
          caption: seo.course?.description || '',
        }
      : null,
  },
];

const urls = Array.isArray(seo.sitemap_urls) && seo.sitemap_urls.length > 0
  ? seo.sitemap_urls
  : defaultUrls;

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const xmlUrls = urls.map((u) => {
  const parts = [`  <url>`, `    <loc>${esc(u.loc)}</loc>`, `    <lastmod>${today}</lastmod>`];
  if (u.changefreq) parts.push(`    <changefreq>${u.changefreq}</changefreq>`);
  if (u.priority) parts.push(`    <priority>${u.priority}</priority>`);
  if (u.image && u.image.loc) {
    parts.push(`    <image:image>`);
    parts.push(`      <image:loc>${esc(u.image.loc)}</image:loc>`);
    if (u.image.title) parts.push(`      <image:title>${esc(u.image.title)}</image:title>`);
    if (u.image.caption) parts.push(`      <image:caption>${esc(u.image.caption)}</image:caption>`);
    parts.push(`    </image:image>`);
  }
  parts.push(`  </url>`);
  return parts.join('\n');
}).join('\n');

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${xmlUrls}
</urlset>
`;

fs.writeFileSync(OUT_PATH, xml);
console.log('✓ sitemap.xml gerado com', urls.length, urls.length === 1 ? 'URL' : 'URLs');
console.log('  lastmod:', today);
console.log('  URLs:', urls.map((u) => u.loc).join(', '));
