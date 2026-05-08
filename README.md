# Curso Claude — Landing Page

LP do curso "Formação Claude Pro: Do Cowork ao Code · Impacta × Olhar Digital".
Servida em **claude.technowhub.ai** via Coolify (Docker + nginx alpine).

## Workflow de atualização

A LP é gerada como **artifact do Claude** (HTML bundlado). Cada vez que você re-exporta, o `index.html` precisa ser pós-processado para incluir tracking (GA4, Meta Pixel, click events, UTMs).

```bash
# 1. Substituir index.html pelo novo export do Claude
cp ~/Downloads/index.html ./index.html

# 2. Injetar tracking (idempotente)
node inject-tracking.js

# 3. Commit + push
git add index.html
git commit -m "content: atualiza LP"
git push origin main

# 4. Coolify redeploya automaticamente (se webhook ligado)
```

## Tracking configurado

### Stack
- **GA4** direto via `gtag.js` — ID em `tracking-config.json`
- **Meta Pixel** — ID em `tracking-config.json` (preencher quando tiver)
- **Google Ads** — abordagem recomendada: importar conversões do GA4 (sem tag extra na LP)

### Eventos disparados

Capturados via event delegation. Cada evento vai para `dataLayer` + `gtag('event')` + `fbq('track')`:

| Evento (GA4)             | Trigger                                                  | Meta Pixel              |
|--------------------------|----------------------------------------------------------|-------------------------|
| `click_matricular`       | Click em CTAs `.btn--primary`, `.btn--white`, `.bar__cta` (textos "matricular", "garantir vaga") | `InitiateCheckout`      |
| `click_consultor`        | Click em `.btn--ghost` ("Falar com um consultor")        | `Lead` (`consultor_open`) |
| `form_submit_consultor`  | Submit do form modal `.modal__submit`                    | `Lead` (`consultor_form_submit`) |
| `page_view` (auto)       | gtag.js `config`                                          | `PageView`              |

### UTMs

Captura automática de `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, `gclid`, `fbclid` da URL. Persistidos em `localStorage` (sobrevivem a refresh / navegação interna) e anexados a todos os eventos como parâmetros.

### Configuração no GA4

1. Acesse [analytics.google.com](https://analytics.google.com) → Admin → Eventos
2. Marque `click_matricular`, `click_consultor`, `form_submit_consultor` como **conversões**
3. Em Dimensões personalizadas, registre `utm_source`, `utm_medium`, `utm_campaign`, `cta_text`, `gclid`, `fbclid`
4. Para Google Ads: vincule a property GA4 → Google Ads e importe as conversões

### Configuração no Meta Pixel

Quando tiver o ID do Pixel:
1. Edite `tracking-config.json` — preencha `meta_pixel_id`
2. Rode `node inject-tracking.js`
3. Commit + push
4. Em [business.facebook.com](https://business.facebook.com/events_manager) configure `Lead` e `InitiateCheckout` como conversões customizadas

## Estrutura

```
.
├── index.html              # LP bundle (artifact Claude + tracking injetado)
├── Dockerfile              # nginx:alpine
├── nginx.conf              # try_files + gzip
├── tracking-config.json    # IDs (GA4, Pixel, Google Ads)
├── inject-tracking.js      # script de injeção (idempotente)
└── README.md
```

## Build local (opcional)

```bash
docker build -t claude-lp .
docker run -p 8080:80 claude-lp
# abra http://localhost:8080
```
