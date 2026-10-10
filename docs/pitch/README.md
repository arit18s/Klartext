# Pitch material (B33)

| File | What |
|---|---|
| `slides.html` | Three slides (architecture, operating concept, detection quality), 1920 × 1080, Klartext design system, works offline (font embedded). Open in a browser; print to PDF gives one slide per page. |
| `1-architecture.png`, `2-operating-concept.png`, `3-detection-quality.png` | The slides as images, for any deck tool. |
| `klartext-slides.pdf` | All three slides as PDF. |
| `demo-script.md` | The 5-minute demo from `01_PRD.md` section 10: what to click, what to say, timed, with fallbacks. |
| `qa.md` | Q&A sheet from the pitch lines in `DECISIONS.md`. |

Slide 3 and `qa.md` carry the B29 numbers (holdout run once on ASR, thresholds version 4). The chart colours are the dataviz reference palette's first two categorical slots, validated for colour-blind separation and contrast.

To regenerate the PNG and PDF after editing `slides.html`: open it in Chromium at 1920 px or wider and print with background graphics, or use Playwright (`page.locator('#architecture').screenshot()`, `page.pdf({ width: '1920px', height: '1080px', printBackground: true })`).
