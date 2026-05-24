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
  parts.push('<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1">');
  // Verificacoes de search engines (cola o codigo no config; vazio = nao injeta)
  if (seo.google_site_verification) {
    parts.push('<meta name="google-site-verification" content="' + esc(seo.google_site_verification) + '">');
  }
  if (seo.bing_site_verification) {
    parts.push('<meta name="msvalidate.01" content="' + esc(seo.bing_site_verification) + '">');
  }
  if (themeColor) parts.push('<meta name="theme-color" content="' + esc(themeColor) + '">');
  if (canonical) parts.push('<link rel="canonical" href="' + esc(canonical) + '">');
  if (favicon) parts.push('<link rel="icon" href="' + esc(favicon) + '">');
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

// ─── Wrapper: parseia bundle template, modifica, salva ───────────────────
const html = fs.readFileSync(HTML_PATH, 'utf8');
const m = html.match(/<script type="__bundler\/template">\s*([\s\S]*?)\s*<\/script>/);
if (!m) throw new Error('Não encontrei o bundle template no index.html');
const rawJson = m[1];
let template = JSON.parse(rawJson);

template = stripExistingSeo(template);
const block = buildBlock(template);
if (template.indexOf('</head>') !== -1) {
  template = template.replace('</head>', block + '\n</head>');
} else {
  template = block + template;
}

const newJson = JSON.stringify(template).replace(/<\/script>/gi, '<\\/script>');
const newHtml = html.replace(rawJson, () => newJson);
fs.writeFileSync(HTML_PATH, newHtml);

// Conta o que entrou
const faq = extractFaq(JSON.parse(newJson));
console.log('✓ SEO injetado em index.html');
console.log('  Canonical:    ', seo.canonical_url || '(não configurado)');
console.log('  OG Image:     ', seo.og_image_url || '(não configurado)');
console.log('  Org Logo:     ', seo.organization?.logo || '(não configurado)');
console.log('  Course Schema:', seo.course?.name ? 'OK' : '(faltando dados em config.seo.course)');
console.log('  FAQ items:    ', faq.length);
