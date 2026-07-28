# MVP

> **Purpose:** MVP scope and explicit out-of-scope.

One vertical slice, answered completely and honestly, for one origin, one destination, and one career
track. Depth before breadth: country five is only cheap because country one forced the design to be
additive (`.claude/skills/roadmap/SKILL.md`).

## The MVP question

> **"Can I realistically work in Germany, and what would it take?"**
> — asked by a Filipino professional in one career track.

**Germany first** because it has the largest demand of the four launch markets, the most
publicly-documented pathways, and the clearest tier-1 sources — so the hardest part of the product
(sourced, versioned, dated rules) is easiest to get right there. Luxembourg, New Zealand, and Switzerland
follow as data, not code.

## In scope

| Capability | Scope at MVP |
|---|---|
| Résumé parsing | PDF and DOCX, skills and roles, evidenced vs claimed, source spans, editable |
| Skill graph | seeded for one track only; sourced edges, `requires` edges present |
| Skill gap | weighted, dependency-ordered, against that one track |
| Learning paths | ordered steps, real ingested resources or an explicit absence, ranged estimates |
| Readiness | one honest number with its remainder and its evidence |
| Immigration (DE) | pathway rules ingested from tier-1 sources, versioned and dated; per-rule eligibility |
| Recognition | **status surfaced, not decided** — see out of scope |
| Viability | eligibility × employability, with the binding constraint named |
| Remote | as a comparison target, since it is often the better answer |
| Migration-friendly filtering | Germany only: sponsorship status (four-valued), relocation support, pathway visibility (`docs/features/migration-friendly-jobs.md`) |
| AI memory | long-term profile memory with source, status, and confidence; session memory discarded (`.claude/context/ai-memory.md`) |
| Dashboard | one surface answering "what should I do next?" with evidence reachable |
| Outcomes | recorded from day one, even though nothing reads them yet |

## Explicitly out of scope

Naming these matters more than listing what is in, because each is a thing someone will otherwise assume:

- **The other three launch destinations.** LU, NZ, CH are next, not now.
- **More than one career track.** The second track is the test that the design is additive.
- **Regulated professions with a licence dependency** — nursing, engineering, teaching. The rule model
  cannot express origin-side recognition yet (`docs/architecture/immigration.md`), so these must return
  `unknown` rather than a visa-only verdict. Deliberately not faked.
- **Job aggregation at scale.** A small number of sources, or seeded facts with real provenance. Breadth
  of postings is not what makes the MVP convincing.
- **Interview prep.** Needs report volume that does not exist yet; a stub is honest, a fabrication is not.
- **Notifications** beyond a rule-change alert.
- **Billing.** Prove the answer is worth paying for before charging for it.
- **Mobile app.** Responsive web covers it.
- **Prediction.** No outcome volume yet; estimates are labelled assumptions.
- **Employer-side anything.**

## Not cuttable, under any schedule pressure

Written down now, while nobody is under pressure:

1. **Evidence.** Every number shows what produced it. A score without evidence is a different, worse
   product — not a smaller one.
2. **The unknown path.** Missing knowledge produces "we don't know, and here's what's missing". Cutting
   this means shipping confident guesses to people making irreversible decisions.
3. **Provenance.** Tier-1 sourcing, dated and versioned, for every immigration rule. Unsourced facts
   cannot be repaired later; they silently poison everything derived from them.
4. **Privacy and retention.** Résumés and immigration status. Retrofitted privacy is a breach already
   shipped.
5. **Honest recognition handling.** Where recognition is unresolved, say so. Never a visa-only verdict
   dressed as an answer.
6. **Documentation of what shipped.**

Cut coverage — fewer tracks, fewer sources, manual ingest — before touching any of these.

## Done when

- A real Filipino user completes the path: résumé in → gap → plan → readiness → DE viability.
- Every number displayed carries reachable evidence and a visible confidence.
- Missing knowledge produces an honest `unknown` naming what is needed.
- DE rules are tier-1 sourced, dated, versioned, with a refresh window.
- Docs match what was built; invariant tests pass (determinism, evidence, provenance, unknown).
- Outcomes are being recorded.

## Open decision

**Which career track?** Not chosen here — it is a product decision, not an engineering one. The criterion
I would use: the track with the largest Philippines→Germany demand whose recognition path is *not*
licence-gated, since licence-gated tracks are blocked by the origin-rule gap above. That points away from
nursing for the MVP despite its demand, and toward something like software or IT infrastructure — but the
call is yours.

## Related

- `phases.md` — what follows this
- `vision.md` — users, destinations, and the design test
- `.claude/skills/roadmap/SKILL.md` — vertical slices, legitimate cuts
- `docs/features/README.md` — the composition chain
