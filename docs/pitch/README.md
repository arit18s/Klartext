# Pitch material (B33)

| File | What |
|---|---|
| `slides.html` | Two slides, 1920 × 1080, Klartext design system, works offline (font embedded). Open in a browser; print to PDF gives one slide per page. |
| `1-architecture.png`, `2-operating-concept.png` | The slides as images, for any deck tool. |
| `klartext-slides.pdf` | Both slides as PDF. |
| `demo-script.md` | The 5-minute demo from `01_PRD.md` section 10: what to click, what to say, timed, with fallbacks. |
| `qa.md` | Q&A sheet from the pitch lines in `DECISIONS.md`. |

The slides make no performance claims. Numbers go on the metrics slide once the holdout run on ASR (B29) exists; `qa.md` marks them `[B29]`.

To regenerate the PNG and PDF after editing `slides.html`: open it in Chromium at 1920 px or wider and print with background graphics, or use Playwright (`page.locator('#architecture').screenshot()`, `page.pdf({ width: '1920px', height: '1080px', printBackground: true })`).
