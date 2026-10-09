# Klartext

**Every bank call heard. Every alert explained.**

Klartext checks every recorded customer–advisor call in Swiss German, flags insider trading, leaked access codes, disclosure to third parties and other compliance risks, and hands the compliance officer the exact 20 seconds worth listening to, with a reason. When the facts in the call are not enough to decide, it says so and sends the call to a human.

Built for the Inventx × Outcept case at sprintd Innovation Sprint Zurich, 9–11 October 2026.

## Why the name

"Klartext reden" means to speak plainly. The product turns hours of dialect audio into plain, traceable statements: what was said, when, by whom, and why it matters. It also sits naturally next to Outcept's own product naming (Klarsicht).

## Documents

Read them in this order. Each one is written so an AI coding agent (Claude Code) can build from it without guessing.

| File | What it answers |
|---|---|
| `01_PRD.md` | What we build, for whom, what is in and out of scope, how we win |
| `02_APP_FLOW.md` | Every screen, what is on it, how the officer moves through it |
| `03_TECH_STACK.md` | Exact tools, models, libraries and why |
| `04_FRONTEND_GUIDELINES.md` | Design system: brand, colour, type, components, copy rules |
| `05_BACKEND_STRUCTURE.md` | Pipeline, database schema, API, decision logic, evaluation |
| `06_IMPLEMENTATION_PLAN.md` | Step-by-step build prompts with a timeline to Sunday 08:30 |
| `07_SECURITY_GUIDELINES.md` | Security and data rules for a banking context |
| `CLAUDE.md` | Short rules file for the coding agent. Put it in the repo root |

## Design references

Put the reference screenshots in `docs/design-refs/` in the repo. The look we follow: light, calm, monochrome SaaS (Vocalyn-style dashboard, sidebar, filter modals), with Outcept yellow as the single accent.

## Team

- Dinesh: pipeline (ASR, checks, decision logic, evaluation), backend, integration.
- Teammate: frontend, built against the fixture JSON defined in `05_BACKEND_STRUCTURE.md` so both sides work in parallel from hour one.
