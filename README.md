# Curso Claude — Landing Page

LP do curso "Formação Claude Pro: Do Cowork ao Code · Impacta × Olhar Digital".
Servida em **claude.technowhub.ai** via Coolify (Docker + nginx alpine).

## Workflow de atualização

A LP é gerada como **artifact do Claude** (HTML bundlado). Cada vez que você re-exporta, o `index.html` precisa ser pós-processado para incluir tracking (GA4, Meta Pixel, click events, UTMs) e os extras da campanha (selo Claude Pro, sticky CTA, hijack form para `integracao-rd`, WhatsApp tooltip).

```bash
# 1. Substituir index.html pelo novo export do Claude
cp ~/Downloads/index.html ./index.html

# 2. Injetar tracking (idempotente) — GA4 + Meta Pixel + click events + UTMs
node inject-tracking.js

# 3. Injetar extras da campanha (idempotente) — selo Pro, sticky, form hijack, WhatsApp tooltip
node inject-extras.js

# 4. Commit + push
git add index.html
git commit -m "content: atualiza LP"
git push origin main

# 5. Coolify redeploya automaticamente (se webhook ligado)
```

> **Sempre rodar `inject-tracking.js` ANTES de `inject-extras.js`** — os scripts manipulam o mesmo template embutido, em locais diferentes. A ordem garante que o JS de tracking esteja disponível quando os extras forem renderizados.

## Tracking configurado

### Stack
- **GA4** direto via `gtag.js` — ID em `tracking-config.json`
- **Meta Pixel** — ID em `tracking-config.json` (preencher quando tiver)
- **Google Ads** — abordagem recomendada: importar conversões do GA4 (sem tag extra na LP)

### Eventos disparados

Eventos seguem o template **"Gerar leads online"** do GA4. Cada evento vai para `dataLayer` + `gtag('event')` + `fbq('track')`:

| Evento (GA4)         | Trigger                                                  | Meta Pixel               | Estágio funil           |
|----------------------|----------------------------------------------------------|--------------------------|-------------------------|
| `begin_checkout`     | Click em CTAs `.btn--primary`, `.btn--white`, `.bar__cta` (textos "matricular", "garantir vaga") | `InitiateCheckout` (BRL 1699) | Intenção de compra      |
| `generate_lead`      | Click em `.btn--ghost` ("Falar com um consultor")        | `Lead` (consultor_open)  | Interesse               |
| `qualify_lead` ⭐    | Submit do form modal `.modal__submit`                    | `Lead` (form_submit)     | Lead qualificado        |
| `page_view` (auto)   | gtag.js `config`                                         | `PageView`               | Visita                  |
| `close_convert_lead` ⭐ | (offline/CRM — disparado quando vendedor fecha venda)  | (offline)                | Conversão fechada       |
| `purchase`           | (na página de obrigado do checkout final, fora desta LP) | `Purchase`               | Pagamento concluído     |

### UTMs

Captura automática de `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, `gclid`, `fbclid` da URL. Persistidos em `localStorage` (sobrevivem a refresh / navegação interna) e anexados a todos os eventos como parâmetros.

### Configuração no GA4

1. Acesse [analytics.google.com](https://analytics.google.com) → Admin → Eventos
2. Marque `generate_lead` e `begin_checkout` como **conversões** (a estrela ⭐). `qualify_lead` e `close_convert_lead` já vêm marcados pelo template.
3. Em Dimensões personalizadas, registre `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, `cta_text`, `gclid`, `fbclid`
4. Para Google Ads: vincule a property GA4 → Google Ads e importe as conversões `begin_checkout` e `qualify_lead`

### Configuração no Meta Pixel

Quando tiver o ID do Pixel:
1. Edite `tracking-config.json` — preencha `meta_pixel_id`
2. Rode `node inject-tracking.js`
3. Commit + push
4. Em [business.facebook.com](https://business.facebook.com/events_manager) configure `Lead` e `InitiateCheckout` como conversões customizadas

## Extras da campanha Claude Pro Maio/2026

`inject-extras.js` adiciona ao `index.html`:

1. **Substitui `href="#"` dos botões `cta-buy-pricing` e `cta-buy-final` pela `checkout_url`** do `tracking-config.json`. Os botões de scroll (`cta-buy-hero`, `cta-buy-format`) ficam intactos.
2. **Selo `⚠ Requer Claude Pro (US$ 20/mês)`** antes de cada um dos 4 botões `cta-buy-*`.
3. **Bloco `<!-- LP-EXTRAS:START -->...<!-- LP-EXTRAS:END -->`** antes de `</head>` com:
   - **Sticky CTA mobile** (aparece após 4s, dismissível, persiste em `sessionStorage`) com bônus 20 primeiros + horário 19h–20h + checkout direto.
   - **Bubble do WhatsApp** ("👋 Tira sua dúvida em 2 min") sobre o fab existente, após 6s.
   - **Hijack do submit do form `#leadForm`** → POST para `integracao-rd /api/leads` (cria Lead+Deal no RD CRM no funil "Curso Claude Pro" e encaminha evento ao IRIS via webhook). Mensagem visual ✓/✗ aparece no próprio form.
   - **Notify de clique no WhatsApp** para o `integracao-rd /api/leads/whatsapp-click` (alimenta o IRIS).

Configuração no `tracking-config.json`:

| Campo | Default | Descrição |
|---|---|---|
| `checkout_url`      | `https://impacta.com.br/checkout/curso-claude-pro` | URL real do checkout (Marketing/Vendas) |
| `integracao_rd_url` | `https://rd.impacta.com.br` | URL pública do microsserviço integracao-rd |
| `campaign_slug`     | `claude-pro-maio-2026` | Slug enviado a integracao-rd para resolver funnel_id/deal_stage_id |
| `bonus_remaining`   | `20` | Atualize conforme matrículas avançam |
| `horario_aulas`     | `19h–20h (Brasília)` | Mostrado no sticky bar |
| `ticket_price`      | `1699` | Mostrado no sticky bar e nos eventos de InitiateCheckout |
| `whatsapp_tooltip`  | `Tira sua dúvida em 2 min` | Texto da bubble sobre o fab WhatsApp |

## Estrutura

```
.
├── index.html              # LP bundle (artifact Claude + tracking + extras injetados)
├── Dockerfile              # nginx:alpine
├── nginx.conf              # try_files + gzip
├── tracking-config.json    # IDs (GA4, Pixel, Google Ads) + extras (checkout, integracao-rd, etc.)
├── inject-tracking.js      # script de injeção tracking (idempotente)
├── inject-extras.js        # script de injeção extras da campanha (idempotente)
└── README.md
```

## Build local (opcional)

```bash
docker build -t claude-lp .
docker run -p 8080:80 claude-lp
# abra http://localhost:8080
```
