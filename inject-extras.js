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
  const checkout       = c.checkout_url;
  const integracaoRd   = c.integracao_rd_url;
  const campaign       = c.campaign_slug;
  const bonus          = Number(c.bonus_remaining) || 20;
  const horario        = c.horario_aulas || '19h–22h (Brasília)';
  const horarioAtend   = c.horario_atendimento || '9h–18h dias úteis · sábados 9h–13h';
  const ticket         = Number(c.ticket_price) || 1499;
  const waTooltip      = c.whatsapp_tooltip || 'Tira sua dúvida em 2 min';
  const ticketBR       = ticket.toLocaleString('pt-BR');

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

/* ===== Authority Split (Impacta + Olhar Digital) ===== */
.lp-auth-split {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 24px;
  margin: 8px 0 0;
}
.lp-auth-card {
  position: relative;
  background: rgba(247,241,232,0.04);
  border: 1px solid rgba(247,241,232,0.10);
  border-radius: 16px;
  padding: 28px;
  display: flex;
  flex-direction: column;
  gap: 20px;
  transition: border-color .2s, transform .2s;
}
.lp-auth-card:hover { border-color: rgba(217,119,87,0.35); transform: translateY(-2px); }
.lp-auth-card::before {
  content: '';
  position: absolute; top: 0; left: 24px; right: 24px;
  height: 2px; border-radius: 2px;
  background: linear-gradient(90deg, transparent, #D97757 50%, transparent);
  opacity: 0.6;
}
.lp-auth-card--olhar::before { background: linear-gradient(90deg, transparent, #073a1a 30%, #0e6b2e 60%, transparent); }
.lp-auth-card__head { display: flex; flex-direction: column; gap: 4px; }
.lp-auth-card__brand {
  font: 800 13px/1 'JetBrains Mono', ui-monospace, monospace;
  letter-spacing: 0.2em;
  color: #D97757;
}
.lp-auth-card--olhar .lp-auth-card__brand { color: #4ce67c; }
.lp-auth-card__sub {
  font: 700 15px/1.3 'Inter', -apple-system, sans-serif;
  color: rgba(247,241,232,0.85);
  letter-spacing: 0.01em;
  margin-top: 4px;
}
.lp-auth-card--impacta .lp-auth-card__sub { color: #F7F1E8; }
.lp-auth-card--olhar .lp-auth-card__sub  { color: #F7F1E8; }
.lp-auth-card__big {
  display: flex;
  align-items: baseline;
  gap: 14px;
  border-bottom: 1px solid rgba(247,241,232,0.08);
  padding-bottom: 18px;
}
.lp-auth-card__big b {
  font: italic 700 56px/0.95 'Cormorant Garamond', Georgia, serif;
  color: #F7F1E8;
  letter-spacing: -0.02em;
}
.lp-auth-card__big b i { font-style: normal; color: #D97757; font-size: 0.6em; vertical-align: top; padding-left: 2px; }
.lp-auth-card--olhar .lp-auth-card__big b i { color: #4ce67c; }
.lp-auth-card__big span {
  font-size: 13px;
  color: rgba(247,241,232,0.75);
  line-height: 1.4;
  flex: 1;
}
.lp-auth-card__list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.lp-auth-card__list li {
  position: relative;
  padding-left: 24px;
  font-size: 14px;
  line-height: 1.5;
  color: rgba(247,241,232,0.85);
}
.lp-auth-card__list li b { color: #F7F1E8; font-weight: 700; }
.lp-auth-card__list li::before {
  content: '';
  position: absolute;
  left: 0; top: 6px;
  width: 14px; height: 14px;
  border-radius: 50%;
  background: rgba(217,119,87,0.15);
  border: 1.5px solid #D97757;
}
.lp-auth-card--olhar .lp-auth-card__list li::before {
  background: rgba(76,230,124,0.12);
  border-color: #4ce67c;
}
.lp-auth-card__list li::after {
  content: '';
  position: absolute;
  left: 4px; top: 9px;
  width: 5px; height: 8px;
  border-right: 2px solid #D97757;
  border-bottom: 2px solid #D97757;
  transform: rotate(45deg);
}
.lp-auth-card--olhar .lp-auth-card__list li::after {
  border-color: #4ce67c;
}
.lp-auth-card__metrics {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  margin-top: auto;
  padding-top: 16px;
  border-top: 1px solid rgba(247,241,232,0.08);
}
.lp-auth-card--olhar .lp-auth-card__metrics { grid-template-columns: repeat(2, 1fr); }
.lp-auth-card__metrics > div {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.lp-auth-card__metrics b {
  font: 800 22px/1 'Inter', -apple-system, sans-serif;
  color: #F7F1E8;
}
.lp-auth-card__metrics span {
  font-size: 10.5px;
  color: rgba(247,241,232,0.55);
  line-height: 1.3;
  letter-spacing: 0.02em;
}
/* ===== Logos nos cards de autoridade ===== */
.lp-auth-card__logo {
  height: 56px;
  width: auto;
  max-width: 240px;
  object-fit: contain;
  margin-bottom: 12px;
  display: block;
}
.lp-auth-card__logo--inline-svg {
  display: inline-block;
}
.lp-auth-card--olhar .lp-auth-card__logo {
  /* Olhar Digital: logo eh circular (olho verde), reservar espaco compativel */
  height: 64px;
  max-width: 220px;
}

/* ===== Banner topo do hero — bonus dos 20 primeiros (SOLIDO) ===== */
.lp-top-banner {
  position: relative;
  z-index: 8800;
  background: #1a1411;
  border-bottom: 2px solid #D97757;
  color: #F7F1E8;
  padding: 10px 16px;
  text-align: center;
  font: 600 13px/1.4 'Inter', -apple-system, sans-serif;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 14px;
  flex-wrap: wrap;
  box-shadow: 0 2px 8px rgba(0,0,0,0.4);
}
.lp-top-banner b { color: #D97757; font-weight: 800; }
.lp-top-banner__sep { opacity: 0.4; }
.lp-top-banner a {
  color: #0e0b08;
  background: #D97757;
  padding: 6px 12px;
  border-radius: 6px;
  text-decoration: none;
  font-weight: 700;
  font-size: 12px;
  white-space: nowrap;
  transition: transform .15s;
}
.lp-top-banner a:hover { transform: translateY(-1px); }
@media (max-width: 600px) {
  .lp-top-banner { font-size: 11px; padding: 8px 12px; }
  .lp-top-banner__sep { display: none; }
  .lp-top-banner a { padding: 5px 10px; font-size: 11px; }
}

/* ===== cta-form-* rebaixado pra ghost (UX: hierarquia) =====
   Mantém os botões "Falar com especialista" visíveis mas com peso
   menor que os de matrícula — evita CTAs concorrentes (NN/g). */
[data-track="cta-form-pricing"],
[data-track="cta-form-final"] {
  background: transparent !important;
  color: rgba(247,241,232,0.7) !important;
  border: 1px solid rgba(247,241,232,0.25) !important;
  font-weight: 500 !important;
  box-shadow: none !important;
  font-size: 13px !important;
  padding: 10px 16px !important;
}
[data-track="cta-form-pricing"]:hover,
[data-track="cta-form-final"]:hover {
  border-color: rgba(247,241,232,0.5) !important;
  color: #F7F1E8 !important;
  background: rgba(247,241,232,0.04) !important;
}
[data-track="cta-form-pricing"] .arrow,
[data-track="cta-form-final"] .arrow {
  opacity: 0.6;
}

/* ===== Tallos web chat OFF no lançamento =====
   Tallos cria iframes/divs com IDs/classes variados. Match agressivo
   pra cobrir todos. Reabilitar removendo este bloco. */
iframe[src*="tallos"],
iframe[src*="megasac"],
[id^="tallos"],
[id^="megasac"],
[class*="tallos-chat"],
.tallos-chat-widget,
#tallos-widget,
#tallos-chat {
  display: none !important;
  visibility: hidden !important;
}

@media (max-width: 768px) {
  .lp-auth-split { grid-template-columns: 1fr; gap: 16px; }
  .lp-auth-card { padding: 22px; }
  .lp-auth-card__big b { font-size: 44px; }
  .lp-sticky-cta { display: flex; }
}
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

  // ─── Helpers para Pixel CAPI dedup ─────────────────────────────────────
  function uuid(){
    try { if (window.crypto && crypto.randomUUID) return crypto.randomUUID(); } catch(e){}
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c){
      var r = Math.random()*16|0, v = c==='x' ? r : (r&0x3|0x8);
      return v.toString(16);
    });
  }
  function getCookie(name){
    var v = document.cookie.match('(^|;)\\s*' + name + '=([^;]*)');
    return v ? decodeURIComponent(v[2]) : null;
  }
  /**
   * Dispara um evento Pixel client-side + envia para integracao-rd /api/pixel/event
   * com o MESMO event_id, para o Meta deduplicar entre browser e servidor.
   * iOS 14+/Brave/Firefox cortam ~30-50% do tracking client-side; CAPI recupera.
   */
  function fireCAPIEvent(eventName, params, userData){
    params   = params   || {};
    userData = userData || {};
    var eid = uuid();
    // Client-side (Pixel)
    if (window.fbq) {
      try { fbq('track', eventName, params, { eventID: eid }); } catch(e){}
    }
    // Server-side via integracao-rd
    try {
      var body = {
        event_name: eventName,
        event_id:   eid,
        event_source_url: window.location.href,
        fbc:        getCookie('_fbc'),
        fbp:        getCookie('_fbp'),
        value:      params.value,
        currency:   params.currency || 'BRL',
        email:      userData.email || null,
        phone:      userData.phone || null,
        first_name: userData.first_name || null,
        extra:      params.extra || null,
      };
      var blob = new Blob([JSON.stringify(body)], { type: 'application/json' });
      if (navigator.sendBeacon) {
        navigator.sendBeacon(INTEGRACAO_RD_URL + '/api/pixel/event', blob);
      } else {
        fetch(INTEGRACAO_RD_URL + '/api/pixel/event', {
          method: 'POST', headers: {'Content-Type':'application/json'},
          body: JSON.stringify(body), keepalive: true,
        }).catch(function(){});
      }
    } catch(e){ console.warn('[lp-extras] CAPI fire failed', e); }
    return eid;
  }

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
      fireCAPIEvent('InitiateCheckout', { value: TICKET, currency: 'BRL', extra: { placement: 'sticky' } });
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
        var nameVal  = (fd.get('name')  || '').trim();
        var emailVal = (fd.get('email') || '').trim();
        var phoneVal = (fd.get('phone') || '').trim();
        var data = {
          campaign_slug: CAMPAIGN_SLUG,
          name:    nameVal,
          email:   emailVal,
          phone:   phoneVal,
          channel: 'form',                 // origem: form submit "Falar com especialista"
          utm:     utms(),
          source_page: window.location.href,
          extra:   { course: fd.get('course') || '' },
        };
        // Bloqueia o handler nativo do bundle (que tem captureLead mock + fetch
        // pra endpoint que falha, gerando mensagem visual de erro falsa).
        // Nosso sendBeacon JA enviou o Lead — eh seguro impedir o resto.
        e.preventDefault();
        e.stopPropagation();
        // Mostra mensagem de sucesso propria
        try {
          form.querySelectorAll('.lp-form-msg').forEach(function(n){ n.remove(); });
          var ok = document.createElement('div');
          ok.className = 'lp-form-msg ok';
          ok.textContent = '✓ Recebemos seu contato. Em breve um consultor falará com você no horário comercial.';
          form.appendChild(ok);
          setTimeout(function(){ try { form.reset(); } catch(_){} }, 100);
        } catch(_) {}
        // Pixel CAPI: dispara evento Lead com email/phone hashed server-side
        fireCAPIEvent('Lead',
          { value: 0, currency: 'BRL', extra: { content_name: 'Curso Claude Pro' } },
          { email: emailVal, phone: phoneVal, first_name: nameVal }
        );
        // Google Enhanced Conversions for Leads: passa email/phone em TEXTO
        // PURO no evento gtag — o Google Ads tag faz o hash automatico quando
        // Enhanced Conversions estiver habilitado no UI (Tools > Conversions).
        // Sem isso, mesmo a feature ativada no UI nao consegue fazer match.
        if (window.gtag && (emailVal || phoneVal)) {
          try {
            gtag('event', 'qualify_lead_enhanced', {
              currency: 'BRL', value: 1499,
              user_data: {
                email_address: emailVal || undefined,
                phone_number:  phoneVal || undefined,
                address: nameVal ? { first_name: nameVal.split(' ')[0] } : undefined,
              },
            });
            // Marca o user para futuras conversoes da mesma sessao (purchase no Engaged)
            gtag('set', 'user_data', {
              email: emailVal || undefined,
              phone_number: phoneVal || undefined,
            });
          } catch(e){ console.warn('[lp-extras] enhanced gtag failed', e); }
        }
        /* Evento amigavel pro IRIS — separado do qualify_lead_enhanced
           (que carrega PII pra Google Enhanced Conversions). Esse aqui
           eh limpo, soh contagem + UTMs. */
        if (window.gtag) {
          try {
            gtag('event', 'lead_form', {
              campaign_slug: CAMPAIGN_SLUG,
              page_url: window.location.pathname,
              value: TICKET, currency: 'BRL'
            });
          } catch(e){}
        }
        // Defesa em profundidade: dispara TANTO fetch keepalive QUANTO sendBeacon.
        // Ambos sao fire-and-forget. Garante entrega mesmo se um for cancelado
        // por unload/replace do bundle React. fetch keepalive aparece no Network
        // tab e logs do servidor; sendBeacon e' silencioso mas resiliente.
        var fetchOk = false;
        try {
          fetch(INTEGRACAO_RD_URL + '/api/leads', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
            keepalive: true,
            mode: 'cors',
            credentials: 'omit',
          }).then(function(r){
            console.log('[lp-extras] lead via fetch — status', r.status);
          }).catch(function(err){
            console.warn('[lp-extras] fetch fail (sendBeacon ainda pode ter ido):', err.message);
          });
          fetchOk = true;
        } catch(e){ console.warn('[lp-extras] fetch threw', e); }
        var beaconOk = false;
        if (navigator.sendBeacon) {
          try {
            var blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
            beaconOk = navigator.sendBeacon(INTEGRACAO_RD_URL + '/api/leads', blob);
          } catch(e){}
        }
        console.log('[lp-extras] lead disparado (fetch=' + fetchOk + ' beacon=' + beaconOk + ')');
      } catch (err) {
        console.error('[lp-extras] erro ao preparar lead', err);
      }
    }, true);  /* capture phase = roda ANTES do handler do bundle */
  }

  /* ------------------------------------------------------------------
     GA4 — eventos padronizados pra alimentar o IRIS
     ------------------------------------------------------------------
     A LP ja dispara begin_checkout (Pixel + GA4) em alguns CTAs e
     qualify_lead_enhanced no submit do form. Aqui adicionamos os
     nomes amigaveis que o IRIS espera, via delegated listener unico:

       data-track="cta-buy-*"  -> click_compra      (botao Engaged)
       data-track="cta-form-*" -> click_consultor   (Falar com especialista)
       data-track="float-wa"   -> click_whats       (WhatsApp fab)
       href*=wa.me / api.whatsapp -> click_whats

     Idempotente — registra o listener uma so vez.
     (Sem crases nem dollar-brace aqui — esse bloco eh montado dentro
      de um template literal externo e qualquer crase ou interpolacao
      quebra o parser.)
  */
  function setupGA4Events(){
    if (document.__ga4EventsBound) return;
    document.__ga4EventsBound = true;
    document.addEventListener('click', function(e){
      var el = e.target && e.target.closest ? e.target.closest(
        '[data-track^="cta-buy-"], [data-track^="cta-form-"], ' +
        '[data-track="float-wa"], a[href*="wa.me"], a[href*="api.whatsapp.com"]'
      ) : null;
      if (!el) return;
      var track = el.getAttribute('data-track') || '';
      var href  = el.getAttribute('href')       || '';
      var placement = track || 'unknown';
      var eventName = null;
      var params = {
        campaign_slug: CAMPAIGN_SLUG,
        placement: placement,
        page_url: window.location.pathname
      };
      if (track.indexOf('cta-buy-') === 0) {
        /* IMPORTANTE: alguns cta-buy-* sao apenas ancoras internas (href="#algo")
           que rolam pra outra secao — NAO sao intent de compra real.
           So conta como click_compra se o href aponta pra checkout externo
           (engaged.com.br, hotmart, ou qualquer URL absoluta). Ancoras internas
           sao silenciosas — nada de evento, soh navegacao. */
        var isCheckoutLink = !!href && (
          /engaged\.com\.br/.test(href) ||
          /hotmart\.com/.test(href) ||
          /sympla\.com/.test(href) ||
          /^https?:\/\//i.test(href)
        );
        if (!isCheckoutLink) return; /* ancora interna — sem evento */
        eventName = 'click_compra';
        params.value = TICKET;
        params.currency = 'BRL';
      } else if (track.indexOf('cta-form-') === 0) {
        eventName = 'click_consultor';
      } else if (track === 'float-wa' || /wa\.me|api\.whatsapp/.test(href)) {
        eventName = 'click_whats';
      }
      if (eventName && window.gtag) {
        try { gtag('event', eventName, params); } catch(err){}
      }
      if (eventName && window.dataLayer) {
        try { window.dataLayer.push(Object.assign({event: eventName}, params)); } catch(err){}
      }
    }, true); /* capture phase: roda antes de outros handlers */
    /* Page view explicito com produto/campanha — facilita filtro no GA4 */
    if (window.gtag) {
      try {
        gtag('event', 'lp_view', {
          campaign_slug: CAMPAIGN_SLUG,
          page_url: window.location.pathname
        });
      } catch(err){}
    }
  }

  function safe(fn){ try { fn(); } catch(err){ console.warn('[lp-extras]', err); } }
  function suppressBundleErrSink(){
    var d = document.getElementById('__bundler_err');
    if (d) d.style.display = 'none';
  }
  function injectTopBanner(){
    if (document.querySelector('.lp-top-banner')) return;
    try { if (sessionStorage.getItem('lp-top-banner-dismissed') === '1') return; } catch(e){}
    var banner = document.createElement('div');
    banner.className = 'lp-top-banner';
    banner.innerHTML =
      '<span>🎁 <b>Bônus</b> dos primeiros ' + BONUS_REMAINING + ' inscritos: <b>1h extra</b> em grupo com o instrutor</span>' +
      '<span class="lp-top-banner__sep">·</span>' +
      '<a href="' + CHECKOUT_URL + '" data-track="cta-buy-banner">Garantir minha vaga</a>';
    if (document.body.firstChild) {
      document.body.insertBefore(banner, document.body.firstChild);
    } else {
      document.body.appendChild(banner);
    }
    banner.querySelector('a').addEventListener('click', function(){
      fireCAPIEvent('InitiateCheckout', { value: TICKET, currency: 'BRL', extra: { placement: 'banner-topo' } });
      if (window.gtag) { try { gtag('event', 'begin_checkout', { value: TICKET, currency: 'BRL', cta_text: 'banner-topo' }); } catch(e){} }
    });
  }
  function disableTallos(){
    // Esconder e remover qualquer iframe / div do Tallos que apareca.
    // CSS ja faz display:none, mas alguns widgets re-adicionam dinamicamente.
    var sels = [
      'iframe[src*="tallos"]', 'iframe[src*="megasac"]',
      '[id^="tallos"]', '[id^="megasac"]',
      '[class*="tallos-chat"]', '#tallos-chat-widget'
    ];
    sels.forEach(function(s){
      document.querySelectorAll(s).forEach(function(el){ try { el.remove(); } catch(e){ el.style.display='none'; } });
    });
  }
  function applyAll(){
    safe(suppressBundleErrSink);
    safe(injectTopBanner);
    safe(injectStickyCTA);
    safe(injectWaBubble);
    safe(hijackLeadForm);
    safe(disableTallos);
  }
  function start(){
    safe(setupGA4Events);
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

// ─── 3. Selos "Requer Claude Pro" REMOVIDOS dos CTAs ───────────────────────
// Decisao do produto: nao queremos afastar publico no hero/CTAs com bloqueio
// de pre-requisito. A informacao sobre Claude Pro continua no FAQ
// ("Preciso da assinatura Claude Pro?") — quem tiver duvida, encontra la.
function injectProBadges(template) {
  // Apenas REMOVE versoes anteriores (caso ja injetadas em deploys passados)
  var stripRe = /<span[^>]*class="lp-pro-badge"[^>]*data-lp-extras="probadge"[^>]*>[^<]*<\/span>/g;
  return template.replace(stripRe, '');
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

// ─── 3d. Substitui o bloco .auth__nums por 2 cards (Impacta + Olhar Digital) ─
function injectAuthoritySplit(template) {
  var html = ''
    + '<div data-lp-extras="authority-split" class="lp-auth-split">'
      // CARD IMPACTA
      + '<div class="lp-auth-card lp-auth-card--impacta">'
        + '<div class="lp-auth-card__head">'
          + '<img src="/logo-impacta.png" alt="Impacta Tecnologia" class="lp-auth-card__logo">'
          + '<div class="lp-auth-card__sub">Escola de Tecnologia · 35+ anos</div>'
        + '</div>'
        + '<div class="lp-auth-card__big">'
          + '<b>35<i>+</i></b>'
          + '<span>anos formando profissionais de tecnologia no Brasil</span>'
        + '</div>'
        + '<ul class="lp-auth-card__list">'
          + '<li>Maior escola de tecnologia, gestão e design do Brasil</li>'
          + '<li>Metodologia de ensino e certificação exclusivas</li>'
          + '<li>Eleita <b>10×</b> o melhor fornecedor de RH</li>'
        + '</ul>'
        + '<div class="lp-auth-card__metrics">'
          + '<div><b>100%</b><span>professores atuantes no mercado</span></div>'
          + '<div><b>90%</b><span>alunos empregados</span></div>'
          + '<div><b>2M</b><span>alunos formados</span></div>'
        + '</div>'
      + '</div>'
      // CARD OLHAR DIGITAL
      // <img> aponta para /logo-olhar-digital.png — deve estar na raiz do
      // claude-lp (mesmo diretorio do Dockerfile). nginx serve estaticos.
      + '<div class="lp-auth-card lp-auth-card--olhar">'
        + '<div class="lp-auth-card__head">'
          + '<img src="/logo-olhar-digital.webp" alt="Olhar Digital" class="lp-auth-card__logo">'
          + '<div class="lp-auth-card__sub">Mídia &amp; Comunidade Tech · 1M+ leitores</div>'
        + '</div>'
        + '<div class="lp-auth-card__big">'
          + '<b>1M<i>+</i></b>'
          + '<span>leitores mensais — comunidade tech do Brasil</span>'
        + '</div>'
        + '<ul class="lp-auth-card__list">'
          + '<li>Maior portal de tecnologia do Brasil</li>'
          + '<li>Conteúdo de referência do mundo de tecnologia</li>'
          + '<li>Comunidade ativa e engajada com IA, dev e produto</li>'
        + '</ul>'
        + '<div class="lp-auth-card__metrics">'
          + '<div><b>365</b><span>dias por ano cobrindo tech</span></div>'
          + '<div><b>20+</b><span>anos de história editorial</span></div>'
        + '</div>'
      + '</div>'
    + '</div>'
    + '<!-- LP-AUTH-END -->';

  // Idempotente: 3 caminhos
  // 1) Se ja existe nossa versao, substitui pela versao mais nova (atualiza o conteudo)
  // 2) Se ainda existe a div .auth__nums original, substitui por nossa versao
  // 3) Se nenhuma das duas existe, nao faz nada (markup mudou)
  var ourRe  = /<div[^>]*data-lp-extras="authority-split"[\s\S]*?<!-- LP-AUTH-END -->/;
  var authRe = /<div class="auth__nums[^"]*"[^>]*>(?:\s*<div class="auth__num"[^>]*>[\s\S]*?<\/div>){2,8}\s*<\/div>/;

  if (ourRe.test(template)) {
    return template.replace(ourRe, html);
  }
  if (authRe.test(template)) {
    return template.replace(authRe, html);
  }
  return template;
}

// ─── 3c. Adiciona/atualiza perguntas no FAQ ───────────────────────────────
// Cobre: horario_aulas, horario_atendimento (substitui texto antigo de "1 dia
// util"), aulas gravadas, NF para PJ.
function injectFaqExtras(template, horarioAulas, horarioAtendimento) {
  // Strip versoes anteriores (idempotente)
  var stripRe = /<details[^>]*data-lp-extras="faq-(schedule|atendimento|gravadas|nfpj)"[\s\S]*?<\/details>/g;
  var out = template.replace(stripRe, '');

  // Atualiza textos pre-existentes do bundle: troca promessa "1 dia util"
  // por "poucos minutos no horario comercial" ou similar, sem mudar a
  // estrutura do FAQ original.
  out = out.replace(
    /respond[ea]?mos em at[eé]?\s*1\s*dia\s*[uú]til[^<]*/gi,
    'respondemos em poucos minutos no horário comercial'
  );

  var perguntas = [
    {
      id: 'faq-schedule',
      summary: 'Em que horário acontecem as aulas?',
      body: 'As 5 aulas acontecem ao vivo das <strong>' + horarioAulas + '</strong>, em 5 noites consecutivas. ' +
            'Toda aula é gravada e disponibilizada na comunidade para revisão <strong>sem prazo</strong>.',
    },
    {
      id: 'faq-atendimento',
      summary: 'Em quanto tempo vocês respondem?',
      body: 'Respondemos em <strong>poucos minutos no horário comercial</strong> ' +
            '(' + horarioAtendimento + '). ' +
            'Para atendimento mais rápido use o WhatsApp — fora do horário, ' +
            'deixe sua mensagem que retornamos no próximo turno.',
    },
    {
      id: 'faq-gravadas',
      summary: 'E se eu não conseguir assistir ao vivo?',
      body: 'Toda aula é gravada e disponibilizada na comunidade em até 2 horas após o término. ' +
            '<strong>Sem prazo de expiração</strong> — você revisa quantas vezes quiser.',
    },
    {
      id: 'faq-nfpj',
      summary: 'Vocês emitem nota fiscal para empresas (PJ)?',
      body: 'Sim. A nota fiscal é emitida pela <strong>Impacta Tecnologia</strong> ' +
            'após confirmação da matrícula. Para condições corporativas (5+ vagas) ' +
            'fale conosco pelo WhatsApp para tratar desconto e faturamento.',
    },
  ];
  var qaHtml = perguntas.map(function (p) {
    return '<details class="qa" data-lp-extras="' + p.id + '">' +
             '<summary>' + p.summary + '<span class="plus">+</span></summary>' +
             '<div class="qa__body">' + p.body + '</div>' +
           '</details>';
  }).join('');

  // Insere todas no fim do FAQ (antes do </div> final do .faq)
  out = out.replace(
    /(<div class="faq">[\s\S]*?)(<\/details>\s*<\/div>)/,
    function (match, head, tail) {
      // Se ja foi inserido, nao duplica
      if (head.indexOf('data-lp-extras="faq-atendimento"') !== -1) return match;
      return head + '</details>' + qaHtml + tail.replace('</details>', '');
    }
  );
  return out;
}

// alias para compat com chamadas anteriores no process()
function injectFaqSchedule(template, horarioAulas) {
  return injectFaqExtras(template, horarioAulas, '9h–18h dias úteis · sábados 9h–13h');
}

// ─── 3e. Move a section que contem o bloco de autoridade para ANTES da
// section #investimento. Reduz risco percebido antes do preco. ─────────────
function moveAuthoritySection(template) {
  // Acha a section que contem .auth__nums (original) ou data-lp-extras="authority-split"
  // (nossa versao). Captura toda a tag <section>...</section>.
  var sectionRe = /<section[^>]*>(?:(?!<\/section>)[\s\S])*?(?:auth__nums|data-lp-extras="authority-split")(?:(?!<\/section>)[\s\S])*?<\/section>/;
  var m = template.match(sectionRe);
  if (!m) return template;
  var authoritySection = m[0];

  // Acha a section #investimento
  var investRe = /<section[^>]*id="investimento"[^>]*>/;
  var im = template.match(investRe);
  if (!im) return template;

  // Verifica se ja esta na posicao correta (autoridade vem ANTES de investimento
  // E sem outra section entre eles?). Se sim, nao mexe.
  var idxAuth   = template.indexOf(authoritySection);
  var idxInvest = template.indexOf(im[0]);
  if (idxAuth < 0 || idxInvest < 0) return template;

  // Verifica se ja esta IMEDIATAMENTE antes
  var between = template.slice(idxAuth + authoritySection.length, idxInvest);
  if (/^\s*$/.test(between)) return template;  // ja esta no lugar

  // Remove do lugar atual
  var withoutAuth = template.replace(authoritySection, '');
  // Insere antes da section investimento
  return withoutAuth.replace(im[0], authoritySection + im[0]);
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
  template = injectFaqExtras(template, c.horario_aulas, c.horario_atendimento || '9h–18h dias úteis · sábados 9h–13h');
  template = injectAuthoritySplit(template);
  template = moveAuthoritySection(template);

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
