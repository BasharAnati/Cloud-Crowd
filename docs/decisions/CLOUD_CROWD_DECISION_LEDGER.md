# Cloud Crowd Decision Ledger

## 1. Document Metadata

| Field | Value |
|---|---|
| Document | Cloud Crowd Decision Ledger |
| Status | Accepted — Sprint 1.11 decision gate closed; implementation not started |
| Date recorded | 2026-08-12 |
| Repository baseline | `dev` at `19f3f49c23d0200832defd7b4cfb8a21ca9689a6` |
| Scope | Product intent, accepted future requirements, deferred choices, unresolved decisions, compatibility commitments, and evidenced supersessions |
| Primary inputs | Project-owner conversation package dated 2026-08-12; accepted Knowledge Transfer Volumes 1–3 and Volume 1 Addendum; repository evidence at the baseline above |
| Maintainer | Project owner and explicitly authorized maintainers |

## 2. Purpose and Boundaries

This ledger preserves decisions and unanswered product questions that cannot be recovered reliably from code alone. It distinguishes confirmed product-owner intent from current implementation, documented targets, inference, and unresolved choices.

This document does not:

- Define the visual design system or page-family target.
- Serve as an as-built runtime, API, schema, deployment, or operations reference.
- Replace the future Project Bible.
- Treat current production behavior as intended policy merely because it exists.
- Invent conversation history, quotations, requirements, or rejected alternatives.
- Authorize implementation by itself. Each implementation still requires an approved scope and applicable verification.

## 3. Relationship to Other Documents

### UI Architecture

`docs/architecture/CLOUD_CROWD_UI_ARCHITECTURE_V1.md` remains the authoritative target for design-system rules, page families, shared presentation patterns, responsive/accessibility requirements, and UI roadmap. This ledger records product choices that govern or constrain that target. It does not duplicate the architecture specification.

### Future Project Bible

The future `CLOUD_CROWD_PROJECT_BIBLE.md` will describe the verified as-built system and operational contracts. It may reference decision IDs here, but must not convert an `OPEN` or `DEFERRED` entry into policy. This ledger may cite current behavior only to explain why a decision is needed.

### Existing ADRs

`docs/decisions/ADR-0001-ui-architecture.md` records acceptance of UI Architecture v1.0. This ledger supplements that ADR with product intent and unresolved choices. A material architecture decision or reversal may require a new ADR in addition to a ledger update.

## 4. Decision-Status Taxonomy

| Status | Meaning |
|---|---|
| `ACCEPTED` | Product-owner intent is confirmed and currently governs relevant work. |
| `ACCEPTED FUTURE REQUIREMENT` | Product direction is confirmed, but implementation is intentionally scheduled for future work. |
| `DEFERRED` | A decision is intentionally postponed and does not currently block the scoped work. |
| `OPEN` | A material choice remains unanswered. Options may be documented, but none is selected. |
| `SUPERSEDED` | A previously evidenced decision was replaced by a later confirmed decision. |
| `REJECTED` | An option was explicitly rejected by authoritative evidence. Absence from code is not rejection evidence. |

## 5. Evidence and Provenance Taxonomy

| Provenance | Meaning |
|---|---|
| `PROJECT-OWNER CONFIRMED` | Supplied explicitly as product-owner intent in the conversation package. |
| `REPOSITORY-EVIDENCED CURRENT BEHAVIOR` | Directly traceable in production code; describes implementation, not intent. |
| `DOCUMENTED TARGET` | Stated by the accepted UI architecture or an ADR. |
| `REASONABLE INFERENCE` | Strongly supported interpretation that is not direct confirmation. |
| `UNRESOLVED` | Repository and supplied history do not select an answer. |

Records may use multiple provenance labels. Repository behavior alone is never `PROJECT-OWNER CONFIRMED`.

## 6. Accepted Decisions

### DEC-001 — Weekly Quality Website and Database Authority

- **Status:** `ACCEPTED`
- **Area:** Weekly Quality data authority
- **Decision:** The Cloud Crowd website and its database are the primary source of truth for Weekly Quality. Google Sheets is backup/reporting only and must not become the authoritative operational store.
- **Product-owner intent:** Weekly Quality work must preserve database authority and treat Sheets as a secondary reporting/backup surface.
- **Current repository behavior:** `weekly-quality.html` and `netlify/functions/weekly-quality.js` provide database CRUD and browser fallback/import behavior. This record does not certify the live reporting integration.
- **Why in ledger:** Source authority cannot be inferred safely from dual persistence and fallback code.
- **Provenance:** `PROJECT-OWNER CONFIRMED`; `REPOSITORY-EVIDENCED CURRENT BEHAVIOR`
- **Consequences:** Future Weekly Quality synchronization must be one-way or otherwise subordinate to database authority. The decision does not apply to the four Operations workflows.
- **Explicit non-goals:** Selecting authority for CCTV, Customer Experience, Daily Complaints, or Complimentary Orders; redesigning synchronization now.
- **Related:** Volume 3 `DL-001`, `DL-002`, `V3-R001`–`V3-R008`; `weekly-quality.html`; `netlify/functions/weekly-quality.js`.
- **Target sprint/workstream:** Weekly Quality reporting/backup integration.
- **Implementation state:** Partially implemented; database paths exist, but live backup/reporting conformance requires verification.
- **Required characterization/verification:** Verify live Sheets directionality, imports, reporting jobs, and that Sheet changes cannot overwrite authoritative database records.
- **Revisit trigger:** Any new Weekly Quality import, export, sync, migration, or reporting design.
- **Date recorded:** 2026-08-12
- **Blocks Sprint 1.11:** No; Profile integrations must preserve current reads and fallbacks.

### DEC-002 — Maintenance Authority Is Anati-Specific

- **Status:** `ACCEPTED`
- **Area:** Maintenance authority
- **Decision:** Only the specifically named admin user `Anati` is intended to control Maintenance Mode. Other admin-role accounts are not automatically maintenance authorities.
- **Product-owner intent:** Maintenance authority is identity-specific, not a general consequence of the `admin` role.
- **Current repository behavior:** Maintenance exemption and mutation authority are derived only from the backend `admin` result, which requires a current active `Anati` account with role `admin`, a valid session version, and no forced password reset. Local display identity is not authoritative.
- **Why in ledger:** Code shows a special case but cannot establish whether it is intentional policy without confirmation.
- **Provenance:** `PROJECT-OWNER CONFIRMED`; `REPOSITORY-EVIDENCED CURRENT BEHAVIOR`
- **Consequences:** UI and backend enforcement must converge on the named-user policy. General admin expansion requires a new decision.
- **Explicit non-goals:** General maintenance redesign, automatic recovery navigation, role-system redesign.
- **Related:** Volume 3 `DL-003`, `V3-R016`, `V3-R017`; `js/maintenance.js`; `netlify/functions/maintenance.js`.
- **Target sprint/workstream:** Maintenance parity/hardening; limited Employee parity is permitted in Sprint 1.11.
- **Implementation state:** Implemented with backend-authoritative identity and role verification. Sprint 1.15 consolidates polling without changing this authority policy.
- **Required characterization/verification:** Test Anati, non-Anati admin, manager, and agent against frontend controls and backend mutations.
- **Revisit trigger:** Identity rename, admin-role redesign, granular maintenance permission, or maintenance backend change.
- **Date recorded:** 2026-08-12
- **Blocks Sprint 1.11:** No; the policy is resolved.

### DEC-003 — Maintenance Covers Every Other Internal User

- **Status:** `ACCEPTED`
- **Area:** Maintenance coverage and enforcement
- **Decision:** When maintenance is enabled, every internal user except Anati must lose access, including users already inside the system. They must reach the System Update surface within the polling window. Employee Profiles is not exempt. When maintenance ends, internal access becomes available again.
- **Product-owner intent:** Maintenance coverage is universal across authenticated internal routes, with Anati retained as operator.
- **Current repository behavior:** Every active internal page enforces Maintenance. Employee Profiles has shared enforcement parity, legacy inline pollers were consolidated in Sprint 1.15, and System Update returns to Dashboard only after authoritative OFF or verified Anati recovery.
- **Why in ledger:** The Employee omission could not be classified as intentional or defective without owner confirmation.
- **Provenance:** `PROJECT-OWNER CONFIRMED`; `REPOSITORY-EVIDENCED CURRENT BEHAVIOR`
- **Consequences:** Universal fail-closed enforcement and existing-user polling remain required. Recovery UX beyond the implemented authoritative Dashboard return remains separately open.
- **Explicit non-goals:** Replacing the polling architecture, changing the maintenance shell, or expanding control authority.
- **Related:** Volume 3 `DL-004`, `V3-R015`–`V3-R017`; Sprint 1.11 readiness; `employee-profiles.html`; `js/maintenance.js`.
- **Target sprint/workstream:** Employee parity may be completed in Sprint 1.11; broader maintenance improvements later.
- **Implementation state:** Implemented across active internal routes. Sprint 1.15 establishes one enforcement-owned GET stream per normal page lifecycle and a distinct fail-closed recovery controller for System Update.
- **Required characterization/verification:** Test enabled/disabled transitions, unavailable authority, Employee Profiles, legacy Operations routes, and Anati exemption across representative internal routes.
- **Revisit trigger:** Maintenance transport/polling redesign or route inventory change.
- **Date recorded:** 2026-08-12
- **Blocks Sprint 1.11:** No decision blocker; it creates an in-scope parity requirement.

### DEC-004 — Public and Internal Product Separation

- **Status:** `ACCEPTED`
- **Area:** Product surfaces and information exposure
- **Decision:** Cloud Crowd retains a public marketing surface describing services without internal operational data. Internal platform pages remain behind authentication and authorization.
- **Product-owner intent:** Public marketing and authenticated operations are separate product surfaces and workstreams.
- **Current repository behavior:** `index.html` is public; internal pages use session and permission mechanisms with known implementation differences.
- **Why in ledger:** The separation is product policy, not merely current routing.
- **Provenance:** `PROJECT-OWNER CONFIRMED`; `DOCUMENTED TARGET`; `REPOSITORY-EVIDENCED CURRENT BEHAVIOR`
- **Consequences:** Public redesign cannot expose internal data or be bundled into internal workflow sprints.
- **Explicit non-goals:** Approving current public content, redesigning authentication, or certifying every route guard.
- **Related:** UI Architecture §§3.1–3.3, 25–26; Volume 3 Sprint 1.11 exclusions.
- **Target sprint/workstream:** Public/authentication work after Sprint 1.11, currently mapped by the UI roadmap.
- **Implementation state:** Broadly implemented; security verification remains separate.
- **Required characterization/verification:** Route-access review and deployed public-content/data-exposure verification.
- **Revisit trigger:** New public route, embedded operational data, portal model, or authentication boundary change.
- **Date recorded:** 2026-08-12
- **Blocks Sprint 1.11:** No.

### DEC-005 — Thyme Table Surface Remains Disabled

- **Status:** `ACCEPTED`
- **Area:** Product availability
- **Decision:** The Thyme Table/Time Table surface is intentionally hidden and disabled at the current product stage. Its card remains unavailable and its old route redirects rather than exposing an active workflow.
- **Product-owner intent:** Its absence is deliberate and must not be treated as an accidental defect.
- **Current repository behavior:** The related surface is not an active production workflow; compatibility behavior keeps it unavailable/redirected.
- **Why in ledger:** Intentional absence cannot be recovered reliably from the active page inventory.
- **Provenance:** `PROJECT-OWNER CONFIRMED`; `REPOSITORY-EVIDENCED CURRENT BEHAVIOR`
- **Consequences:** Audits and UI work must not “restore” it opportunistically. Reactivation requires a separate decision.
- **Explicit non-goals:** Defining future Thyme Table scope, data model, route, permissions, or schedule.
- **Related:** Prior knowledge-transfer findings concerning hidden/legacy surfaces; UI Architecture prohibition on disguising incomplete features does not override this confirmed product decision.
- **Target sprint/workstream:** None until reactivation is approved.
- **Implementation state:** Implemented as intentional unavailability.
- **Required characterization/verification:** Preserve redirect/unavailable behavior in relevant route/navigation characterization.
- **Revisit trigger:** Product-owner request to reactivate or replace the surface.
- **Date recorded:** 2026-08-12
- **Blocks Sprint 1.11:** No.

### DEC-006 — Sprint 1.11 Is a Presentation-Architecture Sprint

- **Status:** `ACCEPTED`
- **Area:** Sprint 1.11 scope
- **Decision:** Sprint 1.11 focuses on shared presentation-only Master/Detail foundations for Employee Profiles and Client Profiles, including fixed desktop directory/detail layout, intentional mobile list/detail behavior, explicit states, safe focus movement/restoration, and preservation of domain behavior.
- **Product-owner intent:** Consolidate profile presentation without redesigning data, workflows, permissions, persistence, or unrelated products.
- **Current repository behavior:** Employee Profiles already has an inline two-pane workspace; Client Profiles uses directory cards plus a profile modal.
- **Why in ledger:** Sprint boundaries and preservation commitments are conversation-derived and cannot be inferred from code.
- **Provenance:** `PROJECT-OWNER CONFIRMED`; `DOCUMENTED TARGET`; `REPOSITORY-EVIDENCED CURRENT BEHAVIOR`
- **Consequences:** Shared code may own layout/state presentation/focus mechanics only. Employee/Client data, calculations, APIs, CRUD, archive behavior, fallbacks, and integrations remain domain-owned.
- **Explicit non-goals:** Admin expansion; Call Queue productization; authentication redesign; database migration; runtime-DDL removal; Operations sync redesign; general maintenance redesign; Dashboard/public redesign; general archive/delete standardization; logo migration; unrelated workflows.
- **Related:** UI Architecture §§4.8, 17, Sprint 1.11; Volume 3 readiness, `V3-R024`, `V3-R026`–`V3-R030`; `employee-profiles.html`; `client-profiles.html`.
- **Target sprint/workstream:** Sprint 1.11.
- **Implementation state:** Not started at the recorded baseline.
- **Required characterization/verification:** Dedicated profile behavior, URL/history, permission, fallback, race, responsive, keyboard, focus, and theme tests before/during implementation.
- **Revisit trigger:** Any proposal to expand Sprint 1.11 beyond the listed boundaries.
- **Date recorded:** 2026-08-12
- **Blocks Sprint 1.11:** No; it defines the authorized boundary.

## 7. Accepted Future Requirements

### DEC-007 — Future Anati Admin Control Center

- **Status:** `ACCEPTED FUTURE REQUIREMENT`
- **Area:** Administration and access control
- **Decision:** A future Anati Admin control center must create/manage users, assign roles, manage module access and workflow assignments, control Free Order Requests stages and Free Order Share access, and support future granular permission expansion.
- **Product-owner intent:** Administration must evolve beyond the current partial users/access implementation.
- **Current repository behavior:** `anati-admin.html` and `netlify/functions/admin-users.js` implement users and module access foundations while other sections remain partial/planned.
- **Why in ledger:** Future scope is confirmed even though delivery phases are not.
- **Provenance:** `PROJECT-OWNER CONFIRMED`; `REPOSITORY-EVIDENCED CURRENT BEHAVIOR`; `DOCUMENTED TARGET`
- **Consequences:** Future permission models must accommodate workflow/stage scope. Current placeholders must not be described as completed functionality.
- **Explicit non-goals:** Selecting phases, first-sprint scope, schemas, or implementing any Admin work in Sprint 1.11.
- **Related:** Volume 3 `DL-007`, `V3-R011`, `V3-R016`; UI Architecture §23 and Sprint 1.13.
- **Target sprint/workstream:** Admin Center completion, after Sprint 1.11.
- **Implementation state:** Foundation partial; future requirement not complete.
- **Required characterization/verification:** Current users/access behavior, Anati-specific authority, audit effects, Free Order permission model, and migration compatibility.
- **Revisit trigger:** Admin Center planning or granular permission design.
- **Date recorded:** 2026-08-12
- **Blocks Sprint 1.11:** No.

### DEC-008 — Future Anati-Only Bulk Ticket Deletion

- **Status:** `ACCEPTED FUTURE REQUIREMENT`
- **Area:** Destructive administration
- **Decision:** A future admin-only action must allow the specifically authorized Anati user to delete all tickets in the approved scope. It must not automatically apply to every admin-role account.
- **Product-owner intent:** Provide exceptional destructive control with identity-specific authorization.
- **Current repository behavior:** No general Anati-only bulk-delete contract is implemented. Existing Operations deletion is per ticket and has multi-store risks.
- **Why in ledger:** The future capability and its narrow authority are confirmed, while safety semantics are unresolved.
- **Provenance:** `PROJECT-OWNER CONFIRMED`; `REPOSITORY-EVIDENCED CURRENT BEHAVIOR`
- **Consequences:** Implementation requires explicit scope, confirmation, audit, recovery, retention, and multi-store consistency decisions before coding.
- **Explicit non-goals:** Authorizing current implementation, choosing modules, hard deletion, or granting all admins the action.
- **Related:** Volume 3 `V3-R003`–`V3-R007`, `V3-R010`, `V3-R018`; Operations ticket and workflow stores.
- **Target sprint/workstream:** Future destructive-administration/security workstream.
- **Implementation state:** Not implemented.
- **Required characterization/verification:** Inventory every affected store, deletion/tombstone behavior, audit coverage, reconciliation, and restore/backup capability.
- **Revisit trigger:** Bulk-delete planning or retention-policy approval.
- **Date recorded:** 2026-08-12
- **Blocks Sprint 1.11:** No.

### DEC-009 — Call Queue Product Direction

- **Status:** `ACCEPTED FUTURE REQUIREMENT`
- **Area:** Call Queue productization
- **Decision:** Call Queue will become a restricted operational page for specifically authorized users, providing assigned call tickets, prominent order imagery, work-during-call behavior, positive/negative outcomes, positive notes, additional negative details, Contacted/Called, Pending, and Done concepts, and required reporting/Sheet reflection.
- **Product-owner intent:** Deliver a durable, permission-restricted operational workflow rather than preserve the current local prototype as the final product.
- **Current repository behavior:** `call-queue.html` is browser-local, incomplete, and intentionally characterized as a prototype; shared backend persistence and final route enforcement are absent.
- **Why in ledger:** Future product behavior is confirmed, while the technical/workflow design remains open.
- **Provenance:** `PROJECT-OWNER CONFIRMED`; `REPOSITORY-EVIDENCED CURRENT BEHAVIOR`; `DOCUMENTED TARGET`
- **Consequences:** Productization must add durable state, permissions, transitions, imagery, results/details, reporting integration, audit, and conflict handling.
- **Explicit non-goals:** Selecting the system of record, exact statuses, assignment model, Sheet authority, API, audit schema, image storage, permission-key design, or concurrency policy; Sprint 1.11 implementation.
- **Related:** Volume 3 `DL-006`, `V3-R014`; UI Architecture §24 and Sprint 1.12; `call-queue.html`.
- **Target sprint/workstream:** Call Queue productization after Sprint 1.11.
- **Implementation state:** Prototype only.
- **Required characterization/verification:** Freeze current prototype behavior, then define an approved workflow/state/permission/data design and real browser acceptance.
- **Revisit trigger:** Sprint 1.12 planning or integration-source selection.
- **Date recorded:** 2026-08-12
- **Blocks Sprint 1.11:** No.

## 8. Deferred Decisions

### DEC-010 — Long-Term Client Logo Storage

- **Status:** `DEFERRED`
- **Area:** Client media persistence
- **Decision/question:** Should Client logos remain database-stored data URLs or move to managed object/media storage?
- **Product-owner intent:** No long-term storage choice is confirmed; logo migration is explicitly outside Sprint 1.11.
- **Current repository behavior:** `client-profiles.html` reads images into data URLs with a 750 KB frontend limit; `netlify/functions/restaurants.js` stores the value in `logo_url`.
- **Why in ledger:** Current mechanism does not establish approved long-term scale, lifecycle, or security policy.
- **Provenance:** `UNRESOLVED`; `REPOSITORY-EVIDENCED CURRENT BEHAVIOR`; `PROJECT-OWNER CONFIRMED` only for deferral from Sprint 1.11
- **Consequences:** Sprint 1.11 must preserve the current logo contract. Future options are: retain data URLs; object storage with database references; managed media service.
- **Explicit non-goals:** Choosing or implementing a migration now.
- **Related:** Volume 3 `DL-018`, Sprint 1.11 exclusions; `V3-R026`; Client Profiles files.
- **Target sprint/workstream:** Future media/storage workstream.
- **Implementation state:** Current data-URL mechanism implemented; long-term choice deferred.
- **Required characterization/verification:** File type/size, create/edit/remove/render, large payload behavior, orphan cleanup, authorization, and migration compatibility.
- **Revisit trigger:** Storage growth, payload/performance concern, security review, or media-service adoption.
- **Date recorded:** 2026-08-12
- **Blocks Sprint 1.11:** No.

## 9. Open Decisions

This section retains the stable Volume 3 `DL-*` sequence for traceability. Records resolved after the initial draft remain in sequence with their updated `ACCEPTED` or `SUPERSEDED` status; only records explicitly marked `OPEN` still require a product decision.

### DL-001 — Operations Data Authority

- **Status:** `OPEN`
- **Area:** CCTV, Customer Experience, Daily Complaints, Complimentary Orders
- **Decision/question:** For each of the four Operations workflows, is PostgreSQL or Google Sheets authoritative, or is authority field-specific/transitional?
- **Product-owner intent:** Unresolved. DEC-001 applies only to Weekly Quality and must not be generalized.
- **Current repository behavior:** `main.js` hydrates PostgreSQL then Sheets, merges by logical keys, allows Sheet values to replace visible fields, seeds Sheet-only records into PostgreSQL, and polls both sources.
- **Why in ledger:** Dual behavior cannot reveal intended ownership.
- **Provenance:** `UNRESOLVED`; `REPOSITORY-EVIDENCED CURRENT BEHAVIOR`
- **Consequences:** Options: PostgreSQL authority; Sheets authority; field-specific authority; temporary dual-write with conflict rules. The answer governs identity, deletion, reconciliation, recovery, and migration.
- **Explicit non-goals:** Applying the Weekly Quality decision automatically or redesigning sync in Sprint 1.11.
- **Related:** Volume 3 `DL-001`; `V3-R001`–`V3-R008`; `main.js`; `netlify/functions/tickets.js`; `sheets.js`.
- **Target sprint/workstream:** Operations synchronization redesign.
- **Implementation state:** Current dual-source behavior exists; intended model is unresolved.
- **Required characterization/verification:** Live data flow, duplicate keys, overwrite/delete/reseed behavior, multi-browser seeding, partial failures, and polling races.
- **Revisit trigger:** Before any Operations sync/schema migration or data repair.
- **Recommended decision deadline:** Before synchronization redesign begins.
- **Date recorded:** 2026-08-12
- **Blocks Sprint 1.11:** No.

### DL-002 — Intended Role of Operations Sheets

- **Status:** `OPEN`
- **Area:** Operations integration
- **Decision/question:** Are Operations Sheets a source, compatibility layer, backup, reporting output, or a transitional combination?
- **Product-owner intent:** Unresolved for the four Operations workflows.
- **Current repository behavior:** Sheets are read, appended, updated, deleted, and used to seed PostgreSQL.
- **Why in ledger:** Technical capabilities do not identify approved product purpose.
- **Provenance:** `UNRESOLVED`; `REPOSITORY-EVIDENCED CURRENT BEHAVIOR`
- **Consequences:** Options materially change write direction, failure handling, retention, access, and decommission plans.
- **Explicit non-goals:** Weekly Quality, whose Sheet role is resolved by DEC-001.
- **Related:** Volume 3 `DL-002`; `V3-R001`–`V3-R008`, `V3-R019`; `main.js`; `sheets.js`.
- **Target sprint/workstream:** Operations synchronization redesign.
- **Implementation state:** Multi-purpose integration exists without confirmed long-term purpose.
- **Required characterization/verification:** Live consumers, reporting dependencies, manual edits, Apps Script use, backups, and operational ownership.
- **Revisit trigger:** Same as DL-001.
- **Recommended decision deadline:** Together with DL-001.
- **Date recorded:** 2026-08-12
- **Blocks Sprint 1.11:** No.

### DL-003 — Maintenance Authority

- **Status:** `SUPERSEDED`
- **Area:** Maintenance administration
- **Decision:** The earlier unanswered question about non-Anati admin authority is superseded by DEC-002: maintenance control is Anati-specific.
- **Product-owner intent:** Non-Anati administrators are not intended to control maintenance solely because of role.
- **Current repository behavior:** Special-casing exists with a frontend/backend mismatch.
- **Why in ledger:** Preserves traceability from Volume 3 `DL-003` to the confirmed resolution.
- **Provenance:** `PROJECT-OWNER CONFIRMED`; `REPOSITORY-EVIDENCED CURRENT BEHAVIOR`
- **Consequences:** Remaining work is implementation parity, not product discovery.
- **Explicit non-goals:** Deleting history of the earlier open question or broadening authority.
- **Related:** DEC-002; Volume 3 `DL-003`, `V3-R016`.
- **Target sprint/workstream:** Maintenance parity/hardening.
- **Implementation state:** Decision resolved; implementation partial.
- **Required characterization/verification:** See DEC-002.
- **Revisit trigger:** Explicit proposal to change maintenance authority.
- **Date recorded:** 2026-08-12
- **Blocks Sprint 1.11:** No.

### DL-004 — Employee Profiles During Maintenance

- **Status:** `SUPERSEDED`
- **Area:** Maintenance route coverage
- **Decision:** The earlier unanswered question is superseded by DEC-003: Employee Profiles must enforce maintenance and is not exempt.
- **Product-owner intent:** Universal internal coverage except Anati.
- **Current repository behavior:** Employee Profiles omits `js/maintenance.js`; this is an implementation gap.
- **Why in ledger:** Preserves the transition from unresolved intent to confirmed requirement.
- **Provenance:** `PROJECT-OWNER CONFIRMED`; `REPOSITORY-EVIDENCED CURRENT BEHAVIOR`
- **Consequences:** Sprint 1.11 may add parity without becoming a maintenance redesign.
- **Explicit non-goals:** Changing polling, recovery navigation, or authority.
- **Related:** DEC-003; Volume 3 `DL-004`, `V3-R015`.
- **Target sprint/workstream:** Sprint 1.11 parity item.
- **Implementation state:** Decision resolved; production gap remains.
- **Required characterization/verification:** See DEC-003.
- **Revisit trigger:** Explicit route-exemption policy change.
- **Date recorded:** 2026-08-12
- **Blocks Sprint 1.11:** No.

### DL-005 — Forced Password Reset Behavior

- **Status:** `ACCEPTED`
- **Area:** Authentication
- **Decision:** Correct temporary credentials issue only a short-lived, purpose-limited reset authorization. The user must set a password of at least 12 characters and then sign in again; no normal session is issued before completion.
- **Product-owner intent:** Enforce a restricted reset-only path without composition rules or plaintext secret exposure.
- **Current repository behavior:** `login.js` and `complete-password-reset.js` implement the reset-only flow with scrypt compatibility, atomic version invalidation, and safe audit metadata.
- **Why in ledger:** A dormant database flag does not define the required user or security flow.
- **Provenance:** `UNRESOLVED`; `REPOSITORY-EVIDENCED CURRENT BEHAVIOR`
- **Consequences:** Options: block login pending reset; issue restricted reset-only session; warn but allow; retire the field. Security and UX differ materially.
- **Explicit non-goals:** Authentication redesign in Sprint 1.11.
- **Related:** Volume 3 `DL-005`, `V3-R013`; `login.js`.
- **Target sprint/workstream:** Authentication/security redesign.
- **Implementation state:** Accepted decision implemented in the uncommitted Sprint 1.13 remediation and covered by deterministic handler tests; pending independent approval. The original disposable-Neon suite completed with 16 passed, 0 failed, 0 skipped across all 21 named PostgreSQL scenarios, and the PostgreSQL-enabled canonical run completed with 809 tests, 808 passed, 0 failed, and one unrelated existing opt-in skip. Independent review found incomplete rollback-path and early-cleanup evidence. The corrected dedicated TAP accounts for its total exactly: 19 child PostgreSQL test results cover the 21 numbered production scenarios because grouped children combine scenarios 6–7, 8–9, 11–14, and 18–19 while scenario 10 expands into five mutation-specific children 10a–10e; one parent PostgreSQL test result records completion of the PostgreSQL parent; and two top-level deterministic lifecycle/mutation-resistance test results complete the total. Therefore the corrected user-run disposable-PostgreSQL summary was 22 tests, 22 passed, 0 failed, and 0 skipped; the corrected PostgreSQL-enabled canonical run completed with 816 tests, 815 passed, 0 failed, and one unrelated existing opt-in adapter skip. Manual real-browser acceptance, deployment, and production migration remain deferred; no production or staging database was used.
- **Required characterization/verification:** Login/token/password-reset flows, account-link types, audit, expiry, recovery, and live schema.
- **Revisit trigger:** Before password-reset functionality or security release.
- **Recommended decision deadline:** Before authentication redesign begins.
- **Date recorded:** 2026-08-12
- **Blocks Sprint 1.11:** No.

### DL-006 — Call Queue Durable Design

- **Status:** `OPEN`
- **Area:** Call Queue
- **Decision/question:** What are the durable system of record, exact statuses/transitions, assignment model, Sheet authority, backend API, audit/history, image storage, permission-key model, and concurrency rules?
- **Product-owner intent:** The product direction is confirmed in DEC-009; these implementation-defining choices remain open.
- **Current repository behavior:** Browser-local prototype with no shared durable backend and intentionally exceptional route policy.
- **Why in ledger:** Confirmed goals do not select a safe technical/workflow design.
- **Provenance:** `UNRESOLVED`; `PROJECT-OWNER CONFIRMED` for future direction; `REPOSITORY-EVIDENCED CURRENT BEHAVIOR`
- **Consequences:** Plausible systems of record include a dedicated database model, Operations-ticket projection, external source, or controlled hybrid. Assignment may be preassigned, claim-based, or queue-based. Status vocabulary and transitions require explicit approval.
- **Explicit non-goals:** Selecting an option here or implementing Call Queue in Sprint 1.11.
- **Related:** Volume 3 `DL-006`, `V3-R014`; DEC-009; UI Architecture §24.
- **Target sprint/workstream:** Call Queue productization/Sprint 1.12 planning.
- **Implementation state:** Prototype only.
- **Required characterization/verification:** Prototype behavior, source integrations, user/permission needs, images, reporting, audit, offline/conflict cases.
- **Revisit trigger:** Before Call Queue production design begins.
- **Recommended decision deadline:** Sprint 1.12 inception.
- **Date recorded:** 2026-08-12
- **Blocks Sprint 1.11:** No.

### DL-007 — Admin Center Delivery Phases

- **Status:** `ACCEPTED`
- **Area:** Administration roadmap
- **Decision:** Sprint 1.13 completes Users and Module Access only. Workflow Permissions and the Audit viewer remain visibly deferred and noninteractive; Maintenance stays in the existing topbar.
- **Product-owner intent:** Ship the production user/access boundary as one coherent unit without implying that later Admin capabilities exist.
- **Current repository behavior:** Users and Module Access implement lifecycle, concurrency, audit, and fail-closed authorization contracts; planned sections state their deferred status.
- **Why in ledger:** Future direction does not determine release boundaries.
- **Provenance:** `UNRESOLVED`; `PROJECT-OWNER CONFIRMED` for future scope; `REPOSITORY-EVIDENCED CURRENT BEHAVIOR`
- **Consequences:** Options include users/access first, workflow controls first, or a broader integrated release; each changes schema, testing, and rollout risk.
- **Explicit non-goals:** Admin work in Sprint 1.11.
- **Related:** Volume 3 `DL-007`; DEC-007; UI Architecture §23/Sprint 1.13.
- **Target sprint/workstream:** Admin Center planning.
- **Implementation state:** Option A is implemented in the uncommitted Sprint 1.13 remediation with deterministic handler evidence, pending independent approval. The original disposable-Neon suite completed with 16 passed, 0 failed, 0 skipped across all 21 named PostgreSQL scenarios, and its PostgreSQL-enabled canonical run completed with 809 tests, 808 passed, 0 failed, and one unrelated existing opt-in skip. Independent review then found that part of the audit-rollback evidence could accept the wrong failure path and that early setup was outside reliable cleanup. The corrected dedicated TAP accounts for its total exactly: 19 child PostgreSQL test results cover the 21 numbered production scenarios because grouped children combine scenarios 6–7, 8–9, 11–14, and 18–19 while scenario 10 expands into five mutation-specific children 10a–10e; one parent PostgreSQL test result records completion of the PostgreSQL parent; and two top-level deterministic lifecycle/mutation-resistance test results complete the total. Therefore the corrected user-run disposable-PostgreSQL summary was 22 tests, 22 passed, 0 failed, and 0 skipped; the corrected PostgreSQL-enabled canonical run completed with 816 tests, 815 passed, 0 failed, and one unrelated existing opt-in adapter skip. Workflow Permissions, Audit Viewer, real-browser acceptance, deployment, and production migration remain deferred. Sprint 1.12 Call Queue remains disabled and deferred, and no production or staging database was used.
- **Required characterization/verification:** Current Admin behavior, permission dependencies, audit, workflow assignment requirements, and operational priority.
- **Revisit trigger:** Before Admin Center completion planning.
- **Recommended decision deadline:** Sprint 1.13 inception or earlier roadmap commitment.
- **Date recorded:** 2026-08-12
- **Blocks Sprint 1.11:** No.

### DL-008 — Employee Profile URL and Browser-History Contract

- **Status:** `ACCEPTED`
- **Area:** Employee Profile navigation
- **Decision:** The selected Employee Profile uses the existing `employeeId` URL identifier. A valid direct link is refreshable/shareable and opens that detail. Invalid, missing, inaccessible, archived, or no-longer-existing identifiers produce an intentional non-selected or unavailable state and never silently select another employee. Desktop selection changes use `replaceState` and do not create profile-by-profile Back history. Mobile list selection uses `pushState`; Browser Back returns to list. For a valid direct mobile detail link, the internal Back control removes `employeeId` and returns to list without loops or duplicate history entries.
- **Product-owner intent:** Employee Profiles has a stable deep-link contract and intentionally different desktop and mobile history behavior.
- **Current repository behavior:** Selection uses `history.replaceState`; refresh restores `employeeId`; there is no `popstate`; the in-page Back control only scrolls to the directory and focuses search. Archived IDs currently remain in the all-status collection and are not intentionally rejected as unavailable.
- **Why in ledger:** URL identity and navigation policy cannot be inferred from the partial current implementation.
- **Provenance:** `PROJECT-OWNER CONFIRMED`; `DOCUMENTED TARGET`; `REPOSITORY-EVIDENCED CURRENT BEHAVIOR`
- **Consequences:** Sprint 1.11 must preserve `employeeId`, add mobile push/list history handling, distinguish direct-detail entry from in-app selection, remove the identifier on internal mobile Back, and implement explicit invalid/inaccessible/archived states. Missing identifiers keep the list/empty-selection state.
- **Explicit non-goals:** Renaming `employeeId`; changing employee APIs, data, CRUD, archive semantics, or backend identifiers; creating desktop profile-by-profile history.
- **Related:** Volume 3 `DL-008`, `V3-R027`; Sprint 1.11 readiness; `employee-profiles.html`.
- **Target sprint/workstream:** Sprint 1.11.
- **Implementation state:** Partially implemented: desktop replacement and valid refresh exist; mobile history, intentional Back, and unavailable-state requirements are not implemented.
- **Required characterization/verification:** Freeze current behavior first; then verify valid/invalid/missing/inaccessible/archived direct links, refresh/shareability, desktop replacement, mobile push/Back/internal Back, loop/duplicate prevention, and focus at all required widths.
- **Revisit trigger:** Any proposed identifier rename or change to the accepted desktop/mobile navigation contract.
- **Recommended decision deadline:** Resolved on 2026-08-12.
- **Date recorded:** 2026-08-12
- **Blocks Sprint 1.11:** No; the decision is resolved, but implementation remains unstarted.

### DL-009 — Client Master/Detail URL, History, and Dialog Contract

- **Status:** `ACCEPTED`
- **Area:** Client Profile navigation and detail presentation
- **Decision:** The selected Client Profile uses the existing technical identifier `restaurantId` while the user-facing domain remains Client Profiles. A valid direct link is refreshable/shareable and opens that detail. Invalid, missing, inaccessible, archived, or no-longer-existing identifiers produce an intentional non-selected or unavailable state and never silently select another client. Desktop selection changes use `replaceState`. Mobile list selection uses `pushState`, Browser Back returns to list, and internal Back from a valid direct detail link removes `restaurantId` and returns to list without loops or duplicate entries. The Client Profile itself becomes Master/Detail rather than a modal. Create/Edit remain dialogs with accessible naming, focus entry/containment, intentional closing, and trigger restoration.
- **Product-owner intent:** Client Profiles receives a durable deep-link and list/detail contract without renaming its existing technical identity or conflating detail navigation with dialogs.
- **Current repository behavior:** Profile detail is a modal, selection is ephemeral, and no URL/history state exists. Create/Edit use the shared dialog foundation.
- **Why in ledger:** Neither the architecture target nor the modal implementation defines URL/history or the boundary between profile detail and form dialogs.
- **Provenance:** `PROJECT-OWNER CONFIRMED`; `DOCUMENTED TARGET`; `REPOSITORY-EVIDENCED CURRENT BEHAVIOR`
- **Consequences:** Sprint 1.11 must introduce `restaurantId` URL state, desktop replacement, mobile push/list Back, explicit unavailable states, and non-modal detail. Existing Create/Edit dialogs retain shared overlay behavior and must remain independent of browser-history navigation.
- **Explicit non-goals:** Renaming `restaurantId`, backend identifiers, routes, stored fields, or APIs; changing Client fields, integrations, logo handling, CRUD, archive/reactivation, or unrelated dialogs.
- **Related:** Volume 3 `DL-009`, `DL-015`, `V3-R028`; Sprint 1.11 readiness; `client-profiles.html`.
- **Target sprint/workstream:** Sprint 1.11.
- **Implementation state:** Not implemented for primary detail; current modal and ephemeral selection must be migrated. Create/Edit dialog foundations already exist but require preservation verification.
- **Required characterization/verification:** Freeze current profile rendering, integrations, rapid-click race, and form-dialog behavior; then verify valid/invalid/missing/inaccessible/archived links, refresh/shareability, desktop replacement, mobile push/Back/internal Back, no history/dialog confusion, and dialog focus lifecycle.
- **Revisit trigger:** Any proposed identifier rename, return to modal primary detail, or change to the accepted history/dialog contract.
- **Recommended decision deadline:** Resolved on 2026-08-12.
- **Date recorded:** 2026-08-12
- **Blocks Sprint 1.11:** No; the decision is resolved, but implementation remains unstarted.

### DL-010 — Profile Dependency Permission Model

- **Status:** `ACCEPTED`
- **Area:** Employee/Client integrated panels
- **Decision:** Every module-backed dependency panel retains its independent module permission. Profile access does not grant access to Attendance, Training, Deductions, Weekly Quality, Restaurant Ratings, or another integrated module. A denied/403 dependency renders an intentional permission-restricted panel state, does not expose local fallback data, and does not destroy the rest of the Profile workspace.
- **Product-owner intent:** Integrated profiles aggregate permitted views without expanding the user's underlying access.
- **Current repository behavior:** Each dependency API enforces its own module key. A profile-authorized user can receive panel-specific 403/unavailable/fallback states.
- **Why in ledger:** Backend separation alone did not establish the intended user-facing permission and fallback policy.
- **Provenance:** `PROJECT-OWNER CONFIRMED`; `REPOSITORY-EVIDENCED CURRENT BEHAVIOR`
- **Consequences:** Sprint 1.11 must distinguish permission denial from empty/loading/general failure, prevent permission-bypassing local fallback, isolate dependency failures, and preserve exact existing permission keys/backend enforcement unless a separately verified narrow gap requires correction.
- **Explicit non-goals:** General permission-system redesign, aggregate profile-scoped access, new permission keys, or broader role changes.
- **Related:** Volume 3 `DL-010`, `V3-R011`, `V3-R030`; `_auth.js`; profile and dependency functions.
- **Target sprint/workstream:** Sprint 1.11 presentation; future permission changes require a separate decision/workstream.
- **Implementation state:** Backend independence exists; intentional permission-restricted UI states and fallback suppression are not fully implemented.
- **Required characterization/verification:** Permission matrix for every integrated panel; explicit 403 handling; no restricted local fallback; unaffected sibling panels; unchanged keys and backend enforcement.
- **Revisit trigger:** Proposed aggregate endpoint, profile-scoped permission, permission-key change, or local fallback expansion.
- **Recommended decision deadline:** Resolved on 2026-08-12.
- **Date recorded:** 2026-08-12
- **Blocks Sprint 1.11:** No; the decision is resolved, but implementation gaps remain.

### DL-011 — Employee Archive Restoration

- **Status:** `OPEN`
- **Area:** Employee lifecycle
- **Decision/question:** Are archived employees permanently archived, explicitly restorable, or editable/reactivatable like Clients?
- **Product-owner intent:** Unresolved.
- **Current repository behavior:** Employee DELETE soft-archives; Employee PUT cannot update status; no restore control exists. Client edit can set active and clear archival state.
- **Why in ledger:** Asymmetry does not establish intended policy.
- **Provenance:** `UNRESOLVED`; `REPOSITORY-EVIDENCED CURRENT BEHAVIOR`
- **Consequences:** Options: preserve no restore; add Anati/admin restore; allow manager restore; edit-to-reactivate. Each affects permissions, audit, filtering, and identity reuse.
- **Explicit non-goals:** General archive/delete standardization in Sprint 1.11.
- **Related:** Volume 3 `DL-011`, `V3-R029`; `employee-profiles.html`; `employees.js`.
- **Target sprint/workstream:** Employee lifecycle or later administrative work.
- **Implementation state:** Soft archive implemented; restore absent.
- **Required characterization/verification:** Archive selected record, linked-history preservation, duplicate/recreate behavior, permission expectations, and live data retention.
- **Revisit trigger:** Restore request or archived-record action design.
- **Recommended decision deadline:** May be deferred if Sprint 1.11 preserves current behavior; required before adding restore/reactivation UI.
- **Date recorded:** 2026-08-12
- **Blocks Sprint 1.11:** No, provided current behavior is preserved.

### DL-012 — Archive Versus Delete Semantics

- **Status:** `OPEN`
- **Area:** Cross-product record lifecycle
- **Decision/question:** What terminology, retention, recovery, and audit semantics should “Archive” and “Delete” have across entities and tickets?
- **Product-owner intent:** Unresolved; general standardization is outside Sprint 1.11.
- **Current repository behavior:** Several DELETE endpoints perform soft archive, while Operations tickets can be hard-deleted with history; recovery varies.
- **Why in ledger:** HTTP method and current labels do not define approved product semantics.
- **Provenance:** `UNRESOLVED`; `REPOSITORY-EVIDENCED CURRENT BEHAVIOR`
- **Consequences:** Options: preserve entity-specific rules; standardize archive as reversible and delete as destructive; introduce retention/tombstone policy. DEC-008 bulk deletion depends on this answer.
- **Explicit non-goals:** Changing profile archive behavior in Sprint 1.11.
- **Related:** Volume 3 `DL-012`, `V3-R003`, `V3-R010`, `V3-R029`; DEC-008.
- **Target sprint/workstream:** Data lifecycle/governance.
- **Implementation state:** Inconsistent entity-specific behavior exists.
- **Required characterization/verification:** Entity matrix covering status, deleted/archived timestamps, history, restore, linked records, Sheets, backups, and permissions.
- **Revisit trigger:** Bulk delete, restore, retention, compliance, or terminology redesign.
- **Recommended decision deadline:** Before destructive-admin implementation or cross-product lifecycle changes.
- **Date recorded:** 2026-08-12
- **Blocks Sprint 1.11:** No.

### DL-013 — Legacy Permission Fallback

- **Status:** `ACCEPTED`
- **Area:** Authorization compatibility
- **Decision:** Remove synthesized legacy/full access. Explicit allow is allowed; explicit deny, no assignment, partial/malformed data, and permission-service failure are denied, with unavailable distinguished from denied.
- **Product-owner intent:** Permissions fail closed on every route and request.
- **Current repository behavior:** `js/permissions.js`, `js/app-shell.js`, and protected Netlify Functions use authoritative fail-closed permission resolution.
- **Why in ledger:** Compatibility code cannot reveal its approved lifespan or failure policy.
- **Provenance:** `UNRESOLVED`; `REPOSITORY-EVIDENCED CURRENT BEHAVIOR`
- **Consequences:** Options: remove fallback; retain only for truly unconfigured legacy users; retain by deployment flag; replace with explicit migration state. Security and availability tradeoffs differ.
- **Explicit non-goals:** Permission redesign in Sprint 1.11.
- **Related:** Volume 3 `DL-013`, `V3-R011`; `permissions.js`; `_auth.js`.
- **Target sprint/workstream:** Authorization hardening/migration.
- **Implementation state:** Implemented in the uncommitted Sprint 1.13 remediation with deterministic handler evidence. Original disposable PostgreSQL evidence passed, but independent review found incomplete rollback-path and early-cleanup proof. The corrected dedicated TAP accounts for its total exactly: 19 child PostgreSQL test results cover the 21 numbered production scenarios because grouped children combine scenarios 6–7, 8–9, 11–14, and 18–19 while scenario 10 expands into five mutation-specific children 10a–10e; one parent PostgreSQL test result records completion of the PostgreSQL parent; and two top-level deterministic lifecycle/mutation-resistance test results complete the total. Therefore the corrected user-run disposable-PostgreSQL summary was 22 tests, 22 passed, 0 failed, and 0 skipped; the corrected PostgreSQL-enabled canonical run completed with 816 tests, 815 passed, 0 failed, and one unrelated existing opt-in adapter skip. Independent approval remains pending. Real-browser acceptance, deployment, and production migration remain deferred, and no production or staging database was used.
- **Required characterization/verification:** Configured/unconfigured/error/Anati cases, direct routes, navigation, actions, and backend outcomes.
- **Revisit trigger:** Permission migration completion, access incident, or Admin expansion.
- **Recommended decision deadline:** Before authorization redesign; Profile work should preserve current behavior.
- **Date recorded:** 2026-08-12
- **Blocks Sprint 1.11:** No if preserved.

### DL-014 — Sprint 1.11 Compatibility Preservation and Later Retirement

- **Status:** `ACCEPTED`
- **Area:** Sprint 1.11 migration compatibility
- **Decision:** Sprint 1.11 preserves data shapes, API routes and request/response behavior, persisted identifiers, fields, required aliases, relevant `localStorage` keys, CRUD/archive behavior, permission enforcement, calculations, fallback contracts except where fallback would violate DL-010, and existing integrations. The Client primary-detail modal may be replaced by Master/Detail. Broad cleanup, backend/data redesign or migration, route/identifier renaming, and removal of compatibility paths whose consumers have not been disproven are not authorized. **Unresolved remainder:** the long-term retirement timing and proof standard for retained compatibility paths remain open beyond Sprint 1.11.
- **Product-owner intent:** Profile presentation may evolve while domain and compatibility behavior remains stable; security-preserving fallback suppression under DL-010 is the explicit exception.
- **Current repository behavior:** Employee uses a manual shell and legacy name fallbacks; Client uses modal detail and name-compatible quality fallback; both have embedded CSS and compatibility selectors.
- **Why in ledger:** The accepted sprint preservation boundary is product intent; repository usage alone still cannot determine when every compatibility path may later be retired.
- **Provenance:** `PROJECT-OWNER CONFIRMED` for Sprint 1.11 preservation; `UNRESOLVED` for later retirement; `REPOSITORY-EVIDENCED CURRENT BEHAVIOR`
- **Consequences:** Characterize retained contracts before presentation changes. Keep aliases/storage/API behavior unless a consumer is disproven and removal is separately authorized. Replace only Client primary-detail modal presentation. Long-term options remain: preserve through v1; retire individually after evidence; perform a later explicit compatibility migration.
- **Explicit non-goals:** Broad legacy cleanup; backend redesign; data migration; route, field, or identifier renaming; removing unverified compatibility paths.
- **Related:** Volume 3 `DL-014`, `V3-R024`, `V3-R026`; Sprint 1.11 readiness.
- **Target sprint/workstream:** Sprint 1.11 migration plan and later cleanup.
- **Implementation state:** Existing contracts remain active; the Sprint 1.11 preservation rule is accepted but no implementation has started.
- **Required characterization/verification:** Inventory and freeze data shapes, routes, identifiers, fields, aliases, storage keys, CRUD/archive, permissions, calculations, permitted fallbacks, integrations, shell behavior, and cascade-dependent selectors. Prove consumers absent before any later removal.
- **Revisit trigger:** Any proposed compatibility removal/rename or the start of a dedicated legacy-retirement workstream.
- **Recommended decision deadline:** Sprint 1.11 preservation is resolved; long-term retirement may be deferred until cleanup is proposed.
- **Date recorded:** 2026-08-12
- **Blocks Sprint 1.11:** No; preservation is mandatory and later retirement remains non-blocking.

### DL-015 — Client Selection Persistence and Shareability

- **Status:** `ACCEPTED`
- **Area:** Client Profile state
- **Decision:** A selected Client is represented by the existing `restaurantId` URL identifier and is refreshable/shareable. Valid direct links open that Client detail. Invalid, missing, inaccessible, archived, or no-longer-existing identifiers produce an intentional non-selected or unavailable state and never select a different Client.
- **Product-owner intent:** Client selection has a stable URL contract while the user-facing name remains Client Profiles.
- **Current repository behavior:** Selection exists only while the profile modal is open.
- **Why in ledger:** Shareability and the continued use of `restaurantId` are product choices distinct from layout.
- **Provenance:** `PROJECT-OWNER CONFIRMED`; `REPOSITORY-EVIDENCED CURRENT BEHAVIOR`
- **Consequences:** Implement stable `restaurantId` query state and explicit unavailable handling in accordance with DL-009. Do not introduce `clientId` as a replacement technical identity.
- **Explicit non-goals:** Renaming backend restaurant identity without a separate migration.
- **Related:** Volume 3 `DL-015`; DL-009; `client-profiles.html`.
- **Target sprint/workstream:** Sprint 1.11.
- **Implementation state:** Not implemented; current selection remains modal/ephemeral.
- **Required characterization/verification:** See DL-009, including invalid/missing/inaccessible/archived identities and authorization-safe deep linking.
- **Revisit trigger:** Proposed identifier rename or removal of Client deep links.
- **Recommended decision deadline:** Resolved on 2026-08-12.
- **Date recorded:** 2026-08-12
- **Blocks Sprint 1.11:** No; implementation remains unstarted.

### DL-016 — Default Profile Selection

- **Status:** `ACCEPTED`
- **Area:** Profile workspace state
- **Decision:** Neither profile workspace automatically selects the first record. Without a selected identifier, desktop displays an explicit choose-a-profile empty-selection state and mobile displays the list state. Loading, empty collection, and empty selection remain distinct.
- **Product-owner intent:** Selection is always intentional or URL-directed, never silently inferred from record order.
- **Current repository behavior:** Employee shows an empty-selection workspace; Client has no fixed detail and does not select a card.
- **Why in ledger:** Default selection affects navigation, accessibility, load volume, and empty-state acceptance and therefore requires explicit intent.
- **Provenance:** `PROJECT-OWNER CONFIRMED`; `DOCUMENTED TARGET`; `REPOSITORY-EVIDENCED CURRENT BEHAVIOR`
- **Consequences:** Shared workspace initialization must not choose a record. It must model list loading, collection empty, selection empty, selection loading/error/degraded/populated separately.
- **Explicit non-goals:** Remembering or auto-restoring an unrepresented last selection; silently selecting after invalid/unavailable URL handling.
- **Related:** Volume 3 `DL-016`; Sprint 1.11 readiness.
- **Target sprint/workstream:** Sprint 1.11.
- **Implementation state:** No default selection currently.
- **Required characterization/verification:** Freeze current no-selection behavior, then test desktop empty-selection, mobile list, collection loading/empty, valid direct selection, and invalid/unavailable identifiers.
- **Revisit trigger:** Any proposal for first-record or last-visited automatic selection.
- **Recommended decision deadline:** Resolved on 2026-08-12.
- **Date recorded:** 2026-08-12
- **Blocks Sprint 1.11:** No; the decision is resolved.

### DL-017 — Filtering a Selected Profile Out of the Directory

- **Status:** `ACCEPTED`
- **Area:** Profile filtering and selection
- **Decision:** If active filters hide a selected but still existing and accessible Employee or Client, keep its detail visible, keep its selection, show an explicit hidden-by-filters notice, and provide a clear filter-reset/clear action. Never silently switch or clear. Deleted, archived, inaccessible, or missing records use their proper unavailable state instead.
- **Product-owner intent:** Filtering changes the directory projection, not the user's valid selected context.
- **Current repository behavior:** Employee detail remains populated even when its directory card is filtered out; Client has no persistent selection.
- **Why in ledger:** The selected record can become invisible from the master list, affecting context and Back/focus restoration.
- **Provenance:** `PROJECT-OWNER CONFIRMED`; `REPOSITORY-EVIDENCED CURRENT BEHAVIOR`
- **Consequences:** The shared presentation must detect hidden selection, display/reset filters without altering valid selection, and distinguish filter invisibility from record unavailability. Focus restoration follows DEC-013 when the originating item is hidden.
- **Explicit non-goals:** Altering domain filters or result ordering.
- **Related:** Volume 3 `DL-017`; Sprint 1.11 readiness; profile pages.
- **Target sprint/workstream:** Sprint 1.11.
- **Implementation state:** Employee preserves hidden selection; Client has no comparable state.
- **Required characterization/verification:** Search/status combinations, filter reset, URL selection, hidden selected item, archived/deleted/inaccessible transitions, and Back/focus restoration when the trigger is absent.
- **Revisit trigger:** Any proposal to clear/switch selection automatically or remove the reset notice/action.
- **Recommended decision deadline:** Resolved on 2026-08-12.
- **Date recorded:** 2026-08-12
- **Blocks Sprint 1.11:** No; the decision is resolved.

### DL-018 — Long-Term Client Logo Storage

- **Status:** `DEFERRED`
- **Area:** Client media persistence
- **Decision:** The Volume 3 open question is intentionally deferred and represented by DEC-010. Sprint 1.11 preserves current behavior.
- **Product-owner intent:** No logo-storage migration in Sprint 1.11.
- **Current repository behavior:** Browser-generated data URL stored with the Client record.
- **Why in ledger:** Preserves Volume 3 ID continuity while pointing to the active deferred record.
- **Provenance:** `PROJECT-OWNER CONFIRMED` for deferral; `UNRESOLVED` for final storage; `REPOSITORY-EVIDENCED CURRENT BEHAVIOR`
- **Consequences:** No selection among the options in DEC-010.
- **Explicit non-goals:** Treating deferral as approval of indefinite data-URL storage.
- **Related:** DEC-010; Volume 3 `DL-018`.
- **Target sprint/workstream:** Future media/storage workstream.
- **Implementation state:** Current mechanism active; future choice deferred.
- **Required characterization/verification:** See DEC-010.
- **Revisit trigger:** See DEC-010.
- **Date recorded:** 2026-08-12
- **Blocks Sprint 1.11:** No.

### DEC-011 — System Update Automatic Return

- **Status:** `IMPLEMENTED CURRENT BEHAVIOR; UX EXPANSION OPEN`
- **Area:** Maintenance recovery
- **Decision/question:** After maintenance is disabled, should `system-update.html` automatically return users, offer Retry, return to Login, or combine these behaviors?
- **Product-owner intent:** Access must become available again; navigation behavior is unresolved.
- **Current repository behavior:** System Update automatically uses `location.replace('dashboard.html')` only after authoritative Maintenance OFF or verified Anati exemption. Unavailable, malformed, timed-out, and ON/non-Anati authority remain on System Update.
- **Why in ledger:** Availability after maintenance does not define navigation or session recovery UX.
- **Provenance:** `UNRESOLVED`; `PROJECT-OWNER CONFIRMED` for restored availability; `REPOSITORY-EVIDENCED CURRENT BEHAVIOR`
- **Consequences:** Options: automatic return to prior safe route; Retry; Login; Retry plus Login; remain until manual navigation. Security and stale-route handling must be considered.
- **Explicit non-goals:** General maintenance redesign in Sprint 1.11.
- **Related:** Volume 3 `V3-R017`; DEC-003; UI Architecture §27.
- **Target sprint/workstream:** Maintenance/public-auth-system sprint.
- **Implementation state:** The automatic Dashboard return is implemented and behaviorally tested. Retry, Return to Login, prior-route recovery, and alternate recovery controls remain unresolved and are not implied by the implemented behavior.
- **Required characterization/verification:** Session validity, prior-route safety, repeated polling, disabled users, unauthorized destinations, and browser history.
- **Revisit trigger:** Before System Update completion.
- **Recommended decision deadline:** Before maintenance recovery implementation; may be deferred from Sprint 1.11.
- **Date recorded:** 2026-08-12
- **Blocks Sprint 1.11:** No.

### DEC-012 — Disabled-Session Revocation

- **Status:** `ACCEPTED`
- **Area:** Authentication and account disablement
- **Decision:** Every authenticated backend request revalidates the active database account, current role, identity, token purpose, and session version. Authority-invalidating changes revoke existing sessions on the next request.
- **Product-owner intent:** Disablement, role changes, Admin password replacement, and reset completion invalidate existing sessions across devices.
- **Current repository behavior:** Versioned application tokens and `_auth.js` database checks enforce the decision; old unversioned tokens require fresh login.
- **Why in ledger:** Session invalidation is a security/product policy not encoded by the disable control.
- **Provenance:** `UNRESOLVED`; `REPOSITORY-EVIDENCED CURRENT BEHAVIOR`
- **Consequences:** Options include short expiry only, database status check per request, token/session versioning, or revocation store. Each changes latency, reliability, and security.
- **Explicit non-goals:** Authentication redesign in Sprint 1.11.
- **Related:** Volume 3 `V3-R012`; `admin-users.js`; `_auth.js`; `login.js`.
- **Target sprint/workstream:** Authentication/security redesign.
- **Implementation state:** Implemented in the uncommitted Sprint 1.13 remediation with deterministic handler evidence. Original disposable PostgreSQL evidence passed, but independent review found incomplete rollback-path and early-cleanup proof. The corrected dedicated TAP accounts for its total exactly: 19 child PostgreSQL test results cover the 21 numbered production scenarios because grouped children combine scenarios 6–7, 8–9, 11–14, and 18–19 while scenario 10 expands into five mutation-specific children 10a–10e; one parent PostgreSQL test result records completion of the PostgreSQL parent; and two top-level deterministic lifecycle/mutation-resistance test results complete the total. Therefore the corrected user-run disposable-PostgreSQL summary was 22 tests, 22 passed, 0 failed, and 0 skipped; the corrected PostgreSQL-enabled canonical run completed with 816 tests, 815 passed, 0 failed, and one unrelated existing opt-in adapter skip. Independent approval remains pending. Real-browser acceptance, deployment, and production migration remain deferred, and no production or staging database was used.
- **Required characterization/verification:** Disable while active, route/API access, token expiry, multi-device sessions, restore, and audit.
- **Revisit trigger:** Before account-security hardening or external-user rollout.
- **Recommended decision deadline:** Authentication redesign inception or security-priority escalation.
- **Date recorded:** 2026-08-12
- **Blocks Sprint 1.11:** No.

### DEC-013 — Exact Sprint 1.11 Selection and Focus Contract

- **Status:** `ACCEPTED`
- **Area:** Profile accessibility and interaction
- **Decision:** On desktop, selecting a profile keeps keyboard focus on the selected directory item; that item has clear visual and programmatic selection. Detail updates are announced accessibly without forced focus movement or disruptive repetition. On mobile, selection moves focus to the detail heading or appropriate detail-view target. Returning by internal Back or browser history restores focus to the originating visible directory item; if filtered out, use search or the closest appropriate visible record; if missing/inaccessible, use a safe predictable list-level target.
- **Product-owner intent:** Focus follows the visible interaction model: stable master-list focus on desktop, intentional focus transfer/restoration for mobile list/detail.
- **Current repository behavior:** Employee mobile selection scrolls without moving focus; its Back focuses search. Client modal focus is managed by the shared overlay and returns to the View trigger.
- **Why in ledger:** “Safe focus” did not define the exact desktop/mobile interaction and fallback order.
- **Provenance:** `PROJECT-OWNER CONFIRMED`; `DOCUMENTED TARGET`; `REPOSITORY-EVIDENCED CURRENT BEHAVIOR`
- **Consequences:** Shared selection presentation must expose selected semantics, a restrained accessible announcement, mobile detail focus, and restoration fallback logic compatible with filters, removal, permission loss, internal Back, and history navigation. No focus may remain inside a hidden list/detail view.
- **Explicit non-goals:** Unrelated dialog redesign; forcing desktop focus into detail; announcing the entire detail workspace repetitively.
- **Related:** Volume 3 Sprint 1.11 readiness, `V3-R024`, `V3-R027`, `V3-R028`; DL-008, DL-009, DL-017.
- **Target sprint/workstream:** Sprint 1.11.
- **Implementation state:** Not fully implemented. Employee mobile scrolls without detail focus; Client primary detail is modal; desktop/programmatic selection and restoration require migration verification.
- **Required characterization/verification:** Pointer/keyboard selection, selected semantics, restrained announcements, desktop focus retention, mobile focus transfer, internal/history Back, hidden/removed triggers, async errors, archive/inaccessibility, filtering, and representative screen-reader behavior.
- **Revisit trigger:** Any proposed focus behavior that differs from the accepted desktop/mobile contract.
- **Recommended decision deadline:** Resolved on 2026-08-12.
- **Date recorded:** 2026-08-12
- **Blocks Sprint 1.11:** No; the decision is resolved, but implementation remains unstarted.

### DEC-014 — Destructive Admin Scope and Safeguards

- **Status:** `OPEN`
- **Area:** Future bulk ticket deletion
- **Decision/question:** Which modules/records are affected, and what confirmation, audit, recovery, retention, and multi-store behavior must the Anati-only bulk action use?
- **Product-owner intent:** The capability is required by DEC-008; safeguards and scope are unresolved.
- **Current repository behavior:** No unified bulk action exists; Operations data may span PostgreSQL and Sheets.
- **Why in ledger:** A confirmed destructive capability is unsafe to implement without explicit boundaries.
- **Provenance:** `UNRESOLVED`; `PROJECT-OWNER CONFIRMED` for the future capability; `REPOSITORY-EVIDENCED CURRENT BEHAVIOR`
- **Consequences:** Options include archive/tombstone versus hard delete; typed/step-up confirmation; export/backup prerequisite; full audit; recovery window; per-module or global scope. Multi-source authority must be resolved first where applicable.
- **Explicit non-goals:** Implementing the action now or assuming every admin may use it.
- **Related:** DEC-008; DL-001, DL-002, DL-012; `V3-R003`–`V3-R010`.
- **Target sprint/workstream:** Future destructive administration after data-authority decisions.
- **Implementation state:** Not implemented.
- **Required characterization/verification:** Complete store/entity matrix, live backups, deletion reconciliation, audit and recovery exercise.
- **Revisit trigger:** Before destructive-admin design begins.
- **Recommended decision deadline:** Before any implementation or UI mockup is approved.
- **Date recorded:** 2026-08-12
- **Blocks Sprint 1.11:** No.

## 10. Rejected or Superseded Decisions

Only evidenced entries appear here:

| ID | Status | Evidenced outcome |
|---|---|---|
| DL-003 | `SUPERSEDED` | The open possibility that non-Anati admins might control maintenance is replaced by DEC-002. |
| DL-004 | `SUPERSEDED` | The open possibility that Employee Profiles might be maintenance-exempt is replaced by DEC-003. |

No separate `REJECTED` record is created. The supplied history rejects particular alternatives within accepted records—general admin maintenance authority, Employee maintenance exemption, treating Sheets as Weekly Quality authority, exposing Thyme Table now, and expanding Sprint 1.11—but there is no need to invent historical decision records for options that were never previously accepted.

## 11. Sprint 1.11 Decision Gate

### Required before characterization tests

None. Tests should first freeze current behavior, including known omissions and inconsistencies, without treating that behavior as intended policy.

### Required before production changes

No genuine product decision remains that blocks Sprint 1.11 production implementation. Production changes remain unauthorized until Sprint 1.11 is explicitly started, and must follow the accepted package below plus characterization evidence.

### Can safely be deferred while current behavior is preserved

- DL-011 Employee restore policy.
- DL-012 general archive/delete standardization.
- DL-013 long-term permission fallback.
- DL-018/DEC-010 logo storage.
- DEC-011 System Update automatic return.
- DEC-012 disabled-session revocation.
- All Operations synchronization, Call Queue, Admin Center, and destructive-administration choices.

### Already resolved for Sprint 1.11

- DEC-003: Employee Profiles must enforce maintenance; limited parity is permitted.
- DEC-006: Sprint 1.11 is presentation-only Master/Detail work with domain preservation.
- DL-008: Employee uses `employeeId`, desktop `replaceState`, mobile `pushState`, direct links, intentional list Back, and explicit unavailable states.
- DL-009/DL-015: Client uses `restaurantId`, refreshable/shareable direct links, the same desktop/mobile history model, non-modal primary detail, and preserved Create/Edit dialogs.
- DL-010: Dependency panels retain independent permissions, explicit restricted states, isolated failures, and no permission-bypassing local fallback.
- DL-014: Existing domain/compatibility contracts are preserved during Sprint 1.11, except the authorized Client detail presentation replacement and security-required fallback suppression.
- DL-016: Neither workspace auto-selects; empty collection, loading, and empty selection remain distinct.
- DL-017: A valid selection hidden by filters remains visible with a notice and reset action.
- DEC-013: Desktop retains directory focus; mobile transfers focus to detail and restores it predictably on return.
- Public redesign, Admin expansion, Call Queue productization, authentication/database/synchronization redesign, general maintenance redesign, logo migration, and unrelated workflow changes remain out of scope.

### Remaining non-blocking open or deferred decisions

DL-011, DL-012, DL-013, the long-term retirement remainder of DL-014, DL-018/DEC-010, DEC-011, DEC-012, and all Operations, Call Queue, Admin Center, and destructive-administration decisions remain open/deferred. They do not block Sprint 1.11 while the accepted preservation boundary is honored.

## 12. Future Sprint Decision Map

| Workstream | Decisions required before implementation |
|---|---|
| Sprint 1.11 Profile Workspaces | Accepted DL-008–DL-010, DL-014–DL-017, DEC-013; DEC-003 governs maintenance parity. No remaining product-decision blocker. |
| Call Queue productization | DEC-009 direction plus DL-006 technical/workflow decisions |
| Admin Center completion | DEC-007 direction plus DL-007 phasing |
| Destructive administration | DEC-008 plus DEC-014, DL-012, and applicable DL-001/DL-002 authority decisions |
| Operations synchronization | DL-001, DL-002; identity, deletion, seeding, concurrency, and recovery design tied to `V3-R001`–`V3-R008` |
| Authentication/security | DL-005, DEC-012, plus throttling/lockout/CSP verification from `V3-R012`, `V3-R013`, `V3-R023` |
| Maintenance completion | DEC-002, DEC-003, and DEC-011 |
| Client media/storage | DEC-010/DL-018 |
| Data lifecycle/governance | DL-011, DL-012, DEC-014 |
| Public/auth/system UI | DEC-004 and DEC-011; remains separate from internal workflow sprints |
| Weekly Quality reporting | DEC-001 governs authority |
| Thyme Table reactivation | New product decision required; DEC-005 governs until then |

## 13. Decision Index

| ID | Short title | Status | Blocks Sprint 1.11 |
|---|---|---|---|
| DEC-001 | Weekly Quality authority | `ACCEPTED` | No |
| DEC-002 | Anati-specific maintenance authority | `ACCEPTED` | No |
| DEC-003 | Universal maintenance coverage except Anati | `ACCEPTED` | No; parity required |
| DEC-004 | Public/internal separation | `ACCEPTED` | No |
| DEC-005 | Thyme Table disabled | `ACCEPTED` | No |
| DEC-006 | Sprint 1.11 presentation scope | `ACCEPTED` | No |
| DEC-007 | Future Admin Center | `ACCEPTED FUTURE REQUIREMENT` | No |
| DEC-008 | Future Anati-only bulk ticket deletion | `ACCEPTED FUTURE REQUIREMENT` | No |
| DEC-009 | Call Queue direction | `ACCEPTED FUTURE REQUIREMENT` | No |
| DEC-010 | Client logo storage choice | `DEFERRED` | No |
| DEC-011 | System Update automatic return | `OPEN` | No |
| DEC-012 | Disabled-session revocation | `ACCEPTED` | No |
| DEC-013 | Profile selection/focus contract | `ACCEPTED` | No |
| DEC-014 | Bulk-delete scope/safeguards | `OPEN` | No |
| DL-001 | Operations authority | `OPEN` | No |
| DL-002 | Operations Sheet role | `OPEN` | No |
| DL-003 | Maintenance authority question | `SUPERSEDED` | No |
| DL-004 | Employee maintenance question | `SUPERSEDED` | No |
| DL-005 | Forced password reset | `ACCEPTED` | No |
| DL-006 | Call Queue durable design | `OPEN` | No |
| DL-007 | Admin delivery phases | `ACCEPTED` | No |
| DL-008 | Employee URL/history contract | `ACCEPTED` | No |
| DL-009 | Client URL/history/dialog contract | `ACCEPTED` | No |
| DL-010 | Dependency permission model | `ACCEPTED` | No |
| DL-011 | Employee restoration | `OPEN` | No if preserved |
| DL-012 | Archive/delete semantics | `OPEN` | No |
| DL-013 | Legacy permission fallback | `ACCEPTED` | No |
| DL-014 | Sprint compatibility preservation; later retirement open | `ACCEPTED` | No |
| DL-015 | Client selection shareability | `ACCEPTED` | No |
| DL-016 | Default profile selection | `ACCEPTED` | No |
| DL-017 | Filter hides selection | `ACCEPTED` | No |
| DL-018 | Client logo storage trace record | `DEFERRED` | No |

## 14. Update and Review Rules

1. Every new record receives a stable ID and every update preserves ID history.
2. Only explicit owner confirmation may add `PROJECT-OWNER CONFIRMED` provenance or move a record to `ACCEPTED`, `ACCEPTED FUTURE REQUIREMENT`, `REJECTED`, or `SUPERSEDED` on product-intent grounds.
3. Repository behavior may update the “Current repository behavior” and “Implementation state” fields, but may not silently change product intent or status.
4. An `OPEN` record must retain plausible options without selecting one. Recommendations, prototypes, and implementation convenience are not acceptance.
5. A `DEFERRED` record must state the scope from which it is deferred and its revisit trigger.
6. A superseding record must cross-reference the prior ID. Historical records are not deleted.
7. Accepted decisions that materially alter UI architecture require review for a new ADR and corresponding architecture update.
8. Project Bible updates should cite accepted IDs and keep unresolved choices visibly unresolved.
9. Each implementation sprint must review all records marked as blockers for that sprint before production changes begin.
10. Review this ledger when routes, data authority, permissions, authentication, maintenance, lifecycle semantics, storage integrations, or roadmap scope change.
11. Record review date, reviewer, decision evidence, implementation status, and related commit when a decision changes.
12. Never store secrets, unverifiable quotations, or private operational credentials in this ledger.

## 15. Sprint 1.16 implementation record (2026-08-24)

Sprint 1.16 accepted the existing product decisions without changing their status or intent. The implementation adds deterministic local real-browser acceptance and presentation/accessibility corrections only. No backend authority, permissions, Maintenance authority/lifecycle, workflow semantics, persistence, Operations source-of-truth policy, Remember Me behavior, public contact content, planned Admin areas, or dormant Call Queue scope changed.

The executed matrix and limitations are documented in the UI architecture and Sprint 1.16 browser evidence. This is an implementation trace record, not a new product decision and not production release approval.
