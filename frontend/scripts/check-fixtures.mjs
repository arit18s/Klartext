// Checks src/fixtures against the API contract (docs/API_CONTRACT.md, src/lib/types.ts).
// Run: npm run check:fixtures. Exits 1 on the first list of problems.
// The verdict itself is not re-derived here: that is lib/decide.ts with decision_cases.json (step F5).
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'fixtures')
const load = (name) => JSON.parse(readFileSync(path.join(dir, name), 'utf-8'))
const problems = []
const fail = (where, msg) => problems.push(`${where}: ${msg}`)

const VERDICTS = ['alarm', 'review', 'no_alert']
const FAMILIES = ['trade', 'splitting', 'access', 'disclosure', 'documentation']
const EVENTS = ['present', 'absent', 'undetermined', 'not_applicable', 'failed']
const STATUSES = ['queued', 'transcribing', 'checking', 'done', 'failed', 'waiting_for_asr']
const ROLES = ['advisor', 'customer', 'unknown']
const EVIDENCE_ROLES = ['context', 'trigger', 'exclusion']
// Keyword → family, from families[*].keywords in Stichwortliste.json (example-0.2). K09 is the numbers helper.
const KEYWORD_FAMILY = { K01: 'trade', K02: 'trade', K03: 'trade', K04: 'trade', K05: 'trade', K06: 'documentation',
  K07: 'splitting', K08: 'splitting', K09: 'numbers', K10: 'access', K11: 'disclosure' }
const ID = /^(Stufe[123]_[CD]\d{2})-K([1-4])$/

function keys(where, obj, required) {
  if (obj === null || typeof obj !== 'object') return fail(where, 'not an object')
  for (const k of required) if (!(k in obj)) fail(where, `missing key "${k}"`)
  for (const k of Object.keys(obj)) if (!required.includes(k)) fail(where, `unexpected key "${k}"`)
}
const oneOf = (where, value, allowed, nullable = false) => {
  if (nullable && value === null) return
  if (!allowed.includes(value)) fail(where, `"${value}" not in ${allowed.join('|')}`)
}
const isoTime = (where, v, nullable = false) => {
  if (nullable && v === null) return
  if (typeof v !== 'string' || Number.isNaN(Date.parse(v)) || !v.endsWith('Z')) fail(where, `not an ISO UTC time: ${v}`)
}

const SUMMARY_KEYS = ['call_id', 'file_name', 'dialogue_id', 'variant', 'level', 'duration_s', 'advisor_name', 'status',
  'error', 'created_at', 'processed_at', 'verdict', 'family', 'score', 'reason', 'open_question', 'feedback_label',
  'trigger_sent', 'expected_verdict']

function checkSummary(where, c) {
  keys(where, c, SUMMARY_KEYS)
  const m = ID.exec(c.call_id)
  if (m) {
    if (c.dialogue_id !== m[1]) fail(where, `dialogue_id ${c.dialogue_id} does not match ${c.call_id}`)
    const variant = ['1', '3'].includes(m[2]) ? 'clean' : 'noisy'
    if (c.variant !== variant) fail(where, `variant ${c.variant}, expected ${variant} for K${m[2]}`)
    if (c.level !== Number(c.call_id[5])) fail(where, `level ${c.level} does not match ${c.call_id}`)
  } else if (c.dialogue_id !== null || c.variant !== null || c.level !== null) {
    fail(where, 'unknown file name must have null dialogue_id, variant and level')
  }
  if (c.file_name !== `${c.call_id}.wav`) fail(where, `file_name ${c.file_name}`)
  oneOf(`${where}.status`, c.status, STATUSES)
  oneOf(`${where}.verdict`, c.verdict, VERDICTS, true)
  oneOf(`${where}.expected_verdict`, c.expected_verdict, VERDICTS, true)
  oneOf(`${where}.family`, c.family, FAMILIES, true)
  isoTime(`${where}.created_at`, c.created_at)
  isoTime(`${where}.processed_at`, c.processed_at, true)
  if (c.verdict === 'review' && !c.open_question) fail(where, 'review without open_question')
}

// ---- calls.json ----
const list = load('calls.json')
keys('calls.json', list, ['items', 'counts'])
keys('calls.json.counts', list.counts, ['total', 'done', 'flagged', 'alarm', 'review', 'no_alert', 'checked_today'])
list.items.forEach((c, i) => checkSummary(`calls.json.items[${i}]`, c))
const count = (v) => list.items.filter((c) => c.verdict === v).length
for (const v of VERDICTS) if (list.counts[v] !== count(v)) fail('calls.json.counts', `${v} is ${list.counts[v]}, list has ${count(v)}`)
if (list.counts.flagged !== count('alarm') + count('review')) fail('calls.json.counts', 'flagged != alarm + review')
if (list.counts.total !== list.items.length) fail('calls.json.counts', 'total != items')

// ---- call_detail_<id>.json ----
const detailFiles = readdirSync(dir).filter((f) => f.startsWith('call_detail_'))
for (const item of list.items) {
  if (!detailFiles.includes(`call_detail_${item.call_id}.json`)) fail('fixtures', `no detail file for ${item.call_id}`)
}
const details = {}
for (const file of detailFiles) {
  const d = load(file)
  const w = file
  details[d.call.call_id] = d
  keys(w, d, ['call', 'decision', 'checks', 'evidence', 'keyword_hits', 'segments', 'twin', 'feedback', 'triggers'])
  checkSummary(`${w}.call`, d.call)
  if (file !== `call_detail_${d.call.call_id}.json`) fail(w, 'file name does not match call_id')
  const row = list.items.find((c) => c.call_id === d.call.call_id)
  if (!row) fail(w, 'call missing from calls.json')
  else if (JSON.stringify(row) !== JSON.stringify(d.call)) fail(w, 'call differs from its calls.json row')

  // segments
  const segIds = new Map()
  let prevStart = -1
  d.segments.forEach((s, i) => {
    keys(`${w}.segments[${i}]`, s, ['seg_id', 'start_s', 'end_s', 'role', 'text', 'low_confidence'])
    oneOf(`${w}.segments[${i}].role`, s.role, ROLES, true)
    if (s.start_s <= prevStart || s.end_s <= s.start_s) fail(`${w}.segments[${i}]`, 'times not increasing')
    if (s.end_s > d.call.duration_s) fail(`${w}.segments[${i}]`, 'ends after the call')
    prevStart = s.start_s
    segIds.set(s.seg_id, s)
  })
  const inSeg = (where, segId, start, end) => {
    const s = segIds.get(segId)
    if (!s) return fail(where, `seg_id ${segId} does not exist`)
    if (start < s.start_s || end > s.end_s + 0.01) fail(where, `${start}–${end} outside ${segId} ${s.start_s}–${s.end_s}`)
    return s
  }

  // decision
  const dec = d.decision
  keys(`${w}.decision`, dec, ['verdict', 'family', 'score', 'reason', 'reason_de', 'open_question', 'asr_uncertain',
    'thresholds_version_id', 'decided_at'])
  for (const k of ['verdict', 'family', 'score', 'reason', 'open_question']) {
    if (dec[k] !== d.call[k]) fail(`${w}.decision.${k}`, 'differs from call summary')
  }
  isoTime(`${w}.decision.decided_at`, dec.decided_at)

  // checks: one per verdict family, in fixed order
  if (JSON.stringify(d.checks.map((c) => c.family)) !== JSON.stringify(FAMILIES)) fail(`${w}.checks`, 'families missing or out of order')
  d.checks.forEach((c, i) => {
    const cw = `${w}.checks[${i}]`
    keys(cw, c, ['family', 'score', 'event_majority', 'agreement', 'samples', 'needs_human_votes', 'open_question',
      'reason', 'reason_de', 'benign_explanation'])
    oneOf(`${cw}.event_majority`, c.event_majority, EVENTS)
    if (c.event_majority === 'failed' ? c.score !== null : !(c.score >= 0 && c.score <= 100)) fail(cw, `score ${c.score}`)
    if (c.agreement !== null && !(c.agreement > 0 && c.agreement <= 1)) fail(cw, `agreement ${c.agreement}`)
    if (c.event_majority === 'undetermined' && !c.open_question) fail(cw, 'undetermined without open_question')
  })
  const best = d.checks.filter((c) => c.score !== null).reduce((a, b) => (b.score > a.score ? b : a))
  if (dec.score !== best.score || dec.family !== best.family) fail(`${w}.decision`, `score/family must be the max family (${best.family} ${best.score})`)

  // evidence
  let prev = -1
  d.evidence.forEach((e, i) => {
    const ew = `${w}.evidence[${i}]`
    keys(ew, e, ['id', 'family', 'seg_id', 'role', 'start_s', 'end_s', 'speaker_role', 'quote', 'note', 'snippet_url'])
    oneOf(`${ew}.role`, e.role, EVIDENCE_ROLES)
    if (e.family !== dec.family) fail(ew, 'evidence must belong to the decided family')
    const s = inSeg(ew, e.seg_id, e.start_s, e.end_s)
    if (s && !s.text.includes(e.quote)) fail(ew, 'quote is not in its segment text')
    if (s && e.speaker_role !== s.role) fail(ew, 'speaker_role differs from segment role')
    if (e.start_s < prev) fail(ew, 'not sorted by start_s')
    prev = e.start_s
    if (e.snippet_url !== `/api/calls/${d.call.call_id}/snippets/${e.seg_id}`) fail(ew, `snippet_url ${e.snippet_url}`)
  })
  if (dec.verdict !== 'no_alert' && !d.evidence.some((e) => e.role === 'trigger')) fail(w, 'flagged call without trigger evidence')

  // keyword hits
  d.keyword_hits.forEach((k, i) => {
    keys(`${w}.keyword_hits[${i}]`, k, ['keyword_id', 'family', 'phrase', 'seg_id', 'start_s', 'end_s', 'label'])
    oneOf(`${w}.keyword_hits[${i}].family`, k.family, FAMILIES)
    if (KEYWORD_FAMILY[k.keyword_id] !== k.family) fail(`${w}.keyword_hits[${i}]`, `${k.keyword_id} belongs to ${KEYWORD_FAMILY[k.keyword_id]}`)
    const seg = segIds.get(k.seg_id)
    if (seg && !seg.text.toLowerCase().includes(k.phrase.toLowerCase())) fail(`${w}.keyword_hits[${i}]`, `phrase "${k.phrase}" not in ${k.seg_id}`)
    oneOf(`${w}.keyword_hits[${i}].label`, k.label, ['relevant', 'benign'], true)
    inSeg(`${w}.keyword_hits[${i}]`, k.seg_id, k.start_s, k.end_s)
  })

  // twin
  if (d.twin) {
    keys(`${w}.twin`, d.twin, ['call_id', 'dialogue_id', 'variant', 'verdict', 'note'])
    const other = list.items.find((c) => c.call_id === d.twin.call_id)
    if (!other) fail(`${w}.twin`, `${d.twin.call_id} not in calls.json`)
    else {
      if (other.verdict !== d.twin.verdict) fail(`${w}.twin`, 'verdict differs from the twin call')
      if (other.verdict === dec.verdict) fail(`${w}.twin`, 'twin must have a different verdict')
    }
  }

  // triggers: only for alarm/review, deep link t = trigger start − 10 s
  if (d.triggers.length && dec.verdict === 'no_alert') fail(w, 'no_alert call has triggers')
  if (d.call.trigger_sent !== d.triggers.some((t) => t.status_code >= 200 && t.status_code < 300)) fail(w, 'trigger_sent mismatch')
  const trig = d.evidence.find((e) => e.role === 'trigger')
  d.triggers.forEach((t, i) => {
    keys(`${w}.triggers[${i}]`, t, ['id', 'call_id', 'remote_id', 'url', 'status_code', 'created_at'])
    const tParam = Math.max(0, Math.floor(trig.start_s - 10))
    if (!t.url.endsWith(`/calls/${d.call.call_id}?t=${tParam}`)) fail(`${w}.triggers[${i}]`, `url should end with ?t=${tParam}`)
  })
}

// ---- scores.json ----
const scores = load('scores.json')
keys('scores.json', scores, ['thresholds', 'samples_per_check', 'enabled_families', 'calls'])
keys('scores.json.thresholds', scores.thresholds, ['review', 'alarm', 'version_id', 'note', 'created_at'])
if (!(scores.thresholds.review <= scores.thresholds.alarm)) fail('scores.json.thresholds', 'review > alarm')
for (const c of scores.calls) {
  const w = `scores.json[${c.call_id}]`
  keys(w, c, ['call_id', 'dialogue_id', 'variant', 'level', 'verdict', 'asr_uncertain', 'expected_verdict', 'families'])
  const d = details[c.call_id]
  if (!d) { fail(w, 'no detail file'); continue }
  if (c.verdict !== d.decision.verdict || c.asr_uncertain !== d.decision.asr_uncertain) fail(w, 'differs from decision')
  if (c.expected_verdict !== d.call.expected_verdict) fail(w, 'expected_verdict differs')
  for (const f of c.families) {
    keys(`${w}.${f.family}`, f, ['family', 'score', 'needs_human_votes', 'failed'])
    const chk = d.checks.find((x) => x.family === f.family)
    if (!chk || chk.score !== f.score || chk.needs_human_votes !== f.needs_human_votes) fail(`${w}.${f.family}`, 'differs from checks')
  }
}
if (scores.calls.length !== list.items.length) fail('scores.json', 'call count differs from calls.json')

// ---- families.json, keywords.json ----
const FAMILY_KEYS = [...FAMILIES, 'numbers']
const kwc = load('keywords.json')
keys('keywords.json', kwc, ['version_id', 'note', 'created_at', 'keywords'])
const kl = kwc.keywords
keys('keywords.json.keywords', kl, ['version', 'status', 'official_source', 'families', 'keywords', 'alarm_scope', 'policy_examples', 'corpus_binding'])
const owner = new Map()
for (const f of FAMILY_KEYS) {
  if (!kl.families[f]) fail('keywords.json.families', `missing ${f}`)
  for (const id of kl.families[f]?.keywords ?? []) {
    if (owner.has(id)) fail('keywords.json.families', `${id} in ${owner.get(id)} and ${f}`)
    owner.set(id, f)
  }
}
kl.keywords.forEach((k, i) => {
  for (const req of ['id', 'label', 'de', 'gsw', 'enabled', 'status', 'match_unit', 'partial_words_count_as_full_hit']) {
    if (!(req in k)) fail(`keywords.json.keywords[${i}]`, `missing "${req}"`)
  }
  if (!owner.has(k.id)) fail(`keywords.json.keywords[${i}]`, `${k.id} belongs to no family`)
  if (KEYWORD_FAMILY[k.id] && KEYWORD_FAMILY[k.id] !== owner.get(k.id)) fail(`keywords.json.keywords[${i}]`, `${k.id} family differs from the hits map`)
})
const fam = load('families.json')
keys('families.json', fam, ['version_id', 'note', 'created_at', 'families'])
if (JSON.stringify(Object.keys(fam.families).sort()) !== JSON.stringify([...FAMILY_KEYS].sort())) fail('families.json', 'families must be the five verdict families plus numbers')
for (const [f, cfg] of Object.entries(fam.families)) {
  keys(`families.json.${f}`, cfg, ['enabled', 'helper', 'label_de', 'task', 'keyword_ids', 'rule', 'harmless', 'changed_at', 'changed_by'])
  if (cfg.helper !== (f === 'numbers')) fail(`families.json.${f}`, 'helper flag')
  if (JSON.stringify(cfg.keyword_ids) !== JSON.stringify(kl.families[f]?.keywords)) fail(`families.json.${f}`, 'keyword_ids differ from keywords.json')
  if (cfg.rule !== kl.policy_examples[f]) fail(`families.json.${f}`, 'rule differs from policy_examples (seed)')
}
for (const f of scores.enabled_families) if (!fam.families[f]?.enabled) fail('scores.json', `${f} enabled in scores but not in families.json`)

// ---- eval.json ----
const ev = load('eval.json')
keys('eval.json', ev, ['run_id', 'split', 'source', 'created_at', 'config_versions', 'metrics'])
const m = ev.metrics
keys('eval.json.metrics', m, ['n_calls', 'binary', 'exact', 'confusion', 'breakdown', 'stufe2_pairs', 'stufe3_review', 'clean_noisy_agreement',
  'evidence_overlap', 'family_accuracy', 'pr_curve', 'keyword_baseline', 'mismatches'])
if (JSON.stringify(m.confusion.labels) !== JSON.stringify(VERDICTS)) fail('eval.json.confusion', 'labels order')
const cm = VERDICTS.map((e) => VERDICTS.map((g) => list.items.filter((c) => c.expected_verdict === e && c.verdict === g).length))
if (JSON.stringify(cm) !== JSON.stringify(m.confusion.matrix)) fail('eval.json.confusion', `matrix ${JSON.stringify(m.confusion.matrix)} != fixtures ${JSON.stringify(cm)}`)
if (m.n_calls !== list.items.length) fail('eval.json', 'n_calls')
const b = m.binary
if (b.tp + b.fp + b.fn + b.tn !== m.n_calls) fail('eval.json.binary', 'tp+fp+fn+tn != n_calls')
if (m.pr_curve.length !== 101 || m.pr_curve.some((p, i) => p.t_review !== i)) fail('eval.json.pr_curve', 'one point per t_review 0..100')
for (const x of m.mismatches) if (!list.items.some((c) => c.call_id === x.call_id)) fail('eval.json.mismatches', `${x.call_id} unknown`)

// ---- settings.json ----
const st = load('settings.json')
keys('settings.json', st, ['llm_model', 'llm_base_url', 'asr_model', 'trigger_api_url', 'trigger_api_enabled', 'config_versions'])
keys('settings.json.config_versions', st.config_versions, ['keywords', 'families', 'thresholds', 'model'])
if (JSON.stringify(st).match(/key|secret|token/i) && /sk-|or-v1/.test(JSON.stringify(st))) fail('settings.json', 'looks like it contains a key')
if (st.config_versions.thresholds !== scores.thresholds.version_id) fail('settings.json', 'thresholds version differs from scores.json')

if (problems.length) {
  console.error(`Fixture check failed (${problems.length}):\n  ` + problems.join('\n  '))
  process.exit(1)
}
console.log(`Fixtures OK: ${list.items.length} calls, ${detailFiles.length} detail files, scores for ${scores.calls.length} calls.`)
for (const c of list.items) console.log(`  ${c.call_id.padEnd(15)} ${c.verdict.padEnd(9)} ${String(c.family).padEnd(7)} score ${c.score}`)
