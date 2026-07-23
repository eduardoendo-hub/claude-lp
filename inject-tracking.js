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
fbq('init', '1581473926936760'); // Pixel IRIS — dupla queima na migração
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
  var UTM_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias — atribuicao nao gruda pra sempre
  // Le um UTM persistido respeitando TTL. Formato atual: {"v":valor,"t":ts}.
  // Formato legado (string crua, sem timestamp) eh tratado como expirado e
  // PURGADO — assim UTMs antigos (ex: brevo/email/CLAUDEPRO-MAI26 de um disparo
  // de carrinho abandonado) param de grudar no checkout de quem entra
  // direto/organico numa sessao posterior.
  function lpReadUtm(k){
    try {
      var raw = localStorage.getItem('lp_'+k);
      if (!raw) return null;
      var obj = JSON.parse(raw); // string crua legada -> throw -> purga no catch
      if (obj && obj.v && obj.t && (Date.now() - obj.t) < UTM_TTL_MS) return obj.v;
      localStorage.removeItem('lp_'+k);
      return null;
    } catch(e){
      try { localStorage.removeItem('lp_'+k); } catch(_){}
      return null;
    }
  }
  var p = new URLSearchParams(location.search);
  var utms = {};
  UTM_KEYS.forEach(function(k){
    var v = p.get(k);
    if (v) {
      try { localStorage.setItem('lp_'+k, JSON.stringify({v:v, t:Date.now()})); } catch(e){}
      utms[k] = v;
    } else {
      var s = lpReadUtm(k);
      if (s) utms[k] = s;
    }
  });
  window.__lp_utms = utms;
  window.__lpReadUtm = lpReadUtm; // reusado por checkoutUrlWithUtms (inject-extras)

  // NOTA: a propagacao de UTMs pros links engaged.com.br ja eh feita pela
  // funcao applyCheckoutUtmsToAllLinks() / checkoutUrlWithUtms() embarcada
  // no bundler original do Claude LP. Validei em 24/05/2026 que todos os 6
  // CTAs ja saem com utm_source/medium/campaign/content/term no querystring
  // do Engaged. Nao injetar duplicata aqui — duplicar causa race
  // (applyCheckoutUtmsToAllLinks sobrescreve o que injetamos e ainda gerava
  // loop infinito quando o MutationObserver observava 'href').

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
      track('begin_checkout', {cta_text: label, currency: 'BRL', value: 1699});
      trackPixel('InitiateCheckout', {content_name: label, currency: 'BRL', value: 1699});
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
