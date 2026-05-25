#!/usr/bin/env node
/**
 * inject-seo.js — adiciona SEO completo no <head> do bundle template:
 *   - <link rel="canonical">
 *   - <link rel="icon"> + apple-touch-icon
 *   - <meta robots>
 *   - <meta theme-color>
 *   - Open Graph (og:title/description/image/url/type/site_name/locale)
 *   - Twitter Cards
 *   - JSON-LD: Organization (com logo URL pra aparecer no Google),
 *     Course (curso), Event (turma ao vivo), FAQPage (extraido do FAQ
 *     da pagina), BreadcrumbList
 *
 * Idempotente: re-rodar substitui o bloco antigo (marcadores
 * LP-SEO:START/END). Roda DEPOIS de inject-extras.js.
 *
 * Config: tracking-config.json -> chave "seo"
 */
const fs = require('fs');
const path = require('path');

const HTML_PATH = path.join(__dirname, 'index.html');
const CONFIG_PATH = path.join(__dirname, 'tracking-config.json');
const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
const seo = cfg.seo || {};

const MARK_START = '<!-- LP-SEO:START -->';
const MARK_END = '<!-- LP-SEO:END -->';

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Extrai pares pergunta/resposta dos <details><summary> do FAQ pra FAQPage schema */
function extractFaq(template) {
  const items = [];
  const re = /<details[^>]*class="qa"[^>]*>[\s\S]*?<summary[^>]*>([\s\S]*?)<\/summary>[\s\S]*?<(?:p|div)[^>]*class="qa__body"[^>]*>([\s\S]*?)<\/(?:p|div)>[\s\S]*?<\/details>/gi;
  let m;
  while ((m = re.exec(template)) !== null) {
    const q = m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    const a = m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (q && a) items.push({ q, a });
    if (items.length >= 20) break;
  }
  return items;
}

function buildHeadTags() {
  const title = cfg.seo?.course?.name || 'Formação Claude Pro';
  const desc = cfg.seo?.course?.description || '';
  const canonical = seo.canonical_url || '';
  const ogImage = seo.og_image_url || seo.organization?.logo || '';
  const siteName = seo.site_name || 'Impacta';
  const themeColor = seo.theme_color || '#0e0b08';
  const favicon = seo.favicon_url || '';
  const appleIcon = seo.apple_touch_icon_url || '';
  const twitterHandle = seo.twitter_handle || '';

  const parts = [];
  // Mobile responsive — sem isso o pre-hidratacao quebra em mobile e o
  // Google penaliza o Mobile-First Indexing.
  parts.push('<meta name="viewport" content="width=device-width, initial-scale=1">');
  parts.push('<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1">');
  // Description CLASSICA (Google usa direto pro snippet do SERP, separado
  // do og:description). Pega do config.seo.course.description.
  if (desc) parts.push('<meta name="description" content="' + esc(desc) + '">');
  // Author / publisher (ajuda Knowledge Panel)
  if (seo.organization?.name) {
    parts.push('<meta name="author" content="' + esc(seo.organization.name) + '">');
    parts.push('<meta name="publisher" content="' + esc(seo.organization.name) + '">');
  }
  // Keywords (peso pequeno hoje mas barato)
  if (seo.keywords) {
    parts.push('<meta name="keywords" content="' + esc(seo.keywords) + '">');
  }
  // Verificacoes de search engines (cola o codigo no config; vazio = nao injeta)
  if (seo.google_site_verification) {
    parts.push('<meta name="google-site-verification" content="' + esc(seo.google_site_verification) + '">');
  }
  if (seo.bing_site_verification) {
    parts.push('<meta name="msvalidate.01" content="' + esc(seo.bing_site_verification) + '">');
  }
  if (themeColor) parts.push('<meta name="theme-color" content="' + esc(themeColor) + '">');
  if (canonical) parts.push('<link rel="canonical" href="' + esc(canonical) + '">');

  // Resource hints — abre conexao HTTP/TLS antecipada com dominios de
  // tracking, fonts, checkout. Melhora LCP/FCP (Core Web Vitals → sinal
  // de ranking no Google). preconnect = TLS handshake + DNS;
  // dns-prefetch = so resolucao DNS (fallback mais barato).
  const RESOURCE_HINTS = [
    // Fonts (criticos pra render)
    { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
    { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: true },
    // Tracking (carregam logo apos o load)
    { rel: 'preconnect', href: 'https://www.googletagmanager.com' },
    { rel: 'preconnect', href: 'https://connect.facebook.net' },
    // IRIS events (LP push)
    { rel: 'preconnect', href: 'https://iris.technowhub.ai' },
    // Integracao RD (lead form + Pixel CAPI)
    { rel: 'dns-prefetch', href: 'https://rd.technowhub.ai' },
    // Checkout Engaged (so dispara no click — dns-prefetch eh suficiente)
    { rel: 'dns-prefetch', href: 'https://impacta.site.engaged.com.br' },
  ];
  for (const h of RESOURCE_HINTS) {
    const co = h.crossorigin ? ' crossorigin' : '';
    parts.push('<link rel="' + h.rel + '" href="' + esc(h.href) + '"' + co + '>');
  }
  if (favicon) {
    parts.push('<link rel="icon" href="' + esc(favicon) + '">');
    parts.push('<link rel="shortcut icon" href="' + esc(favicon) + '">'); // browsers legados
  }
  if (appleIcon) parts.push('<link rel="apple-touch-icon" href="' + esc(appleIcon) + '">');

  // Open Graph
  parts.push('<meta property="og:type" content="website">');
  parts.push('<meta property="og:locale" content="pt_BR">');
  parts.push('<meta property="og:site_name" content="' + esc(siteName) + '">');
  parts.push('<meta property="og:title" content="' + esc(title) + '">');
  parts.push('<meta property="og:description" content="' + esc(desc) + '">');
  if (canonical) parts.push('<meta property="og:url" content="' + esc(canonical) + '">');
  if (ogImage) {
    parts.push('<meta property="og:image" content="' + esc(ogImage) + '">');
    parts.push('<meta property="og:image:width" content="1200">');
    parts.push('<meta property="og:image:height" content="630">');
    parts.push('<meta property="og:image:alt" content="' + esc(title) + '">');
  }

  // Twitter Card
  parts.push('<meta name="twitter:card" content="summary_large_image">');
  if (twitterHandle) parts.push('<meta name="twitter:site" content="' + esc(twitterHandle) + '">');
  parts.push('<meta name="twitter:title" content="' + esc(title) + '">');
  parts.push('<meta name="twitter:description" content="' + esc(desc) + '">');
  if (ogImage) parts.push('<meta name="twitter:image" content="' + esc(ogImage) + '">');

  return parts.join('\n');
}

function buildJsonLd(faqItems) {
  const org = seo.organization || {};
  const course = seo.course || {};
  const canonical = seo.canonical_url || '';

  const graph = [];

  // Organization — CRITICO pro logo aparecer no Google
  if (org.name) {
    const orgNode = {
      '@type': 'Organization',
      '@id': (org.url || canonical) + '#organization',
      name: org.name,
      url: org.url || canonical,
    };
    if (org.logo) {
      orgNode.logo = {
        '@type': 'ImageObject',
        url: org.logo,
      };
    }
    if (Array.isArray(org.sameAs) && org.sameAs.length) {
      orgNode.sameAs = org.sameAs;
    }
    graph.push(orgNode);
  }

  // WebSite
  if (canonical) {
    graph.push({
      '@type': 'WebSite',
      '@id': canonical + '#website',
      url: canonical,
      name: course.name || seo.site_name,
      inLanguage: course.language || 'pt-BR',
      publisher: org.name ? { '@id': (org.url || canonical) + '#organization' } : undefined,
    });
  }

  // Course (curso ao vivo) — ajuda Google a mostrar como card de curso
  if (course.name) {
    const courseNode = {
      '@type': 'Course',
      '@id': canonical + '#course',
      name: course.name,
      description: course.description,
      url: course.url || canonical,
      inLanguage: course.language || 'pt-BR',
      provider: org.name
        ? {
            '@type': 'Organization',
            name: org.name,
            sameAs: org.url,
          }
        : undefined,
      // CourseInstance (instancia da turma)
      hasCourseInstance: {
        '@type': 'CourseInstance',
        courseMode: 'Online',
        courseWorkload: course.duration_iso || 'P5D',
        startDate: course.start_date,
        endDate: course.end_date,
        location: {
          '@type': 'VirtualLocation',
          url: course.url || canonical,
        },
        instructor: course.instructor_name
          ? {
              '@type': 'Person',
              name: course.instructor_name,
              description: course.instructor_bio,
            }
          : undefined,
        offers: course.price
          ? {
              '@type': 'Offer',
              price: course.price,
              priceCurrency: course.currency || 'BRL',
              availability: 'https://schema.org/InStock',
              url: course.url || canonical,
              validFrom: new Date().toISOString().slice(0, 10),
            }
          : undefined,
      },
    };
    graph.push(courseNode);
  }

  // Event (turma especifica como evento) — aparece em "Eventos" no Google
  if (course.start_date && course.name) {
    graph.push({
      '@type': 'Event',
      '@id': canonical + '#event',
      name: course.name + ' — Turma ' + course.start_date.slice(0, 10),
      description: course.description,
      startDate: course.start_date,
      endDate: course.end_date,
      eventStatus: 'https://schema.org/EventScheduled',
      eventAttendanceMode: 'https://schema.org/OnlineEventAttendanceMode',
      location: {
        '@type': 'VirtualLocation',
        url: course.url || canonical,
      },
      image: seo.og_image_url ? [seo.og_image_url] : undefined,
      organizer: org.name
        ? {
            '@type': 'Organization',
            name: org.name,
            url: org.url,
          }
        : undefined,
      performer: course.instructor_name
        ? {
            '@type': 'Person',
            name: course.instructor_name,
          }
        : undefined,
      offers: course.price
        ? {
            '@type': 'Offer',
            price: course.price,
            priceCurrency: course.currency || 'BRL',
            availability: 'https://schema.org/InStock',
            url: course.url || canonical,
            validFrom: new Date().toISOString().slice(0, 10),
          }
        : undefined,
    });
  }

  // FAQPage — usa FAQ ja existente na LP (rich snippet com expansiveis no Google)
  if (faqItems && faqItems.length > 0) {
    graph.push({
      '@type': 'FAQPage',
      '@id': canonical + '#faq',
      mainEntity: faqItems.map((it) => ({
        '@type': 'Question',
        name: it.q,
        acceptedAnswer: { '@type': 'Answer', text: it.a },
      })),
    });
  }

  // BreadcrumbList simples (Home > Curso)
  if (canonical) {
    graph.push({
      '@type': 'BreadcrumbList',
      itemListElement: [
        {
          '@type': 'ListItem',
          position: 1,
          name: org.name || 'Impacta',
          item: org.url,
        },
        {
          '@type': 'ListItem',
          position: 2,
          name: course.name,
          item: canonical,
        },
      ],
    });
  }

  const ld = {
    '@context': 'https://schema.org',
    '@graph': graph,
  };
  return '<script type="application/ld+json">\n' + JSON.stringify(ld, null, 2) + '\n</script>';
}

function stripExistingSeo(template) {
  const re = new RegExp(MARK_START + '[\\s\\S]*?' + MARK_END, 'g');
  return template.replace(re, '');
}

function buildBlock(template) {
  const tags = buildHeadTags();
  const faq = extractFaq(template);
  const jsonLd = buildJsonLd(faq);
  return MARK_START + '\n' + tags + '\n' + jsonLd + '\n' + MARK_END;
}

// ─── Wrapper ─────────────────────────────────────────────────────────────
// CRITICO: a LP eh um artifact bundlado do Claude que hidrata via JS.
// O <head> REAL servido pelo nginx eh minusculo — todo o HTML "de verdade"
// fica dentro de <script type="__bundler/template"> como JSON string e
// so vira DOM depois do JS rodar.
//
// Crawlers (Google, GSC verifier, FB scraper, LinkedIn) NAO executam JS,
// entao tags injetadas dentro do bundler template ficam INVISIVEIS pra
// SEO/social. Por isso este script injeta o bloco SEO DUAS vezes:
//
//   1. No <head> ESTATICO real do index.html — onde crawlers leem
//      (RESOLVE a verificacao do GSC + rich snippets + OG cards)
//   2. Tambem no bundle template — pra que a versao hidratada tenha
//      as mesmas tags (browsers de usuarios reais), evitando que o JS
//      sobrescreva o <head> e remova as tags estaticas
//
let html = fs.readFileSync(HTML_PATH, 'utf8');

// Garante <html lang="pt-BR"> no shell estatico (Google usa pra idioma)
const lang = seo.course?.language || 'pt-BR';
if (/<html(\s|>)/i.test(html) && !/<html[^>]*\blang=/i.test(html.match(/<html[^>]*>/)?.[0] || '')) {
  html = html.replace(/<html(\s|>)/i, '<html lang="' + lang + '"$1');
}

// Override do <title> estatico — sobrescreve o gerado pelo bundler do Claude
// (que era so o curso, sem keywords de busca tipo "Curso de Claude Code").
// O title_override entra no config; se vazio, mantem o que o bundler colocou.
if (seo.title_override && /<title>[^<]*<\/title>/i.test(html)) {
  const safe = seo.title_override
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  html = html.replace(/<title>[^<]*<\/title>/i, '<title>' + safe + '</title>');
}

// Extrai FAQ do bundle template (pra montar FAQPage schema) — so leitura
const m = html.match(/<script type="__bundler\/template">\s*([\s\S]*?)\s*<\/script>/);
let faqForSchema = [];
if (m) {
  try {
    const tpl = JSON.parse(m[1]);
    faqForSchema = extractFaq(tpl);
  } catch {
    /* template parse falhou — segue sem FAQ */
  }
}

// Monta o bloco SEO completo (mesma instancia pra ambos os destinos)
const seoBlock = (function () {
  const tags = buildHeadTags();
  const jsonLd = buildJsonLd(faqForSchema);
  return MARK_START + '\n' + tags + '\n' + jsonLd + '\n' + MARK_END;
})();

// ─── DESTINO 1: <head> ESTATICO real ─────────────────────────────────────
// Strip versao antiga + insere antes do </head> estatico (primeiro </head>
// que aparece no HTML servido).
const staticStripRe = new RegExp(MARK_START + '[\\s\\S]*?' + MARK_END, 'g');
let workingHtml = html.replace(staticStripRe, '');
// Override do <html lang> ja foi feito acima (linha 295). 'html' agora
// ja eh let, entao a modificacao persiste em workingHtml.
if (!workingHtml.includes('</head>')) {
  throw new Error('Não encontrei </head> no index.html estatico');
}
// Substitui SO o primeiro </head> (o estatico — o do template vem depois,
// dentro do JSON escapado como "</head>" -> nao casa o pattern bruto).
workingHtml = workingHtml.replace('</head>', seoBlock + '\n</head>');

// ─── DESTINO 2: <head> dentro do bundle template (hidratacao) ────────────
const m2 = workingHtml.match(/<script type="__bundler\/template">\s*([\s\S]*?)\s*<\/script>/);
if (m2) {
  const rawJson = m2[1];
  try {
    let template = JSON.parse(rawJson);
    template = template.replace(staticStripRe, ''); // strip versao antiga no template
    if (template.indexOf('</head>') !== -1) {
      template = template.replace('</head>', seoBlock + '\n</head>');
    }
    const newJson = JSON.stringify(template).replace(/<\/script>/gi, '<\\/script>');
    workingHtml = workingHtml.replace(rawJson, () => newJson);
  } catch (e) {
    console.warn('  (aviso: bundle template parse falhou — so o head estatico foi atualizado)');
  }
}

fs.writeFileSync(HTML_PATH, workingHtml);

console.log('✓ SEO injetado em index.html');
console.log('  Destino:       <head> estatico (crawlers) + bundle template (hidratacao)');
console.log('  Canonical:    ', seo.canonical_url || '(não configurado)');
console.log('  OG Image:     ', seo.og_image_url || '(não configurado)');
console.log('  Org Logo:     ', seo.organization?.logo || '(não configurado)');
console.log('  GSC verify:   ', seo.google_site_verification ? '✓ tag injetada' : '(vazio)');
console.log('  Course Schema:', seo.course?.name ? 'OK' : '(faltando dados em config.seo.course)');
console.log('  FAQ items:    ', faqForSchema.length);
