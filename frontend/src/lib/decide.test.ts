// Runs shared/decision_cases.json against decide.ts (the backend runs the same file against decide.py).
// npm test  →  node --test (Node strips the TypeScript types; no test library needed).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { decide, type DecisionInput, type DecisionOutput } from './decide.ts'

interface Case {
  name: string
  why: string
  input: DecisionInput
  expected: Partial<DecisionOutput>
}

const file = new URL('../../../shared/decision_cases.json', import.meta.url)
const { cases } = JSON.parse(readFileSync(file, 'utf-8')) as { cases: Case[] }

test('shared file has at least 12 cases', () => assert.ok(cases.length >= 12))

for (const c of cases) {
  test(c.name, () => {
    const out = decide(c.input)
    for (const [key, want] of Object.entries(c.expected)) {
      const got = out[key as keyof DecisionOutput]
      if (key === 'score') assert.ok(Math.abs((got as number) - (want as number)) < 1e-9, `score ${got} != ${want}`)
      else assert.equal(got, want, `${key} (${c.why})`)
    }
  })
}
