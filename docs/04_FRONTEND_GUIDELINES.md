# 04 · Frontend Guidelines and Design System: Klartext

## 1. Direction

A quiet, light, monochrome workspace (in the spirit of the Vocalyn / Callora references: soft grey sidebar, white content, thin borders, generous spacing) with **one** loud element: the **yellow highlighted passage** in the call's waveform and transcript. Yellow comes from Outcept's brand and from the case deck, where the suspicious part of the waveform is the yellow part. In Klartext, yellow always means *listen here*.

Principles:
1. **Evidence first.** The officer sees the passage, the speaker, the time and the reason before anything else.
2. **Calm by default.** No gradients, no decorative shadows, no animation for its own sake. Colour is information.
3. **Yellow is earned.** Used only for the highlighted passage, the logo mark and the active focus of attention. Never for decoration, never for text.
4. **Plain words.** Labels say what things are to an officer, not how the system works.

## 2. Brand

**Name:** Klartext
**Tagline:** Every bank call heard. Every alert explained.

**Logo mark:** a graphite rounded square with five waveform bars. Four bars white, the middle bar Outcept yellow and tallest: the one passage that matters.

```svg
<svg width="28" height="28" viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg" aria-label="Klartext">
  <rect width="28" height="28" rx="8" fill="#1E2126"/>
  <rect x="6"    y="11" width="2" height="6"  rx="1" fill="#FFFFFF"/>
  <rect x="9.5"  y="8"  width="2" height="12" rx="1" fill="#FFFFFF"/>
  <rect x="13"   y="5"  width="2" height="18" rx="1" fill="#F2C744"/>
  <rect x="16.5" y="8"  width="2" height="12" rx="1" fill="#FFFFFF"/>
  <rect x="20"   y="11" width="2" height="6"  rx="1" fill="#FFFFFF"/>
</svg>
```

**Wordmark:** "Klartext" in Instrument Sans SemiBold, 18 px in the sidebar, letter-spacing −0.01em, graphite.

**Partner credit:** sidebar footer, small muted text: "Built for Inventx and Outcept". On the pitch title slide, show Outcept and Inventx logos at equal size next to the Klartext mark.

## 3. Colour tokens

Base palette:

| Token | Hex | Use |
|---|---|---|
| `graphite` | `#1E2126` | Primary text, logo square, primary buttons |
| `paper` | `#FFFFFF` | Content surfaces |
| `canvas` | `#F5F5F3` | App background, sidebar |
| `line` | `#E6E6E2` | Borders, dividers, table rules |
| `muted` | `#666A72` | Secondary text, icons |
| `signal` | `#F2C744` | Outcept yellow: highlighted passage, logo bar, active waveform region |
| `signal-soft` | `#FCF1C9` | Highlighted transcript segment background |

Verify `signal` against outcept.ch CSS and adjust if their exact value differs.

Verdict palette (always paired with icon + label, never colour alone):

| Verdict | Strong | Soft background | Icon (lucide) |
|---|---|---|---|
| Alarm | `#C2361F` | `#FBE9E5` | `siren` |
| Review | `#3557B7` | `#E8EDFA` | `user-search` |
| No alert | `#2E7A50` | `#E6F2EA` | `check` |

Review is blue, not amber, on purpose: amber would clash with the yellow passage highlight, and blue reads as "hand to a human" rather than "danger".

Rules:
- Never put text in `signal` on white (fails contrast). Text on yellow is always `graphite`.
- Body text contrast ≥ 4.5:1. `muted` passes on `paper` (5.4:1), `canvas` (5.0:1) and every soft fill; do not go lighter. (Was `#6E727A`, which is only 4.42:1 on `canvas`; see `DECISIONS.md`.)
- Dark mode is out of scope for the MVP. Keep all colours as CSS variables so it can be added.

Tailwind config:

```js
// tailwind.config.ts (extend.colors)
colors: {
  graphite: '#1E2126', paper: '#FFFFFF', canvas: '#F5F5F3',
  line: '#E6E6E2', muted: '#666A72',
  signal: { DEFAULT: '#F2C744', soft: '#FCF1C9' },
  alarm:  { DEFAULT: '#C2361F', soft: '#FBE9E5' },
  review: { DEFAULT: '#3557B7', soft: '#E8EDFA' },
  clear:  { DEFAULT: '#2E7A50', soft: '#E6F2EA' },
}
```

## 4. Typography

| Role | Font | Notes |
|---|---|---|
| Interface | **Instrument Sans** (400, 500, 600) | Clean grotesk with a slightly Swiss character. Use `font-variant-numeric: tabular-nums` for timestamps, scores, counts |
| Call quotes | **Newsreader** italic (400) | Only for words spoken in a call: evidence quotes, transcript excerpts. Echoes the italic serif quotes in the case deck and separates *what was said* from *what the system says* |

No monospace face. Timestamps use tabular Instrument Sans.

Scale (px / line-height):

| Name | Size | Line height | Weight | Use |
|---|---|---|---|---|
| `display` | 28 | 34 | 600 | Page titles |
| `title` | 20 | 28 | 600 | Section titles, verdict header |
| `subtitle` | 16 | 24 | 500 | Card titles |
| `body` | 14 | 22 | 400 | Default |
| `quote` | 17 | 27 | 400 italic serif | Evidence quotes |
| `small` | 12.5 | 18 | 400/500 | Meta, table secondary |

Rules:
- Sentence case everywhere. No all-caps labels, no tracked-out eyebrows above headings.
- One accent per heading at most, and only if it carries meaning (a verdict chip, not a coloured word).
- Max line length 72 characters for reasons and explanations.

## 5. Layout and spacing

- Spacing scale: 4, 8, 12, 16, 24, 32, 48. Default gap in panels 16, between sections 32.
- App frame: sidebar 232 px (collapsible to 64 px icons), top bar 56 px, content max width 1440 px, padding 32.
- Radii by hierarchy, not one value for everything: controls 6 px, panels 10 px, modals 14 px, chips fully rounded.
- Elevation: panels use a 1 px `line` border and no shadow. Only modals and popovers get a shadow (`0 12px 32px rgba(30,33,38,0.12)`).
- Lists of calls are **tables with rows**, not grids of cards.

Call view wireframe:

```
┌ sidebar ┬──────────────────────────────────────────────────────────────┐
│ ■ Klartext │ ◀ Inbox   Stufe2_C09  [Clean]                    search  │
│          ├──────────────────────────────────────────────────────────────┤
│ Inbox    │ [Alarm] Access code shared            score 91               │
│ All calls│ Customer reads a live six-digit login code to the advisor.   │
│ Tuning   │ [Correct] [False alarm] [Missed something]  Sent to Outcept  │
│ Rules    ├───────────────────────────────────┬──────────────────────────┤
│ Quality  │ ▁▂▃▅▂▁▂▃██▃▂▁▂▃▅▃▂▁▂▃██▃▂▁ (yellow)│ Checks                  │
│ Pipeline │ Advisor  ▬▬  ▬▬▬    ▬▬            │ access   present 91 3/3 │
│          │ Customer   ▬▬   ▬▬▬    ▬▬▬        │ trade    absent   4 3/3 │
│          │                                   │ ...                      │
│          │ Context  00:31–00:45  Customer    │ Keyword hits             │
│          │ "Ich habe gerade selber die       │ Transcript (scrolls)     │
│          │  Anmeldung gestartet…"   ▶ play   │  00:31 Customer ...      │
│          │ Trigger  01:41–01:48  Customer    │  01:41 Customer ... (hl) │
│          │ "acht, drei, sechs, eins…" ▶ play │                          │
│          │ Similar call without alarm: C10   │                          │
└──────────┴───────────────────────────────────┴──────────────────────────┘
```

Content is left-aligned. Numbers in tables right-aligned.

## 6. Components

**Verdict chip.** Pill, soft background, strong text and icon, 12.5 px 500. Labels: "Alarm", "Review", "No alert". Large variant (20 px) in the call header.

**Score bar.** 48 × 4 px track in `line`, fill in verdict strong colour, number to the right (tabular). Score 0–100.

**Waveform.** Full width, 72 px high, bars in `#C9CBCF`, played part in `graphite`, evidence regions filled `signal` at 85% opacity. Speaker lanes below: two 8 px rows (Advisor, Customer) in `muted` tones. Click seeks; hovering a region shows its role and time.

**Evidence card.** White panel, 10 px radius, 1 px `line`. Left 3 px bar in `signal` for Trigger, `line` grey for Context and Exclusion. Row 1: role, time range, speaker (small, muted). Row 2: quote in Newsreader italic. Row 3: criterion + "Play passage" button (plays ±10 s). Focused card (from deep link) gets a 2 px `graphite` outline.

**Open question box** (review only). `review.soft` background, 10 px radius, title "Missing to decide", one sentence.

**Twin call box.** Plain panel with `line` border: "Similar call without alarm" + one-sentence difference + link.

**Checks table.** Columns: family, event, score, agreement ("3 of 3 runs agree"). Undetermined event shown in review colour.

**Threshold slider.** Single track with two handles ("Review from", "Alarm from"). Track segments coloured clear / review / alarm soft colours. Values shown above handles. Live summary sentence under it.

**Tables.** 44 px rows, 1 px `line` dividers, hover `canvas`. Sticky header. Keyboard navigable.

**Filter modal.** As in the Vocalyn reference: grouped sections with thin borders, checkboxes and segmented buttons, "Apply filters" and "Clear all" at the bottom.

**Banners.** After rule or threshold changes: `canvas` background, graphite text, states the effect in one sentence with numbers.

**Buttons.** Primary: graphite background, white text. Secondary: white, `line` border. Destructive: alarm strong text on white. Labels are verbs: "Play passage", "Mark as false alarm", "Apply thresholds", "Process folder". No arrows appended to labels.

**Focus.** 2 px graphite ring with 2 px white offset on every interactive element.

## 7. Motion

- Only motion that answers an action: modal open (150 ms fade + 4 px rise), slider value changes, toast in/out.
- One deliberate moment: when a new call finishes processing, its row slides into the Inbox and the verdict chip fades in (300 ms).
- Respect `prefers-reduced-motion`: disable all of the above.

## 8. Copy rules

- Speak to the officer: "Customer reads a live login code to the advisor", not "Event present in family access".
- Family display names:
  - trade → "Trading on non-public information"
  - splitting → "Splitting to avoid approval"
  - access → "Access code shared"
  - disclosure → "Information given to a third party"
  - documentation → "Relevant information left out"
  - numbers → "Number type" (helper, never a verdict)
- Event display: present → "Happened", absent → "Did not happen", undetermined → "Unclear from the call", not_applicable → "Not relevant".
- Reasons: one or two sentences, start with who did what, end with why it matters.
- Errors state what happened and what to do: "Transcription failed for Stufe1_D04. The file is not 16 kHz mono. Convert it and drop it into the inbox again."
- Empty states invite action: "No calls need attention. 60 of 60 calls checked."
- Toast after an action uses the same verb as the button: "Mark as false alarm" → "Marked as false alarm".
- Swiss German quotes are shown as transcribed. A toggle "Show script wording" exists only in evaluation mode.

## 9. Accessibility checklist

- [ ] Verdicts always have icon + text label
- [ ] All text ≥ 4.5:1 contrast, no yellow text
- [ ] Full keyboard navigation in tables, sliders, modals
- [ ] Visible focus ring everywhere
- [ ] Audio controls have labels ("Play passage 01:41 to 01:48")
- [ ] Reduced motion respected
- [ ] Usable at 1024 px width

## 10. Frontend structure

```
frontend/src/
├── app/            routes, layout (Sidebar, TopBar)
├── pages/          Inbox, AllCalls, CallView, Tuning, Rules, Quality, Pipeline, Advisors
├── components/     VerdictChip, ScoreBar, Waveform, EvidenceCard, ChecksTable,
│                   ThresholdSlider, KeywordTable, FilterModal, Banner, EmptyState, Logo
├── lib/            api.ts (typed client), decide.ts (client-side re-decision for sliders),
│                   format.ts (time, labels), types.ts (mirrors backend schemas)
└── fixtures/       calls.json, call_detail.json, eval.json (from backend fixture spec)
```

`decide.ts` must implement exactly the same decision rule as the backend (`05_BACKEND_STRUCTURE.md`, section 5) so slider changes are instant and match server results.
