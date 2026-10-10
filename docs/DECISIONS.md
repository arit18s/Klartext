# Decisions: Klartext

Decisions that change or sharpen what the other docs say. Newest first. Each entry: what, why, where it applies.

## Design

### D1 · `muted` text colour is `#666A72` (contrast fix)

*Sat 10 Oct, approved by the team. Frontend commit `9c368a0` (F9).*

- **What.** The `muted` token changes from `#6E727A` to `#666A72`. It is used for secondary text and icons.
- **Why.** The accessibility pass in F9 (axe-core, WCAG 2 A/AA) found that `#6E727A` reaches only 4.42:1 on the `canvas` background `#F5F5F3`. That is below the 4.5:1 that `04_FRONTEND_GUIDELINES.md` section 9 requires. It affected the sidebar group labels, the stat tile footers, keyboard hints and table group rows. `#666A72` is the smallest darker step that passes on every surface muted text sits on:

  | Background | `#6E727A` | `#666A72` |
  |---|---|---|
  | `paper` `#FFFFFF` | 4.83 | 5.43 |
  | `canvas` `#F5F5F3` | 4.42 | 4.97 |
  | nav hover `#ECECE8` | 4.07 | 4.58 |
  | `review.soft` `#E8EDFA` | 4.12 | 4.63 |
  | `alarm.soft` `#FBE9E5` | 4.11 | 4.62 |
  | `signal.soft` `#FCF1C9` | 4.27 | 4.80 |

  Visually the difference is barely noticeable. Darker is allowed by the guideline ("do not go lighter").
- **Where.** `docs/04_FRONTEND_GUIDELINES.md` (colour table, contrast rule, Tailwind config) and `frontend/src/index.css` (`--muted`). After the change axe reports 0 violations on all 12 routes and the filter modal.
