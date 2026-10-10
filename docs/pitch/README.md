# Pitch material (B33)

| File | What |
|---|---|
| `slides.html` | The deck, 1920 × 1080 per slide, Klartext design system, font embedded. Open in a browser; print to PDF gives one slide per page. The backup slides load their images from `screens/`, so keep that folder next to the file. |
| `0-title.png` … `14-backup-j-outcept.png` | Every slide as an image, for any deck tool (order below). |
| `klartext-slides.pdf` | All 15 slides as PDF. |
| `screens/` | The raw demo screenshots (1920 × 1080, 100 % zoom) used on the backup slides. |
| `demo-script.md` | The 5-minute demo from `01_PRD.md` section 10: what to click, what to say, timed, with fallbacks. |
| `qa.md` | Q&A sheet from the pitch lines in `DECISIONS.md`. |
| `video-aufnahmen.md` | Shot list (German) for the ten backup demo videos: setup, what to click per clip, what not to click, reset afterwards. Videos go to `videos/` (git-ignored). |

## Slide order

| # | Image | Slide |
|---|---|---|
| 0 | `0-title.png` | Title: Klartext, tagline, case, team (teammate name still a placeholder) |
| 1 | `1-architecture.png` | Architecture: from a finished call to an explained decision |
| 2 | `2-operating-concept.png` | Operating concept |
| 3 | `3-detection-quality.png` | Detection quality (B29 holdout numbers) |
| 4 | `4-backup.png` | Divider: Backup, demo screens |
| 5 | `5-backup-a-pipeline.png` | 1. Pipeline picks up `demo_call.wav` (mid-processing, *Checking*) |
| 6 | `6-backup-b-inbox.png` | 1. Inbox with `demo_call` at the top |
| 7 | `7-backup-c-demo-call.png` | 1. `demo_call`: Alert, Access code shared, reason, *Raised by: Customer*, yellow trigger card |
| 8 | `8-backup-d-d06.png` | 2. Stufe1_D06: Keyword hits, No alert, access check opened |
| 9 | `9-backup-e-c10.png` | 2. Stufe2_C10: No alert, Exclusion card, twin note |
| 10 | `10-backup-f-c17.png` | 3. Stufe3_C17: Review, Missing to decide, Why the access check is unclear |
| 11 | `11-backup-g-tuning.png` | 4. Tuning: thresholds and the summary sentence |
| 12 | `12-backup-h-rules.png` | 4. Rules → Families |
| 13 | `13-backup-i-quality.png` | 5. Quality on the holdout run |
| 14 | `14-backup-j-outcept.png` | 5. Outcept trigger list (`localhost:8080`), 35 alerts and reviews |

Slide 3 and `qa.md` carry the B29 numbers (holdout run once on ASR, thresholds version 4). The chart colours are the dataviz reference palette's first two categorical slots, validated for colour-blind separation and contrast.

The backup screens were captured on Sat 10 Oct against the real DB (60 calls plus the dropped `demo_call`), backend with the watcher on, Playwright at 1920 × 1080. Read-only: no feedback, threshold or rule was saved. Afterwards `demo_call` was purged (`purge_call.py demo_call --keep-transcript`), the Outcept list was cleared and the 35 batch alerts and reviews were posted again with the *Alert: …* / *Review: …* titles (D45); screen 14 shows that clean list.

To regenerate the PNG and PDF after editing `slides.html`: open it in Chromium at 1920 px or wider and print with background graphics, or use Playwright (`page.locator('#title').screenshot()` for each slide id, `page.pdf({ width: '1920px', height: '1080px', printBackground: true })`).
