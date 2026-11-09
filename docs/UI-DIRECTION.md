# UI direction (v2): "calm command center"

Audience: Eric, job hunting, wants focus and finishability (ADHD/OCD-friendly), uses a laptop and an iPhone. Personal tool, so optimize for daily use, not first impressions.

## What's wrong today (seen in test-shots/ at the end of Phase 0)

1. **Phone:** about 400px of stacked controls (search, 2 dropdowns, checkbox, button) sit above the map. The list is below the map. On a phone the map is the product, and it starts below the fold.
2. **Desktop:** the title, tagline and control row take about 190px of height before any content. The details card sits over the map's move pad.
3. **No sense of "what do I do now?"** There is a ranked list but no daily focus, no status, no next step.
4. **Long page:** the document scrolls, so the map and the list scroll away from each other.
5. Small touch targets on the map chips and zoom buttons. The card is long and dense.

## Target layout

**Desktop (>900px): app shell, not a document.** `height: 100dvh`, nothing scrolls except inside panels.
- **Left rail, 400-440px, scrolls inside itself:**
  1. Slim top bar: product name at 17px, sync state ("Saved on this device" / "Synced"), a gear menu (see Settings).
  2. Search.
  3. Filter summary row: "Showing 41 of 95 · Filters (3 on)" that expands in place (Agent F's bar).
  4. **Today panel** (reminders), collapsible. Open when something is due.
  5. Tabs: Top matches · My applications · Biggest offices.
  6. The list.
- **Right: the map**, full height. The employer card becomes a **drawer docked to the right edge of the map** (about 380px wide, closable) instead of a card floating over the map. The map re-centers so the selected pin stays visible. The tagline moves into an "About this map" popover.
- Map controls: zoom, compass and 2D/3D stay top-right. The d-pad is collapsible ("Move" button) and hidden by default on mouse devices. The place chips (Home, Reston, Rosslyn...) become one compact "Jump to..." menu plus a Home button.

**Phone (<=900px): map first.**
- The map fills the viewport. A floating search pill sits on top.
- The list, filters, Today and tabs live in a **bottom sheet** with three snap points: peek (about 88px, showing the active tab and count), half, full. It has a drag handle, plus buttons that do the same thing for people who can't drag.
- Selecting an employer flies the map and shows its card in the sheet at half height, with Prev/Next. The pin stays visible above the sheet.
- Hide the d-pad on touch devices (gestures work). Keep zoom and compass.

## Visual system (keep the family, tighten it)

- Keep Archivo and IBM Plex Mono and the existing palette tokens. Add the kit's tokens (`--r-*`, `--shadow-*`, status colors) from `src/parts/05-kit.css`.
- Type scale: 12 / 13.5 / 15 / 18 / 22. No other sizes. Numbers in mono.
- One radius family (6 / 10 / 16). One shadow for floating things, none for flat cards.
- Score badge, rank number and status pill are the three recurring shapes; design each once and reuse them everywhere (list row, card, board, map).
- Dark mode must be a first-class citizen: check every part in it.
- Motion: only to explain (sheet snapping, drawer, fly-to). All of it off under `prefers-reduced-motion`.

## Settings (gear menu, stored in localStorage `reston-map-ui`)

Theme (Auto/Light/Dark), Text size (S/M/L via a root font-size variable), "Calm mode" (hides the map's decorative labels and the per-row sub-scores, keeping rank + name + one line), and "Show move pad".

## ADHD/OCD-friendly rules (apply to every screen; see BUILD-PLAN.md section 0)

- No layout shift when data loads: reserve space and use skeletons.
- The same action is always in the same place. One primary button per panel.
- Never more than 3 visible actions per row. Everything else is behind "More".
- Done is done: nothing reorders itself under the cursor. Lists only re-sort when the user changes sort or filters.
- Calm color: no red anywhere. Status is always glyph + word + color.
- Every empty state says what to do next in one sentence.

## Accessibility checks

Keyboard reachability of the sheet, drawer and menus (focus trap in dialogs, Esc closes, focus returns to the opener), visible focus, 44px touch targets on touch, contrast AA in light and dark, `aria-live` for toasts and the list count, no information by color alone, no horizontal scroll at 320px.

## Deliverables

- Rewritten layout in `src/shell.html` and `src/parts/00-core.css`; the minimum JS in `00-core.js` for the sheet and drawer behavior; polish in each part's own CSS.
- Before/after screenshots in `test-shots/` at 1280x800, 1024x700, 400x800 and 320x640, in light and dark.
- All `tests/*.js` still pass. Add `tests/layout.js` for: no horizontal scroll at 320/400, the sheet snaps, the drawer opens, and the map is visible at load on a phone.
