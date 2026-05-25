#!/usr/bin/env node
/**
 * inject-use-cases.js — adiciona seção "Casos de uso por área" no template.
 *
 * Insere ANTES da seção FAQ. Objetivos:
 *   - SEO semantico: cobre 6 personas que buscam IA aplicada (Marketing,
 *     Financeiro, RH, Juridico, Operacoes, Tecnologia)
 *   - Conversao: ajuda lead a se reconhecer na area dele
 *   - GEO: cada persona vira ancora citavel ("curso de Claude para RH")
 *
 * Idempotente: marcadores LP-USE-CASES:START/END.
 * Roda DEPOIS de inject-extras.js no Dockerfile.
 */
const fs = require('fs');
const path = require('path');

const HTML_PATH = path.join(__dirname, 'index.html');
const MARK_START = '<!--LP-USE-CASES:START-->';
const MARK_END = '<!--LP-USE-CASES:END-->';

const CASES = [
  {
    icon: '📊',
    area: 'Marketing',
    headline: 'Análises, relatórios e calendário editorial em minutos',
    bullets: [
      'Analisa performance de campanhas Meta/Google em planilha',
      'Gera relatórios executivos a partir de dados crus',
      'Monta calendário editorial com base em briefing',
      'Cria variações de copy/CTA pra A/B test',
    ],
  },
  {
    icon: '💰',
    area: 'Financeiro',
    headline: 'Leitura de planilhas, conciliações e alertas',
    bullets: [
      'Concilia extratos bancários com lançamentos do ERP',
      'Lê e classifica notas fiscais em PDF',
      'Identifica anomalias em fluxo de caixa',
      'Gera fechamento mensal com narrativa pronta',
    ],
  },
  {
    icon: '👥',
    area: 'RH',
    headline: 'Triagem de currículos e análise de documentos',
    bullets: [
      'Triagem inteligente de currículos por fit técnico',
      'Resumo de avaliações de desempenho',
      'Análise de pesquisa de clima organizacional',
      'Geração de descrições de cargo',
    ],
  },
  {
    icon: '⚖️',
    area: 'Jurídico',
    headline: 'Resumo de contratos e busca em base documental',
    bullets: [
      'Resume contratos longos identificando cláusulas críticas',
      'Compara versões de minutas (red-line inteligente)',
      'Busca jurisprudência em base interna via RAG',
      'Padroniza linguagem de pareceres',
    ],
  },
  {
    icon: '⚙️',
    area: 'Operações',
    headline: 'Automação de processos e relatórios recorrentes',
    bullets: [
      'Automatiza relatórios diários/semanais',
      'Monitora SLAs e dispara alertas',
      'Triagem inicial de tickets de suporte',
      'Padronização de procedimentos operacionais',
    ],
  },
  {
    icon: '💻',
    area: 'Tecnologia',
    headline: 'Geração, revisão e documentação de código',
    bullets: [
      'Refator de código com Claude Code no terminal',
      'Geração de testes automatizados',
      'Documentação técnica a partir do código',
      'Análise de logs e debug guiado',
    ],
  },
];

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const css = `<style>
.lp-casos { padding: 80px 24px; background: var(--bg, #0e0b08); color: var(--w, #F7F1E8); }
.lp-casos__inner { max-width: 1200px; margin: 0 auto; }
.lp-casos__kicker { font-family: var(--mono, monospace); font-size: 11px; letter-spacing: .2em; text-transform: uppercase; color: var(--acc, #D97757); margin-bottom: 16px; }
.lp-casos__title { font-size: clamp(28px, 4vw, 44px); font-weight: 700; line-height: 1.1; margin: 0 0 16px; color: var(--w, #F7F1E8); }
.lp-casos__sub { font-size: 16px; color: var(--w-2, rgba(247,241,232,0.8)); max-width: 720px; margin: 0 0 48px; line-height: 1.5; }
.lp-casos__grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; }
.lp-caso { background: rgba(247,241,232,0.04); border: 1px solid rgba(247,241,232,0.1); border-radius: 8px; padding: 24px; transition: border-color .2s, transform .2s; }
.lp-caso:hover { border-color: var(--acc, #D97757); transform: translateY(-2px); }
.lp-caso__icon { font-size: 32px; margin-bottom: 12px; line-height: 1; }
.lp-caso__area { font-family: var(--mono, monospace); font-size: 11px; letter-spacing: .18em; text-transform: uppercase; color: var(--acc, #D97757); margin-bottom: 8px; }
.lp-caso__headline { font-size: 17px; font-weight: 600; color: var(--w, #F7F1E8); margin: 0 0 16px; line-height: 1.3; }
.lp-caso__list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
.lp-caso__list li { font-size: 13px; line-height: 1.5; color: var(--w-2, rgba(247,241,232,0.75)); padding-left: 18px; position: relative; }
.lp-caso__list li::before { content: "—"; position: absolute; left: 0; color: var(--acc, #D97757); }
@media (max-width: 720px) {
  .lp-casos { padding: 60px 16px; }
  .lp-casos__grid { grid-template-columns: 1fr; }
}
</style>`;

const cardsHtml = CASES.map((c) => `
        <article class="lp-caso">
          <div class="lp-caso__icon" aria-hidden="true">${c.icon}</div>
          <div class="lp-caso__area">${esc(c.area)}</div>
          <h3 class="lp-caso__headline">${esc(c.headline)}</h3>
          <ul class="lp-caso__list">
${c.bullets.map((b) => `            <li>${esc(b)}</li>`).join('\n')}
          </ul>
        </article>`).join('');

const section = `${MARK_START}
${css}
<section class="section lp-casos" id="casos" aria-labelledby="casos-titulo">
  <div class="lp-casos__inner">
    <div class="lp-casos__kicker">Casos de uso por área</div>
    <h2 class="lp-casos__title" id="casos-titulo">O que você vai construir na sua função</h2>
    <p class="lp-casos__sub">A formação é prática e aplicada. Cada projeto pode ser adaptado pro contexto da sua área — você sai com automações reais, não com slides.</p>
    <div class="lp-casos__grid">${cardsHtml}
    </div>
  </div>
</section>
${MARK_END}`;

let html = fs.readFileSync(HTML_PATH, 'utf8');
const m = html.match(/<script type="__bundler\/template">\s*([\s\S]*?)\s*<\/script>/);
if (!m) {
  console.warn('(inject-use-cases) bundle template nao encontrado — abortando');
  process.exit(0);
}
const rawJson = m[1];
let template = JSON.parse(rawJson);

// Strip versao antiga
const stripRe = new RegExp(MARK_START + '[\\s\\S]*?' + MARK_END, 'g');
template = template.replace(stripRe, '');

// Insere ANTES de <section class="section" id="faq">
const faqMarker = '<section class="section" id="faq">';
if (!template.includes(faqMarker)) {
  console.warn('(inject-use-cases) section FAQ nao encontrada — abortando');
  process.exit(0);
}
template = template.replace(faqMarker, section + '\n' + faqMarker);

const newJson = JSON.stringify(template).replace(/<\/script>/gi, '<\\/script>');
html = html.replace(rawJson, () => newJson);
fs.writeFileSync(HTML_PATH, html);

console.log('✓ Seção "Casos de uso por área" injetada antes do FAQ');
console.log('  Cards:', CASES.length, '(Marketing, Financeiro, RH, Jurídico, Operações, Tecnologia)');
