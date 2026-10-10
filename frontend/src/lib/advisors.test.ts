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
  raised_by: CallSummary['raised_by'] = verdict === 'alarm' || verdict === 'review' ? 'unclear' : null,
): CallSummary => ({ ...base, call_id, advisor_name, verdict, family, processed_at, raised_by })

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
    advisor_alarm: 0, // C09's trigger is spoken by the customer
    advisor_review: 0,
    customer_alarm: 1,
    customer_review: 0,
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

test('split by who raised it, advisor-raised first', () => {
  const rows = advisorRows([
    call('A1', 'Advisor 01', 'alarm', 'trade', '2026-10-10T10:00:00Z', 'customer'),
    call('A2', 'Advisor 01', 'alarm', 'trade', '2026-10-10T10:00:00Z', 'customer'),
    call('A3', 'Advisor 01', 'review', 'trade', '2026-10-10T10:00:00Z', 'customer'),
    call('B1', 'Advisor 02', 'review', 'access', '2026-10-10T10:00:00Z', 'advisor'),
    call('B2', 'Advisor 02', 'review', 'access', '2026-10-10T10:00:00Z', 'unclear'),
  ])
  assert.deepEqual(
    rows.map((r) => [r.advisor_name, r.advisor_alarm, r.advisor_review, r.customer_alarm, r.customer_review]),
    [
      ['Advisor 02', 0, 2, 0, 0],
      ['Advisor 01', 0, 0, 2, 1],
    ],
  )
  assert.deepEqual(rows.map(needsAttention), [true, false])
})

test('attention: an advisor-raised alarm or 2+ advisor-raised reviews', () => {
  const row = (advisor_alarm: number, advisor_review: number, customer_alarm = 0) =>
    ({ advisor_alarm, advisor_review, customer_alarm, alarm: advisor_alarm + customer_alarm }) as AdvisorRow
  assert.deepEqual(
    [row(1, 0), row(0, 2), row(0, 1), row(0, 0), row(0, 0, 3)].map(needsAttention),
    [true, true, false, false, false],
  )
})
