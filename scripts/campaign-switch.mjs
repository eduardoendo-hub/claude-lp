#!/usr/bin/env node
/**
 * campaign-switch.mjs — aplica a troca de turma agendada pra hoje.
 *
 * Rodado pelo .github/workflows/campaign-switch.yml (cron diario 03:05 UTC =
 * 00:05 America/Sao_Paulo).
 *
 * Fluxo:
 *   1. Le campaigns-schedule.json
 *   2. Acha o switch cujo switch_date (America/Sao_Paulo) == hoje
 *   3. Se nao houver, sai sem fazer nada (exit 0)
 *   4. Le tracking-config.json pra pegar os valores ATUAIS da turma vigente
 *   5. Substitui em: tracking-config.json, index.html, inject-body-seo.js
 *   6. Remove o switch do schedule (pra nao re-executar)
 *   7. Commita + pusha
 *
 * Idempotente: se rodar 2x no mesmo dia, o segundo run nao acha switch
 * pra hoje (porque ja foi removido do JSON) e sai limpo.
 *
 * Teste local: `node scripts/campaign-switch.mjs --dry-run` (sem commit/push).
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DRY = process.argv.includes('--dry-run');

const ROOT        = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCHED_PATH  = path.join(ROOT, 'campaigns-schedule.json');
const CONFIG_PATH = path.join(ROOT, 'tracking-config.json');
const HTML_PATH   = path.join(ROOT, 'index.html');
const SEO_PATH    = path.join(ROOT, 'inject-body-seo.js');

function todayBRT() {
  // sv-SE já formata YYYY-MM-DD, no fuso que a gente pedir
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function dateBr(iso) {
  // '2026-12-14' -> '14/12/2026'
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

const sched = JSON.parse(readFileSync(SCHED_PATH, 'utf8'));
const today = todayBRT();
const idx   = sched.switches.findIndex((s) => s.switch_date === today);

if (idx === -1) {
  console.log(`[campaign-switch] sem switch pra hoje (${today}). nada a fazer.`);
  process.exit(0);
}

const next = sched.switches[idx];
console.log(`[campaign-switch] aplicando switch: ${next.label} (${next.switch_date})`);

const cfg = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
const curSharedid = (cfg.checkout_url || '').split('/').pop();
const curTurmaId  = cfg.turma_id;
const curSlug     = cfg.campaign_slug;
const curStartIso = (cfg.seo?.course?.start_date || '').slice(0, 10);
const curEndIso   = (cfg.seo?.course?.end_date   || '').slice(0, 10);

if (!curSharedid || !curTurmaId || !curSlug || !curStartIso || !curEndIso) {
  console.error('[campaign-switch] não consegui extrair valores atuais do tracking-config.json');
  console.error({ curSharedid, curTurmaId, curSlug, curStartIso, curEndIso });
  process.exit(1);
}

const curStartBr = dateBr(curStartIso);
const newStartBr = dateBr(next.start_date);

// Par (old, new). Ordem importa: slug ANTES do que puder colidir.
// (claude-pro-* é único, mas por segurança deixamos o slug cedo.)
const pairs = [
  [curSharedid, next.checkout_sharedid],
  [curSlug,     next.campaign_slug],
  [curStartIso, next.start_date],
  [curEndIso,   next.end_date],
  [curStartBr,  newStartBr],
  [curTurmaId,  next.turma_id],
];

console.log('substituições:');
for (const [from, to] of pairs) console.log(`  '${from}' -> '${to}'`);

function applyReplacements(filePath, repl) {
  let content = readFileSync(filePath, 'utf8');
  let total = 0;
  for (const [from, to] of repl) {
    if (!from || from === to) continue;
    const parts = content.split(from);
    if (parts.length > 1) {
      content = parts.join(to);
      total += parts.length - 1;
    }
  }
  if (!DRY) writeFileSync(filePath, content);
  console.log(`  ${path.relative(ROOT, filePath)}: ${total} ocorrências`);
}

applyReplacements(CONFIG_PATH, pairs);
applyReplacements(HTML_PATH,   pairs);
applyReplacements(SEO_PATH,    pairs);

// Remove switch do schedule
sched.switches.splice(idx, 1);
if (!DRY) writeFileSync(SCHED_PATH, JSON.stringify(sched, null, 2) + '\n');
console.log(`[campaign-switch] switch removido do schedule (${sched.switches.length} restantes).`);

if (DRY) {
  console.log('[campaign-switch] --dry-run, sem commit/push.');
  process.exit(0);
}

// Git commit + push
const run = (cmd) => execSync(cmd, { cwd: ROOT, stdio: 'inherit' });
try {
  run('git config user.name "github-actions[bot]"');
  run('git config user.email "41898282+github-actions[bot]@users.noreply.github.com"');
  run('git add campaigns-schedule.json tracking-config.json index.html inject-body-seo.js');
  const msg =
    `chore(lp): auto-switch para ${next.label}\n\n` +
    `Aplicado via .github/workflows/campaign-switch.yml em ${today}.\n` +
    `Switch removido do campaigns-schedule.json.\n\n` +
    `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>`;
  // Escapa aspas e quebras de linha pro shell
  const escaped = msg.replace(/'/g, `'\\''`);
  run(`git commit -m '${escaped}'`);
  run('git push origin HEAD:main');
  console.log(`[campaign-switch] push feito.`);
} catch (err) {
  console.error('[campaign-switch] erro no commit/push:', err.message);
  process.exit(1);
}
