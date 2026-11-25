# MASTER PROMPT — UAR COMPLETE MOBILE MIGRATION AND FEATURE PARITY

## Role

Act as a Principal Software Architect, Senior Full-Stack Engineer, Mobile Application Architect, Backend Engineer, QA Automation Engineer, and Technical Project Manager.

You have access to the complete local codebase. Your responsibility is to autonomously analyze, plan, implement, migrate, test, and validate the entire UAR platform migration.

Use **GLM 5.3 Flash with 5 parallel agents**. Each agent must work on a clearly defined responsibility, coordinate with the other agents, review their changes, and continuously validate integration.

Do not stop after producing an analysis or migration plan. Start implementing immediately after completing the initial repository audit.

---

# 1. PROJECT LOCATIONS

There are three important project locations.

### A. Legacy PHP application

Legacy backend and existing application:

`/Users/mansoorkhan/Documents/works/uar/php/admin`

Legacy PHP application:

`/Users/mansoorkhan/Documents/works/uar/php`

This is the source of truth for existing business functionality, workflows, APIs, database operations, permissions, and user journeys.

### B. Existing mobile application

`/Users/mansoorkhan/Documents/works/uar/mobile`

Currently, this mobile application communicates with the legacy PHP backend.

We need to migrate it to the new backend without losing any existing functionality.

### C. New UAR application

New backend and admin frontend:

`/Users/mansoorkhan/Documents/works/uar/uarnew/backend`

This is the target architecture.

The new backend and its admin frontend must become the primary platform for all functionality.

The mobile application must eventually communicate exclusively with the new backend.

---

# 2. PRIMARY OBJECTIVE

Completely migrate the existing UAR mobile application's functionality from the legacy PHP backend to the new backend.

Before starting mobile migration, ensure that the new backend and admin frontend contain all the functionality required by the existing mobile application.

Additionally, identify features already available in the new backend/admin frontend but missing from mobile and implement them in mobile.

The final system must have feature parity across:

1. Legacy PHP application.
2. New backend.
3. New admin frontend.
4. Mobile application.

All features and protals user-facing roles must be supported and implemented in frontend:

- Beneficiary
- Volunteer
- Donor
- All logins portals must be supported
- Admin portal also
- Reports
- etc all

Each role must have its own complete authentication, dashboard, navigation, permissions, profile, features, workflows, and associated screens.

**Important migration principle: Backend and admin frontend first. Mobile migration second.**

Do not start modifying mobile APIs or replacing its existing backend integration until the new backend has been audited and the required APIs and features are implemented and tested.

---

# 3. FIVE-AGENT EXECUTION STRATEGY

Create and coordinate five specialized agents.

Each agent must inspect the actual source code before making assumptions.

## Agent 1 — Legacy Application Auditor

Responsibility:

Analyze the complete legacy PHP application.

Location:

`/Users/mansoorkhan/Documents/works/uar/php`

Tasks:

1. Inspect the complete PHP project structure.
2. Identify every module and feature.
3. Identify all API endpoints.
4. Identify authentication and authorization mechanisms.
5. Identify all user roles and their permissions.
6. Identify database tables, relationships, constraints, and business rules.
7. Identify file upload and download functionality.
8. Identify notifications and messaging.
9. Identify payment or donation workflows, if present.
10. Identify beneficiary registration and verification workflows.
11. Identify volunteer registration and management workflows.
12. Identify donor registration and donation management workflows.
13. Identify admin workflows.
14. Identify reports, dashboards, analytics, and exports.
15. Identify background jobs and scheduled tasks.
16. Identify integrations with external services.
17. Identify all mobile-specific APIs and their request/response formats.

Produce:

`uarnew/backend/docs/migration/LEGACY_FEATURE_INVENTORY.md`

`uarnew/backend/docs/migration/LEGACY_API_INVENTORY.md`

`uarnew/backend/docs/migration/LEGACY_DATABASE_MAPPING.md`

Every discovered feature must have a status and source-code reference.

Do not assume that a feature does not exist just because it is not visible in the UI.

Inspect controllers, models, routes, middleware, services, database queries, and frontend calls.

## Agent 2 — New Backend and Admin Frontend Auditor

Responsibility:

Analyze the new UAR backend and admin frontend.

Location:

`/Users/mansoorkhan/Documents/works/uar/uarnew/backend`

Tasks:

1. Understand the existing architecture and technology stack.
2. Identify all implemented modules.
3. Identify all existing APIs.
4. Identify database schema and migrations.
5. Identify authentication and authorization.
6. Identify role-based permissions.
7. Identify admin frontend pages and workflows.
8. Identify existing dashboards.
9. Identify missing backend features compared with legacy PHP.
10. Identify missing admin frontend pages and workflows.
11. Identify APIs that are incomplete or incompatible with mobile.
12. Identify duplicated or inconsistent business logic.
13. Identify security and validation gaps.
14. Identify existing tests and their coverage.

Produce:

`docs/migration/NEW_PLATFORM_AUDIT.md`

`docs/migration/FEATURE_PARITY_MATRIX.md`

`docs/migration/API_COMPATIBILITY_MATRIX.md`

The feature parity matrix must compare:

| Feature | Legacy PHP | New Backend | Admin Frontend | Mobile | Status |
|---|---|---|---|---|---|

Use these statuses:

- IMPLEMENTED
- PARTIALLY_IMPLEMENTED
- MISSING
- NEEDS_FIX
- NOT_APPLICABLE
- VERIFIED

Do not mark something VERIFIED without testing it.

## Agent 3 — Backend Implementation Engineer

Responsibility:

Implement all missing legacy functionality in the new backend.

Work only after reviewing the findings from Agent 1 and Agent 2.

Tasks:

1. Implement missing APIs.
2. Implement missing business logic.
3. Implement missing database models and migrations.
4. Implement role-specific permissions.
5. Implement authentication and session handling.
6. Implement beneficiary workflows.
7. Implement volunteer workflows.
8. Implement donor workflows.
9. Implement admin workflows.
10. Implement file upload/download functionality.
11. Implement notifications.
12. Implement reports and analytics.
13. Implement search, filtering, sorting, and pagination.
14. Implement validation and error handling.
15. Implement all mobile-required API capabilities.
16. Ensure consistent API response formats.
17. Add API documentation.
18. Add automated tests.

Preserve existing new-backend architecture and coding conventions.

Do not blindly copy PHP code into the new backend.

Translate the legacy business logic into the new backend's existing technology stack and architectural patterns.

Do not introduce duplicate tables or APIs when equivalent functionality already exists.

## Agent 4 — Admin Frontend Implementation Engineer

Responsibility:

Ensure the new admin frontend supports every required feature.

Tasks:

1. Compare legacy admin pages with new admin pages.
2. Identify missing screens and workflows.
3. Implement missing pages.
4. Implement missing forms and validation.
5. Implement beneficiary management.
6. Implement volunteer management.
7. Implement donor management.
8. Implement donation management.
9. Implement verification and approval workflows.
10. Implement dashboards and reports.
11. Implement search, filters, sorting, and pagination.
12. Connect all pages to the new backend APIs.
13. Handle loading, error, empty, and success states.
14. Implement role-based UI permissions.
15. Validate all frontend workflows against actual backend behavior.

Do not create static or dummy screens.

Every feature must use real backend APIs and persistent database operations.

Maintain the existing UI design system, component structure, and conventions.

## Agent 5 — Mobile Application Architect and Migration Engineer

Responsibility:

Initially, audit the existing mobile application and prepare a complete migration specification.

Location:

`/Users/mansoorkhan/Documents/works/uar/mobile`

During the initial phase, do not modify the mobile application.

Wait until Agents 1–4 have completed the required backend and admin implementation.

Once the new backend is ready and its APIs are verified, start mobile migration.

Tasks:

1. Audit all existing mobile screens.
2. Identify navigation structure.
3. Identify all API integrations.
4. Identify authentication and token handling.
5. Identify role-specific functionality.
6. Identify models and data structures.
7. Identify local storage and caching.
8. Identify file uploads.
9. Identify push notifications.
10. Identify error handling.
11. Identify deep links, if implemented.
12. Identify existing offline capabilities, if any.
13. Identify missing mobile functionality compared with the new admin frontend.
14. Create a complete screen-to-API mapping.

Produce:

`mobile/docs/MOBILE_MIGRATION_PLAN.md`

`mobile/docs/MOBILE_API_MAPPING.md`

After backend readiness, migrate the mobile application to the new backend.

Preserve existing functionality and improve the mobile application where required.

---

# 4. STRICT IMPLEMENTATION PHASES

Follow these phases in order.

## PHASE 1 — Repository and Architecture Discovery

All five agents should inspect their respective projects.

First determine:

- Actual programming languages.
- Frameworks and versions.
- Build systems.
- Project entry points.
- Database technologies.
- Authentication architecture.
- API architecture.
- Testing frameworks.
- Environment configuration.
- Existing coding standards.

Do not assume the technology stack.

Inspect package manifests, configuration files, routes, controllers, database migrations, and application entry points.

Create a shared project architecture document.

Do not change production configuration or secrets.

## PHASE 2 — Complete Feature Inventory

Create an exhaustive feature inventory from the legacy PHP application.

Inspect the entire application, including features that may not currently be accessible through the mobile UI.

Categorize features into:

- Authentication
- User management
- Beneficiary management
- Volunteer management
- Donor management
- Donations
- Food distribution
- Food requests
- Distribution scheduling
- Beneficiary verification
- Volunteer assignments
- Donor contributions
- Campaigns
- Notifications
- Reports
- Dashboards
- Profile management
- Documents
- Media uploads
- Administration
- Settings
- Any other discovered modules

These are investigation categories, not assumptions that all features exist.

Every feature discovered in the actual source code must be documented.

## PHASE 3 — Backend Feature Parity

The new backend must first achieve complete legacy feature parity.

For every legacy feature:

1. Identify the legacy implementation.
2. Understand its business rules.
3. Identify database dependencies.
4. Identify API contracts.
5. Check whether equivalent new functionality exists.
6. Reuse existing implementation if correct.
7. Fix incomplete implementation if necessary.
8. Implement missing functionality.
9. Add database migrations if needed.
10. Add validation and permissions.
11. Add automated tests.
12. Verify the actual API response.

Do not remove existing new-backend functionality.

Do not break existing API consumers.

Use backward-compatible API changes wherever practical.

## PHASE 4 — Admin Frontend Feature Parity

After the backend implementation, ensure the admin frontend exposes all necessary functionality.

For each feature:

- Verify page availability.
- Verify API integration.
- Verify forms and validation.
- Verify authorization.
- Verify CRUD operations.
- Verify status transitions.
- Verify pagination and filtering.
- Verify error handling.
- Verify data persistence.

No dummy data should remain in production workflows.

The admin frontend must be fully usable with the new backend.

## PHASE 5 — API Contract Verification

Before mobile migration, establish the final API contract.

For every mobile API requirement document:

- HTTP method.
- Endpoint.
- Authentication requirement.
- Required role.
- Request parameters.
- Request body.
- Response structure.
- Error responses.
- Pagination behavior.
- File upload requirements.
- Authorization rules.

Generate or update OpenAPI documentation if supported by the project.

Test the APIs using automated integration tests.

Create:

`docs/migration/MOBILE_API_CONTRACT.md`

Only mark backend readiness when all required mobile APIs have been implemented and verified.

## PHASE 6 — Mobile Migration

Now Agent 5 can begin modifying the mobile application.

Replace the legacy PHP API integration with the new backend API.

Important:

Do not simply replace the base URL.

Review and update:

- API endpoint paths.
- Request payloads.
- Response parsing.
- Authentication.
- Token refresh.
- User role handling.
- Error handling.
- File uploads.
- Pagination.
- Data models.
- Navigation.
- Local storage.
- Push notification integration.
- Logout and session expiry.

Keep API configuration environment-based.

Support development, staging, and production environments where the existing project architecture permits.

Remove dependencies on the legacy PHP backend after all migration tests pass.

Search the entire mobile repository for old PHP API URLs and endpoint references.

Ensure there are no unintended legacy backend dependencies remaining.

---

# 5. ROLE-BASED MOBILE IMPLEMENTATION

This is a critical requirement.

The mobile application must provide complete functionality for all three user types.

## A. Beneficiary

Inspect the new backend and admin frontend to determine the complete beneficiary functionality.

Ensure mobile supports every applicable beneficiary feature, including:

- Registration.
- Login.
- Logout.
- Forgot password.
- Profile management.
- Personal information.
- Family or household information, if applicable.
- Address management.
- Document uploads.
- Verification status.
- Approval status.
- Food requests.
- Request history.
- Distribution information.
- Distribution schedules.
- Notifications.
- Request status tracking.
- Feedback.
- Any additional features discovered in the new backend.

A beneficiary must be able to complete the entire supported workflow through mobile.

## B. Volunteer

Ensure mobile supports every applicable volunteer feature.

Potential areas to investigate:

- Registration.
- Login.
- Logout.
- Profile management.
- Volunteer verification.
- Availability.
- Assigned tasks.
- Distribution assignments.
- Beneficiary-related tasks.
- Food distribution activities.
- Task status updates.
- Attendance, if applicable.
- Activity history.
- Notifications.
- Document uploads.
- Feedback.
- Any other existing backend functionality.

Volunteers must be able to execute their supported workflows without requiring the admin frontend for ordinary operations.

## C. Donor

Ensure mobile supports every applicable donor feature.

Potential areas to investigate:

- Registration.
- Login.
- Logout.
- Profile management.
- Donation history.
- Donation creation.
- Donation tracking.
- Donation status.
- Campaigns.
- Contribution records.
- Receipts.
- Payment integration, if applicable.
- Notifications.
- Feedback.
- Any additional features found in the backend.

Do not implement payment features without verifying the existing business logic and payment provider requirements.

## D. Role-Based Authentication

The mobile application must correctly identify the authenticated user and display the appropriate dashboard.

Implement secure role-based navigation.

Requirements:

- Beneficiary cannot access volunteer-only screens.
- Volunteer cannot access donor-only screens.
- Donor cannot access beneficiary-only screens.
- Admin-only functionality must remain protected.
- Backend authorization must enforce permissions independently of mobile UI restrictions.
- Session expiry must be handled correctly.
- Logout must clear sensitive local session data.

---

# 6. FEATURE PARITY RULES

The new backend and admin frontend may contain additional functionality that does not exist in the old mobile application.

This functionality must not be ignored.

For every role:

1. Compare the legacy mobile screens.
2. Compare the new backend capabilities.
3. Compare the new admin frontend workflows.
4. Identify relevant role-specific missing screens.
5. Implement the missing mobile functionality.
6. Verify the end-to-end workflow.

Create a matrix:

| Feature | Beneficiary | Volunteer | Donor | Backend API | Admin UI | Mobile |
|---|---|---|---|---|---|---|

Every applicable feature must reach VERIFIED status.

The mobile app should offer a consistent experience with the new platform, while adapting workflows to mobile usability.

Do not blindly reproduce desktop admin screens on mobile.

---

# 7. TESTING REQUIREMENTS

Testing is mandatory throughout the migration.

## Backend testing

- Unit tests.
- Integration tests.
- Authentication tests.
- Authorization tests.
- API validation tests.
- Database tests.
- File upload tests.
- Error handling tests.
- Role-specific workflow tests.

## Admin frontend testing

- Page rendering.
- API integration.
- Form validation.
- CRUD workflows.
- Role permissions.
- Loading and error states.
- End-to-end workflows.

## Mobile testing

- Application builds.
- Login for all three roles.
- Registration where supported.
- Session persistence.
- Token refresh.
- Navigation.
- Every API integration.
- Every role-specific screen.
- File uploads.
- Notifications.
- Error handling.
- Logout.
- Session expiry.

## End-to-end testing

Test actual workflows across the complete system.

Examples:

Beneficiary:

Registration → Login → Profile completion → Verification → Food request → Request tracking → Distribution.

Volunteer:

Registration → Login → Profile completion → Verification → Assignment → Task execution → Completion.

Donor:

Registration → Login → Profile completion → Donation → Donation tracking → History → Receipt, where applicable.

These are test scenarios to adapt to the actual supported business workflows.

Never mark a feature complete based only on a successful build.

---

# 8. AGENT COORDINATION AND CONTINUOUS EXECUTION

All five agents must work as one coordinated engineering team.

Use a shared task board or migration tracking document.

Maintain:

`docs/migration/MASTER_MIGRATION_TRACKER.md`

Each task must have:

- Task ID.
- Description.
- Responsible agent.
- Dependencies.
- Status.
- Files changed.
- Tests added.
- Test results.
- Blockers.

Allowed statuses:

- NOT_STARTED
- IN_PROGRESS
- BLOCKED
- CODE_COMPLETE
- TESTING
- VERIFIED

### Parallel execution rules

Agents 1 and 2 can audit independently.

Agent 3 can begin implementing confirmed backend gaps as soon as the relevant audit findings are available.

Agent 4 can implement frontend features as backend APIs become available, but must coordinate API contracts with Agent 3.

Agent 5 can audit mobile independently but must wait for backend readiness before migrating mobile API integrations.

Avoid having multiple agents modify the same files simultaneously.

Before merging work:

1. Review changed files.
2. Check for duplicate implementations.
3. Resolve conflicting changes.
4. Run relevant tests.
5. Run the complete application build where possible.

One agent must act as the integration coordinator.

The coordinator must continuously review the other agents' outputs and update the migration tracker.

---

# 9. ENGINEERING RULES

These rules are mandatory.

1. Work directly in the provided repositories.
2. Never delete existing functionality without explicit technical justification.
3. Never replace real business logic with mock implementations.
4. Never introduce hardcoded production credentials.
5. Never expose secrets in logs.
6. Never bypass backend authorization.
7. Never make assumptions about existing database structures.
8. Never introduce duplicate APIs when existing APIs can be extended.
9. Follow existing architectural and coding conventions.
10. Add database migrations instead of manually changing production schemas.
11. Preserve backward compatibility where possible.
12. Add tests for all significant changes.
13. Document breaking changes.
14. Keep the mobile API base URL configurable.
15. Maintain clean separation between backend, admin frontend, and mobile responsibilities.
16. Do not mark unfinished functionality as complete.
17. Do not stop after generating documentation.
18. Do not ask for confirmation for ordinary implementation decisions.
19. If an essential external dependency or credential is missing, document the blocker and continue with independent work.
20. Do not overwrite user changes or unrelated uncommitted work.

Before making changes:

- Inspect Git status in every repository.
- Identify existing branches.
- Preserve uncommitted changes.
- Do not reset, force-push, or destructively clean repositories.

---

# 10. COMPLETION CRITERIA

The migration is complete only when all the following conditions are met.

### Backend

- All existing legacy functionality has been inventoried.
- All applicable legacy functionality is implemented in the new backend.
- All required APIs are available.
- All APIs have appropriate authentication and authorization.
- Database migrations are complete.
- Backend tests pass.

### Admin frontend

- All required admin functionality is available.
- Beneficiary management works.
- Volunteer management works.
- Donor management works.
- All workflows connect to real backend APIs.
- Frontend builds and tests pass.

### Mobile

- Legacy PHP backend integration has been removed from active mobile workflows.
- New backend integration is complete.
- Beneficiary login and workflows work.
- Volunteer login and workflows work.
- Donor login and workflows work.
- All relevant new backend features are available in mobile.
- All existing mobile functionality is preserved.
- All role-specific navigation and permissions work.
- Mobile builds successfully.
- Mobile tests pass.

### Integration

- No unexpected legacy PHP API dependencies remain in mobile.
- No API contract mismatches remain.
- No critical authentication issues remain.
- No critical authorization issues remain.
- No known critical workflow bugs remain.
- All features have documented verification status.

---

# 11. FINAL DELIVERABLES

Create and maintain the following documentation:

1. `docs/migration/LEGACY_FEATURE_INVENTORY.md`
2. `docs/migration/LEGACY_API_INVENTORY.md`
3. `docs/migration/LEGACY_DATABASE_MAPPING.md`
4. `docs/migration/NEW_PLATFORM_AUDIT.md`
5. `docs/migration/FEATURE_PARITY_MATRIX.md`
6. `docs/migration/API_COMPATIBILITY_MATRIX.md`
7. `docs/migration/MOBILE_API_CONTRACT.md`
8. `docs/migration/MASTER_MIGRATION_TRACKER.md`
9. `mobile/docs/MOBILE_MIGRATION_PLAN.md`
10. `mobile/docs/MOBILE_API_MAPPING.md`
11. `docs/migration/FINAL_MIGRATION_REPORT.md`

The final migration report must contain:

- Original architecture.
- New architecture.
- All migrated features.
- New features added.
- Backend API changes.
- Admin frontend changes.
- Mobile changes.
- Database changes.
- Test execution results.
- Build results.
- Outstanding issues.
- Any known limitations.

---

# 12. EXECUTION INSTRUCTIONS — START NOW

Start by inspecting all three repositories.

Launch five agents with the responsibilities described above.

Do not merely return a plan.

Immediately begin the repository audits, create the feature inventory, identify the gaps, and start implementation.

Follow the strict sequence:

**Audit → Feature Inventory → Backend Migration → Admin Frontend Migration → API Verification → Mobile Migration → Role-Based Feature Completion → End-to-End Testing → Final Verification.**

After each phase, update the migration tracker.

Continue iterating through implementation, testing, code review, and bug fixing until all achievable completion criteria are satisfied.

If context or execution limits interrupt the process, persist the exact progress, remaining tasks, agent assignments, blockers, and next actions in the migration tracker so execution can resume without repeating completed work.

Do not claim completion until the actual code, builds, APIs, and workflows have been verified.

**The ultimate goal is one fully integrated UAR platform where the new backend is the single source of truth, the admin frontend has complete administrative functionality, and the mobile application provides complete Beneficiary, Volunteer, and Donor experiences.**