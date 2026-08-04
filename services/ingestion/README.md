# ingestion

> **Purpose:** Runs connectors on schedule; normalizes, dedupes, and queues job listings.

The persistence half of the plugin architecture. A connector fetches and returns data; this service
decides what to store.

**What is built:** requirement ingest planning — `planIngest`, `toRow`, `summarize`. Job listings,
scheduling, and the queue named in the purpose line above are **not** built.

## Persistence lives here, never in a connector

`docs/architecture/connectors.md:140` — *"No persistence in a connector — they return data, never
write."* A connector that wrote to storage and the database would stop being a plugin and become a
pipeline wearing a plugin's interface. That is the property ADR-0002 exists to protect and **M3
exists to test**: adding Luxembourg must touch a reference file, connector coverage, ingested rules,
and a registry entry, and nothing in `services/` or `ai/`.

**No source is named in this package.** It takes a connector and iterates the registry. If adding a
country ever requires editing a file here, the plugin claim is false.

## Planning is separate from writing

`planIngest` is pure: connector output and what is already stored go in, a list of decisions comes
out, and nothing has touched the database. That is what makes supersession, idempotence, and
rejection testable without PostgreSQL — and what lets a caller show an operator what *would* happen
before it happens.

| Action | When |
|---|---|
| `insert` | no row with this `requirement_id` exists |
| `supersede` | a **live** row exists at a different version |
| `unchanged` | this exact `(requirement_id, version)` is already stored |
| `reject` | the connector's own `validate` returned an error |

A record carrying only **warnings** is stored. `no-archived-document` is a warning until ADR-0021's
enforcement phase; treating it as blocking today would mean nothing ingests at all.

## The two rules worth knowing

**A new version closes the old row; it never edits it.** A person planned against the old number,
and *"the threshold you were planning against changed on 2026-01-01"* is only sayable if the old row
still exists (`docs/architecture/immigration.md`, Versioning).

**The old row closes the day *before* the new one takes effect.** Closing it on the same date leaves
both live for a day, and `uq_req__current` rejects the insert — correctly, because two live rows make
evaluation non-deterministic. `dayBefore` uses UTC arithmetic, so a year boundary, a month boundary,
and a leap day are all the same case.

## Not yet wired

`planIngest` produces decisions; **nothing executes them against a live database yet**, and no
scheduler runs it. The executor is the next step, together with the `de.eu-blue-card` row in
`immigration_pathways` that `requirements.pathway_id` needs as a foreign key.

## Related

- ADR-0002 (plugin model), ADR-0010 (requirements), ADR-0021 (archival, and why it belongs here)
- `docs/architecture/object-storage-rollout.md` — Phase 5
- `packages/db/src/repositories/requirements.ts` — the invariants enforced at write time
