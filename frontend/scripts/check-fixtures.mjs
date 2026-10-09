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
const NUMBER_KINDS = ['login_code', 'account_number', 'amount', 'date', 'phone_number', 'reference', 'unknown']
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
  keys(w, d, ['call', 'decision', 'checks', 'numbers', 'evidence', 'keyword_hits', 'segments', 'twin', 'feedback', 'triggers'])
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
      'reason', 'reason_de', 'benign_explanation', 'uncertainty_note'])
    oneOf(`${cw}.event_majority`, c.event_majority, EVENTS)
    if (c.event_majority === 'failed' ? c.score !== null : !(c.score >= 0 && c.score <= 100)) fail(cw, `score ${c.score}`)
    if (c.agreement !== null && !(c.agreement > 0 && c.agreement <= 1)) fail(cw, `agreement ${c.agreement}`)
    if (c.event_majority === 'undetermined' && !c.open_question) fail(cw, 'undetermined without open_question')
  })
  const best = d.checks.filter((c) => c.score !== null).reduce((a, b) => (b.score > a.score ? b : a))
  if (dec.score !== best.score || dec.family !== best.family) fail(`${w}.decision`, `score/family must be the max family (${best.family} ${best.score})`)

  // numbers helper
  if (d.numbers) {
    keys(`${w}.numbers`, d.numbers, ['objects', 'agreement', 'samples'])
    d.numbers.objects.forEach((n, i) => {
      keys(`${w}.numbers.objects[${i}]`, n, ['seg_id', 'start_s', 'end_s', 'digits', 'kind', 'label'])
      oneOf(`${w}.numbers.objects[${i}].kind`, n.kind, NUMBER_KINDS)
      inSeg(`${w}.numbers.objects[${i}]`, n.seg_id, n.start_s, n.end_s)
    })
  }

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

if (problems.length) {
  console.error(`Fixture check failed (${problems.length}):\n  ` + problems.join('\n  '))
  process.exit(1)
}
console.log(`Fixtures OK: ${list.items.length} calls, ${detailFiles.length} detail files, scores for ${scores.calls.length} calls.`)
for (const c of list.items) console.log(`  ${c.call_id.padEnd(15)} ${c.verdict.padEnd(9)} ${String(c.family).padEnd(7)} score ${c.score}`)
