// npm test: a call checked later is on top of its verdict group, whatever its name or score; a batch (same minute)
// keeps highest score first. Same order as GET /api/calls.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sortCalls } from './sort.ts'
import type { CallSummary } from './types'

const call = (call_id: string, verdict: CallSummary['verdict'], score: number, processed_at: string) =>
  ({ call_id, verdict, score, processed_at }) as CallSummary

test('new alert on top, batch by score, reviews after alerts', () => {
  const ids = sortCalls([
    call('A_batch_100', 'alarm', 100, '2026-10-10T09:00:01Z'),
    call('B_batch_80', 'alarm', 80, '2026-10-10T09:00:30Z'),
    call('Old_review', 'review', 50, '2026-10-10T09:00:10Z'),
    call('WhatsApp_2', 'alarm', 70, '2026-10-10T15:16:00Z'),
    call('C_batch_100', 'alarm', 100, '2026-10-10T09:00:50Z'),
    call('New_review', 'review', 30, '2026-10-10T15:20:00Z'),
  ]).map((c) => c.call_id)
  assert.deepEqual(ids, ['WhatsApp_2', 'A_batch_100', 'C_batch_100', 'B_batch_80', 'New_review', 'Old_review'])
})
