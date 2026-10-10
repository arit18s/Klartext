// npm test: the fixture-mode advisor rows follow the same rules as GET /api/advisors.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { advisorRows, needsAttention } from './advisors.ts'
import type { AdvisorRow, CallSummary } from './types'

const fixture = JSON.parse(readFileSync(new URL('../fixtures/calls.json', import.meta.url), 'utf8')) as {
  items: CallSummary[]
}
const base = fixture.items[0]
const call = (
  call_id: string,
  advisor_name: string | null,
  verdict: CallSummary['verdict'],
  family: CallSummary['family'],
  processed_at: string | null,
): CallSummary => ({ ...base, call_id, advisor_name, verdict, family, processed_at })

test('fixture calls: one row each, alarm first', () => {
  const rows = advisorRows(fixture.items)
  assert.deepEqual(
    rows.map((r) => r.advisor_name),
    ['Advisor 04', 'Advisor 01', 'Advisor 02'],
  )
  assert.deepEqual(rows[0], {
    advisor_name: 'Advisor 04',
    calls: 1,
    alarm: 1,
    review: 0,
    no_alert: 0,
    families: ['access'],
    last_call_at: '2026-10-10T08:42:00Z',
    last_call_id: 'Stufe2_C09-K3',
  })
})

test('counts, family order, last call, names left out', () => {
  const rows = advisorRows([
    call('A1', 'Advisor 01', 'review', 'access', '2026-10-10T10:00:00Z'),
    call('A2', 'Advisor 01', 'review', 'trade', '2026-10-10T11:00:00Z'),
    call('A3', 'Advisor 01', null, null, null),
    call('B1', '  ', 'alarm', 'access', '2026-10-10T10:00:00Z'),
    call('B2', null, 'alarm', 'access', '2026-10-10T10:00:00Z'),
  ])
  assert.equal(rows.length, 1)
  assert.deepEqual(
    [rows[0].calls, rows[0].review, rows[0].families, rows[0].last_call_id],
    [3, 2, ['trade', 'access'], 'A2'],
  )
})

test('since keeps calls processed at or after it', () => {
  assert.deepEqual(
    advisorRows(fixture.items, '2026-10-10T08:40:00Z').map((r) => r.advisor_name),
    ['Advisor 04'],
  )
})

test('attention: any alarm or 2+ reviews', () => {
  const row = (alarm: number, review: number) => ({ alarm, review }) as AdvisorRow
  assert.deepEqual([row(1, 0), row(0, 2), row(0, 1), row(0, 0)].map(needsAttention), [true, true, false, false])
})
