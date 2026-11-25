# MASTER SYSTEM IMPLEMENTATION PROMPT
# UNITED ANGEL REACH — AI-POWERED HEALTHCARE OUTREACH & MANAGEMENT PLATFORM

## 1. MISSION AND OBJECTIVE

We already have an existing UNITED ANGEL REACH (UAR) charitable organisation management platform.

We want to introduce a complete, advanced Healthcare Outreach & Management System into the existing application.

This is NOT a standalone application.

It must be fully integrated into the existing platform, including:

- Existing authentication.
- Admin dashboard.
- Donor portal.
- Volunteer portal.
- Beneficiary portal.
- Organisation and partner management.
- Campaign management.
- Financial management.
- Notifications.
- Reports and analytics.
- Existing backend and database architecture.

The objective is to enable UAR to partner with hospitals, clinics, diagnostic laboratories, doctors, medical colleges and healthcare organisations to organise free medical camps and provide healthcare assistance to underserved communities.

The system must support the complete healthcare lifecycle, from identifying beneficiaries to registration, medical examination, prescriptions, referrals, medicine distribution, follow-ups and outcome tracking.

### Product vision

Build a secure, AI-assisted healthcare outreach platform that allows UAR to organise and manage healthcare programmes at scale.

The platform should be capable of managing:

- Multiple healthcare campaigns.
- Multiple hospitals and clinics.
- Multiple doctors and healthcare professionals.
- Multiple medical camps.
- Thousands of beneficiaries.
- Medical appointments.
- Medical examinations.
- Prescriptions.
- Diagnostic reports.
- Medicine distribution.
- Referrals.
- Follow-up appointments.
- Healthcare donations.
- Volunteer activities.
- Healthcare inventory.
- Medical camp finances.
- AI-powered operational intelligence.

---

# 2. FIRST: INSPECT THE EXISTING APPLICATION

Before writing code, inspect the complete existing repository.

Understand:

1. Frontend framework and folder structure.
2. Backend framework and folder structure.
3. Existing authentication and login implementation.
4. Existing users and role management.
5. Admin module.
6. Donor module.
7. Volunteer module.
8. Beneficiary module.
9. Campaign management.
10. Organisation and partner management.
11. Database schema and ORM.
12. API conventions.
13. Existing notification services.
14. Existing payment gateway.
15. Existing file management and document upload.
16. Existing reporting and analytics.
17. Existing design system.
18. Existing tests and deployment architecture.

Identify what can be reused.

Do not create duplicate implementations of existing functionality.

Create an architecture and dependency map before making changes.

All new functionality must extend the current application.

---

# 3. AUTHENTICATION, LOGIN & IDENTITY MANAGEMENT

This is a mandatory requirement.

Every relevant user must have an appropriate login experience.

Do not implement one shared account type with unrestricted access.

Implement a unified authentication system with role-specific portals and permissions.

## 3.1 User types

Support the following identities:

1. UAR Super Admin.
2. UAR Admin.
3. Healthcare Programme Manager.
4. Camp Coordinator.
5. Hospital Administrator.
6. Clinic Administrator.
7. Doctor.
8. Medical Practitioner.
9. Nurse.
10. Lab Technician.
11. Pharmacist.
12. Healthcare Volunteer.
13. General Volunteer.
14. Donor.
15. Beneficiary.
16. Beneficiary Caregiver / Guardian.
17. Finance Officer.
18. Inventory Manager.
19. Auditor.

Reuse the existing user and role management architecture wherever possible.

## 3.2 Login experience

Build a consistent login experience.

Support:

- Email and password authentication.
- Mobile number and OTP authentication where appropriate.
- Password reset.
- Account recovery.
- Email and mobile verification.
- Session management.
- Secure logout.
- Session expiration.
- Device and session history.
- Account suspension.
- Login attempt monitoring.
- Optional MFA for privileged accounts.
- Appropriate account verification for healthcare professionals.

Beneficiaries should have a simple, accessible login and registration experience.

Support assisted registration for people without smartphones, email addresses or digital literacy.

Do not force every beneficiary to create a traditional email/password account.

Provide secure account recovery and duplicate identity resolution.

## 3.3 Role-based access control

Implement granular RBAC with resource-level permissions.

Examples:

- A doctor can access assigned patients and authorised clinical records.
- A nurse can record assigned observations and screening information.
- A lab technician can access assigned test orders and upload results.
- A pharmacist can access authorised prescriptions and dispense medicines.
- A camp coordinator can manage registrations and attendance.
- A hospital administrator can manage their organisation's staff and assigned camps.
- A donor can view donation records and approved aggregate impact information.
- A beneficiary can view their own permitted records.
- A caregiver can access only records for which appropriate authorisation exists.
- An auditor can access permitted financial and operational audit information.

Enforce permissions on the backend, not just by hiding frontend buttons.

Support permission checks at:

- Module level.
- Page level.
- API level.
- Record level.
- Organisation level.
- Camp level.
- Medical record level.

## 3.4 Login and audit tracking

Record:

- Successful login.
- Failed login.
- Logout.
- Password reset.
- Session creation.
- Session termination.
- Account lockout.
- Permission changes.
- Privileged access.
- Suspicious access attempts.

Never store plain-text passwords or expose authentication secrets.

---

# 4. BENEFICIARY MASTER PROFILE — COMPLETE PATIENT LIFECYCLE

Build a unified beneficiary profile.

This is one of the most important components of the platform.

A beneficiary must have a persistent identity across multiple campaigns and medical camps.

Do not create a new beneficiary every time the same person visits a different camp.

## 4.1 Beneficiary registration

Capture only information necessary for the programme.

Suggested fields:

- Beneficiary ID.
- Full name.
- Date of birth or approximate age.
- Gender, where relevant.
- Mobile number, if available.
- Address.
- City.
- State.
- PIN code.
- Emergency contact.
- Guardian details, where applicable.
- Preferred language.
- Accessibility requirements.
- Relevant medical history.
- Known allergies.
- Existing medications.
- Relevant medical conditions.
- Consent status.

Support different registration methods:

- Self-registration.
- Assisted registration by UAR staff.
- Camp registration desk.
- Bulk registration where justified.
- QR-based registration.

Support identity verification without making Aadhaar collection mandatory for ordinary camp registration.

## 4.2 Unique beneficiary identity

Generate a unique UAR Beneficiary ID.

Example:

UAR-BEN-2026-000001

Provide:

- QR code.
- Printable beneficiary card.
- Digital beneficiary card.
- Search by beneficiary ID.
- Search by permitted identifying information.
- Duplicate beneficiary detection.

The QR code should identify a beneficiary securely without embedding medical details or sensitive personal information.

## 4.3 Unified medical history

Every beneficiary should have a chronological healthcare timeline.

Display:

- Camp visits.
- Registration history.
- Attendance history.
- Medical consultations.
- Vital measurements.
- Screening records.
- Diagnoses recorded by clinicians.
- Prescriptions.
- Lab tests.
- Lab reports.
- Referrals.
- Medicine dispensing.
- Follow-up appointments.
- Consent history.

Provide filters by date, camp, hospital, doctor and medical activity.

Maintain a distinction between:

- Patient-reported information.
- Screening observations.
- Laboratory findings.
- Clinician-recorded diagnoses.
- Clinician-approved treatment plans.

Never automatically convert an AI-generated suggestion into a confirmed diagnosis.

---

# 5. CAMPAIGN MANAGEMENT

Introduce a new campaign:

**Community Health & Wellness Outreach**

Category: Healthcare and Community Welfare.

The campaign must be configurable and reusable.

Support multiple healthcare initiatives under the same campaign framework.

Examples:

- Free General Health Checkup.
- Free Eye Checkup.
- Diabetes Awareness.
- Blood Pressure Screening.
- Dental Health.
- Women's Healthcare.
- Child Healthcare.
- Senior Citizen Healthcare.
- Nutrition Awareness.
- Blood Donation Drives.
- Rural Healthcare.
- Preventive Healthcare Awareness.

Campaign configuration:

- Campaign name.
- Campaign description.
- Objectives.
- Target beneficiaries.
- Target geography.
- Start and end date.
- Campaign budget.
- Fundraising target.
- Sponsorship requirements.
- Partner hospitals.
- Supported medical services.
- Target camp count.
- Expected beneficiaries.
- Campaign coordinator.
- Campaign status.
- Public visibility.
- Registration configuration.

Campaign lifecycle:

Draft → Review → Approved → Published → Active → Completed → Closed.

Support suspension and cancellation with audit history.

---

# 6. HOSPITAL, CLINIC & HEALTHCARE PARTNER MANAGEMENT

Build a complete healthcare partner management module.

Partner categories:

- Hospitals.
- Clinics.
- Diagnostic laboratories.
- Medical colleges.
- Dental clinics.
- Eye-care centres.
- Pharmacies.
- Blood banks.
- Independent healthcare practitioners.
- CSR healthcare sponsors.

## 6.1 Partner onboarding

Provide a partner registration portal.

Capture:

- Organisation name.
- Registration type.
- Address.
- Branches.
- Contact information.
- Website.
- Services offered.
- Organisation registration details.
- Relevant licences and credentials.
- Participating doctors.
- Medical equipment.
- Available facilities.
- Operating hours.
- Service locations.
- Partnership proposal.

Implement document uploads and verification workflows.

## 6.2 Partner dashboard

Partners should be able to:

- Manage organisation profiles.
- Manage staff.
- Register doctors.
- Submit professional credentials.
- View UAR partnership requests.
- Accept or reject camp invitations.
- View assigned camps.
- Manage doctor availability.
- View appointment schedules.
- Access authorised patient lists.
- Upload authorised medical reports.
- Submit camp completion reports.
- View sponsorship contributions.
- View participation history.

Organisations must never access another partner's patient information.

---

# 7. DOCTOR & MEDICAL PROFESSIONAL PORTAL

Provide a dedicated professional experience.

Doctor profile:

- Name.
- Medical registration details.
- Qualification.
- Speciality.
- Experience.
- Organisation.
- Verification status.
- Availability.
- Assigned camps.

Verify professional credentials through appropriate channels before granting clinical privileges.

Doctor dashboard:

- Today's appointments.
- Assigned camps.
- Patient queue.
- Beneficiary profiles.
- Medical history.
- Screening results.
- Consultation notes.
- Diagnosis records.
- Prescription management.
- Test orders.
- Referrals.
- Follow-up schedules.
- Previous consultations.

## 7.1 Consultation workflow

A doctor should be able to:

1. Open an assigned camp.
2. Select the next beneficiary.
3. Verify beneficiary identity.
4. Review relevant medical history.
5. Review allergies and existing medications.
6. Record observations.
7. Review screening results.
8. Conduct consultation.
9. Record clinical findings.
10. Record diagnosis where appropriate.
11. Issue prescription.
12. Order diagnostic tests where appropriate.
13. Create referrals.
14. Schedule follow-up.
15. Complete and sign the consultation.

Provide draft and signed states.

Once signed, clinical records must be protected against silent modification. Corrections must create an amendment with the original version retained.

---

# 8. MEDICAL CAMPS & LIVE OPERATIONS

Build a complete medical camp management system.

Each camp must have its own operational dashboard.

## 8.1 Camp configuration

Capture:

- Camp ID.
- Campaign ID.
- Camp name.
- Description.
- Date.
- Start and end time.
- Location.
- Coordinates.
- Venue details.
- Capacity.
- Expected attendance.
- Partner organisations.
- Assigned doctors.
- Nurses.
- Volunteers.
- Medical services.
- Required equipment.
- Medical supplies.
- Appointment slots.
- Registration limits.
- Camp coordinator.
- Budget.

Support recurring camps.

## 8.2 Camp-day operations

Create a live operational dashboard.

Show:

- Total registered.
- Checked in.
- Waiting.
- Under screening.
- Waiting for doctor.
- Consultation in progress.
- Awaiting laboratory tests.
- Awaiting pharmacy.
- Referred.
- Completed.
- Cancelled.
- No-show.

Use configurable workflow stages rather than assuming every camp follows the same clinical process.

## 8.3 Beneficiary attendance tracking

This is mandatory and must be comprehensive.

Track every registration separately from actual attendance.

Attendance statuses:

- Registered.
- Confirmed.
- Checked in.
- Waiting.
- In consultation.
- Completed.
- Checked out.
- Cancelled.
- No-show.
- Rejected.
- Rescheduled.

Capture:

- Beneficiary ID.
- Camp ID.
- Registration ID.
- Check-in timestamp.
- Check-in operator.
- Check-in method.
- Queue token.
- Appointment slot.
- Assigned service.
- Assigned doctor.
- Check-out timestamp.
- Attendance status.
- Cancellation reason.
- No-show reason, if known.

Support check-in through:

- QR scanning.
- Beneficiary ID.
- Mobile number lookup.
- Manual authorised registration desk entry.

Provide duplicate check-in prevention.

Maintain a complete attendance history.

Do not equate registration with attendance.

## 8.4 Queue management

Implement:

- Automatic token generation.
- Priority categories defined by qualified staff.
- Service-specific queues.
- Doctor-specific queues.
- Live queue status.
- Estimated waiting time.
- Queue reassignment.
- Missed appointment handling.
- Display screen for camp reception.

Queue prioritisation must not use unvalidated AI medical judgments.

---

# 9. MEDICAL RECORDS & CLINICAL DOCUMENTATION

Build a secure electronic health record capability for outreach activities.

Medical record categories:

- Medical history.
- Allergies.
- Current medications.
- Vital signs.
- Screening observations.
- Consultation notes.
- Diagnoses.
- Laboratory orders.
- Laboratory results.
- Prescriptions.
- Referrals.
- Follow-up notes.
- Medical attachments.

Support structured and unstructured clinical information.

Capture author, timestamp, source, verification status and amendments.

## 9.1 Vital signs

Support configurable recording of:

- Blood pressure.
- Pulse.
- Temperature.
- Respiratory rate.
- Oxygen saturation.
- Height.
- Weight.
- BMI.
- Blood glucose.
- Other measurements required by the relevant medical programme.

Include units, measurement timestamps and contextual reference information.

Do not treat screening measurements as diagnoses.

## 9.2 Medical history

Provide authorised clinicians with relevant information about:

- Previous conditions.
- Allergies.
- Medication history.
- Previous consultations.
- Previous screening findings.
- Relevant family history, if collected.
- Previous referrals.

Provide an easy-to-read chronological medical timeline.

---

# 10. PRESCRIPTION MANAGEMENT — CRITICAL MODULE

Build a complete prescription management system.

Prescriptions must be created and authorised by verified healthcare professionals with the appropriate authority.

## 10.1 Prescription creation

Capture:

- Prescription ID.
- Beneficiary ID.
- Consultation ID.
- Doctor ID.
- Professional registration details.
- Prescription date.
- Diagnosis or clinical indication.
- Medication name.
- Generic name.
- Brand name, where relevant.
- Strength.
- Dosage.
- Route.
- Frequency.
- Duration.
- Quantity.
- Instructions.
- Warnings.
- Follow-up date.

Support multiple medications in one prescription.

## 10.2 Prescription lifecycle

Draft → Clinician Review → Signed → Issued → Dispensing → Partially Dispensed / Fully Dispensed → Completed.

Support cancelled and superseded prescriptions with reasons and audit history.

Never silently modify a signed prescription.

## 10.3 Digital prescription

Generate a printable prescription containing:

- UAR branding.
- Healthcare partner details.
- Doctor details.
- Beneficiary information.
- Consultation details.
- Prescribed medicines.
- Dosage instructions.
- Issue date.
- Follow-up information.
- Authorised digital signature or verification mechanism.
- Prescription verification QR code.

Protect prescription documents from unauthorised modification.

## 10.4 Medicine dispensing

Integrate prescription management with the pharmacy and inventory module.

Track:

- Prescribed quantity.
- Available stock.
- Dispensed quantity.
- Remaining quantity.
- Batch number.
- Expiry date.
- Pharmacist.
- Dispensing date.
- Beneficiary acknowledgement.
- Partial dispensing.
- Unavailable medicine.
- Substitution approval where legally and clinically permitted.

Never automatically substitute a medication based on AI recommendations.

## 10.5 Prescription history

A beneficiary's authorised medical timeline should show:

- Previous prescriptions.
- Current prescriptions.
- Dispensing status.
- Cancelled prescriptions.
- Superseded prescriptions.
- Follow-up instructions.

---

# 11. DIAGNOSTIC LABORATORY MANAGEMENT

Provide a laboratory workflow.

Support:

- Test catalogue.
- Test orders.
- Sample collection.
- Sample identification.
- Collection timestamps.
- Laboratory assignment.
- Sample status.
- Test results.
- Report uploads.
- Result verification.
- Doctor review.
- Critical-result escalation.

Lifecycle:

Test Ordered → Sample Collection → Sample Received → Processing → Result Available → Verified → Doctor Reviewed.

Support PDF reports and structured results.

Only authorised laboratory professionals can verify and publish laboratory results.

AI can assist with report extraction and summarisation but must preserve the original report and its provenance.

---

# 12. REFERRAL & FOLLOW-UP MANAGEMENT

A medical camp must not end when the beneficiary leaves the venue.

Build a complete continuity-of-care workflow.

## 12.1 Referral management

Doctors can refer beneficiaries to:

- Hospitals.
- Specialists.
- Diagnostic centres.
- Follow-up clinics.
- Emergency services when clinically appropriate.

Capture:

- Referral ID.
- Beneficiary.
- Referring doctor.
- Referral reason.
- Priority assigned by clinician.
- Receiving organisation.
- Recommended speciality.
- Referral date.
- Supporting documents.
- Referral status.

Referral statuses:

- Created.
- Shared with beneficiary.
- Accepted.
- Appointment scheduled.
- Attended.
- Report received.
- Completed.
- Cancelled.
- Lost to follow-up.

## 12.2 Follow-up management

Support:

- Follow-up date.
- Responsible organisation.
- Responsible clinician.
- Follow-up instructions.
- Appointment confirmation.
- Reminder scheduling.
- Follow-up outcome.
- Additional referral.

Track whether the beneficiary actually attended.

## 12.3 Follow-up notifications

Support configurable:

- SMS.
- WhatsApp.
- Email.
- In-app notifications.
- Phone follow-up task lists.

Use the existing notification infrastructure.

Record delivery and response status where supported.

Do not send sensitive clinical details in ordinary notification messages.

---

# 13. PHARMACY, MEDICINE & INVENTORY MANAGEMENT

Build a shared inventory system for healthcare camps.

Track:

- Medicines.
- Medical equipment.
- Diagnostic kits.
- Disposable supplies.
- PPE.
- Blood glucose strips.
- BP equipment.
- First-aid supplies.
- Other camp materials.

Features:

- Inventory catalogue.
- Stock received.
- Stock issued.
- Stock transferred.
- Stock consumed.
- Stock returned.
- Stock adjustment.
- Batch tracking.
- Expiry tracking.
- Supplier details.
- Camp allocation.
- Low-stock alerts.
- Expiry alerts.
- Stock reconciliation.
- Wastage tracking.

Use inventory transactions with audit history.

Support separate stock ownership for UAR, hospitals and sponsoring organisations.

Do not mix donated inventory with purchased inventory without recording ownership and source.

---

# 14. DONOR, FUNDRAISING & SPONSORSHIP INTEGRATION

Integrate healthcare campaigns with the existing donor system.

Support:

- General healthcare donations.
- Camp sponsorship.
- Equipment sponsorship.
- Medicine sponsorship.
- Diagnostic test sponsorship.
- Hospital sponsorship.
- CSR contributions.
- Restricted donations.
- Unrestricted donations.

Display:

- Fundraising target.
- Funds received.
- Funds allocated.
- Actual expenses.
- Remaining balance.
- Sponsorship coverage.
- Approved impact reports.

Integrate existing payment processing and receipt generation.

Maintain complete financial transaction history.

Do not expose beneficiary identities or clinical information to donors.

---

# 15. VOLUNTEER MANAGEMENT

Build healthcare-specific volunteer workflows.

Support roles such as:

- Registration volunteer.
- Camp coordinator.
- Queue manager.
- General assistant.
- Medical assistant.
- Translation volunteer.
- Logistics volunteer.
- Qualified healthcare volunteer.

Features:

- Volunteer profile.
- Skills.
- Qualifications.
- Credential verification.
- Availability.
- Camp applications.
- Assignments.
- Attendance.
- Check-in/check-out.
- Volunteer hours.
- Task allocation.
- Performance and participation history.
- Certificates.

Separate medical responsibilities from general volunteer responsibilities.

Unqualified volunteers must not receive access to clinical functions.

---

# 16. AI-POWERED HEALTHCARE INTELLIGENCE

This should be a major differentiator for UAR.

Introduce an AI layer that improves operational efficiency, accessibility and continuity of care.

AI must operate as an assistant, not as an autonomous medical practitioner.

All clinical decisions must remain with authorised healthcare professionals.

## 16.1 AI Beneficiary Registration Assistant

Provide an AI-assisted registration experience.

Capabilities:

- Conversational registration.
- Multilingual interaction.
- Guided data collection.
- Voice-assisted registration where supported.
- Duplicate profile suggestions.
- Missing-field detection.
- Document extraction.
- Registration summarisation.

Allow staff to review and confirm extracted information.

## 16.2 AI Medical Document Intelligence

Use OCR and AI to process uploaded documents.

Support:

- Previous prescriptions.
- Laboratory reports.
- Medical documents.
- Discharge summaries.
- Referral documents.

Extract:

- Document date.
- Medical provider.
- Medication names.
- Test names.
- Reported results.
- Reference ranges.
- Follow-up recommendations.

Preserve original documents and extraction confidence.

Never silently overwrite structured medical records.

## 16.3 AI Clinical Documentation Assistant

Assist verified doctors with:

- Consultation note drafting.
- Medical history summarisation.
- Timeline summaries.
- Prescription formatting.
- Follow-up note drafting.
- Referral letter drafting.

The doctor must review, correct and explicitly approve all clinical documentation.

Do not automatically sign notes or prescriptions.

## 16.4 AI Medical Record Summarisation

Generate concise, source-linked summaries of a beneficiary's previous visits.

Example:

"Beneficiary attended two previous UAR camps. A blood pressure screening was recorded during the previous visit. A referral was created. The referral outcome is currently pending."

Summaries must distinguish confirmed records from missing or unverified information.

Provide links to the original records.

## 16.5 AI Camp Planning Assistant

Allow administrators to ask:

- Where should we organise our next medical camp?
- Which locations have the highest unmet outreach demand?
- How many doctors should we arrange?
- How many volunteers are required?
- What equipment and supplies should we procure?
- What is the expected camp budget?
- Which hospitals are suitable partners?

Use aggregated, authorised and appropriately anonymised data.

Recommendations must explain their underlying assumptions.

## 16.6 AI Beneficiary Follow-up Assistant

Identify operational follow-up opportunities:

- Beneficiaries with pending referrals.
- Missed follow-up appointments.
- Pending laboratory reviews.
- Incomplete registration workflows.
- Unacknowledged notifications.

Generate task suggestions for authorised staff.

Do not autonomously determine a patient's medical risk or urgency.

## 16.7 AI Appointment & Resource Optimisation

Assist with:

- Appointment slot allocation.
- Doctor availability.
- Camp capacity planning.
- Queue estimates.
- Volunteer allocation.
- Resource requirements.

Allow administrators to approve suggested schedules.

## 16.8 AI Healthcare Chat Assistant

Introduce a multilingual UAR healthcare information assistant.

Possible use cases:

- Find upcoming free medical camps.
- Understand registration steps.
- Check appointment details.
- Find participating hospitals.
- Explain how to access an issued prescription.
- Understand administrative referral instructions.
- Answer general preventive healthcare questions using approved sources.

The assistant must not diagnose conditions, prescribe medicines or replace a doctor's consultation.

Escalate emergency or potentially urgent situations to appropriate human assistance and local emergency services.

## 16.9 AI Analytics & Campaign Intelligence

Provide natural-language analytics.

Examples:

"How many beneficiaries attended medical camps in Bangalore this month?"

"Which camps had the highest no-show rate?"

"How many prescriptions were issued?"

"How many beneficiaries are awaiting referral follow-up?"

"Which hospitals contributed the most medical services?"

"How much was spent per beneficiary?"

"Which locations require additional camps?"

Generate reports from authorised data with clear definitions and date ranges.

Never expose identifiable medical information in ordinary management reports.

## 16.10 AI Governance

Implement:

- AI provider abstraction.
- Configurable AI providers.
- Model and prompt version tracking.
- AI request audit metadata.
- Confidence indicators where meaningful.
- Human review and approval.
- Sensitive-data minimisation.
- Redaction before external model calls where appropriate.
- AI output provenance.
- Opt-out and consent handling where required.
- Cost and usage tracking.
- AI failure fallback.

Do not train models on beneficiary medical information without an appropriate lawful basis and explicit governance.

Do not allow AI-generated content to directly update signed clinical records, issue prescriptions, dispense medicines or make clinical decisions.

---

# 17. ADVANCED QR, DIGITAL ID & NOTIFICATION FEATURES

Implement:

### Beneficiary QR

- Unique beneficiary QR.
- Secure camp check-in.
- Registration verification.
- Appointment lookup.
- Access-controlled record retrieval.

### Doctor QR / verification

- Professional verification.
- Camp assignment verification.
- Credential status.

### Prescription QR

- Prescription authenticity verification.
- Document version verification.
- No public access to full medical details.

### Camp QR

- Public camp information.
- Registration.
- Location.
- Available services.
- Appointment availability.

### Notifications

Support:

- Registration confirmation.
- Appointment reminders.
- Camp changes.
- Volunteer assignment.
- Partner approval.
- Prescription availability.
- Test result availability.
- Referral reminders.
- Follow-up reminders.
- Donation acknowledgement.

Respect consent, communication preferences and privacy.

---

# 18. COMPLETE ADMIN DASHBOARD

Create a healthcare management dashboard integrated into existing Admin.

### Overview

- Active healthcare campaigns.
- Total medical camps.
- Upcoming camps.
- Completed camps.
- Registered beneficiaries.
- Actual beneficiaries attended.
- Total consultations.
- Total screenings.
- Total prescriptions.
- Total referrals.
- Pending follow-ups.
- Verified healthcare partners.
- Active doctors.
- Active volunteers.
- Total donations.
- Total expenditure.

### Operational management

- Camp calendar.
- Live camp status.
- Beneficiary queue.
- Attendance.
- Doctor allocation.
- Partner availability.
- Volunteer assignments.
- Appointment capacity.

### Clinical operations

- Screening statistics.
- Prescription statistics.
- Lab test statistics.
- Referral status.
- Follow-up completion.

Clinical data must only be visible to authorised roles.

### Financial operations

- Donations.
- Sponsorships.
- Budget allocation.
- Camp expenses.
- Inventory value.
- Cost per beneficiary.

### AI insights

- Resource demand.
- Attendance trends.
- Camp planning suggestions.
- Follow-up workload.
- Operational bottlenecks.

---

# 19. REPORTS & AUDITABILITY

Provide exportable reports.

### Campaign reports

- Campaign performance.
- Camp completion.
- Geographic outreach.
- Beneficiary reach.
- Service distribution.

### Attendance reports

- Registered.
- Confirmed.
- Attended.
- No-show.
- Cancelled.
- Unique beneficiaries.
- Repeat beneficiaries.

### Medical reports

For authorised medical personnel only:

- Screening summaries.
- Consultation records.
- Prescription summaries.
- Test completion.
- Referral completion.
- Follow-up outcomes.

### Financial reports

- Donations.
- Sponsorships.
- Expenses.
- Inventory.
- Budget utilisation.

### Audit reports

Track who performed every important action.

Examples:

- Who created a beneficiary?
- Who edited their profile?
- Who viewed a medical record?
- Who recorded a screening?
- Who issued a prescription?
- Who modified an appointment?
- Who dispensed medicine?
- Who closed a camp?
- Who exported a report?

Create immutable audit events or an equivalent tamper-evident audit mechanism.

Maintain version history for sensitive records.

---

# 20. SECURITY, PRIVACY & LEGAL REQUIREMENTS

This platform processes sensitive personal and healthcare information.

Implement privacy and security as core architectural requirements.

Research applicable Indian laws and regulations, including:

- Digital Personal Data Protection Act, 2023 and applicable rules.
- Information Technology Act and applicable rules.
- Applicable clinical establishment and professional requirements.
- Applicable electronic health record and digital health standards.

Implement:

- Data minimisation.
- Purpose-based consent.
- Role-based access.
- Organisation-level isolation.
- Encryption in transit and at rest.
- Secure document storage.
- Audit trails.
- Record retention policies.
- Secure backups.
- Access revocation.
- Data export and correction workflows.
- Incident response.
- No sensitive medical information in application logs.
- No public medical document URLs.

Where appropriate, evaluate FHIR-compatible data structures for future interoperability with healthcare providers and India's ABDM ecosystem.

Do not claim ABDM compliance merely because the system uses FHIR-like data structures.

For minors, implement appropriate parent or guardian consent and access rules.

Emergency handling must have an explicitly governed access process and complete audit trail.

---

# 21. DATABASE & TECHNICAL ARCHITECTURE

Inspect the existing database and ORM first.

Reuse existing users, roles, beneficiaries, campaigns, donations, organisations and notifications.

Introduce only necessary new entities.

Potential healthcare entities:

IDENTITY:
- HealthcareUserProfile
- ProfessionalCredential
- HealthcareOrganisation
- OrganisationStaff
- BeneficiaryProfile
- BeneficiaryGuardian
- BeneficiaryConsent

CAMPAIGN:
- HealthCampaign
- MedicalCamp
- CampService
- CampPartner
- CampStaffAssignment
- CampVolunteerAssignment

OPERATIONS:
- CampRegistration
- Appointment
- AppointmentSlot
- Attendance
- QueueToken
- CampTask

CLINICAL:
- Encounter
- VitalObservation
- ScreeningRecord
- ConsultationNote
- ClinicalDiagnosis
- Prescription
- PrescriptionItem
- MedicationDispense
- DiagnosticOrder
- DiagnosticResult
- MedicalDocument
- MedicalReferral
- FollowUp

INVENTORY:
- MedicalInventory
- InventoryBatch
- InventoryTransaction
- CampInventoryAllocation

FINANCE:
- HealthcareSponsorship
- CampExpense
- CampBudgetAllocation

AI:
- AIInteractionMetadata
- AIReview
- AIUsageRecord
- AIModelConfiguration

AUDIT:
- MedicalRecordAccessLog
- ClinicalRecordVersion
- SecurityAuditEvent

These are conceptual entities. Reuse or extend existing equivalents wherever possible.

Requirements:

- Proper foreign keys.
- Referential integrity.
- Indexing.
- Transactional operations.
- Idempotency.
- Optimistic locking where necessary.
- Safe migrations.
- Soft deletion where appropriate.
- Tenant and organisation isolation.
- Record versioning.
- Efficient reporting queries.

Do not create an unnecessarily fragmented microservice architecture.

Follow the existing application architecture.

---

# 22. API DEVELOPMENT

Implement complete API contracts following existing project conventions.

API domains:

1. Authentication and identity.
2. Healthcare organisations.
3. Healthcare professionals.
4. Beneficiary profiles.
5. Medical campaigns.
6. Medical camps.
7. Registrations.
8. Appointments.
9. Attendance and queues.
10. Consultations.
11. Screening.
12. Prescriptions.
13. Medicine dispensing.
14. Diagnostics.
15. Referrals.
16. Follow-ups.
17. Inventory.
18. Donations.
19. Expenses.
20. Reporting.
21. AI assistance.
22. Audit and compliance.

Each API must have:

- Authentication.
- Authorisation.
- Input validation.
- Proper error handling.
- Pagination.
- Filtering.
- Consistent response format.
- Audit events where applicable.
- Rate limiting where appropriate.
- Idempotency for critical operations.

Use existing API clients and shared services.

---

# 23. FRONTEND MODULES & NAVIGATION

Integrate the following navigation into the existing platform.

ADMIN:
- Healthcare Dashboard.
- Campaigns.
- Medical Camps.
- Beneficiaries.
- Healthcare Partners.
- Doctors & Medical Staff.
- Volunteers.
- Registrations & Attendance.
- Appointments.
- Clinical Operations.
- Prescriptions.
- Diagnostics.
- Referrals & Follow-ups.
- Pharmacy & Inventory.
- Donations & Sponsorships.
- Expenses.
- Reports & Analytics.
- AI Assistant.
- Audit & Security.
- Configuration.

DOCTOR:
- Dashboard.
- My Camps.
- Patient Queue.
- Beneficiaries.
- Consultations.
- Screening Records.
- Prescriptions.
- Diagnostic Orders.
- Referrals.
- Follow-ups.
- Medical History.

HOSPITAL / CLINIC:
- Dashboard.
- Organisation Profile.
- Branches.
- Staff.
- Doctors.
- Credentials.
- Camp Invitations.
- Assigned Camps.
- Appointments.
- Reports.
- Partnership History.

VOLUNTEER:
- Dashboard.
- Available Camps.
- Applications.
- Assignments.
- Attendance.
- Tasks.
- Volunteer Hours.
- Certificates.

BENEFICIARY:
- Dashboard.
- My Profile.
- My Health ID.
- Upcoming Camps.
- My Registrations.
- My Appointments.
- My Medical History.
- My Prescriptions.
- My Lab Reports.
- My Referrals.
- Follow-ups.
- Notifications.
- Consent & Privacy.

DONOR:
- Healthcare Campaigns.
- Camp Sponsorship.
- Donations.
- Donation History.
- Receipts.
- Fund Utilisation.
- Impact Reports.

These should be separate role-specific experiences using the existing authentication and navigation framework, not separate applications.

---

# 24. FIVE PARALLEL AGENT IMPLEMENTATION STRATEGY

Spin up five parallel agents.

All agents must inspect the existing codebase and coordinate through a shared implementation plan.

### AGENT 1 — Research, Architecture & Product Design

Responsible for:

- Healthcare programme research.
- Existing architecture discovery.
- End-to-end workflows.
- Role and permission matrix.
- Database design proposal.
- API contracts.
- Security requirements.
- AI architecture.
- Cross-agent coordination.

Must approve shared interfaces before implementation.

### AGENT 2 — Admin, Campaign & Operations

Responsible for:

- Healthcare campaign management.
- Camp management.
- Camp calendar.
- Live operational dashboard.
- Attendance.
- Queue management.
- Partner administration.
- Doctor assignments.
- Volunteer assignments.
- Inventory administration.
- Financial administration.
- Reports and analytics.

### AGENT 3 — Beneficiary, Doctor & Clinical Experience

Responsible for:

- Beneficiary registration.
- Beneficiary master profile.
- Digital health ID.
- Medical timeline.
- Doctor portal.
- Consultation workflows.
- Vital observations.
- Screening.
- Prescriptions.
- Diagnostics.
- Referrals.
- Follow-ups.
- Medical document management.

### AGENT 4 — Donor, Partner, Volunteer & AI

Responsible for:

- Donor integration.
- Healthcare partner portal.
- Hospital onboarding.
- Volunteer portal.
- Sponsorship.
- Notification workflows.
- AI assistant.
- OCR and document extraction.
- AI clinical documentation assistance.
- AI analytics.
- AI camp planning.

### AGENT 5 — Backend, Integration, Security & QA

Responsible for:

- Database migrations.
- Backend APIs.
- Authentication integration.
- RBAC.
- Audit logging.
- Organisation isolation.
- Notification integrations.
- Payment integration.
- Shared services.
- Integration testing.
- End-to-end testing.
- Security review.
- Regression testing.
- Code duplication review.

### Parallel execution rules

1. Define file ownership.
2. Define API contracts first.
3. Define database ownership.
4. Avoid simultaneous modification of shared files.
5. Use shared reusable components.
6. Do not create duplicate API clients or services.
7. Review changes before merging.
8. Resolve integration conflicts.
9. Ensure all agents use the existing design system.
10. Agent 5 must validate the integrated result, not just individual workstreams.

If true parallel agents are unavailable, execute the five workstreams sequentially while maintaining these responsibilities.

---

# 25. TESTING — END-TO-END ACCEPTANCE SCENARIOS

Testing is mandatory.

Create automated tests wherever the existing framework supports them.

### Scenario A — Complete beneficiary journey

1. Beneficiary registers.
2. Beneficiary receives a UAR ID.
3. Beneficiary logs in.
4. Beneficiary finds a nearby medical camp.
5. Beneficiary registers.
6. Beneficiary receives confirmation.
7. Beneficiary arrives at the camp.
8. Registration desk scans QR.
9. Attendance is recorded.
10. Queue token is generated.
11. Nurse records vital signs.
12. Doctor opens the beneficiary record.
13. Doctor reviews medical history.
14. Doctor records consultation.
15. Doctor issues a prescription.
16. Pharmacist dispenses medicines.
17. Doctor creates a referral if needed.
18. Follow-up is scheduled.
19. Beneficiary receives notification.
20. Beneficiary views authorised medical records.
21. Follow-up attendance is recorded.
22. Camp and campaign analytics are updated.

### Scenario B — No-show tracking

1. Beneficiary registers.
2. Appointment is confirmed.
3. Beneficiary does not attend.
4. Appointment is marked no-show by an authorised workflow.
5. No-show statistics update.
6. Follow-up task is created where appropriate.
7. Beneficiary can reschedule.

### Scenario C — Hospital partnership

1. Hospital registers.
2. Admin verifies credentials.
3. Hospital account is approved.
4. Hospital creates staff profiles.
5. Doctor credentials are verified.
6. Admin invites hospital to a camp.
7. Hospital accepts.
8. Doctors are assigned.
9. Doctors conduct consultations.
10. Hospital submits a completion report.

### Scenario D — Prescription and medicine

1. Doctor creates a prescription.
2. Doctor signs it.
3. Prescription document is generated.
4. Pharmacist views the authorised prescription.
5. Medicine availability is checked.
6. Medicine is dispensed.
7. Inventory is reduced.
8. Dispensing is recorded.
9. Beneficiary views prescription history.

### Scenario E — AI assistance

1. Staff uploads a previous medical document.
2. AI extracts information.
3. Extraction confidence and source are displayed.
4. Authorised user reviews extracted information.
5. User confirms the information.
6. Approved information is added to the appropriate record.
7. AI-generated summaries reference original records.
8. No AI output is automatically signed or converted into a prescription.

### Scenario F — Access control and privacy

Test that:

- A donor cannot access medical records.
- A volunteer cannot access clinical notes.
- A doctor cannot access unrelated beneficiaries.
- A hospital cannot access another hospital's records.
- A beneficiary cannot access another beneficiary's records.
- A pharmacist cannot issue prescriptions.
- A nurse cannot sign doctor prescriptions unless explicitly authorised under the applicable clinical workflow.
- An unauthorised user cannot download medical attachments.
- All privileged access is audited.

### Scenario G — Regression

Verify all existing UAR functionality remains operational.

Run:

- Backend tests.
- Frontend tests.
- Integration tests.
- End-to-end tests.
- Database migration tests.
- Build.
- Lint.
- Type checking.
- Security checks.
- Permission tests.

Fix all implementation-related regressions.

---

# 26. PERFORMANCE & SCALABILITY

Design for multiple camps running simultaneously.

Support:

- Large beneficiary databases.
- High-volume check-in.
- Multiple partner organisations.
- Multiple concurrent doctors.
- Appointment concurrency.
- Background notifications.
- Asynchronous document processing.
- AI job queues.
- Report generation.
- Paginated medical timelines.
- Efficient database indexes.

Use Redis, queues or other existing infrastructure where appropriate.

Do not introduce unnecessary infrastructure or dependencies.

Ensure camp-day check-in can operate reliably under poor network conditions.

Evaluate offline-capable registration and attendance with safe synchronisation and duplicate prevention.

---

# 27. FINAL DEFINITION OF DONE

The implementation is complete only when all the following are working.

AUTHENTICATION:
- Every user type has the correct login experience.
- Permissions are enforced on the backend.
- Accounts and organisations are properly isolated.

ADMIN:
- Campaigns and camps can be created and managed.
- Hospitals, doctors and volunteers can be managed.
- Attendance and operational workflows work.
- Reports and dashboards work.

BENEFICIARY:
- Beneficiary registration works.
- Unique identity works.
- Medical history is maintained.
- Camp registration and appointment management work.
- Medical records can be securely accessed.

DOCTOR:
- Consultations work.
- Screening records work.
- Prescriptions can be issued and signed.
- Referrals and follow-ups work.

PHARMACY:
- Prescriptions can be dispensed.
- Inventory is tracked.
- Medicine transactions are auditable.

HOSPITAL:
- Partner onboarding works.
- Staff verification works.
- Camp participation works.

VOLUNTEER:
- Applications and assignments work.
- Attendance and hours are tracked.

DONOR:
- Healthcare donations work.
- Sponsorship works.
- Receipts and approved impact reports work.

AI:
- AI-assisted workflows are integrated.
- Human review is enforced.
- AI cannot autonomously diagnose or prescribe.
- AI usage is audited.

TRACKING:
- Every camp registration is traceable.
- Actual attendance is traceable.
- Consultations are traceable.
- Prescriptions are traceable.
- Medicine dispensing is traceable.
- Referrals are traceable.
- Follow-ups are traceable.
- Changes and privileged access are auditable.

QUALITY:
- All modules are integrated.
- Reusable components are used.
- No unnecessary code duplication exists.
- Existing functionality is not broken.
- Automated tests are executed.
- End-to-end acceptance scenarios pass.
- No placeholder APIs or fake workflows remain.

---

# 28. REQUIRED FINAL DELIVERY REPORT

After implementation, provide:

1. Existing architecture discovered.
2. New architecture implemented.
3. All modules modified.
4. New modules introduced.
5. Database migrations.
6. API endpoints.
7. Authentication and permission changes.
8. New reusable components.
9. AI capabilities implemented.
10. Notification integrations.
11. Security and privacy measures.
12. Tests executed.
13. Actual test results.
14. Build and deployment results.
15. Performance considerations.
16. Known limitations.
17. Remaining work.
18. Instructions to run and deploy.

Clearly distinguish between fully implemented, partially implemented and planned features.

Never report a feature as complete if it is only a UI mockup or an unconnected API.

---

# 29. FINAL EXECUTION INSTRUCTION

Do not stop at generating an architecture document or a development plan.

Start by inspecting the existing UAR repository.

Research the healthcare outreach domain.

Create the shared implementation specification.

Start five parallel agents.

Implement all required backend and frontend functionality.

Integrate the modules.

Run the complete end-to-end test scenarios.

Review the entire codebase for duplication, broken integrations, security issues and regression.

Fix all identified issues.

The final outcome must be a production-oriented, AI-assisted healthcare outreach management platform that works as a natural extension of the existing UAR application.

Do not rebuild the existing system.

Do not compromise existing functionality.

Do not leave disconnected pages, fake data, placeholder APIs or incomplete workflows.

Make sensible engineering decisions based on the existing architecture. Ask for approval only when a genuine business, security, financial or destructive-operation decision requires it.

**BUILD IT END TO END. NOT JUST THE UI. NOT JUST THE BACKEND. THE COMPLETE WORKING SYSTEM.**