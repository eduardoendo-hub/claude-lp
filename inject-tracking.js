#!/usr/bin/env node
/**
 * Pós-processa o index.html (artifact bundle do Claude) e injeta:
 *   - gtag.js (GA4) com o Measurement ID configurado
 *   - Meta Pixel (se configurado)
 *   - Google Ads conversion tag (se configurado)
 *   - Helper de tracking: captura UTMs + dispara eventos em CTAs
 *
 * Idempotente: remove tracking previamente injetado antes de re-injetar.
 *
 * Uso:
 *   node inject-tracking.js
 *
 * Config: tracking-config.json
 */
const fs = require('fs');
const path = require('path');

const HTML_PATH = path.join(__dirname, 'index.html');
const CONFIG_PATH = path.join(__dirname, 'tracking-config.json');

const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

const MARK_START = '<!-- LP-TRACKING:START -->';
const MARK_END = '<!-- LP-TRACKING:END -->';

function buildGtag(id) {
  return `<script async src="https://www.googletagmanager.com/gtag/js?id=${id}"></script>
<script>
window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${id}');
</script>`;
}

function buildMetaPixel(id) {
  if (!id) return '';
  return `<script>
!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
document,'script','https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '${id}');
fbq('track', 'PageView');
</script>
<noscript><img height="1" width="1" style="display:none"
src="https://www.facebook.com/tr?id=${id}&ev=PageView&noscript=1"/></noscript>`;
}

function buildGoogleAdsConversion(convId) {
  if (!convId) return '';
  return `<script async src="https://www.googletagmanager.com/gtag/js?id=${convId}"></script>
<script>
gtag('config', '${convId}');
</script>`;
}

function buildHelper(cfg) {
  const pixelId = cfg.meta_pixel_id ? JSON.stringify(cfg.meta_pixel_id) : 'null';
  const gadsId = cfg.google_ads_conversion_id ? JSON.stringify(cfg.google_ads_conversion_id) : 'null';
  const gadsLabel = cfg.google_ads_conversion_label ? JSON.stringify(cfg.google_ads_conversion_label) : 'null';
  const productSlug = JSON.stringify(cfg.product_slug || '');
  const campaignSlug = JSON.stringify(cfg.campaign_slug || '');
  return `<script>
(function(){
  var UTM_KEYS = ['utm_source','utm_medium','utm_campaign','utm_content','utm_term','gclid','fbclid'];
  var p = new URLSearchParams(location.search);
  var utms = {};
  UTM_KEYS.forEach(function(k){
    var v = p.get(k);
    if (v) { try { localStorage.setItem('lp_'+k, v); } catch(e){} utms[k] = v; }
    else { try { var s = localStorage.getItem('lp_'+k); if (s) utms[k] = s; } catch(e){} }
  });
  window.__lp_utms = utms;

  // ---- UTM propagation to Engaged checkout links ----
  // Sem isto, todo clique em "comprar" vai pro Engaged SEM querystring de UTM.
  // O Engaged então envia o webhook com queryParams vazio e o IRIS não consegue
  // atribuir a venda à campanha de origem.
  // IMPORTANTE: o setter so executa se o href novo for diferente do atual —
  // sem isso, o MutationObserver dispararia em loop infinito ao observar
  // attributeFilter:['href'] (a propria escrita disparava o observer).
  function appendUtmsToEngagedLinks(){
    try {
      var sel = 'a[href*="impacta.site.engaged.com.br"], a[href*="engaged.com.br/p/checkout"]';
      document.querySelectorAll(sel).forEach(function(a){
        try {
          var u = new URL(a.href);
          UTM_KEYS.forEach(function(k){ if (utms[k]) u.searchParams.set(k, utms[k]); });
          if (${productSlug})  u.searchParams.set('product', ${productSlug});
          if (${campaignSlug}) u.searchParams.set('iris_campaign', ${campaignSlug});
          var nh = u.toString();
          if (a.href !== nh) a.href = nh;
        } catch(e){}
      });
    } catch(e){}
  }
  // roda agora (caso DOM ja exista) + ao DOMContentLoaded + observer p/ DOM dinamico.
  // Observer SO em childList/subtree (NAO attributes) pra evitar loop com
  // o proprio set de href feito acima.
  appendUtmsToEngagedLinks();
  document.addEventListener('DOMContentLoaded', appendUtmsToEngagedLinks);
  try {
    new MutationObserver(appendUtmsToEngagedLinks).observe(
      document.body || document.documentElement,
      { childList: true, subtree: true }
    );
  } catch(e){}

  function track(name, extra){
    var payload = Object.assign({}, utms, extra || {});
    if (window.dataLayer) window.dataLayer.push(Object.assign({event: name}, payload));
    if (window.gtag) window.gtag('event', name, payload);
  }
  function trackPixel(name, params){
    if (window.fbq) window.fbq('track', name, params || {});
  }
  function trackGoogleAdsConversion(){
    var id = ${gadsId}, label = ${gadsLabel};
    if (window.gtag && id && label) {
      window.gtag('event', 'conversion', {send_to: id + '/' + label});
    }
  }
  window.__lpTrack = track;

  function classify(el){
    var cls = (el.className && typeof el.className === 'string') ? el.className : '';
    var txt = (el.textContent || '').trim().toLowerCase();
    if (cls.indexOf('modal__close') !== -1) return null;
    if (cls.indexOf('modal__submit') !== -1) return null;
    if (cls.indexOf('btn--ghost') !== -1 || /falar com.*consultor/.test(txt)) return 'consultor_open';
    if (cls.indexOf('btn--primary') !== -1 || cls.indexOf('btn--white') !== -1 || cls.indexOf('bar__cta') !== -1) return 'matricular';
    if (/matricular|garantir.*vaga|comprar/.test(txt)) return 'matricular';
    return null;
  }

  document.addEventListener('click', function(e){
    var el = e.target && e.target.closest ? e.target.closest('a,button') : null;
    if (!el) return;
    var kind = classify(el);
    if (!kind) return;
    var label = (el.textContent || '').trim().slice(0, 100);
    if (kind === 'matricular') {
      track('begin_checkout', {cta_text: label, currency: 'BRL', value: 1499});
      trackPixel('InitiateCheckout', {content_name: label, currency: 'BRL', value: 1499});
      trackGoogleAdsConversion();
    } else if (kind === 'consultor_open') {
      track('generate_lead', {cta_text: label});
      trackPixel('Lead', {content_name: 'consultor_open'});
    }
  }, true);

  document.addEventListener('submit', function(e){
    var f = e.target;
    if (!f) return;
    var isLead = f.id === 'lead-form-cowork-code' || (f.querySelector && f.querySelector('.modal__submit'));
    if (isLead) {
      track('qualify_lead');
      trackPixel('Lead', {content_name: 'consultor_form_submit'});
      trackGoogleAdsConversion();
    }
  }, true);
})();
</script>`;
}

function buildBlock(cfg) {
  const parts = [
    MARK_START,
    buildGtag(cfg.ga4_measurement_id),
    buildMetaPixel(cfg.meta_pixel_id),
    buildGoogleAdsConversion(cfg.google_ads_conversion_id),
    buildHelper(cfg),
    MARK_END,
  ].filter(Boolean);
  return '\n' + parts.join('\n') + '\n';
}

function stripExistingTracking(html) {
  let out = html;
  const re = new RegExp(MARK_START + '[\\s\\S]*?' + MARK_END, 'g');
  out = out.replace(re, '');
  if (cfg.remove_gtm_id) {
    const id = cfg.remove_gtm_id;
    out = out.replace(/<!--\s*Google Tag Manager\s*-->\s*<script>[\s\S]*?\)\(window,document,'script','dataLayer','[^']*'\);<\/script>/g, '');
    out = out.replace(/<!--\s*Google Tag Manager \(noscript\)\s*-->\s*<noscript>[\s\S]*?<\/noscript>/g, '');
    out = out.replace(/<!--\s*End Google Tag Manager[^>]*-->/g, '');
    out = out.replace(new RegExp('<noscript>[^<]*<iframe[^>]*' + id + '[\\s\\S]*?</noscript>', 'g'), '');
  }
  return out;
}

function inject(html, cfg) {
  const m = html.match(/<script type="__bundler\/template">\s*([\s\S]*?)\s*<\/script>/);
  if (!m) throw new Error('Não encontrei o bundle template no index.html');
  const rawJson = m[1];
  let template = JSON.parse(rawJson);

  template = stripExistingTracking(template);

  const block = buildBlock(cfg);
  if (template.indexOf('</head>') !== -1) {
    template = template.replace('</head>', block + '</head>');
  } else {
    template = block + template;
  }

  // Escape </script> dentro do JSON para não fechar prematuramente o
  // <script type="__bundler/template"> wrapper. JSON.stringify do Node não
  // escapa "/", então fazemos manualmente — mesma técnica que o bundler do
  // Claude usa (</script>).
  const newJson = JSON.stringify(template).replace(/<\/script>/gi, '<\\/script>');
  return html.replace(rawJson, () => newJson);
}

const html = fs.readFileSync(HTML_PATH, 'utf8');
const out = inject(html, cfg);
fs.writeFileSync(HTML_PATH, out);

console.log('✓ Tracking injetado em index.html');
console.log('  GA4:', cfg.ga4_measurement_id);
console.log('  Meta Pixel:', cfg.meta_pixel_id || '(não configurado)');
console.log('  Google Ads:', cfg.google_ads_conversion_id || '(não configurado — usar import do GA4)');
