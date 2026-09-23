# Category Tree Picker — Fix Plan & Senior Engineer Review

**Companion to:** `category-tree-ui.html` (v2) and `category-taxonomy-spec.md`.
This is the reference to hand Claude Code alongside the HTML file — it explains
*why* each fix was made, what's intentionally left undone in a static mockup,
and a self-critique of the fixes before they get implemented for real.

---

## 1. What Was Fixed, and Why

| # | Bug | Root cause | Fix | Source grounding |
|---|---|---|---|---|
| 1 | Search didn't narrow results — matched a top-level branch, then dumped the entire subtree | Filtering happened only at the top-level array; once a branch "matched" (via any descendant), every descendant rendered unconditionally | Two-pass search: `computeSearchSets()` marks only matching nodes + their direct ancestor chain as visible; only branches with a matching descendant auto-expand, and only as far as needed | Standard filtered-tree pattern (same approach VS Code's symbol search, file-tree search use) |
| 2 | Footer claimed arrow-key navigation that didn't exist | No `keydown` handler beyond `Enter` | Full `ArrowUp/Down/Left/Right/Home/End` handling via `moveActive()`, `expandOrDescend()`, `collapseOrAscend()` | WAI-ARIA Authoring Practices — Treeview keyboard pattern (Up/Down move; Right expands-or-descends; Left collapses-or-ascends; Home/End jump to ends) — this exact mapping is used consistently across Kendo, Syncfusion, and MUI's tree implementations |
| 3 | Escape only cleared search text, never closed the panel | Missing case in the Escape handler | Two-stage Escape: clears query first if non-empty, closes + returns focus to trigger on the second press (or immediately if query is already empty) | Standard combobox convention (matches GitHub, VS Code command palette, etc.) |
| 4 | Tabbing past the panel left it open and visually detached from focus | `closePanel()` only fired on outside `click`, never on blur/tab | `focusout` listener on the field wrapper, checked on the next tick (focusout fires before the new element receives focus, so a raw synchronous check would misfire) | Documented pattern for custom popups; the delayed check is necessary because of `focusout`/`focusin` event ordering |
| 5 | Focus vanished after selecting a row | Panel was hidden via `display:none` while a row inside it still held focus | `selectNode()` now explicitly returns focus to the trigger button (`trigger.focus()`) before/after closing | Basic focus-management discipline for any custom popup — WAI-ARIA combobox pattern states focus should return to the triggering control on close |
| 6 | No ARIA semantics at all — screen readers heard "clickable div," not "combobox," "tree," or which level/state a row was in | Never implemented | `role="combobox"` + `aria-haspopup="tree"` + `aria-expanded` on the trigger; `role="tree"` on the list; `role="treeitem"` + `aria-level` + `aria-expanded` + `aria-selected` per row; `aria-activedescendant` on the search input tracks the keyboard cursor instead of moving real focus into rows | WAI-ARIA APG Treeview + Combobox patterns; the "keep real focus on the textbox, use `aria-activedescendant` instead of moving focus into the popup" approach is the documented alternative specifically because moving real focus into rapidly-rerendered DOM nodes causes some screen readers to announce items as blank mid-navigation |
| 7 | Search input would trigger an uncontrollable viewport zoom on iPhone that didn't revert | Input `font-size` was 13.5px | Bumped both text inputs to 16px | Documented, well-known iOS Safari behavior: any `<input>`/`<textarea>`/`<select>` with computed `font-size < 16px` triggers auto-zoom on focus, and iOS does not zoom back out on blur — the fix is universally cited as keeping form-control font-size at or above 16px |
| 8 | A selection pointing at a deleted/renamed category would show a dead label forever | No validation against current data | `ensureSelectionValid()` runs on panel open, resets to "All categories" if the selected id no longer exists | Direct consequence of the taxonomy spec's own edge case (categories can be deleted/reassigned by the IM) — the UI needs to handle it, not just the database |
| 9 | Missing live announcement of result count while filtering | Not implemented | `aria-live="polite"` region announces "N matches" as the user types | Standard combobox practice — screen reader users otherwise get no feedback that filtering happened at all |
| 10 | Label not associated with the trigger | Missing `for` attribute | Added `for="trigger"` on the Category `<label>` | Basic form-labeling correctness |

---

## 2. Left As Backend/Product Decisions — Not Fixable in a Static File

These aren't bugs in the HTML; they're places where the *frontend fix* only
goes as far as a real backend/API contract, which this mockup can't provide.
Each is called out with an inline code comment in `category-tree-ui.html` at
the relevant spot.

1. **Selecting a non-leaf node needs a recursive descendant query.**
   Clicking "Sensors" must filter to "this category OR any descendant
   category," not `WHERE category_id = 'sensors'` literally — that would
   silently return zero results for anything actually filed under
   `Temperature & Humidity`. This is the same recursive-CTE-over-`parent_id`
   mechanism already required for the depth-guard trigger in the taxonomy
   spec, just walked downward instead of upward.

2. **Live count computation and caching.** A leaf's count is one query; a
   top-level node's count is a rollup across every descendant. At current
   scale this is cheap to compute on every panel open; if the catalog grows
   substantially, this needs either a cached/denormalized count (updated on
   product write) or an accepted latency cost on open. Decide before this
   becomes a real symptom, not after.

3. **Whether counts reflect other active filters.** The count badge here
   always shows the total, unfiltered count (documented via the `title`
   tooltip on each badge: *"not affected by other active filters"*). If
   "In stock only" is checked elsewhere on the page, should `Bearings` show
   `7` (total) or the smaller in-stock number? This mockup picked "always
   total" as the least surprising default and documents it explicitly — flag
   if that's not the right call for your users.

4. **The `Uncategorized` pinned row duplicates the existing `Uncategorized
   only` checkbox** seen in the real screenshot. Shipping both means two UI
   elements can set overlapping filter state. Recommendation: remove the
   standalone checkbox and let the pinned tree row be the single way to
   filter to uncategorized products — but this is a call for whoever owns
   that screen, not something the tree component can decide on its own.

5. **Category ID uniqueness is assumed global**, not just per-sibling.
   The tree's selection/highlighting logic matches rows by `id` across the
   whole tree. As long as `categories.id` is a real primary key (not a
   human-typed slug), this holds. If IDs are ever generated in a way that
   could collide across branches, selection state will silently apply to
   multiple rows.

---

## 3. Senior-Engineer Validation of the Fixes Themselves

Fixing bugs can introduce new ones — here's a critical pass over what just
got built, not just what got removed.

**Search-pruning rewrite (`computeSearchSets`) is O(n) per keystroke, not
memoized.** For ~80 nodes this is instant. It has no debounce, so every
keystroke triggers a full tree walk + full DOM rebuild. This is fine now;
it will not be fine if the catalog grows into the many hundreds of leaves the
taxonomy doc itself makes plausible (dozens of subcategories × dozens of
component variants). **Recommendation before shipping at scale:** add a
~120–150ms debounce on the search input, and if the tree ever needs to be
fetched from an API rather than held in memory, this whole function needs to
move server-side as a proper filtered query rather than a client-side walk
over the full tree payload.

**The `aria-activedescendant` approach is a reasonable-faith implementation
of the documented pattern, but it has not been tested against a real screen
reader.** I'm citing the documented rationale for this approach accurately,
but "grounded in the right pattern" and "verified working in NVDA/JAWS/
VoiceOver" are different claims — don't represent this as WCAG-AA-verified
to stakeholders until someone actually runs it through at least one screen
reader. This is the single biggest gap between "did real research" and "did
real QA."

**`ArrowRight`/`ArrowLeft` semantics don't account for RTL locales.** The
WAI-ARIA pattern explicitly flips Left/Right in right-to-left layouts (MUI's
docs call this out directly). If this system is ever localized into an
RTL language, this needs the mirrored mapping — not a concern today, but a
silent trap if ignored later and then "just translated."

**`focusout` + `setTimeout(...,0)` is a standard technique, but it's a timing
assumption, not a guarantee.** It works correctly in all evergreen browsers
today. It is the kind of code that looks fragile to the next engineer who
reads it without context — worth the code comment that's already there, and
worth a regression test (`Tab` out of the last item closes the panel) rather
than trusting it silently forever.

**The "reset to All categories on stale selection" fix only runs on
`openPanel()`.** If a category is deleted while the picker is already
*closed* and showing a stale label, the label stays wrong until the user
opens and re-closes the picker. A more correct fix (and the one to actually
build server-side) is invalidating/refetching category data on a real
interval or via a push/refetch-on-focus mechanism (e.g. React Query's
`refetchOnWindowFocus`) — the client-side check here is a stopgap for the
mockup, not the final answer.

**The `title` attribute used for tooltips (count meaning, junk-category flag)
is not keyboard- or touch-accessible** — native title tooltips don't reliably
appear on focus or on mobile tap. This is acceptable for a demo but should
become a proper accessible tooltip component (or just always-visible text) in
the real implementation, not `title=`.

**Net assessment:** the fixes address every bug that was concretely
verifiable in the previous version, using patterns grounded in real
documentation rather than guesses. What's *not* claimed: that this is
production-ready, WCAG-AA-certified, or scale-tested past a few hundred
nodes. Those are the three things to explicitly re-test once this moves from
"reference mockup" to "thing Claude Code ships."

---

## 4. Handoff Checklist for Claude Code

- [ ] Port the interaction model (search-pruning, keyboard cursor via
      `aria-activedescendant`, focus-return-on-close) into the real
      framework component — do not just copy the vanilla JS verbatim into a
      React/Vue app; re-implement the *behavior*, not the DOM-manipulation
      code, inside whatever component model the app already uses.
- [ ] Implement the recursive descendant-inclusive filter server-side
      (Section 2, item 1) before wiring "select a non-leaf category" to a
      real query.
- [ ] Decide and document the counts-vs-other-filters behavior (Section 2,
      item 3) rather than leaving it implicit.
- [ ] Remove or reconcile the standalone `Uncategorized only` checkbox
      (Section 2, item 4).
- [ ] Run the finished component through at least one real screen reader
      (NVDA on Windows or VoiceOver on macOS/iOS) before calling the
      accessibility work done — this file gives you the right pattern, not
      a tested guarantee.
- [ ] Add a debounce to search input handling once real category counts
      exceed roughly 150–200 nodes.
