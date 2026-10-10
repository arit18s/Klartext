// Interface dictionaries: German has every English key, the same placeholders, and Swiss spelling (no ß).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { en } from './en.ts'
import { de } from './de.ts'

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()

test('de has exactly the keys of en', () => assert.deepEqual(Object.keys(de).sort(), Object.keys(en).sort()))

test('de keeps every placeholder of en', () => {
  for (const [k, v] of Object.entries(en)) assert.deepEqual(placeholders(de[k as keyof typeof en]), placeholders(v), k)
})

test('de uses Swiss spelling (ss, never ß)', () => {
  for (const [k, v] of Object.entries(de)) assert.ok(!v.includes('ß'), k)
})

test('plural keys come in _one / _other pairs', () => {
  for (const k of Object.keys(en)) {
    if (k.endsWith('_one')) assert.ok(`${k.slice(0, -4)}_other` in en, k)
    if (k.endsWith('_other')) assert.ok(`${k.slice(0, -6)}_one` in en, k)
  }
})
