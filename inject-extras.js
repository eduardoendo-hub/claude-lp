#!/usr/bin/env node
/**
 * Pós-processa o index.html (artifact bundle do Claude) e injeta os "extras"
 * da campanha do Curso Claude Pro:
 *
 *   1. Substitui href="#" dos botões cta-buy-pricing e cta-buy-final pela
 *      checkout_url do tracking-config.json.
 *   2. Insere o selo "⚠ Requer Claude Pro" antes de cada CTA cta-buy-*
 *      (4 botões — hero, format, pricing, final).
 *   3. Adiciona, antes do </head>, um bloco com:
 *        - CSS dos novos elementos
 *        - Sticky CTA mobile com bônus 20 primeiros + horário 19h–20h + checkout
 *        - WhatsApp tooltip "Tira sua dúvida em 2 min" sobre o fab existente
 *        - Hijack do submit do form #leadForm para POST integracao-rd /api/leads
 *          (cria Lead+Deal no RD CRM e encaminha evento ao IRIS)
 *
 * Idempotente: remove versão anterior dos extras antes de re-injetar. Pode rodar
 * quantas vezes quiser sem duplicar.
 *
 * Roda DEPOIS de `inject-tracking.js`. Os dois mexem no mesmo template JSON
 * mas em locais diferentes; a ordem (tracking → extras) garante que o JS de
 * tracking esteja disponível quando os extras forem renderizados.
 *
 *   node inject-tracking.js
 *   node inject-extras.js
 *
 * Config: tracking-config.json (compartilhada com inject-tracking.js).
 */
const fs = require('fs');
const path = require('path');

const HTML_PATH   = path.join(__dirname, 'index.html');
const CONFIG_PATH = path.join(__dirname, 'tracking-config.json');
const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

const MARK_START = '<!-- LP-EXTRAS:START -->';
const MARK_END   = '<!-- LP-EXTRAS:END -->';
const BADGE_ATTR = 'data-lp-extras="probadge"';

// ─── 1. Bloco CSS+JS injetado antes do </head> ─────────────────────────────
function buildExtrasBlock(c) {
  const checkout      = c.checkout_url;
  const integracaoRd  = c.integracao_rd_url;
  const campaign      = c.campaign_slug;
  const bonus         = Number(c.bonus_remaining) || 20;
  const horario       = c.horario_aulas || '19h–20h (Brasília)';
  const ticket        = Number(c.ticket_price) || 1499;
  const waTooltip     = c.whatsapp_tooltip || 'Tira sua dúvida em 2 min';
  const ticketBR      = ticket.toLocaleString('pt-BR');

  // CSS dos elementos novos
  const css = `
.lp-pro-badge {
  display: inline-flex; align-items: center; gap: 6px;
  background: rgba(217,119,87,0.12); color: #D97757;
  border: 1px solid rgba(217,119,87,0.35);
  font: 600 11px/1 'JetBrains Mono', ui-monospace, monospace;
  letter-spacing: 0.06em; text-transform: uppercase;
  padding: 6px 10px; border-radius: 999px;
  margin: 0 0 10px 0;
}
.lp-pro-badge::before { content: '⚠'; font-size: 13px; }
.lp-sticky-cta {
  position: fixed; bottom: 0; left: 0; right: 0;
  background: rgba(14,11,8,0.96); backdrop-filter: blur(8px);
  border-top: 1px solid rgba(247,241,232,0.12);
  padding: 12px 16px 14px; z-index: 9000;
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  transform: translateY(100%); transition: transform .25s;
}
.lp-sticky-cta.visible { transform: translateY(0); }
.lp-sticky-bonus { color: #F7F1E8; font-size: 12px; line-height: 1.3; flex: 1; min-width: 0; }
.lp-sticky-bonus strong { color: #D97757; font-weight: 700; }
.lp-sticky-cta a {
  display: inline-flex; align-items: center;
  background: #D97757; color: #0e0b08;
  font: 700 13px/1 'Inter', -apple-system, sans-serif;
  padding: 10px 14px; border-radius: 8px;
  text-decoration: none; white-space: nowrap;
}
.lp-sticky-close {
  position: absolute; top: 4px; right: 6px;
  background: none; border: none; color: rgba(247,241,232,0.5);
  font-size: 18px; cursor: pointer; padding: 0; width: 24px; height: 24px;
}
.lp-form-msg { padding: 12px; border-radius: 8px; margin-top: 12px; font-size: 14px; }
.lp-form-msg.ok   { background: rgba(46,204,113,0.15); color: #2ecc71; }
.lp-form-msg.fail { background: rgba(231,76,60,0.15);  color: #e74c3c; }
.lp-wa-bubble {
  position: fixed; z-index: 8990;
  background: #fff; color: #0e0b08;
  font: 600 13px/1.3 'Inter', -apple-system, sans-serif;
  padding: 10px 14px; border-radius: 12px;
  box-shadow: 0 6px 24px rgba(0,0,0,0.18);
  max-width: 230px;
  transform-origin: bottom right;
  transform: scale(0); opacity: 0;
  transition: transform .25s cubic-bezier(.2,.9,.4,1.4), opacity .25s;
}
.lp-wa-bubble.visible { transform: scale(1); opacity: 1; }
.lp-wa-bubble::after {
  content: ''; position: absolute; bottom: -6px; right: 24px;
  border: 6px solid transparent; border-top-color: #fff; border-bottom: 0;
}
.lp-wa-bubble button {
  background: none; border: none; color: #999; font-size: 16px;
  position: absolute; top: 2px; right: 4px; cursor: pointer; padding: 0;
  width: 18px; height: 18px; line-height: 1;
}
/* Suprime o "[bundle] error" — falso positivo do error sink do bundler do
   Claude que captura, em capture phase, qualquer erro de loading de asset
   externo. Em produção dispara por causa de 503 do facebook.com/privacy_sandbox
   e google-analytics.com/g/collect (anti-tracking dos próprios servidores
   Meta/GA, comum em modo anônimo). A página funciona normalmente. */
#__bundler_err { display: none !important; }
@media (min-width: 768px) {
  .lp-sticky-cta { display: none; }
}`.trim();

  // JS dos comportamentos
  const js = `
(function(){
  var CHECKOUT_URL      = ${JSON.stringify(checkout)};
  var INTEGRACAO_RD_URL = ${JSON.stringify(integracaoRd)};
  var CAMPAIGN_SLUG     = ${JSON.stringify(campaign)};
  var BONUS_REMAINING   = ${bonus};
  var HORARIO           = ${JSON.stringify(horario)};
  var TICKET            = ${ticket};
  var WA_TOOLTIP        = ${JSON.stringify(waTooltip)};

  function utms(){ try { return (window.__lp_utms || {}); } catch(e){ return {}; } }

  function injectStickyCTA(){
    if (document.querySelector('.lp-sticky-cta')) return;
    try { if (sessionStorage.getItem('lp-sticky-dismissed') === '1') return; } catch(e){}
    var bar = document.createElement('div');
    bar.className = 'lp-sticky-cta';
    bar.innerHTML =
      '<button class="lp-sticky-close" aria-label="Fechar">×</button>' +
      '<div class="lp-sticky-bonus">' +
        'Bônus: <strong>' + BONUS_REMAINING + ' primeiros</strong> ganham 1h extra. ' +
        'Turma <strong>06/06</strong> · ' + HORARIO + ' · R$ ' + TICKET.toLocaleString('pt-BR') + '.' +
      '</div>' +
      '<a href="' + CHECKOUT_URL + '" data-track="cta-buy-sticky">Quero me matricular</a>';
    document.body.appendChild(bar);
    bar.querySelector('.lp-sticky-close').addEventListener('click', function(){
      bar.remove();
      try { sessionStorage.setItem('lp-sticky-dismissed', '1'); } catch(e){}
    });
    bar.querySelector('a').addEventListener('click', function(){
      if (window.fbq)  { try { fbq('track', 'InitiateCheckout', { value: TICKET, currency: 'BRL' }); } catch(e){} }
      if (window.gtag) { try { gtag('event', 'begin_checkout', { value: TICKET, currency: 'BRL', cta_text: 'sticky' }); } catch(e){} }
    });
    setTimeout(function(){ bar.classList.add('visible'); }, 4000);
  }

  function injectWaBubble(){
    if (document.querySelector('.lp-wa-bubble')) return;
    try { if (sessionStorage.getItem('lp-wa-bubble-dismissed') === '1') return; } catch(e){}
    var fab = document.querySelector('[data-track="float-wa"]') || document.querySelector('a[href*="wa.me"], a[href*="api.whatsapp.com"]');
    if (!fab) return;
    var rect = fab.getBoundingClientRect();
    var bubble = document.createElement('div');
    bubble.className = 'lp-wa-bubble';
    bubble.innerHTML = '<button aria-label="Fechar">×</button>👋 ' + WA_TOOLTIP;
    document.body.appendChild(bubble);
    bubble.style.right  = (window.innerWidth - rect.right) + 'px';
    bubble.style.bottom = (window.innerHeight - rect.top + 12) + 'px';
    bubble.querySelector('button').addEventListener('click', function(e){
      e.stopPropagation();
      bubble.remove();
      try { sessionStorage.setItem('lp-wa-bubble-dismissed', '1'); } catch(e){}
    });
    bubble.addEventListener('click', function(){ fab.click(); });
    setTimeout(function(){ bubble.classList.add('visible'); }, 6000);
    setTimeout(function(){ try { bubble.remove(); } catch(e){} }, 30000);
  }

  function notifyWhatsAppClickToIris(){
    document.addEventListener('click', function(e){
      var el = e.target && e.target.closest ? e.target.closest('[data-track="float-wa"], a[href*="wa.me"], a[href*="api.whatsapp.com"]') : null;
      if (!el || el.dataset.lpWaForwarded) return;
      el.dataset.lpWaForwarded = '1';
      try {
        fetch(INTEGRACAO_RD_URL + '/api/leads/whatsapp-click', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            campaign_slug: CAMPAIGN_SLUG,
            source_page:   window.location.href,
            utm:           utms(),
          }),
          keepalive: true,
        });
      } catch(e){}
    }, true);
  }

  function hijackLeadForm(){
    var form = document.getElementById('leadForm');
    if (!form || form.dataset.lpHijacked) return;
    form.dataset.lpHijacked = '1';

    // Validacao obrigatoria via HTML5: o form do bundle tem novalidate=""
    // que desabilita a validacao nativa. Removemos para garantir que name,
    // email e phone (que ja tem required) bloqueiem submit vazio. Tambem
    // forcamos required nos 3 caso o bundle os tenha removido.
    form.removeAttribute('novalidate');
    ['name', 'email', 'phone'].forEach(function(n){
      var el = form.querySelector('[name="' + n + '"]');
      if (el && !el.hasAttribute('required')) el.setAttribute('required', '');
    });

    // Capture phase + sendBeacon: o bundle original do Claude substitui o
    // innerHTML do form logo apos o submit (mostra tela de sucesso interna),
    // o que cancelava qualquer fetch async em flight (Failed to fetch). Usamos
    // sendBeacon — projetado para POST garantido durante unload/replace.
    // Tradeoff: nao temos resposta do servidor; o servidor ja loga o resultado
    // e o Lead aparece no RD CRM em <2s. A tela de sucesso do bundle continua
    // aparecendo normalmente (nao chamamos preventDefault em caso de sucesso).
    form.addEventListener('submit', function(e){
      // Bloqueia envio se algum campo obrigatorio estiver vazio/invalido.
      // O browser mostra a mensagem nativa ("Preencha este campo") e o
      // tracking original tambem nao dispara qualify_lead.
      if (!form.checkValidity()) {
        form.reportValidity();
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      try {
        var fd = new FormData(form);
        var data = {
          campaign_slug: CAMPAIGN_SLUG,
          name:    (fd.get('name')  || '').trim(),
          email:   (fd.get('email') || '').trim(),
          phone:   (fd.get('phone') || '').trim(),
          channel: 'form',                 // origem: form submit "Falar com especialista"
          utm:     utms(),
          source_page: window.location.href,
          extra:   { course: fd.get('course') || '' },
        };
        var blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
        var sent = false;
        if (navigator.sendBeacon) {
          sent = navigator.sendBeacon(INTEGRACAO_RD_URL + '/api/leads', blob);
        }
        if (!sent) {
          // Fallback: fetch fire-and-forget com keepalive
          fetch(INTEGRACAO_RD_URL + '/api/leads', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
            keepalive: true,
          }).catch(function(){});
        }
        console.log('[lp-extras] lead enviado a integracao-rd (beacon=' + sent + ')');
      } catch (err) {
        console.error('[lp-extras] erro ao preparar lead', err);
      }
    }, true);  /* capture phase = roda ANTES do handler do bundle */
  }

  function safe(fn){ try { fn(); } catch(err){ console.warn('[lp-extras]', err); } }
  function suppressBundleErrSink(){
    var d = document.getElementById('__bundler_err');
    if (d) d.style.display = 'none';
  }
  function applyAll(){
    safe(suppressBundleErrSink);
    safe(injectStickyCTA);
    safe(injectWaBubble);
    safe(hijackLeadForm);
  }
  function start(){
    safe(notifyWhatsAppClickToIris);
    applyAll();
    if (window.MutationObserver && document.body) {
      var obs = new MutationObserver(function(){ applyAll(); });
      obs.observe(document.body, { childList: true, subtree: true });
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();`.trim();

  return MARK_START + '\n<style>' + css + '</style>\n<script>' + js + '</script>\n' + MARK_END;
}

// ─── 2. Substitui href dos botões cta-buy-pricing/final pela checkout_url ──
// Idempotente: substitui QUALQUER href atual (não só "#") para que rerodar
// com URL diferente atualize o link.
function fixCheckoutLinks(template, checkoutUrl) {
  return template.replace(
    /<a([^>]*data-track="cta-buy-(?:pricing|final)"[^>]*)>/g,
    function (_match, attrs) {
      if (/href="[^"]*"/.test(attrs)) {
        attrs = attrs.replace(/href="[^"]*"/, 'href="' + checkoutUrl + '"');
      } else {
        attrs = ' href="' + checkoutUrl + '"' + attrs;
      }
      return '<a' + attrs + '>';
    }
  );
}

// ─── 3. Insere selo Pro antes dos 4 botões cta-buy-* ───────────────────────
function injectProBadges(template) {
  // Remove versões anteriores (regex flexível: classe e marker em qualquer ordem)
  var stripRe = /<span[^>]*class="lp-pro-badge"[^>]*data-lp-extras="probadge"[^>]*>[^<]*<\/span>/g;
  var out = template.replace(stripRe, '');

  var badge = '<span class="lp-pro-badge" ' + BADGE_ATTR + '>Requer assinatura Claude Pro (US$ 20/mês)</span>';
  out = out.replace(
    /(<a\s+[^>]*data-track="cta-buy-(?:hero|format|pricing|final)"[^>]*>)/g,
    badge + '$1'
  );
  return out;
}

// ─── 3b. Adiciona bloco "Horário" no hero__meta (visível no hero) ──────────
function injectHeroSchedule(template, horario) {
  // Remove inserção anterior (idempotente)
  var stripRe = /<div\s+data-lp-extras="hero-schedule"[\s\S]*?<\/div>\s*<\/div>/g;
  var out = template.replace(stripRe, '');

  // Item visual igual aos outros do hero__meta. Inserido logo após "ao vivo"
  // (último div meta original).
  var horaSplit = horario.replace(/\s*\([^)]*\)/, '').trim();      // "19h–22h"
  var localSplit = (horario.match(/\(([^)]*)\)/) || [,'Brasília'])[1]; // "Brasília"
  var item =
    '<div data-lp-extras="hero-schedule">' +
      '<div class="meta-k">Horário</div>' +
      '<div class="meta-v"><em>' + horaSplit + '</em></div>' +
      '<div class="meta-sub">' + localSplit + ' · 5 noites consecutivas</div>' +
    '</div>';

  // Insere depois do último <div> do hero__meta. Pattern conservador:
  // pega o conteúdo dentro de <div class="hero__meta">...</div> e injeta antes do fechamento.
  out = out.replace(
    /(<div class="hero__meta">[\s\S]*?)(<\/div>\s*<\/section>)/,
    function (match, inner, tail) {
      // Se já tem nosso item dentro de inner (não removido), não duplica
      if (inner.indexOf('data-lp-extras="hero-schedule"') !== -1) return match;
      return inner + item + tail;
    }
  );
  return out;
}

// ─── 3c. Adiciona pergunta "Em que horário?" no FAQ ────────────────────────
function injectFaqSchedule(template, horario) {
  var stripRe = /<details[^>]*data-lp-extras="faq-schedule"[\s\S]*?<\/details>/g;
  var out = template.replace(stripRe, '');

  var qa =
    '<details class="qa" data-lp-extras="faq-schedule">' +
      '<summary>Em que horário acontecem as aulas?<span class="plus">+</span></summary>' +
      '<div class="qa__body">' +
        'As 5 aulas acontecem ao vivo das <strong>' + horario + '</strong>, em 5 noites consecutivas. ' +
        'Toda aula é gravada e disponibilizada na comunidade para revisão sem prazo.' +
      '</div>' +
    '</details>';

  // Insere a nova pergunta como PRIMEIRA do FAQ (depois da abertura do .faq__list)
  // ou logo após o último </details> antes do fechamento de .faq.
  // Estratégia: inserir antes do </div> que fecha a div.faq, depois do último </details>.
  out = out.replace(
    /(<div class="faq">[\s\S]*?)(<\/details>\s*<\/div>)/,
    function (match, head, tail) {
      if (head.indexOf('data-lp-extras="faq-schedule"') !== -1) return match;
      return head + '</details>' + qa + tail.replace('</details>', '');
    }
  );
  return out;
}

// ─── 4. Wrapper: pega template JSON, modifica, salva ─────────────────────
function process(html, c) {
  var m = html.match(/<script type="__bundler\/template">\s*([\s\S]*?)\s*<\/script>/);
  if (!m) throw new Error('Não encontrei o bundle template no index.html');
  var rawJson = m[1];
  var template = JSON.parse(rawJson);

  // Remove bloco LP-EXTRAS anterior (idempotência)
  var blockRe = new RegExp(MARK_START + '[\\s\\S]*?' + MARK_END, 'g');
  template = template.replace(blockRe, '');

  // Aplica patches no markup
  template = fixCheckoutLinks(template, c.checkout_url);
  template = injectProBadges(template);
  template = injectHeroSchedule(template, c.horario_aulas);
  template = injectFaqSchedule(template, c.horario_aulas);

  // Insere bloco LP-EXTRAS antes de </head>
  var block = buildExtrasBlock(c);
  if (template.indexOf('</head>') !== -1) {
    template = template.replace('</head>', block + '\n</head>');
  } else {
    template = block + template;
  }

  // Re-encoda JSON, escapando </script> para não fechar o wrapper.
  var newJson = JSON.stringify(template).replace(/<\/script>/gi, '<\\/script>');
  return html.replace(rawJson, function(){ return newJson; });
}

const html = fs.readFileSync(HTML_PATH, 'utf8');
const out  = process(html, cfg);
fs.writeFileSync(HTML_PATH, out);

console.log('✓ Extras injetados em index.html');
console.log('  Checkout URL:    ', cfg.checkout_url);
console.log('  Integração RD:   ', cfg.integracao_rd_url);
console.log('  Campanha:        ', cfg.campaign_slug);
console.log('  Bônus restantes: ', cfg.bonus_remaining);
console.log('  Horário:         ', cfg.horario_aulas);
