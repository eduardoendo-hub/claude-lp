#!/usr/bin/env node
/**
 * inject-alt-text.js — enriquece o atributo alt das imagens chave da LP.
 *
 * Os alts gerados pelo bundler do Claude sao genericos ("Impacta + Olhar
 * Digital", "Logo Impacta") — bons mas perdendo oportunidade de keyword
 * stuffing legitimo + acessibilidade.
 *
 * Substitui por descricoes mais ricas, contextualizadas e SEO-friendly.
 * Idempotente: re-rodar com texto novo so substitui se ainda for o antigo.
 */
const fs = require('fs');
const path = require('path');

const HTML_PATH = path.join(__dirname, 'index.html');
let html = fs.readFileSync(HTML_PATH, 'utf8');

const m = html.match(/<script type="__bundler\/template">\s*([\s\S]*?)\s*<\/script>/);
if (!m) {
  console.warn('(inject-alt-text) bundle template nao encontrado — abortando');
  process.exit(0);
}
const rawJson = m[1];
let template = JSON.parse(rawJson);

// Substituicoes de alt — primeira fonte vence (idempotente).
// "from" precisa ser exato (incluindo aspas e padding) pra evitar conflitos.
const REPLACEMENTS = [
  // Lockup co-brand (4 ocorrencias)
  {
    from: 'alt="Impacta + Olhar Digital"',
    to: 'alt="Formação Claude Pro — parceria oficial Impacta Tecnologia e Olhar Digital, curso de Claude Code e agentes de IA"',
  },
  // Logo Impacta isolada
  {
    from: 'alt="Impacta Tecnologia"',
    to: 'alt="Logo Impacta Tecnologia — instituição com 37+ anos em educação tecnológica no Brasil"',
  },
  // Logo Olhar Digital isolada
  {
    from: 'alt="Olhar Digital"',
    to: 'alt="Logo Olhar Digital — autoridade em tecnologia e inteligência artificial há 20+ anos"',
  },
];

let changesCount = 0;
for (const r of REPLACEMENTS) {
  let n = 0;
  while (template.includes(r.from)) {
    template = template.replace(r.from, r.to);
    n++;
    changesCount++;
  }
  if (n > 0) console.log('  +', n, 'x', r.from.slice(5, 60));
}

if (changesCount === 0) {
  console.log('(inject-alt-text) nada a substituir — alts ja enriquecidos ou nao encontrados');
  process.exit(0);
}

// Re-serializa JSON com escape de </script>
const newJson = JSON.stringify(template).replace(/<\/script>/gi, '<\\/script>');
html = html.replace(rawJson, () => newJson);
fs.writeFileSync(HTML_PATH, html);

console.log('✓ alt text enriquecido em', changesCount, 'imagem(ns)');
