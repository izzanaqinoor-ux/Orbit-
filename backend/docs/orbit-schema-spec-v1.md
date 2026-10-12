# Orbit V1 — Schema Design Specification

This is a design pass, not a DDL pass — no `CREATE TABLE` statements appear below. Every table is specified column-by-column so the eventual DDL is a mechanical transcription with no undecided questions left. This supersedes the earlier DDL draft specifically on the demand/deadline math (which now uses `P_valid` per the mathematical audit) and goes materially deeper on per-field justification.

No contradiction with the locked conceptual model was found. Two points needed a genuine judgment call not fully specified in the lock — both are called out explicitly where they occur, not silently decided.

**Correction pass 1 applied:** (1) duplicated `module_id` on `commitments` removed, (2) same-user ownership database-enforced via composite FKs, (3) recurrence role pairing replaced with a three-way exclusive CHECK, (4) `exams.grade` decided (included).

**Correction pass 2 applied:** (5) `recurrence_template_id` deletion policy corrected from `SET NULL` to `RESTRICT` with an archive-based lifecycle, resolving its incompatibility with the three-way recurrence CHECK; (6) recurrence template rows are locked as never counting toward real calendar occupancy, with the query-layer distinction specified; (7) `completed_at`/`status` consistency is now DB-enforced; (8) UUID generation ambiguity resolved — no DB-side default assumed anywhere; (9) `commitment_category` reduced to `study | work | personal | other`, `goal_linked` removed as redundant with `goal_id`; (10) `priority` semantics locked (1 = highest, 5 = lowest); (11) recurring flexible Commitments with `due_at` resolved as unsupported in V1, enforced by a new CHECK; (12) email normalization locked (lowercase, app-enforced, DB CHECK as a safety net). Each correction is marked inline where it appears.

**Correction pass 3 applied:** (13) the composite `goal_id` FK now uses PostgreSQL's column-specific `ON DELETE SET NULL (goal_id)`, since the default form would attempt to null `commitments.user_id`, which is `NOT NULL`; (14) every remaining reference to `SET NULL` for `recurrence_template_id` (Part L mechanics, Part E, the constraint matrix) is corrected to `RESTRICT`, so exactly one deletion policy for this relationship now appears throughout; (15) `time_blocks.commitment_id` and `commitment_exceptions.commitment_id` ownership is explicitly reclassified as application-enforced (via join), not database-guaranteed — the document no longer claims cross-user references are structurally impossible for these two relationships; (16) range CHECK constraints added for `grade`, `weightage_percent`, `hourly_rate`, and `hourly_rate_override`; (17) `modules(user_id, code)` uniqueness added, scoped to non-null codes; (18) the semantic difference between Commitment-level and TimeBlock-level `skipped` is defined explicitly, and the `RemainingDemand` override is extended to cover `skipped` alongside `completed`.

**Correction pass 4 applied:** (19) a recurrence-template status CHECK closes the blocker where a completed/skipped template could keep generating future occurrences — templates are now restricted to `todo`/`in_progress`/`archived`, verified compatible with the `completed_at` CHECK; (20) `W` is locked to exactly one user-local calendar week for all V1 capacity calculations, with the 2400-minute baseline's interpretation stated precisely; (21) the `recurrence_rule` JSONB contract is fully specified at the application-contract level (frequency, interval, weekday codes, timezone application, duration derivation, explicit unsupported patterns); (22) two cheap non-negativity CHECKs added (`weekly_capacity_minutes`, `reschedule_count`); (23) the mode/category pairing invariant for each domain extension (Assignment/Exam/Shift) is explicitly documented as application-enforced.

**Correction pass 5 applied (final pre-DDL pass):** (24) 🔴 blocker fix — recurrence templates are now locked to `mode = 'fixed'` via a new DB-enforced `chk_recurrence_fixed_template`, closing the gap where a flexible Commitment could have technically held a `recurrence_rule` with no concrete time-of-day to expand from; `chk_no_due_on_recurring_flexible` is retired as superseded, since flexible recurrence is now structurally impossible outright, not merely restricted; (25) materialization is documented as guaranteeing `occurrence.mode = template.mode = 'fixed'`, application-enforced, no new trigger; (26) `weekly_capacity_minutes` semantics rewritten precisely — V1 has exactly one current stored value, no historical snapshots, no per-week overrides, the corrected wording no longer implies otherwise; (27) `updated_at` maintenance is explicitly locked as application-maintained across every table that has it, with no update trigger introduced.

---

## A. Commitment integrity

**Fixed/flexible field requirements — DB-enforced.** This is a hard structural rule with zero legitimate exceptions, so it belongs as a `CHECK` constraint:
```
(mode = 'fixed'    AND start_at IS NOT NULL AND end_at IS NOT NULL
                   AND due_at IS NULL AND estimated_duration_minutes IS NULL)
OR
(mode = 'flexible' AND estimated_duration_minutes IS NOT NULL
                   AND start_at IS NULL AND end_at IS NULL)
```
This single constraint mechanically enforces all four bullet points at once (fixed requires start/end, flexible requires estimate, fixed prohibits due_at, flexible prohibits start/end) — it's one rule, not four, because they're really one invariant viewed from different angles.

**Fixed cannot have TimeBlocks — DB-enforced, but indirectly.** Postgres has no native "this FK may only point to rows matching condition X" constraint without a trigger. Two options: (1) a trigger on `time_blocks` insert/update that checks the referenced Commitment's `mode`, or (2) rely on the fact that `time_blocks.commitment_id` references `commitments(id)` with no further restriction, and enforce the mode check purely at the application layer. **Decision: application-layer enforcement, not a trigger.** A trigger here is real, working machinery, but it duplicates a check the service layer already must perform anyway (you can't sensibly create a TimeBlock in application code without first loading the parent Commitment to schedule it against, at which point checking its mode is a one-line guard). Adding a DB trigger for a rule the application layer already has to touch doesn't buy independent safety, it just duplicates logic in two places that must stay in sync — a worse property than living in one place. This is a deliberate exception to "enforce structural invariants at the DB layer" because the enforcement point (an INSERT into `time_blocks`) is always going to be application-mediated in this project.

**Valid start/end ordering — DB-enforced.** `CHECK (end_at > start_at)` where both are non-null. Universal, zero exceptions, cheap.

**Valid estimated duration — DB-enforced, minimal.** `CHECK (estimated_duration_minutes IS NULL OR estimated_duration_minutes >= 0)`. Zero is explicitly allowed (locked conceptual model: a 0-minute flexible Commitment is a legitimate marker, per the earlier edge-case pass) — no lower bound above zero, no upper bound (an upper bound would be an arbitrary product opinion, not a structural fact).

**Valid status transitions — application-enforced, not DB-enforced.** Postgres can express a transition table only via a trigger comparing `OLD.status` to `NEW.status`, which is real complexity for a rule that's really a workflow policy (e.g., "can you go directly from `todo` to `archived`, or must you pass through `completed`?") rather than a structural fact about the data. This belongs in the service layer, where the business logic naturally lives alongside the code that also handles side effects of a transition (e.g., archiving cascades). Flagging this explicitly as a case where DB enforcement is *possible* but not worth it.

**`completed_at` consistency — DB-enforced (new, this pass).** A universal, structural pairing between `status` and `completed_at`, cheap and safe as a CHECK, with a deliberately simple three-way shape (not a full transition matrix):
```
CHECK (
  (status = 'completed' AND completed_at IS NOT NULL)
  OR
  (status IN ('todo', 'in_progress', 'skipped') AND completed_at IS NULL)
  OR
  (status = 'archived')  -- completed_at unconstrained: NULL if archived without
                          -- ever completing, NOT NULL if archived after completing
)
```
The `archived` branch is deliberately left unconstrained on `completed_at` rather than forced either way, because archiving is reachable from more than one prior state (Part K allows archiving a Commitment with completed TimeBlocks, but a Commitment could conceivably be archived without ever being marked complete) — this is the one place a single rigid rule would be wrong, so the CHECK is written to allow both, not to pick one.

**Recurrence template status — DB-enforced (new, this pass, important blocker fix).** The prior specification had no invariant preventing a recurrence template from reaching `status = 'completed'` or `status = 'skipped'` — a real bug, since the recurrence expansion rule only ever excludes `archived` templates from generating future virtual occurrences, so a completed or skipped *template* would silently keep generating new dates forever. **Locked rule:** a recurrence template's status is restricted to `todo`, `in_progress`, or `archived` only — `completed` and `skipped` remain valid statuses for materialized occurrence rows (which are ordinary, independent Commitments) but are structurally disallowed on the template row itself. A template row is uniquely identifiable as `recurrence_rule IS NOT NULL` (per the three-way recurrence CHECK in Part D), so this is expressible as a single additional CHECK with no cross-row inspection needed:
```
CHECK (
  recurrence_rule IS NULL
  OR status IN ('todo', 'in_progress', 'archived')
)
```
**Compatibility with the `completed_at` CHECK above, verified explicitly:** the two constraints interact only through the `status` value, and there is no overlap that could conflict. A template row can only ever have `status IN ('todo', 'in_progress', 'archived')` per this new rule; the `completed_at` CHECK's `todo`/`in_progress` branch requires `completed_at IS NULL` for those two (satisfied trivially, since a template row is never marked complete), and its `archived` branch is unconstrained on `completed_at` either way (also satisfied — an archived template simply has `completed_at = NULL`, since it was never completed, which the unconstrained branch permits). No combination of the two CHECK constraints is jointly unsatisfiable for a template row — both are simultaneously enforceable for every legal template state.

**Expansion rule, restated precisely to close the semantic gap:** only templates with `status IN ('todo', 'in_progress')` generate future virtual occurrences; `completed`, `skipped`, and `archived` templates generate none. This is now consistent both at the schema level (the CHECK above makes `completed`/`skipped` unreachable for a template in the first place) and at the query level (the expansion logic's exclusion filter is widened from "exclude archived only" to "include only todo/in_progress" — the same predicate, stated as an inclusion rather than a narrower exclusion, and now correctly total: since `completed`/`skipped` are structurally impossible for a template row, the two phrasings are equivalent, but stating it as an inclusion is the safer form to actually implement, since it fails closed if a future status value is ever added rather than fail open).

**Recurrence templates must be fixed-mode — DB-enforced (new, this pass, blocker fix; full treatment in Part D).** A structural gap existed: nothing previously forced `recurrence_rule IS NOT NULL ⇒ mode = 'fixed'`, so a *flexible* Commitment (which by the mode CHECK above has `start_at = NULL, end_at = NULL`) could in principle also be a recurrence template — but the `recurrence_rule` JSONB contract (Part D) derives every occurrence's time-of-day and duration from the template's own `start_at`/`end_at`, which a flexible template simply doesn't have. `chk_recurrence_fixed_template` closes this gap; see Part D for the constraint text and the full consequence analysis, including the retirement of the now-superseded `chk_no_due_on_recurring_flexible`.

**Application-level transition rules (not DB-enforced, since they govern *when* a transition may happen, not what a row looks like once it's settled):** moving into `completed` is the only transition that *sets* `completed_at` (to the current timestamp, by the service layer, at the moment of transition) — no other transition touches it. `completed → archived` is a pure status change; `completed_at` carries over unchanged, since the Commitment genuinely was completed at that timestamp regardless of being archived later. `todo`/`in_progress`/`skipped` → `archived` leaves `completed_at` at `NULL`, since it was never set. No transition is defined that moves a Commitment *out* of `archived` in V1 — archiving is treated as effectively terminal, matching the "archive rather than hard-delete" philosophy; nothing in the locked model calls for un-archiving, so it isn't built.

**Commitment `skipped` vs. TimeBlock `skipped` — explicit semantic distinction (new, this pass).** These are two different-scoped decisions that happen to share a status label, and the document has not previously distinguished them precisely:

- **`TimeBlock.status = 'skipped'`** is a *sub-allocation* decision: one particular planned session didn't happen. The work itself is not abandoned — only that one slot is un-claimed. Its duration is removed from `P_total(c)`/`P_valid(c)` (per the mathematical model), which means the time it represented reverts to unallocated demand; the parent Commitment's `RemainingDemand(c)` is **untouched** by this — a skipped TimeBlock changes only how much of the existing demand has a calendar slot, not how much demand exists in the first place.
- **`Commitment.status = 'skipped'`** is a *whole-Commitment* decision: the entire piece of work is being abandoned — the user has decided it will not be done at all, as distinct from `'completed'` (it was done). **Correction/clarification (this pass): `RemainingDemand(c)` must be forced to `0` when `Commitment.status = 'skipped'`, exactly as it already is for `'completed'`.** The original mathematical-audit rule only named `'completed'` explicitly (`RemainingDemand(c) := 0 if Commitment.status = 'completed'`) and was silent on `'skipped'` — a real gap, since without this override a skipped Commitment's `E(c) − A(c)` would still compute a positive remaining demand and continue generating phantom pressure in `DeadlinePressure(W)`/`UnallocatedDemand(c)` for work the user has explicitly said will never happen. The corrected rule:
```
RemainingDemand(c) =
    0                          if Commitment.status IN ('completed', 'skipped')
    max(0, E(c) − A(c))        otherwise
```
This is a clarification of the existing derived-metric formula, not a schema change — no new column, no new CHECK — since `RemainingDemand` is computed at query time and this simply extends the status values that short-circuit it. A skipped Commitment is not deleted and not archived by this alone (those remain separate, application-driven transitions per the archive-not-delete policy) — it simply stops contributing to forward-looking demand pressure while its history remains fully queryable, the same way a completed one does.

---

## B. TimeBlock integrity

**Every TimeBlock belongs to a flexible Commitment** — the FK itself (`NOT NULL`, `commitment_id REFERENCES commitments(id)`) enforces "belongs to *a* Commitment"; the *flexible-only* part is application-enforced, per the reasoning in section A above (same trigger-vs-service-layer tradeoff, same decision).

**`start_at < end_at`** — DB-enforced `CHECK (end_at > start_at)`. Same reasoning as Commitment: universal, no exceptions.

**Completed requires actual_duration_minutes; planned/skipped prohibit it** — DB-enforced:
```
CHECK (
  (status = 'completed' AND actual_duration_minutes IS NOT NULL)
  OR
  (status IN ('planned', 'skipped') AND actual_duration_minutes IS NULL)
)
```
This is a clean, universal structural rule — worth stating plainly why it's safe as a hard constraint and not a business-logic soft rule: there's no legitimate scenario where a `planned` block has an actual duration, or a `completed` one lacks one, so a `CHECK` costs nothing and closes off an entire class of bad states permanently.

**`actual_duration_minutes >= 0`** — DB-enforced, `CHECK (actual_duration_minutes IS NULL OR actual_duration_minutes >= 0)`.

**Upper bound on actual duration?** **No upper bound at the DB level.** The mathematical audit explicitly validated that actual can legitimately exceed planned (Scenario D, "planned 2h → actually takes 3h") with no ceiling implied anywhere in the locked model. An arbitrary cap (e.g., "actual can't exceed 24h") would be a product opinion smuggled into the schema as if it were a structural fact — reject it.

**Overlapping TimeBlocks — allowed, detected only, never prohibited.** This was resolved explicitly in the earlier architectural challenge and re-confirmed in the conceptual lock ("conflicts are derived, never stored"). Restating the reasoning for this pass: Postgres *can* prevent this via an `EXCLUDE USING gist` constraint on a `tstzrange`, but doing so would hard-block a case the product genuinely wants to allow (a user tentatively planning two overlapping options before picking one). No constraint is added; overlap is a read-time query concern (Part J covers the index that makes that query cheap).

---

## C. One-to-one domain extensions

**Enforcing exactly one Assignment/Exam/Shift per Commitment:** a `UNIQUE` constraint on `assignments.commitment_id` (and identically for `exams`, `shifts`) makes a second row for the same Commitment a constraint violation, not just an application convention — this is the correct, standard way to express a 1:1 relationship in a normalized schema without merging the tables.

**Keeping extension-specific fields out of `commitments`:** already the design — `weightage_percent`/`grade` live only on `assignments`/`exams`, `hourly_rate_override` only on `shifts`. Nothing new to decide here; restating it as satisfied.

**Should PostgreSQL enforce mutual exclusivity between Assignment/Exam/Shift** (i.e., prevent one Commitment from having *both* an Assignment row and a Shift row, which would be a nonsensical state)? **This is a genuine open decision the lock didn't specify — flagging it explicitly rather than assuming.** Two real options:
- A DB-level check via a trigger that queries the other two extension tables before allowing an insert — possible, but this is the same "real complexity for a rule that's really about the application's own data-entry flow" pattern as the transition-validation question above. A Commitment's `category` (study/work/personal/etc.) already implies which extension, if any, is appropriate — the application layer that creates an Assignment already knows it's doing so *because* the Commitment is study-flexible, and it's the natural place to also guarantee it isn't simultaneously being set up as a Shift.
- **Decision: application-layer enforcement.** No cross-extension-table trigger. The 1:1-per-extension-type UNIQUE constraints already prevent the more likely and more damaging mistake (duplicate Assignment rows for one Commitment); preventing the cross-type nonsense case is cheap to check in the one code path that creates extension rows, and doesn't need database machinery.

**Domain-mode/category pairing invariants — explicitly documented, application-enforced (new, this pass).** Beyond mutual exclusivity between extension types, each extension type has its own required pairing with the parent Commitment's `mode` and `category`, which the schema does not and should not enforce structurally (the same trigger-vs-service-layer reasoning as above applies — these are data-entry-flow rules checked at the one place each extension row is ever created, not intrinsic structural facts about the columns themselves):
- **Assignment → the parent Commitment must be `mode = 'flexible'` and `category = 'study'`.** An assignment is exactly the "10 hours of demand, due Friday" shape from the earliest conceptual work — it is definitionally flexible.
- **Exam → the parent Commitment must be `mode = 'fixed'` and `category = 'study'`.** An exam sitting is a specific two-hour slot, not a pool of demand — definitionally fixed.
- **Shift → the parent Commitment must be `mode = 'fixed'` and `category = 'work'`.** A shift is a specific clocked-in span, not flexible demand.

No triggers are added for these, per your explicit instruction — they are documented here as the exact rules the application's create/edit flows must check before writing an `assignments`/`exams`/`shifts` row, alongside the already-documented cross-type exclusivity check.

---

## D. Recurrence

**Fields:** `recurrence_rule JSONB`, `recurrence_end_date DATE`, `recurrence_template_id UUID` (self-referential FK to `commitments.id`), `occurrence_date DATE`.

**`recurrence_rule` minimum V1 application contract (new, this pass) — locked so no major design question remains open after DDL, without building a full recurrence engine or any new table:**

- **Supported `freq` values:** `"weekly"` only. No `"daily"`, `"monthly"`, or `"yearly"` in V1 — a daily-repeating task is expressible as `"weekly"` with all seven weekdays listed, so no separate `"daily"` value is needed; monthly/yearly recurrence is simply unsupported and out of scope.
- **`interval` semantics:** an optional integer, default `1`, meaning "every Nth week" — e.g. `interval: 2` with `days: ["MON"]` means every other Monday. If omitted, `interval` is treated as `1`.
- **Weekly weekdays:** a `days` array of short uppercase codes — `"MON"`, `"TUE"`, `"WED"`, `"THU"`, `"FRI"`, `"SAT"`, `"SUN"` — at least one required. Example: `{"freq": "weekly", "interval": 1, "days": ["MON", "WED", "FRI"]}`.
- **Local time representation:** `recurrence_rule` itself carries **no time-of-day field** — the time each occurrence happens at is taken directly from the template Commitment's own `start_at`/`end_at` (for a fixed-mode template), interpreted in the user's `timezone`. This is deliberate: storing a redundant time-of-day inside the JSONB would create a second source of truth alongside `start_at`, exactly the class of duplication corrected elsewhere in this document (Part E-0) — the template's own timestamp fields are the only source of truth for time-of-day.
- **How the IANA timezone is applied:** at virtual-expansion time, the application takes the template's `start_at`/`end_at` (stored as `timestamptz`, i.e. absolute UTC instants), converts them into the user's local wall-clock time-of-day using `users.timezone`, then re-projects that same local wall-clock time onto each target date the pattern generates, converting back to `timestamptz` for that specific date in the same IANA zone. This is precisely what makes DST transitions correct automatically (Part G) — the wall-clock time-of-day is what repeats, not a fixed UTC offset.
- **How fixed duration is obtained:** every generated occurrence has the same duration as the template — computed once as `template.end_at − template.start_at` (a plain interval, e.g. "2 hours"), then applied to each generated start time to produce that occurrence's end time. The template's own duration is never re-derived per occurrence; it's fixed at the pattern level.
- **Explicitly unsupported in V1** (stated plainly so no one goes looking for machinery that isn't there): monthly/yearly frequencies; ordinal/positional patterns (e.g. "the second Tuesday of the month"); multiple different times-of-day within one series; split-series pattern edits (already locked as deferred); per-occurrence duration overrides at the template level (an individual materialized occurrence can still have its own edited `start_at`/`end_at` once it exists as an independent row — that's normal post-materialization editing, not a recurrence-engine feature); and recurring flexible Commitments with `due_at` (locked as unsupported in the prior pass).

**Revision (correction pass): the prior pairing constraint was insufficient — it only related `recurrence_template_id` and `occurrence_date` to each other, and said nothing about `recurrence_rule` or `recurrence_end_date`. A row could satisfy the old pairing check while still, say, carrying both `recurrence_rule` and `recurrence_template_id` at once — a state with no legitimate meaning. This is replaced by a single three-way exclusive `CHECK` that names all three legal states explicitly, fully DB-enforced, no cross-row inspection needed:**

```
CHECK (
  -- Normal, non-recurring Commitment
  (recurrence_rule IS NULL AND recurrence_template_id IS NULL
   AND occurrence_date IS NULL AND recurrence_end_date IS NULL)
  OR
  -- Recurrence template (recurrence_end_date optional even here — an
  -- indefinite series is legitimate)
  (recurrence_rule IS NOT NULL AND recurrence_template_id IS NULL
   AND occurrence_date IS NULL)
  OR
  -- Materialized occurrence
  (recurrence_rule IS NULL AND recurrence_template_id IS NOT NULL
   AND occurrence_date IS NOT NULL AND recurrence_end_date IS NULL)
)
```

This directly satisfies every sub-requirement: `recurrence_end_date` can only be non-null in the template branch; `occurrence_date` can only be non-null in the occurrence branch; `recurrence_template_id` can only be non-null in the occurrence branch; `recurrence_rule` can only be non-null in the template branch — because each is pinned to exactly one of the three mutually exclusive branches, not merely paired with one other field.

**Preventing a Commitment from being its own template — DB-enforced, unchanged.** `CHECK (recurrence_template_id IS NULL OR recurrence_template_id != id)`.

**Preventing chained occurrences (an occurrence's `recurrence_template_id` pointing at another occurrence rather than a true template) — remains application-enforced.** The three-way CHECK above guarantees the *referenced row's own shape* is consistent (it's either a template or an occurrence, never both, never neither-but-something-else), but Postgres CHECK constraints cannot inspect a *different* row, so nothing at the DB level stops `recurrence_template_id` from pointing at a row that is itself an occurrence rather than a template. This stays application-enforced: the one code path that materializes occurrences always sets `recurrence_template_id` to the *original* template's id, never to another occurrence's id.

**UNIQUE constraints:**
- `UNIQUE (recurrence_template_id, occurrence_date)` on `commitments` — prevents materializing the same date twice for one series. DB-enforced, unchanged; Postgres treats NULLs as distinct in a UNIQUE constraint, so non-recurring and template rows (where `recurrence_template_id` is NULL) never collide against each other or against real occurrence rows.
- `UNIQUE (commitment_id, excluded_date)` on `commitment_exceptions` — unchanged.

**`commitment_exceptions.commitment_id` must reference a template, not an occurrence** — cannot be expressed as a CHECK (cross-table reasoning), so this remains application-enforced, unchanged from the prior pass.

**Same-user integrity for `recurrence_template_id`** — see Part L below; this self-referential FK is one of the relationships that now requires a composite FK to prevent a cross-user reference.

**Recurrence templates must be fixed-mode — resolved definitively (this pass, 🔴 blocker fix), superseding the prior `due_at`-specific restriction below.** The previous pass restricted recurring flexible Commitments only with respect to `due_at` (`chk_no_due_on_recurring_flexible`, shown further below), treating the problem as "a flexible template can't coherently hold one `due_at` across all its occurrences." That framing was too narrow — it left the door open for a flexible Commitment to be a recurrence template at all, `due_at` aside. Re-examining directly against the `recurrence_rule` JSONB contract above: every occurrence's time-of-day and duration are derived from the *template's own* `start_at`/`end_at` (a fixed-mode-only pair, per the mode CHECK in Part A). A flexible Commitment has `start_at = NULL, end_at = NULL` by the same CHECK — so a flexible template would have no concrete time to expand from in the first place, independent of whether it also carries a `due_at`. The correct, narrower fix is a single structural constraint tying `recurrence_rule` directly to `mode`, rather than a rule that only reaches the `due_at` symptom:
```
CHECK (
  recurrence_rule IS NULL
  OR mode = 'fixed'
)
```
Named `chk_recurrence_fixed_template`, fully DB-enforced, no cross-row inspection required — it inspects only `recurrence_rule` and `mode` on the same row. **Consequence, stated explicitly: Orbit V1 supports recurring fixed Commitments only. Flexible Commitments cannot be recurrence templates.** A materialized occurrence's own `mode` is governed by the materialization invariant immediately below (always inherited as `'fixed'` from its template), so this single CHECK on the template row is sufficient to make flexible recurrence structurally impossible end-to-end — not just for the template, but transitively for every occurrence it could ever produce, since a template is the only place a recurring series originates from.

**`chk_no_due_on_recurring_flexible` — retired, superseded (this pass).** The prior CHECK (shown below for the historical record, not to be carried into DDL) restricted only the narrower case of a recurring flexible Commitment carrying `due_at`:
```
-- SUPERSEDED — do not include in DDL
CHECK (
  NOT (
    mode = 'flexible'
    AND (recurrence_rule IS NOT NULL OR recurrence_template_id IS NOT NULL)
    AND due_at IS NOT NULL
  )
)
```
With `chk_recurrence_fixed_template` in place, a flexible Commitment can never have `recurrence_rule IS NOT NULL` at all (the template side), and a materialized occurrence is now guaranteed `mode = 'fixed'` by the materialization invariant below (the occurrence side) — so the condition this CHECK was built to catch (`mode = 'flexible' AND (recurrence_rule IS NOT NULL OR recurrence_template_id IS NOT NULL)`) can never be satisfied by any legally-constructed row in the first place. A CHECK that can never fire is not a safety net, it's dead weight in the DDL — per your explicit instruction not to retain redundant constraints without a strong structural reason, and there is none here: the stronger fixed-template invariant fully subsumes it. **Decision: remove `chk_no_due_on_recurring_flexible` entirely; it does not appear in the eventual DDL.** A non-recurring flexible Commitment (both recurrence fields NULL) was never restricted by either CHECK and continues to support `due_at` exactly as before.

**Materialization invariant — `template.mode = 'fixed' ⇒ occurrence.mode = 'fixed'` (new, this pass, application-enforced, no new trigger).** Since `chk_recurrence_fixed_template` guarantees every template is fixed-mode, and every materialized occurrence originates from exactly one template (via the materialize-on-touch code path), the application's materialization step sets the new occurrence row's `mode = 'fixed'` directly — copied from the template at creation time, the same way it copies duration (Part D, `recurrence_rule` contract above). This is documented as application-enforced rather than a database trigger for the same reason materialization's other field-copying behavior already is (Part 6, "application-enforced" list, "materialization's copy-fields-from-template-once behavior"): it is a one-time action at a single, already-application-mediated code path (the same path that sets `recurrence_template_id` and `occurrence_date`), not a standing invariant that could otherwise be violated by an unrelated write — adding a trigger here would duplicate logic the application must already have, exactly the pattern rejected elsewhere in this document (Part A, "Fixed cannot have TimeBlocks"). **Scope of this invariant, stated precisely so no further recurrence inheritance rules are implied:** only `mode` is fixed by inheritance at materialization time. Once a materialized occurrence exists, it is an ordinary, independent Commitment row — its own `status`, `start_at`/`end_at`, `category`, `goal_id`, and any domain extension (Assignment/Exam/Shift) follow the normal, already-documented editing rules for any fixed Commitment (Parts A, C, E), with no additional recurrence-specific inheritance or restriction beyond the one `mode` guarantee this paragraph establishes. This is a deliberately minimal invariant, not a general "occurrences track their template" rule — no such general rule exists in V1, and none is introduced here.

**Correction (this pass): `recurrence_template_id`'s deletion behavior is revised from `SET NULL` to `RESTRICT`, and templates are archived rather than hard-deleted once they have materialized occurrences.** The prior `SET NULL` policy was structurally incompatible with the three-way exclusive CHECK above: an occurrence row has `occurrence_date NOT NULL` by definition, but `SET NULL`ing its `recurrence_template_id` on template deletion would leave `recurrence_template_id NULL` while `occurrence_date` stays populated — a state the three-way CHECK explicitly forbids (it isn't the normal state, the template state, or the occurrence state; it's a fourth, illegal shape). Rather than adding a fourth legal state to accommodate this, the deletion policy itself is corrected: `commitments.recurrence_template_id → RESTRICT`. A template with any materialized occurrence referencing it cannot be hard-deleted at all — the delete is rejected outright.

**Resulting lifecycle:** a recurrence template that has never generated a materialized occurrence (no one has touched any date in the series yet) has no rows referencing it, so `RESTRICT` allows a hard delete with no special handling — nothing of value exists to lose. The moment a series is touched (a date gets scheduled, completed, or individually edited) and materializes its first occurrence, the template becomes permanently non-hard-deletable — the application must instead set the template's own `status = 'archived'`, which stops it from generating any further *virtual* future occurrences (the expansion query simply excludes archived templates) while leaving every existing materialized occurrence, with its own independent history, fully intact. This is a direct application of the same archive-not-delete principle already governing Commitments with completed TimeBlocks — a recurrence template with materialized occurrences is, in effect, a Commitment with real historical dependents, and gets the same treatment.

**`commitment_exceptions` deletion consistency:** `commitment_exceptions.commitment_id → CASCADE`, unchanged, and this is now provably consistent with the corrected policy above. Exceptions only ever attach to templates. If a template is hard-deleted (the no-materialized-occurrences case), cascading its exceptions away is correct — nothing else references them. If a template is archived rather than deleted (the has-materialized-occurrences case), no deletion occurs at all, so the exceptions simply remain attached and meaningful, continuing to suppress the excluded dates from any future virtual expansion of the now-archived template. No contradiction remains in either branch.

**Locked semantic rule (this pass): a recurrence template row is never itself counted as real calendar occupancy.** A *fixed* recurrence template necessarily carries `start_at`/`end_at` (the fixed-mode CHECK from Part A requires it), but those values serve only as the recurrence anchor — the time-of-day and duration the pattern repeats at — not an actual, additional occupied block on top of whatever the pattern generates. `FixedOccupied(W)`, `Occupied(W)`, and any calendar-display query must exclude template rows explicitly. Since a template row is uniquely identifiable as `recurrence_rule IS NOT NULL` (guaranteed unique to the template branch by the three-way CHECK in this Part), the exclusion is a simple, always-available filter: any query scanning `commitments` for actual scheduled time uses `WHERE recurrence_rule IS NULL`, which correctly retains ordinary non-recurring fixed Commitments and materialized occurrences (both have `recurrence_rule = NULL` per the three-way CHECK) while excluding every template row. Real scheduled calendar time within a given range therefore comes from exactly two sources: (1) materialized occurrence rows that fall in range, and (2) *virtual* occurrences — computed at query time by expanding a template's `recurrence_rule` against the requested date range, for dates that are neither excepted nor already materialized — never the template row itself. This distinction must be applied consistently everywhere occupancy or calendar display is computed, including the partial index on fixed Commitments (see Part J correction below).

---

## E-0. Correction: removing the duplicated Module relationship

**Prior spec had `module_id` on `commitments`, `assignments`, and `exams` simultaneously — three competing sources of truth for the same fact (which module a piece of academic work belongs to). Corrected: `commitments` no longer has a `module_id` column at all.**

The relationship is now strictly: `Commitment → Assignment → Module` and `Commitment → Exam → Module`. **Why this is the normalized representation:** a generic `commitments.module_id` only makes sense for Study-category Commitments, so it would sit `NULL` for every fixed lecture, every Work shift, every Personal task — a column that's meaningful for a small, category-dependent subset of rows is itself a normalization smell, and here it's worse than usual because the *same fact* (which module) could then be set on the Commitment row, on the Assignment row, or on the Exam row independently, with nothing preventing them from disagreeing. Since `Assignment` and `Exam` are already the tables that exist specifically to hold Study-domain-specific information (per the "Commitment = time demand, Assignment/Exam = domain information" split established earlier), the module relationship belongs there and only there — it's domain information, exactly like `weightage_percent`. A lecture that isn't an Assignment or Exam (a plain fixed Study-category Commitment, e.g. a lecture with no assignment/exam extension row) simply has no module relationship in V1 — which is honest, since the locked model never specified how a bare lecture would be tied to a module, and inventing that now would be adding scope, not fixing a bug.

`commitments` table specification and the ERD below are both updated to remove `module_id` accordingly; `assignments.module_id` and `exams.module_id` are retained exactly as before.

## L. Same-user ownership integrity

**The question:** for every relationship where one user-owned row references a different user-owned row, can Postgres itself guarantee both rows belong to the same user — closing off the possibility that User A's Commitment ends up pointing at User B's Goal (or Module, or Job) through nothing more than an application bug?

**The pattern, applied selectively, not everywhere:** a composite foreign key — `FOREIGN KEY (user_id, <ref>_id) REFERENCES <parent_table>(user_id, id)` — requires the referencing table to also carry `user_id` locally, and requires the referenced table to expose `UNIQUE (user_id, id)` (in addition to its existing primary key on `id` alone) as the target of that composite FK. Postgres composite FKs are checked with `MATCH SIMPLE` by default, meaning if *any* column in the composite key is NULL, the constraint isn't evaluated — which is exactly right for nullable references like `goal_id`, `module_id`, and `job_id`: a Commitment with no goal at all shouldn't be blocked by this constraint, only one that *does* reference a goal must reference one belonging to the same user.

**Which relationships genuinely need this, and why others don't:**

| Relationship | Needs composite FK? | Reasoning |
|---|---|---|
| `commitments.goal_id → goals.id` | **Yes** | Two independently user-owned entities being cross-referenced; nothing else guarantees the Goal belongs to the Commitment's own user |
| `assignments.module_id → modules.id` | **Yes** | Same reasoning — Module is independently owned |
| `exams.module_id → modules.id` | **Yes** | Same reasoning |
| `shifts.job_id → jobs.id` | **Yes** | Same reasoning |
| `commitments.recurrence_template_id → commitments.id` (self-referential) | **Yes** | Both sides are Commitments, but they are still two *independently retrievable* rows — nothing prevents User A's occurrence from being pointed at User B's template unless this is enforced the same way |
| `time_blocks.commitment_id → commitments.id` | **No** | Only one reference exists, so there's no second, independently-owned entity for a composite key to reconcile against — but see the explicit reclassification below: this does not mean ownership is database-guaranteed, only that the composite-FK *pattern* doesn't apply |
| `commitment_exceptions.commitment_id → commitments.id` | **No** | Same reasoning as TimeBlock |
| `assignments/exams/shifts.commitment_id → commitments.id` | **Yes, added as a secondary benefit** | Not strictly required by the "two independently-owned entities" test on its own, but since these tables must already gain a local `user_id` column to support the Module/Job composite FKs above, verifying the extension row's `user_id` actually matches its own parent Commitment's `user_id` closes the loop at negligible extra cost — see below |

**Mechanics required to make this work:**

- `goals`, `modules`, `jobs`, and `commitments` each gain `UNIQUE (user_id, id)` (in addition to their existing `PRIMARY KEY (id)`) — this is what a composite FK is allowed to reference.
- `commitments.goal_id`'s existing FK becomes a composite FK: **`FOREIGN KEY (user_id, goal_id) REFERENCES goals (user_id, id) ON DELETE SET NULL (goal_id)`** — `commitments` already has `user_id` locally, so no new column is needed here. **Correction (this pass): the column-specific form `SET NULL (goal_id)` is required, not plain `SET NULL`.** Postgres's default `ON DELETE SET NULL` on a composite FK nulls *every* column in the composite key — here that would mean nulling both `goal_id` and `user_id` on the referencing `commitments` row, which is impossible, since `commitments.user_id` is `NOT NULL`; the delete would fail with a constraint violation instead of degrading gracefully. The column-specific syntax (`ON DELETE SET NULL (goal_id)`, available in PostgreSQL 15+) nulls only the named column, leaving `user_id` untouched — this is the form that must appear in the eventual DDL.
- `commitments.recurrence_template_id`'s existing FK is **`FOREIGN KEY (user_id, recurrence_template_id) REFERENCES commitments (user_id, id) ON DELETE RESTRICT`** — self-referential, no new column needed. **Correction (this pass): this must read `RESTRICT`, not `SET NULL`.** The locked deletion policy for `recurrence_template_id` (Part D) is `RESTRICT`, not `SET NULL` — the composite version of this FK must carry the same policy as the simple version it replaces; there is exactly one deletion policy for this relationship, stated once, consistently, everywhere it's mentioned in this document. (`RESTRICT` requires no column-specific handling, since it never modifies the referencing row at all — the delete is simply rejected outright if any occurrence still references the template.)
- `assignments`, `exams`, and `shifts` each gain a new `user_id` column (denormalized, populated from the parent Commitment at creation time — this is the one place in the schema where a value is deliberately duplicated, and it's justified purely because composite FK enforcement requires a local column to build the composite key from). Each then gets:
  - `FOREIGN KEY (user_id, commitment_id) REFERENCES commitments (user_id, id) ON DELETE CASCADE` — this replaces the plain `commitment_id` FK and, as a side effect, guarantees the extension row's `user_id` is consistent with its own parent's `user_id` (an application bug that set them inconsistently would be rejected outright at insert time).
  - `assignments`/`exams`: `FOREIGN KEY (user_id, module_id) REFERENCES modules (user_id, id) ON DELETE RESTRICT` (nullable `module_id`, so `MATCH SIMPLE` skips the check when null).
  - `shifts`: `FOREIGN KEY (user_id, job_id) REFERENCES jobs (user_id, id) ON DELETE RESTRICT` (same nullable handling).

**What this guarantees, concretely:** it is now structurally impossible — not just discouraged by application code — for a Commitment to reference a Goal belonging to a different user, for an Assignment/Exam to reference a Module belonging to a different user, for a Shift to reference a Job belonging to a different user, or for a recurrence occurrence to reference a template belonging to a different user. **This claim is scoped precisely to the relationships listed in the table above that actually carry a composite FK — it does not extend to `time_blocks.commitment_id` or `commitment_exceptions.commitment_id`, which remain simple FKs; see the correction immediately below.**

**Correction (this pass) — `time_blocks` and `commitment_exceptions` ownership, reclassified honestly:** the original table above marked these two relationships "No composite FK needed" on the reasoning that there's no second independently-owned entity for a mismatch to occur *against*. That reasoning correctly explains why the *composite-FK pattern* doesn't apply here (there's only one reference, not two competing ones to reconcile) — but it does **not** mean the database independently guarantees a `TimeBlock` or an exception row belongs to the right user. Neither table stores `user_id` locally, so nothing at the schema level can check "does this TimeBlock's owner match the caller" without first joining to `commitments`. **Explicit reclassification: same-user correctness for `time_blocks.commitment_id` and `commitment_exceptions.commitment_id` is application-enforced, not database-guaranteed.** In practice this is a materially smaller risk than the Goal/Module/Job case — a TimeBlock is never created by looking up an arbitrary `commitment_id` from a general cross-user-visible list (the way a Goal or Module might be selected from a dropdown); it's always created in the context of a specific, already-loaded, already-ownership-checked Commitment object — but "materially smaller risk" is not "structurally impossible," and this document should not claim the latter for these two relationships. **Decision: keep the simpler design (no local `user_id`, no composite FK) for both tables**, per your explicit preference for the simpler V1 design absent a compelling integrity reason — the application must always authorize TimeBlock and exception operations by first loading and checking the parent Commitment's `user_id`, and every query that lists a user's TimeBlocks must join through `commitments` to scope correctly (a plain `WHERE time_blocks.user_id = :x` is not possible and must not be assumed anywhere in the eventual API layer).

---

## E. Goals / Modules / Jobs — deletion behavior

| Event | Behavior | Reasoning |
|---|---|---|
| **Goal deleted** | `commitments.goal_id` → `SET NULL (goal_id)` — column-specific, since `commitments.user_id` is `NOT NULL` and cannot be nulled by the same operation | Losing a goal shouldn't delete or block the Commitments that referenced it; they simply stop contributing to a goal that no longer exists — graceful degradation, no data loss |
| **Module deleted** | `RESTRICT` (blocks delete if any `assignments`/`exams` reference it) | A Module with academic history attached shouldn't vanish silently, taking weightage/grade records' context with it |
| **Job deleted** | `RESTRICT` (blocks delete if any `shifts` reference it) | Same reasoning — a Job with shift history shouldn't disappear out from under those records |
| **Commitment archived** | No FK effect — `status` is just set to `'archived'`; every child row (TimeBlocks, extension row) remains fully attached and queryable | Archiving is explicitly *not* deletion — it's the locked model's alternative to hard-deleting a Commitment with completed work |
| **Commitment deleted (only planned TimeBlocks, no completed work)** | `time_blocks` → `CASCADE`; extension row → `CASCADE` | Nothing of value is lost — planned-but-never-done allocations and pure domain-detail rows have no independent meaning once their parent is gone |
| **Commitment deleted (has completed TimeBlocks)** | Blocked before reaching the DB — application layer checks for any `completed` TimeBlock and refuses the delete, offering archive instead | This is the direct schema-level implementation of the locked "archive rather than hard-delete completed work" rule — the DB mechanics (`CASCADE`) stay simple; the judgment call lives in application code |
| **Recurrence template deleted** | **Corrected (this pass): `RESTRICT`, not `SET NULL`.** Rejected outright while any materialized occurrence references it | A materialized occurrence is a real, independent Commitment with its own history; `SET NULL` here would leave `occurrence_date` populated with `recurrence_template_id` now NULL — a state the three-way recurrence CHECK (Part D) forbids. The template must instead be archived once it has materialized occurrences, per Part D's lifecycle |

---

## F. Capacity

**Stored: exactly one field, `users.weekly_capacity_minutes`.** A flat weekly baseline, per the locked model and the earlier explicit validation against Models 1–4 (waking hours / productive hours / capacity-minus-fixed / configurable windows) — Model 2 (user-defined productive hours) was chosen and re-confirmed since; nothing in this pass reopens that.

**Not stored:** `RemainingDemand`, `UnallocatedDemand`, `UnfulfilledDeadlineDemand`, `Occupied(W)`, `DeadlinePressure(W)`, `FreeCapacity(W)` — all fully derived at query time from `commitments`/`time_blocks`, per your explicit instruction and consistent with every prior checkpoint's "prefer derived" conclusion. No Availability table, per your explicit instruction — deferred, and nothing in the V1 schema needs to anticipate its shape.

**Granularity — why weekly, not daily or per-session:** a weekly baseline is the coarsest granularity that still supports every equation in the locked mathematical model (`Occupied(W)`, `DeadlinePressure(W)`, `FreeCapacity(W)` are all defined over an arbitrary period `W`, and "week" is simply the chosen instantiation of `W` for V1). A daily figure would require either seven columns or a child table — real added structure for a distinction (varying capacity by day of week) that the locked model never asked for and that belongs to the explicitly-deferred Availability feature.

**`W` locked precisely (new, this pass): in V1, `W` is always exactly one complete user-local calendar week — Monday 00:00 through Sunday 23:59:59.999, evaluated in the user's own `timezone` (Part G), never a rolling window, never an arbitrary date range chosen by a query caller.** The mathematical model states its equations over a general period `W` because that's the correct level of abstraction for the *math* — but the schema and application layer commit to a single concrete instantiation of `W` for V1: one ISO-style calendar week, per the earlier week-boundary lock. No daily or monthly capacity infrastructure is introduced to support any other instantiation of `W`; if a future version needs an arbitrary-period capacity calculation, the equations already support it algebraically — only the application's period-selection logic would need to change, not the stored schema.

**`weekly_capacity_minutes` semantics, stated precisely (rewritten, this pass — the prior wording is corrected below because it implied more than V1 actually stores):**

> `users.weekly_capacity_minutes` is the user's current weekly capacity setting. Capacity calculations use the current stored value for whichever user-local calendar week is being evaluated. V1 does not maintain historical per-week capacity snapshots or overrides.

Unpacking this precisely: `Capacity(W)` in the `FreeCapacity(W)` equation is simply this one stored value, read directly, for whichever calendar week `W` is being evaluated — the same number is used whether `W` is the current week, a past week, or a future week, because there is exactly one value in storage at any given time, not one per week. **The prior wording ("the new value applies to all future week evaluations from that point forward") is corrected here because it could be misread as implying a *past* value is preserved for past weeks** — it is not; there is no history table, no per-week row, nothing that lets a query ask "what was capacity 3 weeks ago" and get anything other than today's current value. If the user changes `weekly_capacity_minutes` today, a capacity calculation run tomorrow for *last* week uses today's value, not whatever was in effect last week — V1 simply has no mechanism to know or represent the difference. This is a deliberate, named limitation, not an oversight: it is not divided, prorated, or otherwise adjusted for partial weeks, and there is no per-week override (a user cannot set "this specific week I only have 20h" — that would be exactly the kind of daily/weekly exception infrastructure this pass explicitly declines to add). Historical per-week capacity snapshots and per-week capacity overrides both remain explicitly deferred, per Part 7 below.

---

## G. Time and timezone strategy

**All timestamp columns use `TIMESTAMPTZ`**, not `TIMESTAMP`: `start_at`, `end_at`, `due_at`, `created_at`, `updated_at`, `completed_at`. Restating and locking the reasoning from the earlier DDL pass, since this section explicitly asks not to hand-wave it: Postgres `timestamptz` stores a UTC instant internally regardless of the session's timezone setting and converts for display only — this guarantees that "lecture at 9am Monday" refers to one unambiguous point in absolute time no matter what timezone a future API server, background job, or second client runs in. `TIMESTAMP` (no timezone) would let an ambiguous local time slip into storage, which is exactly the class of bug the multi-checkpoint effort on week-boundary math has been trying to eliminate — using it anywhere would undermine that work.

**All timestamps are normalized to UTC in storage** (this is what `timestamptz` does natively — there is nothing extra to implement; the type itself guarantees it). The application converts to/from the user's local time only at the display and input boundary.

**User timezone: `users.timezone`, an IANA zone name (e.g. `"Asia/Singapore"`), not a UTC offset.** An offset (`+08:00`) is wrong for this purpose because it doesn't survive daylight-saving transitions correctly for zones that observe DST — an IANA name encodes the *rules*, not a snapshot offset, so `"America/New_York"` correctly resolves to different offsets in January versus July. Not hardcoding Singapore: this is a plain per-user string column with no schema-level assumption about which zone is "default" beyond an application-level default value, satisfying your explicit instruction not to bake Singapore into the architecture.

**`due_at` behavior:** stored as `timestamptz` like every other timestamp — a deadline is a specific instant, and the earlier mathematical audit's week-boundary rule ("an instant belongs wholly to the week containing it, in the user's local time") depends on `due_at` being an unambiguous absolute instant that can be converted into the user's local calendar week on demand.

**Recurring occurrences across timezone/DST changes — this needs explicit handling, and the locked model doesn't fully specify it.** The risk: `recurrence_rule` describes a *local* pattern ("every Monday at 9am, my time"), but the pattern itself contains no timestamp — it's expanded into concrete `timestamptz` instants only when a virtual occurrence is generated, using the user's *current* `timezone` value at expansion time. This means: if a user's timezone is stable, DST transitions are handled correctly and invisibly, because "9am Monday" in a DST-observing zone naturally resolves to a different UTC instant on either side of the transition — this is exactly the behavior IANA zone-based expansion gives you for free. **The one genuine edge case worth naming:** if a user's `timezone` value itself changes (e.g., they physically relocate and update their profile), any *already-materialized* future occurrences retain their original concrete `timestamptz` (correct — they were fixed at creation), while any *not-yet-materialized virtual* occurrences will expand using the *new* timezone going forward. This is a reasonable, low-friction default and requires no new field — but it's worth stating explicitly as a decision rather than an accident, since it wasn't spelled out in the lock.

---

## G-1. `updated_at` maintenance (new, this pass)

**`updated_at` is application-maintained, not database-maintained. No update trigger is introduced.** Every table that has an `updated_at` column (`users`, `goals`, `commitments`, `time_blocks` — the four tables that actually declare one; `modules`, `jobs`, `assignments`, `exams`, `shifts`, and `commitment_exceptions` have only `created_at` and are unaffected by this correction) retains `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()` in the DDL, but that `DEFAULT` clause only ever fires on `INSERT` — Postgres does not re-apply a column default on `UPDATE`, so relying on the default alone would silently leave `updated_at` frozen at creation time forever, a real gap the prior wording glossed over by not stating who is responsible for the column after row creation.

**Locked rule:**

> `updated_at` is application-maintained. Every application-level UPDATE to a row must set `updated_at = now()`.

This is a single, consistent rule applied identically across all four tables that have the column — not a per-table decision. **Why a trigger is deliberately not used, per your explicit instruction:** a `BEFORE UPDATE` trigger that stamps `updated_at = now()` automatically is the standard alternative, and would be more foolproof (no application code path could forget it) — but it is also standing database machinery introduced solely to save one line at each of the application's own UPDATE call sites, which already exist and already have to construct the SET clause. This is the same tradeoff already made deliberately elsewhere in this document (Part A, "Fixed cannot have TimeBlocks"; this pass's materialization-invariant paragraph in Part D): where the enforcement point is always application-mediated anyway, adding DB-side machinery duplicates logic across two layers rather than keeping it in one. For V1, the application's data-access layer (the single shared code path every UPDATE goes through) sets `updated_at = now()` on every write — a one-line convention, not a framework — with the explicit acknowledgment that this depends on every UPDATE going through that shared path; if a future version needs a stronger guarantee independent of application discipline, a trigger remains a simple, well-understood thing to add later without any schema redesign.

---

## H. IDs

**Recommendation: UUIDv7** (time-ordered UUIDs), generated application-side.

**Correction (this pass): this specification previously said "UUIDv7, application-side" in prose while the table specification's `Default` column said `generated` for every primary key — an ambiguity, since `generated` reads as if the database is expected to supply the value (e.g. via a `DEFAULT gen_random_uuid()` clause). That ambiguity is resolved now: no PostgreSQL-side default is assumed for any primary key.** Every `id` column's `Default` is `none — application-generated`; the application generates a UUIDv7 value before the INSERT is issued, every time, for every table with a UUID primary key. The eventual DDL must not include a `DEFAULT gen_random_uuid()` clause (or any equivalent) on these columns — `gen_random_uuid()` produces a v4 UUID, and silently attaching it as a column default would quietly substitute v4 generation the moment application code ever forgot to supply an id explicitly, defeating the v7 decision without anyone noticing. Table specifications in Section 2 are corrected accordingly.

- **BIGINT (auto-increment)** — smallest storage, fastest joins, but leaks row-count/creation-order information and requires a round-trip to get an ID before referencing a not-yet-inserted row in application code (a real annoyance for the materialize-on-touch recurrence flow, where the application often wants to construct a full object graph before committing).
- **UUIDv4 (random)** — the standard "use a UUID" default; solves the pre-generation problem, but random UUIDs fragment B-tree indexes over time (each insert lands in an arbitrary index location, not append-mostly), which matters for a table like `time_blocks` that will accumulate rows continuously.
- **UUIDv7 (time-ordered)** — keeps the pre-generation and non-guessability benefits of UUIDs while remaining mostly-sequential at insert time, which keeps index locality good (append-mostly, like BIGINT) without leaking a literal row count. This is a genuinely better default for a "portfolio-quality SaaS" than plain v4 at negligible extra cost, and worth knowing about specifically because it's a detail many otherwise-solid student projects miss — a good, concrete thing to be able to explain in an interview.

**Recommendation stands: UUIDv7 for all primary keys**, generated application-side (via a small library) rather than relying on Postgres extension availability, since UUIDv7 generation support varies across Postgres versions/extensions and application-side generation keeps this portable.

---

## I. Statuses and enums

**Use native PostgreSQL `ENUM` types** for `commitment_mode`, `commitment_status`, `time_block_status`, and `commitment_category`. Reasoning, and why this doesn't contradict "avoid creating enums merely because they are possible": each of these four fields has a small, genuinely closed set of values with no realistic near-term need to add a new one dynamically (unlike, say, a user-defined tag), and a native enum gets you free validation at the DB layer (invalid values are rejected outright, not just discouraged by convention) plus a self-documenting schema. The one place I'd deliberately *not* use a native enum: if `category` is ever expected to grow user-defined values (flagged as a "things I would not lock in yet" item three checkpoints ago) — for V1 it's still a small fixed set, so a native enum remains appropriate *for now*, with the explicit understanding that migrating an enum to a lookup table later is a real, if mildly annoying, migration — worth knowing that cost exists rather than assuming enums are free to change.

**Correction (this pass): `commitment_category` is reduced to `study | work | personal | other` — `goal_linked` is removed.** Re-examining it directly: `goal_id` being non-null already, independently, indicates that a Commitment contributes to a Goal — that's a real, queryable fact on its own (`WHERE goal_id IS NOT NULL`), with no need for a redundant category label to say the same thing a second way. Keeping `goal_linked` as a category would also create exactly the kind of two-competing-sources-of-truth problem already corrected once in this document for Module (Part E-0): a Commitment could be categorized `goal_linked` while `goal_id` is NULL (a lie), or categorized `study` while `goal_id` is set (an contribution to a goal that the category doesn't reflect) — nothing would keep the two in sync, because they're really encoding the same underlying fact through two different, uncoordinated columns. `category` should describe *what kind of thing* a Commitment fundamentally is (study, work, personal, or other) — a dimension that's orthogonal to whether it happens to also contribute to a Goal. A Work shift that's saved toward a holiday goal is still, categorically, work; `goal_id` alone correctly captures the goal contribution without needing a fifth category value to duplicate it.

**CHECK-constrained text was considered and rejected** for these four fields specifically: it offers no real advantage over a native enum for a genuinely fixed, small set, and native enums produce cleaner `\d` output and ORM integration.

---

## J. Indexing

| Index | Query pattern it accelerates |
|---|---|
| `commitments (user_id, status)` | "All of my active Commitments" — the base filter behind nearly every Dashboard/Calendar query |
| `commitments (user_id, due_at) WHERE mode = 'flexible'` | Upcoming-deadline and overdue-work queries; partial index since fixed rows never populate `due_at` |
| `commitments (user_id, start_at, end_at) WHERE mode = 'fixed' AND recurrence_rule IS NULL` | **Corrected (this pass):** calendar range queries and `FixedOccupied(W)`. The `recurrence_rule IS NULL` clause is added so the partial index — and therefore the query it serves — never includes template rows, which carry `start_at`/`end_at` as pattern anchors, not real occupancy (Part D correction) |
| `commitments (recurrence_template_id, occurrence_date)` | "Does this occurrence already exist" during materialization, and listing a series' materialized dates |
| `commitments (goal_id)` | "Which Commitments contribute to this Goal" — direct FK filter |
| `assignments (module_id)` | "Assignments for this module" — replaces the removed `commitments (module_id)` index, since the relationship now lives here (Part E-0) |
| `exams (module_id)` | "Upcoming exams for this module" — same reasoning |
| `time_blocks (commitment_id, status)` | Computing `A(c)` and `P_total(c)`/`P_valid(c)` — run on essentially every capacity calculation |
| `time_blocks (start_at, end_at)` | Calendar range queries for TimeBlocks and the `PlannedAllocation(W)`/week-boundary-split calculation |
| `commitment_exceptions (commitment_id)` | Checking exceptions when expanding a template's virtual occurrences |

**Corrected query pattern for actual scheduled fixed time:** the index above returns non-template fixed rows in range; a separate application-layer step expands each active (non-archived) template's `recurrence_rule` against the same range, minus any `commitment_exceptions` dates and minus dates already covered by a materialized occurrence row (which the first query already returns). The two result sets are unioned to get the true `FixedOccupied(W)` — the index alone is not the whole answer, by design, since virtual occurrences are never stored rows to begin with.

**Deliberately not indexed:** `title`/`description` (no full-text search planned), `assignments.commitment_id`/`exams.commitment_id`/`shifts.commitment_id` beyond their `UNIQUE` constraint (a UNIQUE constraint already creates the supporting index automatically — a separate plain index would be redundant), `users.email` beyond its own `UNIQUE` constraint (same reasoning). Every index above is tied to a named query from your Dashboard/Calendar/Capacity/Recurrence/Academic/Goal list — none added speculatively.

---

## K. Deletion / archival policy — consolidated

| Can be hard-deleted | Must be archived, not deleted | Cascades | SET NULL | RESTRICT |
|---|---|---|---|---|
| Commitment with only planned TimeBlocks | Commitment with any completed TimeBlock | `commitments → time_blocks`; `commitments → assignments/exams/shifts` | `commitments.goal_id` on Goal deletion | `assignments/exams.module_id` on Module deletion; `shifts.job_id` on Job deletion |
| A `planned` or `skipped` TimeBlock (individually) | — | — | — | — |
| An exception row | — | `commitment_exceptions` on template deletion (only possible when template has no materialized occurrences — see Part D correction) | — | — |
| Recurrence template with no materialized occurrences | Recurrence template with any materialized occurrence | — | — | **Corrected (this pass):** `commitments.recurrence_template_id` on occurrence rows — was `SET NULL`, now `RESTRICT`, per Part D |

**Database responsibility:** the `CASCADE`/`SET NULL`/`RESTRICT` FK policies as declared — mechanical, unconditional, always applied regardless of caller.
**Application responsibility:** the *gate* before a Commitment delete is even attempted — checking for completed TimeBlocks and redirecting to an archive operation instead of allowing the delete to reach the database at all. The DB's `CASCADE` on `time_blocks` is safe *because* the application never lets a delete reach the DB when it would destroy completed work — the two layers work together, each doing the part it's suited for. **Same pattern now applies to recurrence templates (Part D correction):** the application attempts a hard delete first; if the database rejects it via `RESTRICT` (meaning materialized occurrences exist), the application catches that and offers archive instead — the `RESTRICT` constraint is what makes this gate actually safe rather than merely conventional, since a bypassed application check would otherwise be able to destroy real occurrence history.

---

## ORBIT V1 — SCHEMA SPECIFICATION

### 1. ERD-style textual relationship map

```
users (1) ──< commitments (*)
users (1) ──< goals (*)
users (1) ──< modules (*)
users (1) ──< jobs (*)

commitments (1) ──< time_blocks (*)              [flexible only, app-enforced]
commitments (1) ──1 assignments                   [optional, composite FK, same-user enforced]
commitments (1) ──1 exams                         [optional, composite FK, same-user enforced]
commitments (1) ──1 shifts                        [optional, composite FK, same-user enforced]
commitments (*) ──1 goals                         [optional, nullable, single-goal V1, composite FK, same-user enforced]
commitments (*) ──1 commitments                   [recurrence_template_id, self-referential, nullable, composite FK, same-user enforced]
commitments (1) ──< commitment_exceptions (*)     [template rows only]

modules (1) ──< assignments (*)                   [composite FK, same-user enforced]
modules (1) ──< exams (*)                         [composite FK, same-user enforced]
jobs (1) ──< shifts (*)                           [composite FK, same-user enforced]
```

**Correction:** `commitments *──1 modules` removed entirely (Part E-0) — Commitment no longer references Module directly; the relationship runs only through Assignment/Exam.

**Correction (this pass):** `commitments (*) ──1 commitments` (the `recurrence_template_id` self-reference) is now annotated as fixed-mode-only on both ends — the referenced row (template) is guaranteed `mode = 'fixed'` by `chk_recurrence_fixed_template`, and the referencing row (occurrence), once materialized, is guaranteed `mode = 'fixed'` by the materialization invariant (Part D). Flexible Commitments never participate in this relationship, on either side.

### 2. Complete table specification

**`users`**
| Column | Type | Null | Default | Stored/Derived | Why |
|---|---|---|---|---|---|
| id | UUID (v7) | NOT NULL, PK | none — app-generated | Stored | Identity |
| email | TEXT | NOT NULL, UNIQUE | — | Stored | Login. **Locked (this pass):** the application normalizes email to lowercase before every insert/update; `CHECK (email = lower(email))` is added as a cheap, universal DB-level safety net enforcing that invariant, after which the existing plain `UNIQUE (email)` constraint is sufficient for uniqueness — no case-insensitive collation, no citext extension, no additional auth infrastructure needed |
| password_hash | TEXT | NOT NULL | — | Stored | Auth |
| timezone | TEXT | NOT NULL | app default | Stored | IANA zone, per Part G |
| weekly_capacity_minutes | INTEGER | NOT NULL | 2400 | Stored | Capacity input, per Part F; **CHECK (weekly_capacity_minutes >= 0)** — new, this pass |
| created_at | TIMESTAMPTZ | NOT NULL | now() | Stored | Audit |
| updated_at | TIMESTAMPTZ | NOT NULL | now() | Stored | Audit |

**`goals`**
| Column | Type | Null | Default | Stored/Derived | Why |
|---|---|---|---|---|---|
| id | UUID (v7) | NOT NULL, PK | none — app-generated | Stored | Identity |
| user_id | UUID | NOT NULL, FK→users | — | Stored | Ownership |
| title | TEXT | NOT NULL | — | Stored | Display |
| target_value | NUMERIC(12,2) | NULL | — | Stored | Optional numeric target |
| current_value | NUMERIC(12,2) | NOT NULL | 0 | Stored | Manually updated progress (no automatic rollup in V1) |
| target_date | DATE | NULL | — | Stored | Optional aspiration date, not a `due_at` (Goals aren't time-bound) |
| created_at / updated_at | TIMESTAMPTZ | NOT NULL | now() | Stored | Audit |

**Additional constraint (Part L):** `UNIQUE (user_id, id)` — supports `commitments.goal_id`'s composite FK.

**`modules`**
| Column | Type | Null | Default | Stored/Derived | Why |
|---|---|---|---|---|---|
| id | UUID (v7) | NOT NULL, PK | none — app-generated | Stored | Identity |
| user_id | UUID | NOT NULL, FK→users | — | Stored | Ownership |
| name | TEXT | NOT NULL | — | Stored | Display |
| code | TEXT | NULL | — | Stored | Optional module code |
| created_at | TIMESTAMPTZ | NOT NULL | now() | Stored | Audit |

**Additional constraint (Part L):** `UNIQUE (user_id, id)` — supports `assignments.module_id`/`exams.module_id` composite FKs.

**New constraint (this pass): `UNIQUE (user_id, code) WHERE code IS NOT NULL`.** Decided, not added reflexively: a module code (e.g. "IT2002") functions as a natural identifier when a user chooses to set one — a user having two modules with the same code would almost certainly be a data-entry duplicate, not a legitimate distinct pair of modules, so this is a real intrinsic-validity rule, not decoration. The partial index (`WHERE code IS NOT NULL`) is required because `code` is nullable and multiple modules with no code at all must not collide against each other or be blocked from existing.

**`jobs`**
| Column | Type | Null | Default | Stored/Derived | Why |
|---|---|---|---|---|---|
| id | UUID (v7) | NOT NULL, PK | none — app-generated | Stored | Identity |
| user_id | UUID | NOT NULL, FK→users | — | Stored | Ownership |
| name | TEXT | NOT NULL | — | Stored | Display |
| hourly_rate | NUMERIC(8,2) | NULL | — | Stored | Used by Shift income context; **CHECK (hourly_rate IS NULL OR hourly_rate >= 0)** — new, this pass: a negative rate is never intrinsically valid data |
| created_at | TIMESTAMPTZ | NOT NULL | now() | Stored | Audit |

**Additional constraint (Part L):** `UNIQUE (user_id, id)` — supports `shifts.job_id`'s composite FK.

**`commitments`**
| Column | Type | Null | Default | Stored/Derived | Why |
|---|---|---|---|---|---|
| id | UUID (v7) | NOT NULL, PK | none — app-generated | Stored | Identity |
| user_id | UUID | NOT NULL, FK→users | — | Stored | Ownership |
| title | TEXT | NOT NULL | — | Stored | Display |
| description | TEXT | NULL | — | Stored | Optional detail |
| mode | commitment_mode ENUM | NOT NULL | — | Stored | Core fork, Part A |
| status | commitment_status ENUM | NOT NULL | 'todo' | Stored | Lifecycle |
| category | commitment_category ENUM | NOT NULL | 'other' | Stored | Domain grouping |
| priority | SMALLINT | NOT NULL | 3 | Stored | **Locked (this pass): 1 = highest priority, 5 = lowest** (matches the common "P1 is the most urgent" convention); no further semantics beyond this ordering are defined, and none are needed — the field remains a simple, self-consistent ranking, not a full priority system |
| start_at | TIMESTAMPTZ | NULL* | — | Stored | Fixed-mode only, *enforced by CHECK |
| end_at | TIMESTAMPTZ | NULL* | — | Stored | Fixed-mode only |
| due_at | TIMESTAMPTZ | NULL | — | Stored | Flexible-mode only, optional even then |
| estimated_duration_minutes | INTEGER | NULL* | — | Stored | Flexible-mode only, this is `E(c)` |
| recurrence_rule | JSONB | NULL | — | Stored | Template rows only, Part D |
| recurrence_end_date | DATE | NULL | — | Stored | Template rows only |
| recurrence_template_id | UUID | NULL, composite FK→commitments(user_id, id) | — | Stored | Occurrence rows only, self-referential, same-user enforced (Part L) |
| occurrence_date | DATE | NULL | — | Stored | Occurrence rows only |
| goal_id | UUID | NULL, composite FK→goals(user_id, id) | — | Stored | Optional, single-goal V1, same-user enforced (Part L) |
| completed_at | TIMESTAMPTZ | NULL | — | Stored | Set on completion |
| created_at / updated_at | TIMESTAMPTZ | NOT NULL | now() | Stored | Audit |

*Nullability of `start_at`/`end_at`/`estimated_duration_minutes` is column-level NULL, with the mode-dependent requirement enforced by the composite `CHECK` in Part A — not by making them individually `NOT NULL`, since each is legitimately null for the *other* mode.

**Correction: `module_id` removed from this table entirely** (see Part E-0) — the academic relationship now runs exclusively through `assignments.module_id` and `exams.module_id`.

**Additional constraint (Part L):** `UNIQUE (user_id, id)` — supports the composite FKs from `assignments`/`exams`/`shifts`/self-referential `recurrence_template_id` that reference this table.

**Derived (never stored) for `commitments`:** `A(c)`, `P_total(c)`, `P_valid(c)`, `RemainingDemand(c)` (now explicitly `0` for both `completed` and `skipped` status — see the `skipped` semantics correction above), `UnallocatedDemand(c)`, `UnfulfilledDeadlineDemand(c)`.

**`time_blocks`**
| Column | Type | Null | Default | Stored/Derived | Why |
|---|---|---|---|---|---|
| id | UUID (v7) | NOT NULL, PK | none — app-generated | Stored | Identity |
| commitment_id | UUID | NOT NULL, FK→commitments | — | Stored | Parent (flexible only, app-enforced) |
| start_at | TIMESTAMPTZ | NOT NULL | — | Stored | Plan |
| end_at | TIMESTAMPTZ | NOT NULL | — | Stored | Plan |
| status | time_block_status ENUM | NOT NULL | 'planned' | Stored | Lifecycle, Part B |
| actual_duration_minutes | INTEGER | NULL* | — | Stored | Only on completion, this feeds `A(c)` |
| reschedule_count | INTEGER | NOT NULL | 0 | Stored | Incremented on start/end update; **CHECK (reschedule_count >= 0)** — new, this pass |
| created_at / updated_at | TIMESTAMPTZ | NOT NULL | now() | Stored | Audit |

*Nullability governed by the completed/planned-or-skipped CHECK in Part B.

**Derived (never stored):** planned duration itself (`end_at − start_at`, never a separate column).

**`assignments`**
| Column | Type | Null | Default | Stored/Derived | Why |
|---|---|---|---|---|---|
| id | UUID (v7) | NOT NULL, PK | none — app-generated | Stored | Identity |
| user_id | UUID | NOT NULL | — | Stored | **New (Part L)** — denormalized, populated from parent Commitment; exists solely so the composite FKs below can be expressed |
| commitment_id | UUID | NOT NULL, UNIQUE, composite FK→commitments(user_id, id) | — | Stored | 1:1, same-user enforced |
| module_id | UUID | NULL, composite FK→modules(user_id, id) | — | Stored | Grouping, same-user enforced |
| weightage_percent | NUMERIC(5,2) | NULL | — | Stored | Domain-specific; **CHECK (weightage_percent IS NULL OR (weightage_percent >= 0 AND weightage_percent <= 100))** — new, this pass |
| grade | NUMERIC(5,2) | NULL | — | Stored | Domain-specific; **CHECK (grade IS NULL OR (grade >= 0 AND grade <= 100))** — new, this pass |

**`exams`**
| Column | Type | Null | Default | Stored/Derived | Why |
|---|---|---|---|---|---|
| id | UUID (v7) | NOT NULL, PK | none — app-generated | Stored | Identity |
| user_id | UUID | NOT NULL | — | Stored | Same reasoning as `assignments.user_id` |
| commitment_id | UUID | NOT NULL, UNIQUE, composite FK→commitments(user_id, id) | — | Stored | 1:1, same-user enforced |
| module_id | UUID | NULL, composite FK→modules(user_id, id) | — | Stored | Grouping, same-user enforced |
| weightage_percent | NUMERIC(5,2) | NULL | — | Stored | Domain-specific; **CHECK (weightage_percent IS NULL OR (weightage_percent >= 0 AND weightage_percent <= 100))** — new, this pass |
| grade | NUMERIC(5,2) | NULL | — | Stored | Included, symmetric with `assignments.grade`; **CHECK (grade IS NULL OR (grade >= 0 AND grade <= 100))** — new, this pass |

**`shifts`**
| Column | Type | Null | Default | Stored/Derived | Why |
|---|---|---|---|---|---|
| id | UUID (v7) | NOT NULL, PK | none — app-generated | Stored | Identity |
| user_id | UUID | NOT NULL | — | Stored | Same reasoning as `assignments.user_id` |
| commitment_id | UUID | NOT NULL, UNIQUE, composite FK→commitments(user_id, id) | — | Stored | 1:1, same-user enforced |
| job_id | UUID | NULL, composite FK→jobs(user_id, id) | — | Stored | Which job, same-user enforced |
| hourly_rate_override | NUMERIC(8,2) | NULL | — | Stored | Domain-specific; **CHECK (hourly_rate_override IS NULL OR hourly_rate_override >= 0)** — new, this pass |

**`commitment_exceptions`**
| Column | Type | Null | Default | Stored/Derived | Why |
|---|---|---|---|---|---|
| id | UUID (v7) | NOT NULL, PK | none — app-generated | Stored | Identity |
| commitment_id | UUID | NOT NULL, FK→commitments | — | Stored | Must reference a template (app-enforced) |
| excluded_date | DATE | NOT NULL | — | Stored | The cancelled occurrence date |
| created_at | TIMESTAMPTZ | NOT NULL | now() | Stored | Audit |

### 3. Constraint matrix

| Table | Constraint | Type | Enforces |
|---|---|---|---|
| commitments | chk_mode_fields | CHECK | Fixed/flexible field requirements, Part A |
| commitments | chk_completed_at_consistency | CHECK | **New (this pass, Part A):** status/completed_at pairing |
| commitments | chk_template_status | CHECK | **New (this pass, blocker fix):** `recurrence_rule IS NOT NULL ⇒ status IN ('todo','in_progress','archived')` — prevents a template from being `completed`/`skipped`, which would otherwise silently keep generating future occurrences |
| commitments | chk_recurrence_fixed_template | CHECK | **New (this pass, 🔴 blocker fix, Part A/D):** `recurrence_rule IS NOT NULL ⇒ mode = 'fixed'` — recurrence templates must be fixed-mode; makes flexible recurrence structurally impossible |
| ~~commitments~~ | ~~chk_no_due_on_recurring_flexible~~ | ~~CHECK~~ | **Removed (this pass) — superseded by `chk_recurrence_fixed_template`.** Does not appear in DDL; retained here only as a changelog note, not a live constraint |
| commitments | chk_span_valid | CHECK | `end_at > start_at` when both present |
| commitments | chk_estimate_nonneg | CHECK | `estimated_duration_minutes >= 0` |
| commitments | chk_recurrence_role | CHECK | **Revised (Part D):** three-way exclusive state — normal / template / occurrence — replacing the prior insufficient pairing check |
| commitments | chk_no_self_template | CHECK | `recurrence_template_id != id` |
| commitments | uq_template_occurrence | UNIQUE (recurrence_template_id, occurrence_date) | One materialized row per (template, date) |
| commitments | uq_user_id | UNIQUE (user_id, id) | **New (Part L):** supports composite FKs referencing this table |
| commitments | fk_goal_same_user | Composite FK (user_id, goal_id) → goals(user_id, id) ON DELETE SET NULL (goal_id) | **New (Part L), corrected (this pass):** same-user enforcement; column-specific SET NULL so only `goal_id` is nulled, never `user_id` |
| commitments | fk_template_same_user | Composite FK (user_id, recurrence_template_id) → commitments(user_id, id) ON DELETE RESTRICT | **New (Part L), corrected (this pass):** same-user enforcement; RESTRICT, not SET NULL — matches the single locked deletion policy in Part D |
| goals / modules / jobs | uq_user_id | UNIQUE (user_id, id) | **New (Part L):** supports composite FKs from dependent tables |
| time_blocks | chk_tb_span_valid | CHECK | `end_at > start_at` |
| time_blocks | chk_tb_actual_consistency | CHECK | Completed⇔actual-duration pairing, Part B |
| time_blocks | chk_tb_actual_nonneg | CHECK | `actual_duration_minutes >= 0` |
| assignments/exams/shifts | uq_commitment_1to1 | UNIQUE on commitment_id | Enforces true 1:1, Part C |
| assignments/exams/shifts | fk_commitment_same_user | Composite FK (user_id, commitment_id) → commitments(user_id, id) | **New (Part L):** replaces plain FK, enforces same-user, also confirms internal `user_id` consistency |
| assignments/exams | fk_module_same_user | Composite FK (user_id, module_id) → modules(user_id, id) | **New (Part L):** same-user enforcement; **module_id removed from `commitments` (Part E-0)** |
| shifts | fk_job_same_user | Composite FK (user_id, job_id) → jobs(user_id, id) | **New (Part L):** same-user enforcement |
| commitment_exceptions | uq_exception | UNIQUE (commitment_id, excluded_date) | No duplicate exceptions |
| users | chk_email_lowercase | CHECK | **New (this pass):** `email = lower(email)`, safety net for application-side normalization |
| users | chk_capacity_nonneg | CHECK | **New (this pass):** `weekly_capacity_minutes >= 0` |
| time_blocks | chk_reschedule_nonneg | CHECK | **New (this pass):** `reschedule_count >= 0` |
| modules | uq_module_code | UNIQUE (user_id, code) WHERE code IS NOT NULL | **New (this pass):** module codes are a natural per-user identifier when set |
| jobs | chk_rate_nonneg | CHECK | **New (this pass):** `hourly_rate >= 0` when non-null |
| assignments/exams | chk_grade_range | CHECK | **New (this pass):** `grade` between 0 and 100 when non-null |
| assignments/exams | chk_weightage_range | CHECK | **New (this pass):** `weightage_percent` between 0 and 100 when non-null |
| shifts | chk_rate_override_nonneg | CHECK | **New (this pass):** `hourly_rate_override >= 0` when non-null |

### 4. Index matrix

(See Part J above — reproduced in full there; not duplicated here to avoid drift between two copies of the same list.)

### 5. Delete/archive matrix

(See Part K above.)

### 6. Database-enforced vs. application-enforced rules

**Database-enforced:** mode/field-requirement pairing, span validity (both tables), actual-duration/status pairing, non-negativity checks, 1:1 extension uniqueness, template-occurrence uniqueness, exception uniqueness, self-template prevention, the three-way recurrence-role exclusivity check (revised, Part D), **same-user ownership for Commitment→Goal, Assignment/Exam→Module, Shift→Job, and Commitment→recurrence-template, and Assignment/Exam/Shift→Commitment (Part L) — scoped precisely to these relationships, not TimeBlock/Exceptions ownership (see below)**, all standard FK referential integrity and its declared CASCADE / column-specific-SET-NULL / RESTRICT behavior.

**Application-enforced:** TimeBlock-must-reference-flexible-Commitment, status transition validity, cross-extension-type mutual exclusivity, exceptions-must-reference-a-template, chained-occurrence prevention (a recurrence_template_id pointing at another occurrence rather than a true template — the three-way CHECK constrains each row's own shape but not what a *different* row it points to looks like), **same-user ownership for `time_blocks.commitment_id` and `commitment_exceptions.commitment_id` (Part L correction — no local `user_id`, so this must be authorized by the application via a join to `commitments`, not assumed database-guaranteed)**, the completed-work delete gate (archive redirect), the recurrence-template archive gate (Part D/K), materialization's copy-fields-from-template-once behavior (including, **new this pass, `occurrence.mode = 'fixed'` inherited from the template**), recurrence expansion itself (virtual occurrence generation is pure application/query logic, not a stored fact), **`updated_at` maintenance (new, this pass, Part G-1) — every application-level UPDATE sets `updated_at = now()` itself; no trigger performs this**.

### 7. Explicitly NOT represented in the database

Per your instruction, and consistent with the "things I would not lock in yet" list from the conceptual stress test: no Availability/free-slot tables, no notifications, no collaboration/sharing, no AI or scheduling-suggestion tables, no dependency graph between Commitments, no many-to-many Goal join table (single nullable FK only, per the earlier explicit decision), no financial/transaction tables, no analytics/event-log tables, no audit-trail table beyond the plain `created_at`/`updated_at` columns already present, no multi-tenant/organization structure, no mobile-specific tables. Also not represented: `RemainingDemand`, `UnallocatedDemand`, `UnfulfilledDeadlineDemand`, `Occupied(W)`, `DeadlinePressure(W)`, `FreeCapacity(W)` — all derived at query time, never persisted columns.

### 8. Schema-readiness checklist

**Note: this checklist and its verdict below reflect the state through correction pass 4. It is superseded by the "ORBIT V1 — FINAL SCHEMA READINESS REVIEW" section at the end of this document, which re-verifies every item below plus the corrections from pass 5. The final verdict is the one stated there.**

- ✅ **No duplicated relationships** — `module_id` removed from `commitments`; the academic relationship runs exclusively through `assignments.module_id` / `exams.module_id`
- ✅ **No cross-user references possible at the database level, for the relationships where that claim is made** — composite FKs + supporting `UNIQUE (user_id, id)` constraints enforce same-user ownership for Commitment→Goal, Assignment/Exam→Module, Shift→Job, and Commitment→recurrence-template; **`time_blocks.commitment_id` and `commitment_exceptions.commitment_id` remain simple FKs with same-user correctness explicitly classified as application-enforced (via join to `commitments`), not database-guaranteed — this document no longer claims otherwise**
- ✅ **Recurrence roles are structurally unambiguous** — the three legal states (normal / template / occurrence) are now a single exclusive CHECK naming all four recurrence fields together, not an insufficient pairwise check
- ✅ Every extension relationship is 1:1 — enforced via `UNIQUE` on each extension table's `commitment_id`, now composite and same-user-verified
- ✅ **No unresolved schema decisions remain** — `exams.grade` is decided (included, symmetric with `assignments.grade`); the prior pass's two open judgment calls (cross-extension mutual exclusivity, recurrence timezone-on-relocation behavior) were already decided, not reopened here
- ✅ Every stored field has a clear purpose, including the newly-added `assignments/exams/shifts.user_id` columns, whose sole purpose (supporting composite FK enforcement) is stated explicitly rather than left implicit
- ✅ Every derived metric remains derived — `RemainingDemand`, `UnallocatedDemand`, `UnfulfilledDeadlineDemand`, `Occupied(W)`, `DeadlinePressure(W)`, `FreeCapacity(W)` are untouched by this correction pass
- ✅ No speculative future-feature tables were introduced — both correction passes added columns and constraints to existing tables only; no new tables
- ✅ **Recurrence deletion contradiction resolved** — `RESTRICT` + archive-based lifecycle, structurally compatible with the three-way recurrence CHECK, no fourth state introduced
- ✅ **Template rows never count as real occupancy** — locked semantic rule, query-layer distinction (`recurrence_rule IS NULL`) specified precisely, supporting index corrected
- ✅ **`completed_at` consistency DB-enforced**, with a deliberately simple three-branch CHECK rather than a full transition matrix
- ✅ **UUID generation unambiguous** — no PostgreSQL-side default anywhere; every primary key is application-generated UUIDv7
- ✅ **`category` simplified** — `goal_linked` removed, `goal_id` alone signals Goal contribution
- ✅ **`priority` semantics locked** — 1 = highest, 5 = lowest
- ✅ **Recurring flexible + `due_at` resolved** — unsupported in V1, enforced by a single new CHECK, no per-occurrence deadline infrastructure introduced
- ✅ **Email normalization locked** — lowercase before persistence, app-enforced with a DB CHECK safety net, ordinary UNIQUE(email) sufficient
- ✅ **Goal-deletion column-specific SET NULL** — `SET NULL (goal_id)`, never attempts to null `commitments.user_id`
- ✅ **Exactly one deletion policy for `recurrence_template_id`** — `RESTRICT`, everywhere it's mentioned, no remaining `SET NULL` references
- ✅ **TimeBlock/Exceptions ownership claims corrected** — explicitly application-enforced via join, not overclaimed as database-guaranteed
- ✅ **Intrinsic range CHECKs added** — grade, weightage_percent, hourly_rate, hourly_rate_override
- ✅ **Module code uniqueness decided and scoped** — `UNIQUE (user_id, code) WHERE code IS NOT NULL`
- ✅ **Commitment vs. TimeBlock `skipped` distinguished** — and the `RemainingDemand` override extended to cover both `completed` and `skipped`

**Verdict (pass-4 snapshot, superseded below):** ready for DDL. All corrections across the first four passes are structural refinements of the existing tables — no new entities, no reopened product decisions.

---

## ORBIT V1 — FINAL SCHEMA READINESS REVIEW

### 1. Corrections Applied

1. **🔴 Blocker — recurrence templates locked to fixed-mode.** New DB-enforced `chk_recurrence_fixed_template`: `CHECK (recurrence_rule IS NULL OR mode = 'fixed')`. Closes the gap where a flexible Commitment (which structurally has `start_at = NULL, end_at = NULL`) could hold a `recurrence_rule` with no concrete time-of-day for the JSONB contract to expand from. Consequence stated explicitly: **Orbit V1 supports recurring fixed Commitments only. Flexible Commitments cannot be recurrence templates.** `chk_no_due_on_recurring_flexible` is retired — not merely narrowed — because the condition it existed to catch is now structurally unreachable by any legally-constructed row; it is removed from the constraint matrix and will not appear in DDL.
2. **🟠 Materialization preserves fixed mode.** `template.mode = 'fixed' ⇒ occurrence.mode = 'fixed'` is locked as an application-enforced rule (no new trigger) at the single materialize-on-touch code path, alongside the field-copying it already performs. Scope is deliberately minimal: once materialized, an occurrence is an ordinary independent Commitment whose `status`, `start_at`/`end_at`, `category`, `goal_id`, and domain extension all follow normal editing rules — no further recurrence-inheritance rules are introduced beyond the one `mode` guarantee.
3. **🟡 `weekly_capacity_minutes` semantics rewritten precisely.** Replaced the prior wording (which could be misread as implying past values are preserved) with the exact required statement: it is the user's *current* weekly capacity setting, used for whichever calendar week is being evaluated, with no historical per-week snapshots or overrides in V1. `W` remains exactly one user-local calendar week (Mon 00:00 → Sun 23:59:59.999); the 2400-minute default is unchanged.
4. **🟡 `updated_at` maintenance clarified.** New Part G-1 locks `updated_at` as application-maintained, not trigger-maintained: `DEFAULT now()` still appears in DDL (fires on INSERT only), and every application-level UPDATE must itself set `updated_at = now()`. Applied uniformly across the four tables that actually have the column (`users`, `goals`, `commitments`, `time_blocks`); no column is added to tables that don't already have one.

No new entities were introduced. No previously settled architectural decision (Commitment/TimeBlock/Goal split, UUIDv7, the weekly capacity model, the Goal relationship) was reopened.

### 2. Final Core Entities

Exactly ten tables, unchanged in number and purpose from the prior pass:

`users`, `commitments`, `time_blocks`, `goals`, `modules`, `jobs`, `assignments`, `exams`, `shifts`, `commitment_exceptions`.

No table was added, removed, or renamed by this pass.

### 3. Final Relationships

- `users (1) ──< commitments (*)`, `goals (*)`, `modules (*)`, `jobs (*)`
- `commitments (1) ──< time_blocks (*)` — flexible Commitments only, application-enforced
- `commitments (1) ──1 assignments / exams / shifts` — optional, composite FK, same-user enforced
- `commitments (*) ──1 goals` — optional, nullable, single-goal V1, composite FK with `SET NULL (goal_id)`
- `commitments (*) ──1 commitments` — `recurrence_template_id`, self-referential, composite FK, `RESTRICT`. **Both ends now provably fixed-mode**: the referenced row (template) by `chk_recurrence_fixed_template`, the referencing row (occurrence) once materialized by the materialization invariant. Flexible Commitments never appear on either side of this relationship.
- `commitments (1) ──< commitment_exceptions (*)` — template rows only, application-enforced
- `modules (1) ──< assignments (*) / exams (*)`, `jobs (1) ──< shifts (*)` — composite FK, same-user enforced

No relationship was added or removed. The recurrence self-reference's *mode* constraint is the only relationship whose stated properties changed this pass.

### 4. DB-Enforced Invariants

Fixed/flexible field-requirement pairing (Part A) · span validity on both `commitments` and `time_blocks` · `completed_at`/status consistency · **recurrence-template status restricted to `todo`/`in_progress`/`archived`** · **recurrence-template fixed-mode-only (`chk_recurrence_fixed_template`, new this pass)** · actual-duration/status pairing on `time_blocks` · non-negativity checks (`estimated_duration_minutes`, `actual_duration_minutes`, `weekly_capacity_minutes`, `reschedule_count`, `hourly_rate`, `hourly_rate_override`) · range checks (`grade`, `weightage_percent`, 0–100) · 1:1 extension uniqueness (Assignment/Exam/Shift) · template-occurrence uniqueness · exception uniqueness · self-template prevention · the three-way recurrence-role exclusivity CHECK · module-code uniqueness per user · email lowercase safety-net CHECK · same-user ownership for Commitment→Goal, Assignment/Exam→Module, Shift→Job, Commitment→recurrence-template, and Assignment/Exam/Shift→Commitment, via composite FKs · all declared FK referential integrity and its CASCADE / column-specific-`SET NULL` / `RESTRICT` behavior.

### 5. Application-Enforced Invariants

TimeBlock must reference a flexible Commitment · status transition validity (both Commitment and TimeBlock) · cross-extension-type mutual exclusivity (Assignment/Exam/Shift) · domain-mode/category pairing per extension type (Assignment↔flexible+study, Exam↔fixed+study, Shift↔fixed+work) · exceptions must reference a template, not an occurrence · chained-occurrence prevention (`recurrence_template_id` always points at the true template, never another occurrence) · same-user ownership for `time_blocks.commitment_id` and `commitment_exceptions.commitment_id` (no local `user_id`; authorized via join) · the completed-work delete gate (archive redirect) · the recurrence-template archive gate once materialized occurrences exist · materialization's copy-fields-from-template-once behavior, **including `occurrence.mode = 'fixed'` (new this pass)** · recurrence expansion itself (virtual occurrence generation) · **`updated_at = now()` set on every application-level UPDATE (new this pass, Part G-1) — no trigger**.

### 6. Derived / Query-Layer Concepts

`A(c)`, `P_total(c)`, `P_valid(c)`, `RemainingDemand(c)` (forced to `0` for both `completed` and `skipped` status), `UnallocatedDemand(c)`, `UnfulfilledDeadlineDemand(c)`, `FixedOccupied(W)`, `PlannedAllocation(W)`, `Occupied(W)`, `DeadlinePressure(W)`, `FreeCapacity(W)`. None of these are stored columns; all are computed at query time from `commitments`/`time_blocks`. `W` is exactly one user-local calendar week (Mon 00:00 → Sun 23:59:59.999); `weekly_capacity_minutes` is the only stored capacity input, read as a single current value with no per-week variation (Part F, rewritten this pass). None of this changed structurally this pass — only the precision of the `weekly_capacity_minutes` wording changed.

### 7. Deferred Concepts

Availability tables, notifications, collaboration/sharing, AI scheduling or suggestion tables, dependency graphs between Commitments, many-to-many Goal relationships, financial/transaction tables, analytics/event-log tables, organizations/multi-tenancy, mobile-specific schema, historical capacity snapshots, per-week capacity overrides, **flexible recurrence** (now structurally, not just conventionally, unsupported), monthly/yearly recurrence, recurrence split-series editing, per-occurrence recurrence duration overrides at the template level. None of these are introduced by this pass; the pass tightens existing constraints, it does not open the door to any deferred item above.

### 8. Final Schema Readiness Checklist

- ✅ No duplicated relationships (unchanged from pass 4 — `module_id` remains removed from `commitments`)
- ✅ No unresolved structural contradictions — the recurrence-mode gap identified this pass is now closed by `chk_recurrence_fixed_template`
- ✅ Recurrence roles remain mutually exclusive — the three-way CHECK (Part D) is untouched by this pass; the new CHECK is an additional constraint on the template branch, not a change to the exclusivity logic
- ✅ **Recurrence templates are fixed-only** — `chk_recurrence_fixed_template` verified against the mode CHECK (Part A): a flexible Commitment has `start_at/end_at = NULL` by `chk_mode_fields`, so it could never have satisfied the recurrence contract anyway; the new CHECK makes that already-implied fact structurally explicit and enforced
- ✅ **Materialized occurrences are fixed** — application-enforced inheritance verified against the mode CHECK: an occurrence with `mode = 'fixed'` must, by `chk_mode_fields`, carry non-null `start_at`/`end_at` and null `due_at`/`estimated_duration_minutes` — exactly what a materialized calendar date requires; no conflict with any other Commitment CHECK
- ✅ Recurrence deletion policy is consistent — `RESTRICT` on `recurrence_template_id`, stated once, unchanged by this pass, still the only deletion policy for that relationship anywhere in the document
- ✅ Same-user composite FKs are consistent — unchanged by this pass; Commitment→Goal, Assignment/Exam→Module, Shift→Job, Commitment→recurrence-template, and the extension tables→Commitment all remain composite-FK-enforced
- ✅ Goal deletion uses `SET NULL (goal_id)` — column-specific form, unchanged, still required because `commitments.user_id` is `NOT NULL`
- ✅ Recurrence template deletion uses `RESTRICT` — unchanged, verified consistent with the three-way CHECK (a `SET NULL` would produce the illegal fourth state; this was fixed in pass 2 and is not reopened)
- ✅ TimeBlock/exception ownership remains explicitly application-enforced — unchanged by this pass, not overclaimed
- ✅ Commitment/TimeBlock semantics remain correct — fixed/flexible field rules, TimeBlock-belongs-to-flexible-Commitment, planned/skipped→no actual duration, completed→actual duration required: none touched by this pass
- ✅ `skipped` semantics remain correct — Commitment-level `skipped` forces `RemainingDemand = 0`; TimeBlock-level `skipped` only removes that one allocation, parent demand untouched: unchanged
- ✅ Capacity remains fully derived — no metric was converted to a stored column; only the *wording* describing the one stored input (`weekly_capacity_minutes`) was corrected
- ✅ `W` semantics are unambiguous — one user-local calendar week, Mon 00:00 → Sun 23:59:59.999, unchanged
- ✅ UUIDv7 remains application-generated — untouched by this pass, no DB-side default anywhere
- ✅ `updated_at` maintenance is explicitly defined — new this pass (Part G-1): application-maintained, no trigger, applied uniformly to the four tables that have the column
- ✅ No unnecessary triggers were introduced — this pass explicitly chose application-enforcement over a trigger in two places (materialization's `mode` inheritance, `updated_at` maintenance), consistent with the document's existing trigger-avoidance pattern (Part A, "Fixed cannot have TimeBlocks")
- ✅ No new entities were introduced — ten tables, unchanged

### 9. Final Verdict

All checks in Section 8 pass — the recurrence-mode blocker is closed without a redesign, materialization's fixed-mode guarantee is documented without a new trigger, capacity wording is corrected without adding storage, and `updated_at` maintenance is defined without a new trigger. No new entities, no reopened architecture.

> **ORBIT V1 — READY FOR DDL**

Do not generate DDL yet. The next step after this review is generating the PostgreSQL `CREATE TYPE`, `CREATE TABLE`, constraints, foreign keys, indexes, and related DDL directly from this finalized specification.
