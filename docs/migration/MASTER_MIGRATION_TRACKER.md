# UAR Migration — Master Tracker

Single source of truth for the platform migration (legacy PHP → new backend/admin → mobile).
Update after every phase. Statuses: `NOT_STARTED · IN_PROGRESS · BLOCKED · CODE_COMPLETE · TESTING · VERIFIED`

## Repos

| Repo | Path | Stack | Role |
|---|---|---|---|
| Legacy | `../php/admin` | Laravel 9, MySQL | Source of truth for business functionality |
| Mobile | `../mobile` | Flutter (310 dart files) | Migrates to new backend |
| New backend | `/backend` | Express + TS + Prisma + PostgreSQL | Target platform |
| New admin/frontend | `/frontend` | Next.js 16 SPA | Admin + all role portals |

## Phase status

| Phase | Scope | Status | Notes |
|---|---|---|---|
| 1. Repository & architecture discovery | all 3 repos | VERIFIED | Agents 1, 2, 5a complete |
| 2. Complete feature inventory | legacy PHP | VERIFIED | Agent 1: 187 API + 133 web routes, 15 groups |
| 3. Backend feature parity | backend | CODE_COMPLETE | A-1..A-9 (A-6 blocked on FCM creds) |
| 4. Admin frontend feature parity | frontend | CODE_COMPLETE | F-1..F-7 done |
| 5. API contract verification | backend | VERIFIED | MOBILE_API_CONTRACT.md frozen + 15/15 sweep |
| 6. Mobile migration | mobile | VERIFIED | rebuilt (12 files/3376 lines); analyze+tests+web build pass |
| 7. Role-based feature completion | all | VERIFIED | donor/volunteer/beneficiary/admin shells live |
| 8. End-to-end testing | all | VERIFIED | 15/15 conformance + 3 role E2E via Flutter web origin |
| 9. Final verification & report | all | VERIFIED | FINAL_MIGRATION_REPORT.md |

## Deliverables

| Deliverable | Owner | Status |
|---|---|---|
| `backend/docs/migration/LEGACY_FEATURE_INVENTORY.md` | Agent 1 | IN_PROGRESS |
| `backend/docs/migration/LEGACY_API_INVENTORY.md` | Agent 1 | IN_PROGRESS |
| `backend/docs/migration/LEGACY_DATABASE_MAPPING.md` | Agent 1 | IN_PROGRESS |
| `docs/migration/NEW_PLATFORM_AUDIT.md` | Agent 2 | IN_PROGRESS |
| `docs/migration/FEATURE_PARITY_MATRIX.md` | Agent 2 | IN_PROGRESS |
| `docs/migration/API_COMPATIBILITY_MATRIX.md` | Agent 2 | IN_PROGRESS |
| `mobile/docs/MOBILE_MIGRATION_PLAN.md` | Agent 5 | IN_PROGRESS (audit only) |
| `mobile/docs/MOBILE_API_MAPPING.md` | Agent 5 | IN_PROGRESS (audit only) |
| `docs/migration/MOBILE_API_CONTRACT.md` | Coordinator | NOT_STARTED |
| `docs/migration/MASTER_MIGRATION_TRACKER.md` | Coordinator | this file |
| `docs/migration/FINAL_MIGRATION_REPORT.md` | Coordinator | NOT_STARTED |

## Task board

| ID | Task | Agent | Depends | Status | Files | Tests | Blockers |
|---|---|---|---|---|---|---|---|
| T-01 | Legacy PHP full audit (features, APIs, DB, roles, mobile APIs) | 1 | — | VERIFIED | backend/docs/migration/LEGACY_*.md | — | — |
| T-02 | New backend + admin frontend audit | 2 | — | VERIFIED | docs/migration/NEW_PLATFORM_AUDIT.md | — | — |
| T-03 | Feature parity matrix (legacy vs new vs admin vs mobile) | 2+coord | T-01, T-02 | CODE_COMPLETE | docs/migration/FEATURE_PARITY_MATRIX.md | — | reconciled by coordinator |
| T-04 | API compatibility matrix (mobile-facing contracts) | 2 | T-01, T-02 | CODE_COMPLETE | docs/migration/API_COMPATIBILITY_MATRIX.md | — | — |
| T-05 | Mobile app audit (screens, APIs, auth, storage) — READ-ONLY | 5 | — | VERIFIED | mobile/docs/MOBILE_*.md | — | mobile is Chatter template, 0 UAR screens → rebuild |
| T-06 | Backend gap implementation (A-1..A-8 done; A-9 tests 14/14 pass; A-6 blocked) | 3 | T-01, T-02, T-03 | CODE_COMPLETE | backend/src/**, prisma, tests/ | vitest 14/14 ✓ | A-6 FCM creds — see BLOCKERS.md |
| T-07 | Admin frontend gap implementation (F-1..F-7; ignoreBuildErrors removed) | 4 | T-06 | CODE_COMPLETE | frontend/src/**, next.config | tsc ✓ build ✓ | verify pages need live E2E pass |
| T-08 | Mobile API contract freeze + verification | coord | T-06 | VERIFIED | docs/migration/MOBILE_API_CONTRACT.md | 15/15 sweep | — |
| T-09 | Mobile migration to new backend | 5 | T-08 | VERIFIED | ../mobile/lib (rebuilt) | analyze 0 issues, tests 2/2, web build ✓ | — |
| T-10 | E2E role workflows (beneficiary/volunteer/donor/admin) | all | T-07, T-09 | VERIFIED | — | role E2E via Flutter web ✓ | — |
| T-11 | Final migration report | coord | T-10 | VERIFIED | docs/migration/FINAL_MIGRATION_REPORT.md | — | — |

## Blockers log

| Time | Blocker | Impact | Resolution |
|---|---|---|---|
| — | — | — | — |

## Findings that change the plan

1. **MOBILE IS A TEMPLATE, NOT A UAR APP** (Agent 5 audit, VERIFIED by grep): the Flutter app is the unmodified "Chatter" social template (reels/stories/audio-rooms/cart) — `pubspec name: untitled`, `appName = "Chatter"`, hardcoded LAN base URL `http://192.168.1.4:8080/`, zero UAR endpoints called, no token auth (plaintext user-id params), real-time via Firestore/Agora directly. **Consequence:** mobile migration = BUILD a new UAR Flutter app (role shells: Donor / Volunteer / Beneficiary) against the new backend's 71 routers; reuse the template only as scaffolding. Phase 5 (API contract freeze on existing routers) becomes the critical path; the legacy Laravel API inventory matters mainly for business-rule parity, not for mobile endpoint compatibility.

## Session log (resume-safe)

- [phase 1 launched] Agents 1 (PHP audit), 2 (new platform audit), 5a (mobile audit) running in parallel.
- [5a complete] Mobile = Chatter template, 0 real-UAR screens, 97 legacy-template endpoints, none reusable. T-05 VERIFIED (docs delivered). Mobile phase re-scoped as rebuild — see findings.
- Coordinator synthesizes T-03/T-04 after T-01+T-02 land, then launches Agent 3 → Agent 4 → contract freeze → Agent 5b mobile rebuild.

- [wave 2 complete] Agents 3+4 finished (cancelled at reporting stage — work verified on disk + typecheck/tests). A-9 test suite added by coordinator: 14/14 pass on uar_test db. Container rebuilt. NEXT: Phase 5 MOBILE_API_CONTRACT.md → Agent 5b mobile rebuild → E2E (T-10) → final report.
- [wave 2 verified live] Container rebuilt with A-1..A-9. Live: /refresh→/me ADMIN ✓, forgot-password {ok} ✓, SSE broadcast through proxy ✓ (masked name + campaign title), flag exposed publicly ✓. Coordinator note: the "missing flag" scare was a diagnostic bug (bare `liveDonationFeed` vs dotted `features.liveDonationFeed` key) — feature worked all along. Token-revocation race fixed for real (ms claim in JWT + exact watermark compare), test suite 14/14 × 5 runs.
- NEXT: Phase 5 — write MOBILE_API_CONTRACT.md (freeze the donor/volunteer/beneficiary mobile-facing API surface) → launch Agent 5b (mobile rebuild against new backend, env-based base URL, JWT auth swap, role shells) → T-10 E2E → T-11 final report.
