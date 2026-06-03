#!/usr/bin/env node
/**
 * inject-body-seo.js — injeta bloco SEO completo dentro de <noscript> no
 * <body> ESTATICO. Crawlers (Googlebot, GSC verifier, FB, LinkedIn, IA bots)
 * que nao executam JS leem este conteudo. Usuarios reais nunca veem (tem JS,
 * bundler hidrata e nao renderiza noscript).
 *
 * Por que <noscript>?
 *   - Google indexa <noscript> normalmente (confirmado pela documentacao oficial)
 *   - Nao polui o DOM hidratado (bundler nao precisa lidar com lixo)
 *   - Nao "esconde conteudo" (Google entende noscript como fallback legitimo)
 *
 * Idempotente: marcadores LP-BODY-SEO:START/END.
 *
 * Roda DEPOIS de inject-seo.js no Dockerfile.
 */
const fs = require('fs');
const path = require('path');

const HTML_PATH = path.join(__dirname, 'index.html');
const CONFIG_PATH = path.join(__dirname, 'tracking-config.json');
const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

const MARK_START = '<!-- LP-BODY-SEO:START -->';
const MARK_END = '<!-- LP-BODY-SEO:END -->';

const seo = cfg.seo || {};
const course = seo.course || {};
const org = seo.organization || {};
const checkout = cfg.checkout_url || 'https://impacta.site.engaged.com.br/p/checkout/x68jpj7w3k';
const horario = cfg.horario_aulas || '19h–22h (Brasília)';
const ticket = cfg.ticket_price || 1699;

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// FAQ pra crawlers (versao reduzida, alinhada com FAQPage schema)
const FAQ = [
  {
    q: 'O que é a Formação Claude Pro?',
    a: 'Curso online ao vivo de 5 dias da Impacta em parceria com Olhar Digital, para profissionais aprenderem a usar Claude e Claude Code para automatizar processos reais de negócio.',
  },
  {
    q: 'O que é Claude Code?',
    a: 'Ferramenta agêntica da Anthropic que roda no terminal. Permite que Claude execute tarefas — não apenas responda. Edita arquivos, roda comandos, refator de código, pipelines.',
  },
  {
    q: 'Para quem é o curso?',
    a: 'Profissionais que usam IA todo dia mas perdem horas no operacional — gestores, analistas, head/diretores de marketing, financeiro, RH, jurídico, operações, dados, tecnologia e produto.',
  },
  {
    q: 'Preciso saber programar?',
    a: 'Não para começar. O curso é prático mas acessível: começamos do uso operacional de Claude em planilhas/documentos e evoluímos para Claude Code. Quem programa avança mais rápido nos módulos finais.',
  },
  {
    q: 'Preciso da assinatura Claude Pro?',
    a: 'Sim. É pré-requisito porque trabalhamos com features que exigem o plano pago: contexto maior, Claude Code, Skills, tool use.',
  },
  {
    q: 'O curso ensina RAG e agentes de IA?',
    a: 'Sim. Módulo dedicado a RAG (Retrieval-Augmented Generation) com documentos internos + dois módulos sobre agentes autônomos e Team Agents coordenados.',
  },
  {
    q: 'Qual o investimento?',
    a: `R$ ${ticket.toLocaleString('pt-BR')} à vista ou parcelado no checkout. Os 20 primeiros inscritos ganham 1h extra em grupo com o instrutor.`,
  },
  {
    q: 'A formação tem certificado?',
    a: 'Sim. Certificado conjunto Impacta + Olhar Digital ao concluir.',
  },
];

const PROJECTS = [
  'Agente que organiza inbox e prioriza tarefas',
  'Planilha financeira gerada automaticamente',
  'RAG sobre PDF interno (manual, relatório, contrato)',
  'Refator de código usando Claude Code',
  'Bot SDR no WhatsApp',
  'Dashboard que se atualiza sozinho',
  'Análise automática de contratos jurídicos',
  'Resumo automático de reuniões',
  'Pesquisa profunda em fontes externas',
  'Agente que executa no terminal via Claude Code',
  'Pipeline de ETL com Excel + Claude',
  'Consulta SQL via linguagem natural',
  'Integração com APIs REST externas',
  'Skill personalizada de Marketing',
  'Skill personalizada de RH',
  'Agente de análise de dados financeiros',
  'Sistema de FAQ automatizado',
  'Gerador de relatórios executivos',
  'Validador de dados com regras de negócio',
  'Sistema final com Team Agents (projeto-mestre)',
];

const PERSONAS = [
  ['Marketing', 'análise de campanhas, relatórios, calendário editorial'],
  ['Financeiro', 'leitura de planilhas, conciliações, alertas'],
  ['RH', 'triagem de currículos, análise de documentos'],
  ['Jurídico', 'resumo de contratos, busca em documentos'],
  ['Operações', 'automação de processos, relatórios recorrentes'],
  ['Tecnologia', 'geração, revisão e documentação de código'],
];

const courseName = course.name || 'Formação Claude Pro: do Cowork ao Code';
const courseDesc =
  course.description ||
  'Em 5 dias e 20 projetos reais, você sai automatizando processos de negócio com IA — análises, relatórios, agentes autônomos e Skills próprias.';
const orgName = org.name || 'Impacta Treinamentos';

const block = `${MARK_START}
<noscript>
  <main role="main" lang="pt-BR" style="max-width:900px;margin:0 auto;padding:24px;font-family:system-ui,sans-serif;color:#0e0b08;background:#faf9f5;">
    <header>
      <h1>${esc(courseName)}</h1>
      <p><strong>Curso online ao vivo · ${esc(orgName)} + Olhar Digital · Turma 06/07/2026 · R$ ${ticket.toLocaleString('pt-BR')}</strong></p>
      <p>${esc(courseDesc)}</p>
    </header>

    <section>
      <h2>Resposta direta sobre o curso</h2>
      <p>
        A <strong>Formação Claude Pro</strong> é um curso online ao vivo da Impacta, em parceria com o
        Olhar Digital, voltado a profissionais que querem usar <strong>Claude</strong> e
        <strong>Claude Code</strong> para automatizar processos reais de negócio. A formação
        ensina criação de <strong>Skills</strong>, <strong>RAG com documentos internos</strong>,
        <strong>agentes autônomos</strong>, pipelines com Excel, SQL e APIs, além de um
        sistema final com <strong>Team Agents</strong>. São 5 dias intensivos, das ${esc(horario)},
        com certificado conjunto Impacta + Olhar Digital. Investimento: R$ ${ticket.toLocaleString('pt-BR')}.
      </p>
    </section>

    <section>
      <h2>O que você vai aprender</h2>
      <ul>
        <li>Claude (Anthropic) — fundamentos avançados, system prompts, tool use</li>
        <li>Claude Code — uso no terminal para desenvolvimento e automação</li>
        <li>Agentes de IA autônomos com loops de auto-correção</li>
        <li>RAG (Retrieval-Augmented Generation) sobre documentos internos</li>
        <li>Skills personalizadas no Claude</li>
        <li>Pipelines de automação com Excel, SQL e APIs REST</li>
        <li>Team Agents — múltiplos agentes coordenados</li>
        <li>Boas práticas de IA aplicada a negócios</li>
      </ul>
    </section>

    <section>
      <h2>Os 20 projetos práticos</h2>
      <ol>
${PROJECTS.map((p) => `        <li>${esc(p)}</li>`).join('\n')}
      </ol>
    </section>

    <section>
      <h2>Para quem é</h2>
      <p>Profissionais que usam IA todo dia mas perdem horas no operacional:</p>
      <ul>
${PERSONAS.map(([area, use]) => `        <li><strong>${esc(area)}:</strong> ${esc(use)}</li>`).join('\n')}
      </ul>
    </section>

    <section>
      <h2>Formato e investimento</h2>
      <ul>
        <li><strong>Formato:</strong> Online ao vivo (não gravação assíncrona)</li>
        <li><strong>Duração:</strong> 5 dias intensivos · 15h ao vivo</li>
        <li><strong>Horário:</strong> ${esc(horario)}</li>
        <li><strong>Próxima turma:</strong> 06/07/2026</li>
        <li><strong>Investimento:</strong> R$ ${ticket.toLocaleString('pt-BR')} à vista ou parcelado</li>
        <li><strong>Pré-requisito:</strong> Assinatura Claude Pro ativa</li>
        <li><strong>Certificado:</strong> Conjunto ${esc(orgName)} + Olhar Digital</li>
        <li><strong>Bônus:</strong> Os 20 primeiros inscritos ganham 1h extra em grupo com instrutor</li>
      </ul>
    </section>

    <section>
      <h2>Perguntas frequentes</h2>
${FAQ.map((it) => `      <h3>${esc(it.q)}</h3>\n      <p>${esc(it.a)}</p>`).join('\n')}
    </section>

    <section>
      <h2>Sobre ${esc(orgName)}</h2>
      <p>
        A Impacta conecta educação, tecnologia e mercado há mais de três décadas (37+ anos),
        com mais de 2 milhões de profissionais impactados e mais de 30 mil empresas treinadas.
        Atua em programação, dados, gestão, design e tecnologia aplicada.
      </p>
      <h2>Sobre Olhar Digital</h2>
      <p>
        Parceiro de mídia e tecnologia. Autoridade reconhecida no Brasil em IA, transformação
        digital e tendências tecnológicas há 20+ anos.
      </p>
    </section>

    <section>
      <h2>Inscrição</h2>
      <p>Vagas limitadas por turma. <a href="${esc(checkout)}" rel="noopener">Garanta sua vaga aqui</a>.</p>
      <p>
        Para falar com consultor antes de inscrever, use o botão de WhatsApp na página principal
        (versão hidratada com JavaScript).
      </p>
    </section>

    <footer>
      <p>
        <small>
          Esta versão estática é mostrada para crawlers e navegadores sem JavaScript.
          Para a experiência completa, ative JavaScript ou acesse
          <a href="${esc(seo.canonical_url || 'https://claude.impacta.com.br/')}">a página oficial</a>.
        </small>
      </p>
    </footer>
  </main>
</noscript>
${MARK_END}`;

// Strip versao antiga
let html = fs.readFileSync(HTML_PATH, 'utf8');
const re = new RegExp(MARK_START + '[\\s\\S]*?' + MARK_END, 'g');
html = html.replace(re, '');

// Insere logo APOS <body> estatico (primeiro <body> que aparece — antes
// do bundler thumbnail). Crawlers leem antes do JS rodar.
if (!html.includes('<body>')) {
  throw new Error('Não encontrei <body> no index.html estatico');
}
html = html.replace('<body>', '<body>\n' + block);

fs.writeFileSync(HTML_PATH, html);
console.log('✓ Body SEO content injetado em <noscript>');
console.log('  Tamanho do bloco:', block.length, 'chars');
console.log('  FAQ entries:    ', FAQ.length);
console.log('  Projetos:       ', PROJECTS.length);
console.log('  Personas:       ', PERSONAS.length);
