# MASTER IMPLEMENTATION PROMPT
# UNITED ANGEL REACH — FOOD SECURITY, NUTRITION & COMMUNITY DISTRIBUTION PLATFORM

## 1. PROJECT OBJECTIVE

We already have an existing UNITED ANGEL REACH (UAR) charitable organisation management platform.

We want to introduce a comprehensive Food Security & Community Nutrition Programme into the existing platform.

IMPORTANT: The existing platform already has modules such as:

- Admin.
- Donor.
- Beneficiary.
- Volunteer.
- Distribution.
- Campaign Management.
- Inventory and other supporting modules, where implemented.

Do not assume that these modules are complete or correctly integrated.

Your first responsibility is to inspect and understand the existing implementation, verify what actually works, identify missing functionality and improve existing modules wherever necessary.

Do not create duplicate modules or duplicate business logic.

The objective is to build a complete, modern, AI-assisted food assistance management ecosystem that supports the entire process from food donations and procurement to beneficiary identification, distribution, acknowledgement and impact reporting.

This must be an extension of the existing UAR application, not a new application.

### Programme name

**UAR Food Security & Community Nutrition Initiative**

Primary objective:

To provide nutritious food, grocery kits, cooked meals and essential food supplies to underprivileged families, homeless individuals, senior citizens, children, people facing financial hardship and other eligible communities.

The system must support:

1. Free food distribution.
2. Grocery and ration kit distribution.
3. Cooked meal distribution.
4. Community feeding programmes.
5. Emergency food assistance.
6. School and child nutrition support.
7. Senior citizen food assistance.
8. Rural food distribution.
9. Festival and Ramadan food distribution.
10. Disaster and emergency relief.
11. Monthly family ration programmes.
12. Corporate-sponsored food programmes.
13. Community kitchens.
14. Food recovery and surplus food redistribution.
15. Recurring beneficiary assistance.

The platform must be configurable enough to introduce new food programmes without rebuilding the distribution module.

---

# 2. MANDATORY FIRST STEP — EXISTING SYSTEM AUDIT

Before writing any code, inspect the entire existing repository.

Specifically inspect:

- Public website.
- Admin dashboard.
- Donor portal.
- Beneficiary portal.
- Volunteer portal.
- Distribution module.
- Campaign module.
- Inventory module.
- Finance module.
- Organisation and partner module.
- Authentication and role management.
- Notifications.
- Payments.
- Document and file management.
- Reports and analytics.
- Database models.
- Backend APIs.
- Existing shared components.
- Existing test suites.

For each module, determine:

1. What functionality already exists?
2. What functionality is genuinely working?
3. What is only a frontend implementation?
4. What APIs are implemented?
5. What database entities exist?
6. What business logic is missing?
7. What integrations are missing?
8. What security issues exist?
9. What can be reused?
10. What needs to be enhanced?

Create a functionality audit matrix.

Example:

| Feature | Existing | Verified | Required action |
|---|---|---|---|
| Donor management | Yes/No | Yes/No | Reuse/Enhance |
| Beneficiary management | Yes/No | Yes/No | Reuse/Enhance |
| Distribution management | Yes/No | Yes/No | Reuse/Enhance |
| Food inventory | Yes/No | Yes/No | Reuse/Enhance |
| QR distribution | Yes/No | Yes/No | Implement/Enhance |
| Food expiry tracking | Yes/No | Yes/No | Implement/Enhance |
| Donor impact tracking | Yes/No | Yes/No | Implement/Enhance |

Do not implement something again simply because it is mentioned in this prompt.

If an existing implementation is correct, reusable, secure and sufficiently complete, retain it.

If it is incomplete, improve it.

If it is poorly designed, refactor it while preserving backward compatibility.

Create a shared implementation specification before parallel development.

---

# 3. PUBLIC WEBSITE — FOOD SECURITY PROGRAMME

The public website is extremely important.

People should be able to understand what UAR does, see upcoming distributions, request food assistance, donate, sponsor a programme and understand the actual impact.

Do not make the public website look like an internal admin dashboard.

Follow the existing public website design system.

## 3.1 Public campaign landing page

Create a dedicated public-facing page:

/programs/food-security

Suggested title:

**No Family Should Go Hungry.**

Description:

"United Angel Reach works with donors, volunteers, food suppliers, community organisations and local partners to provide essential food assistance to families and individuals facing hardship."

The page should include:

### Hero section

- Compelling campaign heading.
- Campaign description.
- Authentic food distribution imagery.
- Donate Now CTA.
- Request Food Assistance CTA.
- Become a Volunteer CTA.
- Sponsor a Food Distribution CTA.

### Impact statistics

Display verified, up-to-date aggregate figures:

- Families supported.
- Individuals reached.
- Food kits distributed.
- Meals served.
- Distribution locations.
- Active volunteers.
- Active food partners.
- Total donations received, where disclosure is appropriate.

Every statistic must come from actual platform data.

Never hardcode fake impact statistics.

Display the reporting period and last-updated date.

### Upcoming distributions

Show publicly approved distributions.

Each card should display:

- Distribution name.
- Location or general area.
- Date and time.
- Food assistance type.
- Eligibility information.
- Registration availability.
- Available assistance categories.
- Registration deadline.
- Contact information.
- Status.

Public visibility must be configurable.

Never reveal private beneficiary lists, exact sensitive shelter addresses or restricted operational information.

### Our food programmes

Create programme categories:

- Family Grocery Kits.
- Free Cooked Meals.
- Monthly Food Assistance.
- Children's Nutrition.
- Senior Citizen Food Support.
- Emergency Food Relief.
- Community Kitchen.
- Festival Food Distribution.
- Rural Food Assistance.
- Surplus Food Recovery.

Each programme should have a dedicated description and an appropriate CTA.

### How it works

Explain the process:

1. Identify communities requiring food assistance.
2. Receive donations and food supplies.
3. Prepare food packages.
4. Coordinate distribution.
5. Verify actual beneficiaries.
6. Deliver food assistance.
7. Track impact and report outcomes.

### Transparency section

Show:

- Campaign fundraising progress.
- Food kits funded.
- Distribution history.
- Actual meals delivered.
- Aggregate expenses.
- Approved distribution reports.
- Donor impact stories.

Do not expose confidential financial information or beneficiary identities.

### Volunteer section

Allow public visitors to register interest in volunteering.

### Partner section

Invite:

- Restaurants.
- Grocery stores.
- Supermarkets.
- Food manufacturers.
- Food wholesalers.
- Hotels.
- Corporate CSR teams.
- Community organisations.
- Local food suppliers.

### FAQ section

Include questions such as:

- Who can receive food assistance?
- How do I register?
- Is food assistance free?
- How can I sponsor a food distribution?
- Can I donate groceries instead of money?
- How can I volunteer?
- How does UAR ensure food quality?
- How can an organisation partner with UAR?

---

# 4. PUBLIC FOOD ASSISTANCE REQUEST SYSTEM

Visitors must be able to request assistance without necessarily having an existing beneficiary account.

Create a public application flow.

Suggested route:

/food-assistance/apply

Capture only necessary information:

- Applicant name.
- Mobile number.
- Address or locality.
- City.
- PIN code.
- Number of family members.
- Number of children, where relevant.
- Senior citizens in the household, where relevant.
- Assistance required.
- Dietary restrictions and allergies, if voluntarily disclosed and relevant.
- Preferred communication method.
- Urgency.
- Reason for requesting assistance.
- Consent.

Support:

- Individual applications.
- Family applications.
- Assisted applications.
- Community organisation referrals.
- Emergency assistance requests.

After submission:

1. Generate an application reference number.
2. Send confirmation.
3. Create an admin review task.
4. Run duplicate application checks.
5. Allow authorised staff to review.
6. Approve, reject or request additional information.
7. Assign an appropriate programme.
8. Notify the applicant.

Allow applicants to check status using a secure application reference and verification method.

Do not expose applicant details through predictable public URLs.

## Eligibility and fairness

Build a configurable eligibility assessment workflow.

Potential considerations:

- Household size.
- Number of dependants.
- Income range, if appropriate and voluntarily provided.
- Employment situation.
- Existing assistance.
- Urgency.
- Geographic service availability.
- Programme-specific criteria.

Avoid unnecessarily intrusive documentation requirements.

Do not automatically reject beneficiaries using an AI score.

Provide human review, appeal or reassessment workflows.

Support emergency food assistance even when full documentation is unavailable.

---

# 5. ADMIN MODULE — COMPLETE FOOD PROGRAMME MANAGEMENT

Build a dedicated Food Security management experience inside the existing Admin module.

Suggested navigation:

Food Security
- Overview.
- Programmes.
- Campaigns.
- Distribution Events.
- Beneficiary Applications.
- Beneficiary Allocation.
- Food Inventory.
- Food Procurement.
- Food Donations.
- Food Suppliers.
- Food Partners.
- Volunteer Management.
- Distribution Operations.
- Delivery & Logistics.
- Food Safety & Quality.
- Expenses & Budgets.
- Donor Sponsorships.
- Feedback & Complaints.
- Reports & Analytics.
- AI Assistant.
- Configuration.

Adapt this structure to the existing navigation conventions.

## 5.1 Admin dashboard

Display:

- Active food programmes.
- Upcoming distributions.
- Completed distributions.
- Total registered beneficiaries.
- Unique beneficiaries served.
- Total families supported.
- Total food kits prepared.
- Total food kits distributed.
- Total meals prepared.
- Total meals distributed.
- Total food weight distributed.
- Food inventory available.
- Expiring inventory.
- Pending beneficiary applications.
- Pending distributions.
- Active volunteers.
- Active food partners.
- Total donations.
- Total food sponsorships.
- Programme expenses.
- Remaining budget.

Include:

- Date filters.
- Location filters.
- Programme filters.
- Campaign filters.
- Distribution status.
- Food category.
- Partner filters.

Distinguish between planned, prepared, dispatched, delivered and actually received quantities.

---

# 6. FOOD PROGRAMME & CAMPAIGN MANAGEMENT

Use the existing campaign management system wherever possible.

Introduce food-specific campaign configuration.

Example campaigns:

- Monthly Family Ration Assistance.
- Community Meal Programme.
- Ramadan Food Kit Distribution.
- School Nutrition Support.
- Senior Citizen Food Support.
- Emergency Flood Relief Food Distribution.
- Rural Grocery Assistance.

Each programme should support:

- Programme name.
- Description.
- Objectives.
- Target beneficiaries.
- Geographic coverage.
- Start date.
- End date.
- Budget.
- Fundraising target.
- Food assistance categories.
- Eligibility criteria.
- Distribution frequency.
- Partner organisations.
- Assigned coordinator.
- Sponsorship opportunities.
- Public visibility.
- Programme status.

Campaign lifecycle:

Draft → Review → Approved → Published → Active → Completed → Archived.

Support recurring programmes.

Do not create separate hardcoded logic for every campaign category.

---

# 7. FOOD DONATION & DONOR MANAGEMENT

Integrate with the existing Donor module.

Donors should be able to contribute money, food items, grocery kits, supplies or sponsorship.

## 7.1 Monetary donations

Allow:

- General food programme donations.
- Sponsor a family.
- Sponsor 10 families.
- Sponsor 50 families.
- Sponsor 100 meals.
- Sponsor a complete distribution event.
- Sponsor monthly food assistance.
- Sponsor emergency relief.
- CSR sponsorship.

Donation options should be configurable by administrators.

Do not hardcode donation amounts.

Integrate the existing payment gateway.

Support:

- Payment confirmation.
- Payment failure.
- Refund workflows.
- Receipts.
- Donation history.
- Tax documentation where applicable.
- Restricted and unrestricted donations.
- Sponsorship allocation.

## 7.2 Food item donations

Allow donors to donate actual food items.

Capture:

- Donor.
- Food item.
- Quantity.
- Unit.
- Food category.
- Brand, where relevant.
- Batch or lot details.
- Manufacturing date.
- Expiry date.
- Packaging condition.
- Storage requirements.
- Pickup or delivery method.
- Estimated value.
- Donation date.

Support:

- Packaged groceries.
- Rice.
- Wheat flour.
- Pulses.
- Cooking oil.
- Salt.
- Sugar.
- Spices.
- Baby food where permitted.
- Other approved food supplies.

For fresh food, capture preparation or collection time and applicable safe-use deadlines.

Food safety validation must occur before stock becomes available for distribution.

## 7.3 Donor dashboard

Donors should see:

- Total contributions.
- Monetary donations.
- Food donations.
- Active sponsorships.
- Programmes supported.
- Distribution events supported.
- Donation receipts.
- Fund utilisation.
- Food contribution history.
- Approved impact reports.

Provide a donor impact timeline.

Example:

"Your sponsorship supported a community distribution where 120 grocery kits were delivered to eligible families."

Only show verified aggregate outcomes and respect beneficiary privacy.

## 7.4 Sponsor a distribution

Allow donors to select an upcoming event and sponsor:

- Complete event.
- A defined number of families.
- Grocery kits.
- Cooked meals.
- Specific food categories.
- Transportation.
- Packaging materials.
- Emergency food supplies.

Track exactly how the sponsorship was allocated and utilised.

Prevent double allocation of restricted funds.

---

# 8. BENEFICIARY MANAGEMENT & FOOD ASSISTANCE HISTORY

Integrate with the existing Beneficiary module.

Do not create duplicate beneficiary identities.

Every beneficiary should have a persistent UAR beneficiary ID.

Support:

- Individual beneficiaries.
- Families.
- Household members.
- Guardians.
- Senior citizens.
- Children.
- People requiring special assistance.
- Community referrals.

## 8.1 Beneficiary profile

Display:

- Beneficiary ID.
- Name.
- Contact details.
- Address.
- Household size.
- Family composition where relevant.
- Preferred language.
- Accessibility needs.
- Programme eligibility.
- Verification status.
- Consent status.
- Assistance history.

Only collect sensitive socioeconomic information when necessary.

## 8.2 Food assistance timeline

For every beneficiary, maintain:

- Applications.
- Eligibility reviews.
- Approved programmes.
- Allocated distributions.
- Registration confirmations.
- Attendance.
- Actual collection.
- Home delivery.
- Food packages received.
- Quantity received.
- Date and location.
- Acknowledgement.
- Feedback.
- Complaints.
- Follow-up activities.

Show historical assistance across all UAR food programmes.

## 8.3 Household-level assistance

A household must be treated as an important entity.

One household may contain several beneficiaries.

Support:

- Household master record.
- Household members.
- Household size.
- Primary contact.
- Guardian.
- Household assistance plan.
- Distribution history.
- Duplicate household detection.

Prevent duplicate distribution caused by multiple family members registering independently, while still allowing legitimate separate assistance when appropriate.

## 8.4 Beneficiary portal

Provide a dedicated Food Assistance section.

Beneficiaries should be able to:

- Discover available programmes.
- Apply for food assistance.
- View application status.
- View approved distributions.
- Register for distribution events.
- View upcoming distribution details.
- Receive notifications.
- View their assistance history.
- Request home delivery if supported.
- Submit feedback.
- Report missing or incorrect items.
- Request reassessment.

Support assisted access for people who cannot use the portal.

---

# 9. DISTRIBUTION MODULE — COMPLETE END-TO-END OPERATIONS

This is the central operational module.

First audit the existing Distribution module and enhance it rather than replacing it.

Every distribution must be connected to:

- Programme.
- Campaign.
- Budget.
- Food inventory.
- Donors or sponsors.
- Beneficiaries.
- Volunteers.
- Location.
- Logistics.
- Actual distribution records.

## 9.1 Distribution creation

Allow admins to create a distribution event.

Capture:

- Distribution ID.
- Programme.
- Campaign.
- Distribution name.
- Description.
- Date.
- Start and end time.
- Location.
- Coordinates.
- Venue.
- Distribution type.
- Target population.
- Expected beneficiaries.
- Maximum capacity.
- Food packages.
- Quantities.
- Distribution coordinator.
- Volunteers.
- Food inventory allocation.
- Budget.
- Partners.
- Registration deadline.
- Public visibility.
- Special instructions.

Support multiple locations and multiple distribution events under one campaign.

## 9.2 Distribution types

Support:

1. Physical community distribution.
2. Home delivery.
3. Door-to-door distribution.
4. Community kitchen.
5. Cooked meal serving.
6. Monthly grocery kit distribution.
7. Emergency distribution.
8. Institution-based distribution.
9. School-based distribution.
10. Rural distribution.
11. Mobile food distribution.

Make distribution workflows configurable by type.

## 9.3 Distribution lifecycle

Use a clear operational lifecycle:

Draft
→ Approved
→ Published
→ Registration Open
→ Registration Closed
→ Planning
→ Stock Allocated
→ Packages Prepared
→ Ready
→ In Progress
→ Completed
→ Reconciled
→ Closed.

Also support:

- Postponed.
- Cancelled.
- Suspended.

Record reasons and notify relevant users when changes occur.

## 9.4 Distribution package configuration

Create reusable food package templates.

Examples:

FAMILY BASIC GROCERY KIT:
- Rice.
- Wheat flour.
- Pulses.
- Cooking oil.
- Salt.
- Sugar.

FAMILY NUTRITION KIT:
- Cereals.
- Pulses.
- Nutritionally appropriate food items.
- Other programme-approved essentials.

SENIOR CITIZEN FOOD KIT:
- Configurable easy-to-use food essentials based on programme requirements.

EMERGENCY RELIEF KIT:
- Packaged, safe-to-store essentials.
- Drinking water where required.
- Other emergency supplies.

CHILD NUTRITION KIT:
- Age-appropriate, professionally reviewed food items.

Every template must be configurable.

Do not hardcode package contents or quantities.

Store the actual composition of each prepared package, including the version used for each distribution.

## 9.5 Beneficiary allocation

Allow admins to:

- Select eligible beneficiaries.
- Select approved households.
- Allocate assistance quantities.
- Allocate package types.
- Reserve inventory.
- Manage waiting lists.
- Prevent duplicate allocation.
- Reassign cancelled allocations.
- Handle emergency walk-ins.

Track planned quantities separately from actual quantities distributed.

---

# 10. COMPLETE ATTENDANCE & DISTRIBUTION TRACKING

This is a non-negotiable requirement.

We must know exactly:

- Who was invited?
- Who registered?
- Who was approved?
- Who confirmed?
- Who arrived?
- Who collected food?
- Who received home delivery?
- Who did not attend?
- Who was unable to receive assistance?
- What exactly was distributed?
- Who distributed it?
- When was it distributed?

## 10.1 Attendance statuses

- Applied.
- Registered.
- Approved.
- Confirmed.
- Checked in.
- Waiting.
- Distribution in progress.
- Distributed.
- Partially distributed.
- Not collected.
- No-show.
- Cancelled.
- Rescheduled.
- Rejected.
- Delivery pending.
- Delivered.
- Delivery failed.

## 10.2 QR-based verification

Generate a secure QR code for:

- Beneficiary.
- Household.
- Distribution registration.
- Distribution event.
- Food package, where needed.

At the distribution location:

1. Volunteer opens the distribution scanner.
2. Scans beneficiary QR.
3. System verifies the identity.
4. Checks whether the beneficiary is approved.
5. Checks whether the assistance was already distributed.
6. Displays authorised package information.
7. Records check-in.
8. Confirms the actual items and quantities handed over.
9. Records volunteer identity.
10. Captures acknowledgement.
11. Marks distribution complete.

Support manual lookup using beneficiary ID or mobile number.

QR codes must not contain personal or sensitive information directly.

Prevent duplicate distribution and replay attacks.

## 10.3 Acknowledgement

Support:

- Digital acknowledgement.
- OTP verification where practical.
- Signature.
- Assisted acknowledgement.
- Staff witness.
- Photo evidence only where justified and with appropriate consent.

Never make photography mandatory for receiving free food.

Provide alternative acknowledgement for beneficiaries without smartphones or mobile connectivity.

## 10.4 No-show and failed distribution

Track:

- No-show.
- Partial collection.
- Wrong package.
- Insufficient stock.
- Beneficiary unreachable.
- Delivery failed.
- Beneficiary declined.
- Distribution cancelled.

Allow authorised users to record reasons.

Automatically release reserved stock according to configurable rules.

Create reassignment tasks when appropriate.

---

# 11. FOOD INVENTORY & WAREHOUSE MANAGEMENT

Audit the existing inventory system before implementation.

Extend it to support food-specific requirements.

Track:

- Food item.
- SKU.
- Category.
- Unit of measurement.
- Supplier.
- Donor.
- Ownership.
- Batch number.
- Manufacturing date.
- Expiry date.
- Quantity received.
- Quantity reserved.
- Quantity available.
- Quantity dispatched.
- Quantity distributed.
- Quantity returned.
- Quantity wasted.
- Storage location.
- Storage temperature requirements.
- Quality status.

## 11.1 Batch management

Every food donation or procurement receipt must create a traceable stock batch.

Support:

- Batch-level quantity.
- Expiry tracking.
- Lot tracking.
- Storage requirements.
- Source.
- Quality inspection.
- Distribution history.

Use FEFO (First Expired, First Out) where applicable.

Do not allow expired or quarantined stock to be allocated.

## 11.2 Warehouse management

Support:

- Multiple warehouses.
- Storage locations.
- Stock transfers.
- Stock receipts.
- Stock issues.
- Stock adjustments.
- Cycle counts.
- Reconciliation.
- Low-stock alerts.
- Expiry alerts.
- Damaged stock.
- Quarantined stock.

## 11.3 Food safety and quality

Implement food safety workflows.

Capture:

- Packaging condition.
- Product condition.
- Seal integrity.
- Expiry validity.
- Temperature requirements.
- Storage conditions.
- Quality inspection.
- Inspection result.
- Inspector.
- Rejection reason.

For cooked meals and perishable foods, track preparation time, holding conditions and applicable safe distribution/use deadlines.

Use FEFO for suitable packaged food and time-based handling rules for perishable food.

Ensure administrators can configure food safety policies based on applicable FSSAI requirements and the relevant food category.

Never allow AI to override food safety rejection decisions.

---

# 12. FOOD PROCUREMENT & SUPPLIER MANAGEMENT

Build or extend procurement functionality.

Support:

- Food suppliers.
- Grocery wholesalers.
- Retail partners.
- Farmers.
- Food manufacturers.
- Restaurants.
- Supermarkets.
- Local vendors.

Features:

- Supplier registration.
- Supplier verification.
- Food catalogue.
- Purchase requests.
- Purchase orders.
- Goods receipt.
- Quality inspection.
- Invoice upload.
- Purchase cost.
- Supplier payments.
- Procurement history.

Track the source of every stock batch:

- Donated.
- Purchased.
- CSR-sponsored.
- Partner-contributed.
- Recovered surplus food.

Maintain separate financial and inventory records.

---

# 13. LOGISTICS & DELIVERY MANAGEMENT

Introduce a complete logistics workflow.

Support:

- Warehouse dispatch.
- Vehicle allocation.
- Driver allocation.
- Route planning.
- Delivery schedules.
- Distribution point allocation.
- Home delivery.
- Proof of delivery.
- Failed delivery.
- Return to warehouse.

For each dispatch:

- Dispatch ID.
- Distribution ID.
- Vehicle.
- Driver.
- Volunteer or delivery team.
- Items.
- Quantities.
- Batch details.
- Departure time.
- Destination.
- Delivery time.
- Delivery status.

For home delivery, provide:

- Beneficiary address.
- Delivery assignment.
- Contact instructions.
- Delivery attempt history.
- OTP or authorised acknowledgement.
- Delivery failure reason.

Protect beneficiary addresses from unauthorised volunteers and public access.

Only share the minimum necessary information with assigned delivery personnel.

---

# 14. VOLUNTEER PORTAL & DISTRIBUTION OPERATIONS

Integrate with the existing Volunteer module.

Volunteers should be able to:

- Discover food distribution opportunities.
- Apply for events.
- View assigned locations.
- View shift timings.
- Accept tasks.
- Check in and check out.
- View assigned responsibilities.
- Scan beneficiary QR codes where authorised.
- Confirm package handover.
- Record stock issues.
- Report damaged packages.
- Report distribution problems.
- Record delivery outcomes.
- Submit completion reports.
- Track volunteer hours.

Support volunteer roles:

- Registration.
- Queue management.
- Packing.
- Warehouse assistance.
- Food preparation.
- Serving.
- Distribution.
- Delivery.
- Logistics.
- Photography, where authorised.
- Camp coordination.

Provide role-specific permissions.

A volunteer must never be able to alter beneficiary eligibility, financial records or inventory balances without explicit authorisation.

## Volunteer dashboard

Show:

- Upcoming assignments.
- Completed events.
- Attendance.
- Volunteer hours.
- Assigned tasks.
- Distribution history.
- Certificates.
- Feedback.

---

# 15. FOOD PREPARATION & PACKING MANAGEMENT

Introduce a dedicated preparation and packing workflow.

This is particularly useful for large distributions.

Support:

- Package templates.
- Packing batches.
- Packing assignments.
- Required quantities.
- Actual packed quantities.
- Packing teams.
- Quality checks.
- Label printing.
- QR package labels.
- Batch references.
- Completion status.

Example:

Distribution: Monthly Family Grocery Support.

Target: 200 families.

Package template: Family Basic Grocery Kit.

The system calculates required stock from the package template and target allocation.

Example:

200 kits × 5 kg rice = 1,000 kg required.

Show:

- Required stock.
- Available stock.
- Reserved stock.
- Shortfall.
- Packed quantity.
- Rejected packages.
- Remaining quantity.

Do not assume all 200 kits have been prepared merely because the distribution is approved.

Maintain separate states for planned, reserved, packed, dispatched and delivered quantities.

---

# 16. FINANCIAL MANAGEMENT & TRANSPARENCY

Integrate with the existing Finance and Donor modules.

Track:

- Campaign budget.
- Distribution budget.
- Donations.
- Restricted donations.
- Unrestricted donations.
- Food donations.
- Procurement expenses.
- Transportation.
- Packaging.
- Storage.
- Operational expenses.
- Sponsorship allocation.

Provide complete financial traceability.

Example:

A donor sponsors ₹50,000 for a grocery distribution.

The system should track:

- Amount received.
- Payment transaction.
- Sponsorship allocation.
- Purchase orders funded.
- Actual procurement costs.
- Other approved expenses.
- Remaining balance.
- Distribution outcomes.

Do not assume a donation is fully spent just because an event is completed.

Support allocation rules for restricted funds.

Generate reports for:

- Funds received.
- Funds allocated.
- Funds spent.
- Remaining funds.
- Food donated.
- Food purchased.
- Value distributed.
- Cost per family.
- Cost per meal.
- Cost per beneficiary.

Use actual costs and clearly state valuation assumptions for donated goods.

---

# 17. AI-POWERED FOOD SECURITY INTELLIGENCE

AI should make UAR more efficient, proactive and intelligent.

Build a reusable AI service layer using the existing AI architecture or provider abstraction if one exists.

AI should assist staff and administrators, not make final eligibility, financial or food safety decisions.

## 17.1 AI Distribution Planning Assistant

Allow an admin to ask:

- How many grocery kits should we prepare?
- Which locations have the highest pending food assistance demand?
- How much rice, flour and pulses are required?
- Which distributions are understocked?
- How many volunteers should be assigned?
- What is the estimated distribution cost?
- Which beneficiaries are eligible for upcoming programmes?
- Which warehouse should supply this event?

Use actual platform data and clearly state assumptions.

## 17.2 AI Food Demand Forecasting

Analyse historical data:

- Previous distributions.
- Household sizes.
- Seasonal demand.
- Location-wise applications.
- Emergency requests.
- Stock consumption.
- Programme frequency.

Estimate future demand.

Provide confidence and assumptions.

Do not automatically approve or deny food assistance based on forecasts.

## 17.3 AI Beneficiary Assistance

Use AI to assist with:

- Multilingual application guidance.
- Application summarisation.
- Duplicate application suggestions.
- Missing information detection.
- Document extraction where needed.
- Staff communication.
- Assistance status explanations.

Require human review for eligibility decisions and duplicate merges.

## 17.4 AI Inventory Intelligence

Use AI to identify:

- Expiring stock.
- Slow-moving inventory.
- Potential shortages.
- Overstocking.
- Food wastage trends.
- Procurement opportunities.
- Distribution allocation suggestions.

Generate actionable alerts.

Use actual inventory rules for expiry enforcement; never rely on AI for this.

## 17.5 AI Donor Matching

Recommend suitable food programmes to donors based on:

- Donation type.
- Donor preferences.
- Campaign funding requirements.
- Geographic scope.
- Sponsorship availability.

Do not reveal beneficiary identities or confidential programme details.

## 17.6 AI Logistics Assistant

Assist with:

- Distribution point planning.
- Delivery grouping.
- Vehicle requirements.
- Route optimisation.
- Volunteer allocation.
- Delivery workload estimates.

Allow authorised admins to approve suggestions.

## 17.7 AI Food Waste Prevention

Analyse:

- Expiring batches.
- Excess stock.
- Unused allocations.
- Cancelled distributions.
- Food returns.
- Historical consumption.

Recommend redistribution to eligible programmes before safe-use deadlines.

Do not recommend distributing unsafe, expired or quarantined food.

## 17.8 AI Natural Language Analytics

Allow admins to ask:

"How many families received grocery kits this month?"

"How many beneficiaries did not collect their allocated food?"

"Which distributions had the highest attendance?"

"How much food was wasted this quarter?"

"Which donors contributed the most grocery supplies?"

"How much did each distribution cost?"

"Which locations have the highest pending food assistance applications?"

Answers must be generated from authorised data and include reporting periods and metric definitions.

## 17.9 AI Communication Assistant

Generate:

- Public campaign descriptions.
- Donor updates.
- Volunteer instructions.
- Distribution announcements.
- Beneficiary notifications.
- Impact report drafts.
- Partner outreach messages.

Allow human review before publishing or sending.

## 17.10 AI governance

Implement:

- Configurable AI providers.
- Prompt versioning.
- AI usage logging.
- Cost tracking.
- Sensitive-data redaction.
- Human review.
- AI failure fallback.
- Output provenance.
- Permission-aware data retrieval.

Never let AI independently approve beneficiaries, change stock, spend money or publish private information.

---

# 18. ADVANCED FEATURES — THINK BEYOND BASIC DISTRIBUTION

Implement these where they fit the existing architecture and provide real operational value.

## A. Community Food Need Mapping

Create an aggregate geographic view.

Show:

- Active food programmes.
- Distribution locations.
- Service coverage.
- Pending assistance requests.
- Underserved areas.
- Food partner locations.
- Warehouse locations.

Use aggregated data and protect beneficiary locations.

Allow administrators to identify areas that need additional outreach.

## B. Community Referral Network

Allow authorised partners to refer families who need food assistance.

Potential referral sources:

- NGOs.
- Schools.
- Community organisations.
- Hospitals.
- Social workers.
- Local institutions.

Track referral source and outcome.

## C. Recurring Family Assistance

Allow eligible households to receive:

- Weekly food support.
- Monthly grocery kits.
- Quarterly assistance.
- Emergency support.

Track allocation frequency and prevent accidental duplicate allocation.

Allow authorised exceptions.

## D. Food Donation Pickup Scheduling

Allow donors to request pickup for food donations.

Capture:

- Pickup address.
- Food category.
- Estimated quantity.
- Availability.
- Storage requirements.
- Contact person.

Assign volunteers or logistics personnel.

Track pickup, inspection, acceptance and stock receipt.

## E. Corporate CSR Portal

Allow companies to:

- Register organisations.
- Sponsor programmes.
- Fund distributions.
- Donate bulk groceries.
- Arrange employee volunteering.
- View approved CSR impact reports.
- Download sponsorship statements.

## F. Food Distribution Kiosk

Consider a lightweight mobile-first interface for distribution desks.

Features:

- Scan QR.
- Search beneficiary.
- View approved allocation.
- Confirm handover.
- Record quantity.
- Capture acknowledgement.
- Display completion status.

Keep it fast and easy to operate.

## G. Offline Distribution Mode

This is particularly important for rural areas and locations with unreliable internet.

Support:

- Secure offline beneficiary allocation snapshots.
- Offline check-in.
- Offline handover records.
- Locally stored encrypted operational data.
- Safe synchronisation.
- Duplicate conflict detection.
- Idempotent sync.
- Conflict review.

Never permit stale offline data to silently overwrite newer eligibility or inventory information.

## H. Feedback & Grievance Management

Allow beneficiaries to report:

- Food not received.
- Incorrect package.
- Damaged items.
- Poor quality.
- Missing quantities.
- Inaccessible distribution location.
- Unfair treatment.
- Volunteer misconduct.

Allow anonymous complaints where appropriate.

Track investigation, resolution, escalation and closure.

## I. Beneficiary Dignity & Accessibility

Design the platform so assistance is easy to access without stigma.

Support:

- Multiple languages.
- Simple forms.
- Assisted registration.
- Low-literacy interfaces.
- Accessible layouts.
- Large touch targets.
- SMS-based updates.
- Alternative acknowledgement.
- Confidential applications.

Do not publicly label or expose individuals as poor, homeless or vulnerable.

---

# 19. NOTIFICATION & COMMUNICATION SYSTEM

Integrate with existing notifications.

Trigger events for:

BENEFICIARIES:
- Application received.
- Application approved.
- Application rejected with appropriate explanation.
- Distribution scheduled.
- Appointment or collection reminder.
- Distribution postponed.
- Food delivered.
- Assistance history updated.

DONORS:
- Donation received.
- Receipt generated.
- Sponsorship allocated.
- Distribution completed.
- Impact report published.

VOLUNTEERS:
- Application accepted.
- Assignment created.
- Shift reminder.
- Schedule changed.
- Event completed.

ADMINS:
- New applications.
- Low stock.
- Expiring stock.
- Food safety rejection.
- Distribution shortfall.
- Delivery failure.
- Unreconciled stock.
- Budget threshold.
- Complaints.
- Operational alerts.

Support in-app notifications, email, SMS and WhatsApp where existing providers are configured.

Track delivery status.

Avoid sending duplicate messages.

Never expose sensitive beneficiary details in notification content.

---

# 20. REPORTING & IMPACT ANALYTICS

Build a comprehensive reporting engine.

## Programme reports

- Programmes created.
- Active programmes.
- Completed programmes.
- Geographic coverage.
- Target versus actual beneficiaries.

## Distribution reports

- Planned distributions.
- Completed distributions.
- Registered beneficiaries.
- Actual attendance.
- No-shows.
- Families served.
- Food packages prepared.
- Packages distributed.
- Food quantities distributed.
- Delivery success rate.

## Inventory reports

- Stock received.
- Stock available.
- Stock allocated.
- Stock distributed.
- Stock expired.
- Stock wasted.
- Stock returned.
- Inventory valuation.

## Donor reports

- Monetary contributions.
- Food contributions.
- Sponsor participation.
- Restricted fund utilisation.
- Programme impact.

## Volunteer reports

- Volunteer hours.
- Events attended.
- Tasks completed.
- Distribution participation.

## Impact reports

- Unique families supported.
- Unique individuals supported.
- Total assistance instances.
- Total meals served.
- Total food weight distributed.
- Repeat assistance.
- Emergency assistance.
- Geographic coverage.

Avoid double counting.

A family supported in three separate months should be counted as one unique family and three assistance instances.

Provide:

- PDF exports.
- Excel exports.
- CSV exports.
- Printable summaries.

Only show approved, privacy-safe information in public reports.

---

# 21. SECURITY & COMPLIANCE

Research and implement applicable Indian requirements.

Consider:

- Digital Personal Data Protection Act, 2023 and applicable rules.
- Information Technology Act and relevant rules.
- Applicable FSSAI requirements.
- Food safety and hygiene requirements.
- Food donation and surplus redistribution guidance.
- Applicable NGO and charitable organisation financial requirements.

Requirements:

- Secure authentication.
- Role-based permissions.
- Organisation isolation.
- Beneficiary privacy.
- Consent.
- Secure file uploads.
- Encrypted communication.
- Audit logs.
- Secure payment integration.
- Data retention.
- Access revocation.
- Secure backups.
- Food batch traceability.
- Food quality checks.
- Financial reconciliation.

Do not claim regulatory compliance without verifying the applicable requirements and implementation.

---

# 22. TECHNICAL ARCHITECTURE & REUSABLE COMPONENTS

Follow the existing architecture.

Do not introduce a separate application or unnecessary microservices.

Reuse existing:

- Authentication.
- User and role management.
- Campaign management.
- Beneficiary services.
- Donor services.
- Volunteer services.
- Distribution engine.
- Inventory services.
- Payment services.
- Notification services.
- File manager.
- Audit services.
- Reporting infrastructure.

Build shared reusable components where missing.

Potential reusable components:

- DistributionStatusTimeline.
- BeneficiarySearch.
- HouseholdSelector.
- QRScanner.
- AttendanceCheckIn.
- FoodPackageBuilder.
- InventoryBatchSelector.
- StockAvailability.
- FoodExpiryIndicator.
- DistributionProgress.
- DonorImpactSummary.
- VolunteerAssignment.
- DistributionCalendar.
- LocationPicker.
- BulkAllocation.
- DeliveryStatusTracker.
- AuditTimeline.
- ReportFilters.

These are suggestions. Inspect existing components first.

Engineering requirements:

- No duplicate API clients.
- No duplicated business logic.
- No repeated permission checks implemented inconsistently.
- Shared validation schemas.
- Centralised status definitions.
- Reusable forms.
- Reusable tables.
- Reusable modals and drawers.
- Proper loading states.
- Proper empty states.
- Proper error handling.
- Responsive design.
- Accessible interfaces.
- Type safety where supported.
- Database transactions.
- Idempotent operations.
- Auditability.

Keep domain logic separate from UI components.

---

# 23. FIVE PARALLEL AGENTS

Use five parallel agents.

Each agent must inspect the existing system and work only within clearly assigned responsibilities.

The agents must coordinate through a shared implementation specification.

## AGENT 1 — SYSTEM AUDIT, RESEARCH & ARCHITECTURE

Responsibilities:

- Inspect the complete repository.
- Audit existing modules.
- Verify actual functionality.
- Research food security and food distribution models.
- Research FSSAI guidance and applicable requirements.
- Design complete workflows.
- Define database changes.
- Define API contracts.
- Define role permissions.
- Define shared components.
- Identify dependencies.
- Define agent ownership.

Deliverables:

- Existing functionality audit.
- Gap analysis.
- Architecture.
- Data model.
- API contracts.
- Implementation plan.

Agent 1 must coordinate with all other agents before shared architecture changes.

## AGENT 2 — PUBLIC WEBSITE, CAMPAIGN & ADMIN

Responsibilities:

- Public food security landing page.
- Public campaign pages.
- Public assistance application.
- Donation and sponsorship discovery.
- Admin dashboard.
- Programme management.
- Campaign management.
- Distribution administration.
- Application review.
- Allocation management.
- Reporting interfaces.
- Public impact transparency.

## AGENT 3 — BENEFICIARY, DONOR & VOLUNTEER

Responsibilities:

- Beneficiary food assistance experience.
- Household profiles.
- Application status.
- Assistance history.
- Donor food and financial contributions.
- Sponsorship.
- Donor impact tracking.
- Volunteer applications.
- Volunteer assignments.
- Volunteer check-in.
- Volunteer task management.
- Beneficiary notifications.

## AGENT 4 — DISTRIBUTION, INVENTORY, PROCUREMENT & LOGISTICS

Responsibilities:

- Existing distribution module audit and enhancements.
- Distribution lifecycle.
- Food package templates.
- Stock allocation.
- Packing workflows.
- QR-based distribution.
- Attendance.
- Delivery tracking.
- Food inventory.
- Batch and expiry management.
- Warehouse operations.
- Procurement.
- Food donations.
- Food safety.
- Reconciliation.
- Offline operations.

## AGENT 5 — BACKEND, AI, SECURITY & QA

Responsibilities:

- Shared backend APIs.
- Database migrations.
- Authentication and authorisation integration.
- Payment integration.
- Notification integration.
- Audit logging.
- AI services.
- AI analytics.
- AI planning assistant.
- Security validation.
- Integration testing.
- End-to-end testing.
- Regression testing.
- Performance testing.
- Code duplication review.

### Agent coordination rules

1. Agent 1 establishes shared API contracts and data ownership.
2. Every agent must have explicit file/module ownership.
3. Do not allow simultaneous conflicting edits.
4. Use existing components wherever possible.
5. Shared component changes must have a designated owner.
6. All agents must report implementation status and test results.
7. Agents must review dependent work before integration.
8. Integrate frequently rather than waiting until the end.
9. Agent 5 validates the actual merged implementation.
10. No agent can mark its task complete solely because its UI renders.

If true parallel execution is unavailable, execute the same five workstreams sequentially while preserving the responsibilities and validation gates.

---

# 24. MANDATORY VALIDATION FOR EVERY AGENT AND TASK

This is extremely important.

Do not wait until all five agents finish to discover problems.

Every individual task must follow this pattern:

IMPLEMENT → TEST → REVIEW → INTEGRATE → VALIDATE.

For every task:

1. Inspect the existing implementation.
2. Identify reusable components and services.
3. Implement the required change.
4. Run relevant unit tests.
5. Run relevant integration tests.
6. Run linting and type checking.
7. Verify API and database behaviour.
8. Verify permissions.
9. Verify responsive UI.
10. Review for duplicate logic.
11. Review existing workflows for regression.
12. Fix all discovered issues.
13. Report actual results.

### Agent-specific acceptance tests

Agent 1:
- Verify architecture against actual repository.
- Validate all contracts and dependencies.
- Ensure no unnecessary new modules are proposed.

Agent 2:
- Test public campaign browsing.
- Test assistance applications.
- Test admin approval.
- Test campaign publication.
- Test distribution creation.

Agent 3:
- Test donor contributions.
- Test sponsorship.
- Test beneficiary registration.
- Test household handling.
- Test volunteer applications and assignments.

Agent 4:
- Test inventory receipt.
- Test batch tracking.
- Test expiry restrictions.
- Test stock reservation.
- Test package preparation.
- Test QR check-in.
- Test distribution completion.
- Test stock reconciliation.
- Test delivery.

Agent 5:
- Test backend contracts.
- Test authentication.
- Test RBAC.
- Test organisation isolation.
- Test AI permissions.
- Test audit events.
- Test all cross-module integrations.

---

# 25. END-TO-END ACCEPTANCE TEST SCENARIOS

The entire system must be validated through realistic workflows.

## Scenario A — Complete food distribution

1. Admin creates a food security programme.
2. Admin publishes it on the public website.
3. Donor discovers the programme.
4. Donor sponsors a distribution.
5. Payment is completed.
6. Receipt is generated.
7. Admin creates a distribution event.
8. Food package template is selected.
9. Required inventory is calculated.
10. Food stock is procured or donated.
11. Food stock is inspected.
12. Inventory batches are created.
13. Stock is reserved.
14. Beneficiaries apply.
15. Applications are reviewed.
16. Eligible beneficiaries are approved.
17. Beneficiaries receive confirmations.
18. Volunteers are assigned.
19. Food packages are prepared.
20. Distribution event begins.
21. Beneficiary QR is scanned.
22. Identity and allocation are verified.
23. Actual items are recorded.
24. Acknowledgement is captured.
25. Distribution is completed.
26. Stock is reconciled.
27. Financial utilisation is updated.
28. Donor impact is updated.
29. Public aggregate impact is updated after approval.
30. Distribution is closed.

## Scenario B — Beneficiary no-show

1. Beneficiary is approved.
2. Beneficiary receives confirmation.
3. Beneficiary does not arrive.
4. No-show is recorded.
5. Inventory allocation is handled according to policy.
6. Beneficiary can reschedule.
7. Reassignment is recorded.
8. No-show reports are updated.

## Scenario C — Food donation

1. Donor registers a food donation.
2. Pickup is scheduled.
3. Volunteer or logistics team collects the donation.
4. Warehouse receives the food.
5. Quality inspection is conducted.
6. Accepted items are recorded.
7. Rejected items are recorded with reasons.
8. Accepted stock is assigned a batch.
9. Expiry information is tracked.
10. Food is allocated to an appropriate distribution.
11. Distribution is completed.
12. Donor sees an approved impact summary.

## Scenario D — Home delivery

1. Beneficiary requests home delivery.
2. Admin approves the request.
3. Food package is reserved.
4. Delivery is assigned.
5. Delivery personnel receive minimum required information.
6. Food package is dispatched.
7. Delivery is attempted.
8. OTP or alternative acknowledgement is recorded.
9. Delivery is completed or marked failed.
10. Failed delivery is escalated.
11. Inventory and distribution records are updated.

## Scenario E — Inventory safety

1. Food stock is received.
2. Batch details are entered.
3. Expiry is recorded.
4. Food is inspected.
5. Damaged stock is quarantined.
6. Expired stock is blocked.
7. FEFO allocation is applied.
8. Stock is distributed.
9. Remaining stock is reconciled.
10. Audit records are verified.

## Scenario F — AI planning

1. Admin requests a distribution plan.
2. AI retrieves authorised aggregate data.
3. AI calculates suggested package requirements.
4. AI identifies shortages.
5. AI suggests volunteer requirements.
6. AI estimates costs.
7. Admin reviews suggestions.
8. Admin approves or modifies the plan.
9. Actual results are compared with estimates.

AI must never automatically modify inventory or approve beneficiaries.

## Scenario G — Privacy and security

Verify:

- Donors cannot access beneficiary personal details.
- Volunteers only access assigned operational information.
- Beneficiaries cannot access another household's information.
- Delivery personnel only access assigned delivery information.
- Admin permissions are appropriately restricted.
- Financial information is protected.
- Public pages contain no private beneficiary information.
- Unauthorised users cannot manipulate distribution records.
- QR codes cannot be reused to create duplicate handovers.
- All important changes are audited.

---

# 26. PERFORMANCE & RELIABILITY

Design for multiple simultaneous distributions and large beneficiary volumes.

Support:

- Large beneficiary databases.
- Bulk allocation.
- Bulk notifications.
- Concurrent QR scanning.
- Transactional inventory updates.
- Background jobs.
- Large report exports.
- Multiple warehouses.
- Multiple distribution locations.
- Offline check-in.
- Safe synchronisation.

Ensure stock is not distributed twice because of concurrent requests.

Use database transactions, locking or equivalent concurrency controls where required.

Provide useful operational error handling.

Do not silently lose offline records.

---

# 27. FINAL DELIVERY REPORT

After implementation, provide a detailed report.

Include:

1. Existing modules audited.
2. Features already implemented and reused.
3. Features enhanced.
4. New features implemented.
5. Public website changes.
6. Admin changes.
7. Donor changes.
8. Beneficiary changes.
9. Volunteer changes.
10. Distribution changes.
11. Inventory and logistics changes.
12. Database migrations.
13. APIs.
14. Notifications.
15. AI capabilities.
16. Security and permission changes.
17. Reusable components.
18. Code duplication review.
19. Agent-wise completion report.
20. Agent-wise test results.
21. End-to-end test results.
22. Regression test results.
23. Build results.
24. Known limitations.
25. Deployment instructions.

For every feature, identify:

- Fully implemented.
- Partially implemented.
- Not implemented.
- Existing and reused.
- Blocked by an external dependency.

Never report unexecuted tests as passing.

---

# 28. FINAL NON-NEGOTIABLE INSTRUCTIONS

- This is an extension of the existing UAR system.
- Do not rebuild existing modules.
- Do not create duplicate distribution functionality.
- Audit existing functionality before implementing.
- Reuse existing donor, beneficiary and volunteer infrastructure.
- Preserve existing design patterns.
- Use reusable components and shared services.
- Keep the system modular.
- Use five parallel agents with clear responsibilities.
- Validate each agent's work individually.
- Validate each task before moving forward.
- Integrate continuously.
- Test every major workflow.
- Run full regression testing.
- Fix all identified issues.
- No placeholder APIs.
- No disconnected frontend pages.
- No hardcoded fake data.
- No duplicate business logic.
- No fake attendance or distribution records.
- No exposure of private beneficiary information.
- Do not stop at documentation or UI implementation.

Start with repository discovery and existing-module verification.

Then research, architect, implement, integrate, test and validate.

Make sensible decisions based on the actual existing codebase.

Ask for approval only when a genuine business, security, financial or destructive-operation decision requires it.

**THE FINAL RESULT MUST BE A COMPLETE, PRODUCTION-ORIENTED FOOD SECURITY AND DISTRIBUTION ECOSYSTEM WITH PUBLIC WEBSITE, ADMIN, DONOR, BENEFICIARY, VOLUNTEER, INVENTORY, LOGISTICS, AI AND FULL END-TO-END TRACEABILITY.**

BUILD THE COMPLETE WORKING SYSTEM.