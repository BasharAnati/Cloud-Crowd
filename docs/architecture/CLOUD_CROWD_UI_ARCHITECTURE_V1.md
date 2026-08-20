# Cloud Crowd CRM v1.0 — Official UI Architecture & Design System Master Plan

Document type: Authoritative UI architecture specification  
Applies to: All production pages in the current repository  
Implementation status: Documentation only

# 1. Executive Summary

Cloud Crowd CRM v1.0 will use four shell families, nine page families, one shared semantic design foundation, and one reusable component catalog.

The central architecture rule is:

> Different workflows may use different page templates, but they must not create different design systems.

All authenticated CRM pages must ultimately use the Internal CRM Shell. Public, authentication, and maintenance pages remain intentionally distinct shells while sharing Cloud Crowd brand, typography, focus, form, motion, and accessibility rules.

The approved palette, typography, spacing, radius, layout, Light/Dark/System themes, and `cc_theme` lifecycle remain authoritative.

Current repository reality:

- 19 production pages
- 16 authenticated internal pages
- 5 internal pages fully integrated with the shared shell/theme
- 11 internal pages still requiring shell/theme migration
- Several reusable workflow patterns already exist but are implemented independently

This specification establishes:

- Official shell and page-family assignments
- Mandatory design rules
- Shared component contracts
- Responsive and accessibility baselines
- Migration status
- Incremental implementation sequence
- Prohibited implementation patterns

No production files were modified for this document.

# 2. Product Page Inventory

| Product area | Pages |
|---|---|
| Public | `index.html` |
| Authentication | `login.html` |
| Dashboard | `dashboard.html` |
| Core operations | `cctv.html`, `ce.html`, `complaints.html`, `free-orders.html` |
| Free-order workflow | `free-order-requests.html`, `free-order-share.html` |
| Calling workflow | `call-queue.html` |
| Employee/HR | `attendance.html`, `employee-profiles.html`, `employee-deductions.html`, `agent-training.html`, `weekly-quality.html` |
| Client/business | `client-profiles.html`, `restaurant-ratings.html` |
| Administration | `anati-admin.html` |
| System | `system-update.html` |

`weekly-quality.html` is an official production page and must appear in all future navigation, migration, QA, and release matrices.

# 3. Shell Architecture

## 3.1 Public Shell

**Purpose:** Public marketing, identity, trust, service explanation, contact conversion.

**Page:** `index.html`

**Header:**

- Cloud Crowd logo and public brand name
- Marketing section navigation
- Team Login
- Primary contact CTA
- Mobile menu control

**Navigation:** Public anchors and login destination only.

**Theme:** Brand-directed public presentation. It may remain visually independent from the internal Light/Dark preference. It must not overwrite `cc_theme`.

**Width:** Marketing-specific containers; not every section must use 1440px.

**Responsive:** Header becomes a menu at narrow widths. Hero, service grid, process, and contact layout stack predictably.

**Footer:** Required. Contains brand, public links, verified contact information, verified social destinations, and legal/footer content.

**Exceptions:** Marketing hero, background media, and public cards may use distinct presentation rules while staying within approved brand colors, motion, focus, and typography.

## 3.2 Authentication Shell

**Purpose:** Secure entry to the CRM.

**Page:** `login.html`

**Header:** No internal topbar or sidebar. Brand panel and login form provide context.

**Navigation:** Back to public site; no internal navigation before authentication.

**Theme:** Must honor resolved Light/Dark/System preference where practical. A theme toggle is optional on Login, but Login must not overwrite the saved preference.

**Width:** Constrained authentication panel, not 1440px.

**Responsive:** Split brand/form presentation on large screens; single-column form-first presentation on mobile.

**Footer:** Optional minimal security/legal statement. No full marketing footer required.

## 3.3 Internal CRM Shell

**Purpose:** All authenticated operational, HR, client, dashboard, and administration work.

**Pages:** All 16 internal CRM pages.

**Required regions:**

- Shared sidebar
- Shared topbar
- Main content region
- Page header
- Page-family content
- Shared overlays and notification region

**Theme:** Light, Dark, and System are mandatory. Preference key remains `cc_theme`.

**Width:** 1440px maximum by default, with approved full-width workflow exceptions.

**Footer:** No global internal footer. Page content ends naturally.

## 3.4 System / Maintenance Shell

**Purpose:** Intentional production status and maintenance communication.

**Page:** `system-update.html`

**Header/navigation:** No application navigation. A retry or return-to-login action may appear only after product approval.

**Theme:** Theme-aware system surface. It may omit the toggle but should honor the resolved preference.

**Width:** Small centered status panel.

**Responsive:** Single-column at all widths.

**Footer:** Not required.

# 4. Page Family Architecture

Every production page has exactly one primary family.

## 4.1 Public Marketing

**Page:** Index  
**Structure:** Public header → hero → service/value sections → contact → footer.  
**States:** Form idle, submitting, success, error.  
**Mobile:** Stacked content and controlled media crop.

## 4.2 Authentication

**Page:** Login  
**Structure:** Brand panel + authentication form.  
**States:** Idle, submitting, invalid, expired session, network error, success.  
**Mobile:** Form-first single column.

## 4.3 Module Launcher Dashboard

**Page:** Dashboard  
**Structure:** Shared shell → page header → permission-aware module groups/cards → optional supported summaries.  
**Mobile:** One-column launcher hierarchy.

## 4.4 Operational Kanban Workspace

**Pages:** CCTV, CE, Complaints, Complimentary Orders  
**Structure:** Shared shell → operational header → metrics → filter toolbar → full-width board → modal/drawer.  
**Mobile:** Horizontally navigable board with deliberate scroll affordance.

## 4.5 Workflow Kanban Workspace

**Pages:** Free Order Requests, Free Order Share  
**Structure:** Shared shell → workflow header → metrics → filters → stage board → workflow dialogs.  
**Mobile:** Horizontal stage navigation; related workflow action remains visible.

## 4.6 Queue / Action Workspace

**Page:** Call Queue  
**Structure:** Shared shell → header/filters → queue/list → selected customer/order workspace → actions/history.  
**Mobile:** List and detail are sequential views, not compressed side-by-side panes.

## 4.7 Table / Form Management Workspace

**Pages:** Attendance, Employee Deductions, Agent Training, Restaurant Ratings, Weekly Quality  
**Structure:** Shared shell → header/metrics where relevant → form or create action → filters → data table → details dialog.  
**Mobile:** Form stacks; tables scroll or use an approved stacked-row presentation.

## 4.8 Profile / Master-Detail Workspace

**Pages:** Employee Profiles, Client Profiles  
**Structure:** Shared shell → profile header/metrics → directory/list → selected profile workspace → related sections/tables.  
**Mobile:** Directory and profile become sequential views.

## 4.9 Administrative Workspace

**Page:** Anati Admin Center  
**Structure:** Shared shell → admin header → section navigation → users/access/control sections → wide matrices.  
**Mobile:** Full functionality remains available through controlled horizontal scrolling or focused subviews.

## 4.10 System Status

**Page:** System Update  
**Structure:** Brand → status icon → title → message → optional approved recovery action.

# 5. Design Tokens

## Brand primitives

| Token role | Value |
|---|---|
| Accent Light | `#A7EBF2` |
| Secondary | `#54ACBF` |
| Primary | `#26658C` |
| Primary Dark | `#023859` |
| Deep Navy | `#011C40` |

Brand primitives may be defined only in the centralized token source.

Production components must consume semantic tokens such as:

- Background
- Surface
- Raised surface
- Muted surface
- Text
- Muted text
- Border
- Divider
- Primary and interaction states
- Focus
- Success, warning, danger, info, neutral
- On-solid foregrounds
- Sidebar-specific semantic colors

## Theme rules

- Accepted preferences: `light`, `dark`, `system`
- Storage key: `cc_theme`
- System resolves from OS preference
- Explicit Light/Dark ignores later OS changes
- System responds to OS changes
- Theme initializes before visible paint
- No page may implement a second theme runtime
- No page may create a separate theme storage key
- Light must be materially light
- Dark must be materially dark
- Light sidebar intentionally remains deep navy
- Auth and maintenance shells should honor resolved theme without requiring their own toggle
- Public shell may remain brand-directed and must not mutate CRM preference

## Required token extensions

Future component work may add centralized semantic tokens for:

- Layer/z-index
- Toast surfaces
- Skeleton loading
- Drawer width
- Sticky actions
- Mobile touch targets

New tokens must represent reusable meaning, not a single page.

# 6. Typography

## Font family

`Inter, "Tajawal", "Segoe UI", Arial, sans-serif`

Arabic text uses Tajawal when available, then falls through to the same system stack. Mixed Arabic/English interfaces must not assign separate arbitrary sizes to either language.

## Type usage

| Token | Approved value | Official use |
|---|---|---|
| Display | 32px / 700 / 1.2 | Public hero, rare authentication brand display |
| Page title | 28px / 700 / 1.25 | The single page `h1` |
| Section title | 22px / 700 / 1.3 | Major page sections |
| Card/modal title | 18px / 600 / 1.35 | Cards, dialogs, drawers |
| Body | 14px / 400 / 1.6 | Primary content and table cells |
| Strong body | 14px / 600 | Important values and labels |
| Small | 13px / 400 / 1.5 | Helper text and secondary metadata |
| Caption | 12px / 400 / 1.4 | Timestamps and tertiary metadata |
| Button | 14px / 600 | Button text |
| Table header | 13px / 600 | Column headings |
| Badge | 12px / 600 | Status badges/chips |

KPI values may use Display or Page Title size depending on available space. They must use tabular numeric styling where meaningful.

## Mandatory rules

- Exactly one `h1` per page
- Page title is never duplicated in both topbar and hero
- Topbar may show module context without becoming a second page heading
- Labels must not be smaller than Caption
- Uppercase captions require adequate letter spacing and contrast
- Business values must be more prominent than their labels
- Arabic and English share the same semantic hierarchy
- Direction-sensitive layouts must support `dir="rtl"` where required

## Prohibited

- Arbitrary one-off font sizes
- Multiple competing page-title sizes
- All-uppercase paragraphs
- Labels below 12px
- Font weight above 700 for normal application content
- Using color alone to create hierarchy

# 7. Layout / Spacing

## Approved scale

`0, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80`

## Global application layout

- Maximum content width: 1440px
- Desktop page padding: 24px
- Tablet page padding: 16px
- Mobile page padding: 12px
- Default section gap: 32px
- Compact section gap: 24px
- Major page-region gap: 40–48px
- Grid gap: 16–24px
- Card internal padding: 20 or 24px
- Compact card padding: 16px
- Field gap: 16px
- Form-section gap: 32px
- Toolbar gap: 12px
- Dialog body/footer padding: 24px
- Mobile dialog padding: 16px
- Kanban column gap: 16px

## 1440px usage

Use the maximum width for:

- Dashboard
- Table/form workspaces
- Directory/profile pages
- Standard administrative sections

Approved full-width exceptions within the main content region:

- Operational Kanban boards
- Free-order workflow boards
- Call Queue workspace
- Employee/client master-detail workspaces
- Admin permission matrices

Full-width does not mean zero gutters.

# 8. Page Headers

Every internal page uses one `PageHeader` contract.

## Required structure

1. Optional breadcrumb/context
2. Single `h1`
3. Optional subtitle or source metadata
4. Secondary actions
5. One primary action where applicable
6. Optional status/context row
7. Filters remain outside the header unless they are very compact

## Alignment

Desktop:

- Title/subtitle left
- Actions right
- Vertically aligned around title block

Tablet:

- Title first
- Actions may wrap beneath while staying right- or start-aligned consistently

Mobile:

- Title and subtitle full width
- Primary action full width or placed first in the action row
- Secondary actions wrap beneath
- No actions are removed merely to fit

## Variants

### Standard Page Header

Used by table/form pages.

### Operational Page Header

Adds operational metadata or refresh state. Metrics and filters remain separate regions.

### Profile Page Header

May include selected-record context only when a record is active. Directory page title remains the `h1`.

### Admin Page Header

Includes administrative scope/context and high-impact actions. It must not place the entire admin navigation inside the header.

# 9. Navigation

## Sidebar

Desktop width: 260px  
Collapsed width: 72px

Required contents:

- Logo/brand block
- Module groups
- Permission-filtered links
- Active module
- Optional collapse control
- Bottom utility/user region only if it does not duplicate topbar excessively

Module groups:

- Dashboard
- Operations
- HR
- Business
- Administration

## Topbar

Height: 72px

Required contents:

- Mobile sidebar trigger
- Module or location context
- User identity
- Role badge
- Theme control
- Logout
- Maintenance status/action where authorized

## Behavior

Desktop:

- Sidebar fixed or sticky for viewport height
- Main content scrolls independently with the page
- Topbar sticky within the application frame

Tablet:

- Sidebar begins collapsed or becomes an overlay depending on available width
- Expanded overlay must not shrink the content into unusable width

Mobile:

- Sidebar becomes an off-canvas navigation drawer
- Opening it locks background scroll
- Focus moves into it and returns to trigger on close
- It closes on selection, Escape, or explicit close
- Active page and module groups remain readable

## Permission rules

Permissions are not redesigned.

They affect:

- Navigation visibility
- Dashboard module visibility
- Direct route access
- Create/edit/delete controls
- Admin-only modules
- Call Queue access

Hiding a navigation link is not route protection. Direct routes must use the same configured access contract.

# 10. Cards

All cards use semantic surfaces, borders, text, radii, and shadows.

## Surface Card

- General content grouping
- Padding: 24px; mobile 16px
- Radius: 16px
- Border: semantic border
- Shadow: small or none
- No hover unless interactive

## Metric / KPI Card

- Padding: 20px
- Radius: 16px
- Label: Caption/Badge hierarchy
- Value: 28–32px
- Optional icon: 20–24px
- No click behavior unless explicitly an actionable metric

Used by operations, HR, clients, ratings, admin, and workflows.

## Module Launcher Card

- Padding: 24px
- Radius: 16px
- Title, description, icon, destination action
- Must be a semantic link when navigation is its only action
- Hover/focus indicates navigation
- No hidden secondary controls inside the card

Used by Dashboard.

## Ticket / Workflow Card

- Padding: 16px
- Radius: 10 or 16px
- Status and identifier at top
- Primary identifying text next
- Limited metadata
- Actions at bottom or in open detail view
- Selected state uses border/background, not color alone

Used by Kanban and Call Queue.

## Directory Card

- Compact identity summary
- Clear selected state
- Optional status
- Actions must not conflict with selecting the record

Used by Employee and Client Profiles.

## Profile Summary Card

- Identity/header information
- Key contact or status
- Optional action group
- Not used as a general container

## Information Card

- Non-interactive explanatory content
- No hover elevation

## Status Guide Card

- Explains business status meanings
- Uses centralized badge registry
- Must not introduce independent colors

# 11. Buttons / Actions

## Sizes

| Size | Height | Horizontal padding |
|---|---:|---:|
| Small | 32px | 12px |
| Medium/default | 40px | 16px |
| Large | 48px | 20px |

Default icon size: 18px  
Small icon: 16px  
Large icon: 20px  
Icon/text gap: 8px

## Variants

### Primary

Main completion or creation action. Solid primary background and on-primary text.

### Secondary

Supporting action using muted surface and standard text.

### Ghost

Low-emphasis utility action with transparent background.

### Outline

Emphasized alternative action without competing with Primary.

### Danger

Destructive or harmful action only.

### Success

Use only when the action itself explicitly completes or approves a positive workflow state. It is not a general replacement for Primary.

### Icon Button

One clearly recognizable action with accessible name and tooltip where useful.

### Disabled

Uses disabled surface/text and opacity. Must remain readable and non-interactive.

### Loading

Preserves button width, shows activity indicator, sets `aria-busy`, and prevents duplicate activation.

## Priority rules

- Prefer one Primary action per visual region
- Secondary actions may accompany Primary
- Destructive actions are spatially separated
- Table row actions must not all appear as Primary
- Cancel/close is not Danger
- Text-only actions are preferred where an icon would be ambiguous
- Icon-only actions always require an accessible name

## Destructive actions

Require a confirmation dialog when irreversible or materially harmful. Confirmation names the affected record and consequence.

# 12. Icons

Preferred application family: **Lucide Icons**

## Sizes

- Navigation: 20px
- Default button: 18px
- Small/table action: 16px
- KPI/card: 20–24px
- Empty/data state: 32–40px

## Rules

- Use one stroke weight per region
- Icons complement labels; they do not replace unclear wording
- Status icons accompany status text where helpful
- Table icons remain compact and accessible
- Brand logo and approved brand assets are exempt from Lucide

## Existing alternatives

- Emoji: prohibited for persistent operational controls/statuses
- Unicode symbols: migrate when a Lucide equivalent exists; permitted temporarily for simple decorative markers
- Custom SVG: allowed for brand assets or domain-specific imagery unavailable in Lucide
- Text symbols such as ×: permitted only in a semantic button with accessible name

# 13. Forms

## Shared components

- Field
- Label
- Required marker
- Helper text
- Error text
- Input
- Textarea
- Select
- MultiSelect
- Checkbox
- Radio
- Switch
- Date
- Time
- File
- Search

## Dimensions and spacing

- Default control height: 40px
- Large mobile/high-emphasis control: 48px when justified
- Control radius: 10px
- Label-to-control gap: 8px
- Helper/error gap: 4px
- Field gap: 16px
- Section gap: 32px
- Textarea minimum height: 96px unless business content requires more

## States

- Default: surface, text, border
- Hover: stronger semantic border
- Focus: semantic focus border and ring
- Disabled: muted surface/text
- Error: danger border, error text, `aria-invalid`
- Success: use only when field-level validation success benefits the user
- Loading: control disabled only when interaction truly cannot continue

## Required marker

- Visible marker plus programmatic `required`
- Form-level explanation identifies marker meaning
- Never rely on color alone

## Long forms

Long forms are divided into titled semantic sections.

Required grouping targets:

- CCTV: case context, footage/location, people/policy, details/actions, attachment
- CE: customer/order, source/context, experience classification, resolution
- Complaints: complaint/order, responsibility/context, issue, resolution
- Complimentary Orders: customer/order, compensation, approval, usage/deduction, attachments
- Employee Profiles: identity, employment, phones, emergency contacts, assignments
- Weekly Quality: call context, quality scoring, notes/recording
- Admin: account identity, employee/system linkage, role/status, access/security
- Client Profiles: brand identity, contact numbers, ownership/management, media, notes

Field names, requirements, validation, and behavior remain unchanged during UI migration.

# 14. Filters / Search

## Inline Filter Toolbar

Use for up to approximately four concise controls where all are frequently used.

Suitable for:

- Core operations
- Simple table pages
- Free-order boards

Search appears first when it is the dominant filtering method.

## Compact Filter Bar

Use for two or three controls and small result sets.

## Advanced Filter Panel

Use when controls are numerous, infrequently used, or need grouping. It opens within page flow on desktop.

## Mobile Filter Drawer

Use when a toolbar cannot wrap without becoming excessively tall or confusing.

## Mandatory behavior

- Active filters must be visible
- Reset appears only when filters are active
- Reset returns to the defined default state
- Search and filters preserve sensible order
- Wrapping never separates a label from its control
- Mobile drawer actions include Apply and Reset where filtering is deferred
- Immediate filters do not add a redundant Apply action
- Results or count update should be announced when useful

# 15. Tables

## Data Table structure

- Semantic table element
- Optional caption or accessible description
- Header row with appropriate scopes
- Body rows
- Optional action column
- Shared table container
- Associated loading/empty/error states

## Alignment

- Text: start
- Numeric and currency: end
- Dates: consistent start or center, never mixed within one table
- Status: start
- Actions: end

## Interaction

- Hover highlights row only when useful
- Selected state uses surface and border/icon, not color alone
- Row click is allowed only if the entire row represents one clear destination
- Otherwise use explicit action links/buttons

## Responsive

Default mobile treatment is horizontal scrolling with:

- Visible overflow affordance
- Actions kept reachable
- First identifying column retained where possible
- No hidden columns containing required decisions

Stacked mobile rows may be used when:

- Each row is an entity summary
- Column comparison is not the primary task
- Labels remain explicit
- All actions remain available

## Feature decision rules

Sorting:

- Add only when users repeatedly need alternate order
- Server-side if full dataset is not loaded

Pagination:

- Add for performance, comprehension, or API constraints
- Do not add solely for visual convention

Sticky headers:

- Add when the table scrolls within a tall viewport and headings otherwise disappear

Column visibility:

- Add only for optional columns; never hide required operational fields by default

## Existing table pages

Attendance, Employee Profiles, Client Profiles, Deductions, Training, Ratings, Admin, Weekly Quality.

# 16. Kanban

## Shared primitives

- Board
- Column
- Column header
- Status/count
- Ticket card
- Metadata list
- Empty column
- Selected/open state

## Dimensions

- Core operational column: approximately 280–320px
- Detail-heavy workflow column: approximately 300–340px
- Column gap: 16px
- Column padding: 12–16px

Exact widths may adapt within these bounds.

## Behavior

- Board scrolls horizontally; page does not clip columns
- Column header remains visible within its column when practical
- Count appears beside status name
- Empty state occupies the column body without appearing broken
- Open card state is clearly visible
- Ticket metadata is deliberately limited
- Business status order remains unchanged

## Variants

### Core Operations Kanban

CCTV, CE, Complaints, Complimentary Orders.

Dense operational board with modal creation and drawer detail.

### Free Order Workflow Kanban

Requests and Share.

Stage-focused board with related workflow actions and fewer status families.

### Call Queue

Not a standard Kanban. It uses queue/list plus selected action workspace. Status grouping may visually resemble columns, but selected-call work must remain the primary interaction.

# 17. Profiles

## Official master-detail structure

Desktop:

- Directory: approximately 300–340px
- Workspace: remaining width
- Independent directory scroll only when necessary
- Workspace remains the primary page scroll

Tablet:

- Directory narrows
- Detail sections reduce columns
- Related tables remain horizontally accessible

Mobile:

- Directory and profile are sequential states
- Selecting a record opens its full-width profile
- A clear Back to directory action is provided
- Do not squeeze two panes side-by-side

## Profile workspace regions

- Profile header
- Identity/status
- Primary actions
- Metrics
- Contact blocks
- Assignment/business context
- Related tables
- Empty, loading, error, degraded-source states

Employee Profiles and Client Profiles use this pattern.

Call Queue borrows the selection/detail behavior but remains a Queue / Action Workspace.

# 18. Modals / Drawers

## Modal

Use for:

- Create/edit forms
- Focused record details
- Short decisions
- Work that temporarily interrupts the page

Approved widths:

- Small: 480px
- Medium: 640px
- Large: 880px

## Drawer

Use for:

- Operational ticket details
- History
- Context that benefits from keeping the underlying board visible
- Multi-section review without navigation away

Recommended maximum width should become a shared token, generally 560–640px.

## Persistent panel

Use for:

- Call Queue selected work
- Desktop master-detail work where constant context is essential

## Confirmation dialog

Use for:

- Delete
- Archive where materially consequential
- Disable user
- Final workflow completion where reversal is unavailable

## Required behavior

- Semantic overlay and panel
- Labeled title
- Accessible close button
- Initial focus
- Focus trap
- Escape close except while a non-dismissible critical operation is active
- Focus restoration
- Background scroll lock
- Body scroll independent of page
- Footer actions remain reachable
- Long forms use sticky footer actions where appropriate

## Mobile

Below the mobile breakpoint:

- Modal may become near-full-screen
- Drawer uses full viewport width
- Close/action regions remain visible
- Content scrolls without hiding required actions

# 19. Feedback

## Inline Field Error

For a specific invalid field. Appears immediately beneath that field and is programmatically associated.

## Form Error Summary

For multi-field submission failure. Appears at form top, receives focus when necessary, and links to invalid fields where practical.

## Success Toast

For short-lived confirmation after an operation whose new state is already visible.

## Error Toast

Only for transient errors that do not require detailed recovery instructions.

## Persistent Warning Banner

For maintenance risk, incomplete migration, permissions context, or other state that must remain visible.

## Data Source Warning

For API fallback, local-record fallback, sync failure, or degraded data. Never use a disappearing toast.

## Confirmation Dialog

For destructive or consequential choices.

## Inline Status Message

For form submission state, import progress, and local section results.

## Do not use toast for

- Field validation
- Data-source degradation
- Long recovery instructions
- Permission denial
- Destructive confirmation
- Errors that leave the user’s data unsaved without a clear recovery path

## Native API replacement policy

- `alert()` → accessible inline message, banner, or toast based on persistence
- `confirm()` → confirmation dialog
- `prompt()` → labeled modal form

Native APIs may remain temporarily only until the shared replacement is implemented. No new usage is allowed.

# 20. Data States

## Loading

- Neutral activity icon/spinner or skeleton
- Concise title
- Optional description
- `aria-busy="true"`
- Status announcement when loading is not immediate
- No false empty state during loading

## Empty

- Neutral icon
- Business wording supplied by the page
- Optional primary action if the user can create the first record
- No celebratory or error styling

## Error

- Danger or warning icon according to severity
- Clear page-provided message
- Retry action where safe
- Persistent until state changes
- `role="alert"` only when immediate interruption is justified

## Success/Data

- Normal content presentation
- Success feedback does not permanently dominate the page

## Degraded / Offline / Fallback

- Persistent warning surface
- Explicit data source/state
- Explain whether creation/editing remains available
- Provide retry or migration action where supported
- Never visually present fallback data as fully synchronized

All state wording remains page-specific and is not rewritten by the shared component.

# 21. Status / Badges

Semantic states and business statuses are separate.

## Semantic states

- Success
- Warning
- Danger
- Info
- Neutral

Each semantic state defines:

- Soft surface
- Text
- Border
- Solid surface
- On-solid text
- Hover where interactive

## Business-status registry

A centralized registry maps exact business status names to semantic presentation.

Conceptual example:

| Business meaning | Semantic role |
|---|---|
| Completed/Closed/Active success | Success |
| Pending/Under Review/Needs Response | Warning or Info |
| Escalated/Error/Disabled | Danger |
| New/Received/In Call | Info |
| Archived/Unknown/Neutral | Neutral |

The actual mapping must preserve existing business meaning and contrast.

Rules:

- Business labels never change merely to fit the design system
- Pages do not define independent status colors
- Every badge includes readable text
- Color is never the only differentiator
- Interactive badges follow button/link semantics instead of badge semantics

# 22. Dashboard

## v1.0 target

Permission-aware hybrid launcher.

## Structure

1. Shared shell
2. Standard Page Header
3. Optional supported operational summary
4. Module groups
5. Module launcher cards
6. Authorized maintenance control

## Module groups

- Operations
- HR
- Business
- Administration

Only allowed modules are rendered.

## Supported now

- Permission-aware module links
- Module descriptions
- User/role context
- Maintenance state/control for authorized user
- Summary counts already available through existing endpoints, after performance and permission review

## Future product requirement

- Unified recent activity
- Cross-module trends
- SLA analytics
- Assigned-work overview
- Audit-derived activity feed
- Configurable dashboard

The v1.0 UI must not fabricate metrics or use placeholder values.

# 23. Admin Center

## Official sections

### Users — Complete/functional foundation

- User list
- Create/edit
- Account type
- Employee linkage
- Role/status
- Temporary password
- Disable action

### Module Access — Partial

- User selection
- View/create/edit/delete matrix
- Save access
- Direct-route enforcement must be verified consistently

### Workflow Permissions — Planned

- Remains visible as planned
- No fake working controls
- Shows concise development status and completion scope

### Maintenance — Partial

- Existing maintenance control currently exists elsewhere
- Final ownership and location require product confirmation

### Audit — Planned

- Remains visible as planned
- Must not display simulated records

### Security / Configuration — Product decision

Add only when actual controls are approved.

## Incomplete-section presentation

- Clearly labeled “Planned” or “In development”
- Non-interactive information card
- Concise completion scope
- No disabled fake form controls
- Visually subordinate to usable production sections
- Not hidden merely to improve readiness appearance

# 24. Call Queue

## Target v1.0 structure

### Queue/list

- Status filtering/grouping
- Customer/order identifier
- Latest state
- Call urgency/context if existing data supports it
- Selected state

### Selected customer/order

- Customer name
- Phone
- Order number
- Restaurant/channel/context where available
- Current status

### Order image

- Real media presentation
- Loading/error/unavailable state
- Accessible description
- Media viewer where appropriate

### Call controls

- Start Call
- Positive Result
- Negative Result
- Move to Done
- Existing enable/disable logic preserved

### Negative result

- Reason
- Notes
- Resulting Pending state

### Notes/history

- Add note
- Existing notes
- Status transition history
- Acting user and timestamp where available

## Responsive

Desktop:

- Queue/list left
- Selected work main
- Context/actions within the selected workspace

Tablet:

- Narrow queue plus detail
- Actions may become sticky inside detail

Mobile:

- Queue list first
- Selected ticket becomes full-width detail
- Back to Queue control
- Primary call actions remain reachable
- No compressed multi-column board

## V1.0 required UI

- Real loading/empty/error/data states
- Durable result feedback
- Clear selected record
- Real media state
- Permission-aware shell
- Responsive list/detail transition
- Accessible action sequence

## Future product requirement

- Telephony integration
- Automatic dialing
- Call recording
- Assignment/claiming
- Scheduling/retry windows
- Duration analytics

# 25. Public Site

Shared with CRM:

- Brand palette
- Font stack
- Semantic focus
- Form-control quality
- Motion tokens
- Accessibility baseline
- Button hierarchy principles

Intentionally separate:

- Marketing navigation
- Video/hero treatment
- Marketing cards
- Public CTA composition
- Public footer
- Public section layouts
- Brand-led rather than application-led density

The public page must use verified contact and social information before v1.0.

# 26. Authentication

## Brand panel

- Logo
- Cloud Crowd name
- Short trust/security statement
- Decorative content hidden from assistive technology where appropriate

## Login form

- Username
- Password
- Remember me
- Submit
- Error/success feedback
- Return to public site

## Password visibility

- Native button
- Accessible state: Show password / Hide password
- Keyboard-operable
- Does not steal focus from the password field unexpectedly

## Remember me

Visible only if its authentication behavior is defined and implemented. It must not be decorative.

## Busy state

- Submit disabled while request is active
- `aria-busy`
- Stable button width
- Credentials remain available after recoverable failure unless security policy requires clearing

## Theme

Honor resolved preference. A visible toggle is optional.

## Responsive

- Desktop split
- Tablet balanced or stacked
- Mobile form-first
- Minimum 12px outer gutter
- Account for virtual keyboard and password manager overlays

# 27. Maintenance

## Required contract

- Cloud Crowd brand
- Neutral system-status icon
- Single `h1`
- Clear maintenance message
- Optional status metadata only if reliable
- Optional Retry
- Optional Return to Login
- Theme-aware surface
- Responsive centered panel

The page is a production system state, not a placeholder.

All authenticated direct routes must follow the same maintenance policy before this experience is considered complete.

# 28. Responsive

## 1440px

- Full sidebar
- 24px content padding
- Multi-column cards/forms where appropriate
- Kanban and matrices may use full available width

## 1280px

- Full sidebar where content remains usable
- Reduce nonessential grid columns before shrinking controls
- Preserve 24px padding where space allows

## 1024px

- Sidebar may collapse to 72px
- 16px content padding
- Page-header actions may wrap
- Master-detail widths reduce
- Tables and boards begin controlled horizontal scrolling

## 768px

- Sidebar becomes overlay or remains collapsed only when usable
- Topbar controls remain reachable
- Cards typically reduce to two or one column
- Forms reduce to one or two columns
- Filters wrap or move to a drawer
- Drawers approach full width

## 390px

- Mobile navigation drawer
- 12px page padding
- One-column cards/forms
- Full-width primary actions where beneficial
- Profile list/detail becomes sequential
- Tables scroll or use approved stacked rows
- Kanban remains horizontally scrollable

## 360px and 320px

- No content is hidden to make layout fit
- Icon-only global controls require accessible names
- Header metadata may reduce, but actions remain available
- Touch targets remain adequate
- Modal/drawer content uses full available width
- Long unbroken identifiers wrap safely

## Layout versus scrolling

Change layout:

- Page headers
- Card grids
- Forms
- Profile master/detail
- Call Queue list/detail
- Admin section navigation

Allow horizontal scrolling:

- Kanban boards
- Data tables
- Access matrices
- Deliberately wide comparison grids

# 29. Accessibility

Mandatory v1.0 baseline:

- Keyboard access to every action
- Visible `focus-visible` treatment
- Semantic buttons and links
- Exactly one page `h1`
- Logical heading order
- Explicit form labels
- Required and invalid state announcement
- Accessible icon names
- Dialog initial focus, trap, Escape, and restoration
- Semantic table headings
- Async feedback through appropriate live regions
- Status not communicated by color alone
- Normal text contrast of at least 4.5:1
- Large text contrast of at least 3:1
- Focus indicator contrast and visibility
- Mobile touch target goal of at least 44×44px
- Controls with 40px visual height may use surrounding padding/hit area to meet the touch target
- Reduced-motion support
- No keyboard trap outside intentional modal focus containment

Accessibility is a property of each component, not a later visual overlay.

# 30. Motion

Use approved durations:

- Fast: 120ms
- Normal: 180ms
- Slow: 260ms

Use approved easing tokens.

Allowed:

- Button hover/active
- Card hover for genuinely interactive cards
- Sidebar collapse
- Mobile navigation entrance
- Drawer/modal entrance
- Toast entrance/exit
- Skeleton/loading motion
- Focus transitions that do not delay visibility

Rules:

- Operational actions respond immediately
- Motion must not delay data access
- No decorative bouncing, looping, or large parallax inside CRM
- Board columns/cards do not animate unnecessarily during filtering
- `prefers-reduced-motion` reduces transitions and stops decorative animation

# 31. Layer / z-index

Recommended semantic layer tokens:

| Layer | Token | Value |
|---|---|---:|
| Base content | `--layer-base` | 0 |
| Sticky content/table header | `--layer-sticky` | 10 |
| Topbar | `--layer-topbar` | 20 |
| Desktop sidebar | `--layer-sidebar` | 30 |
| Dropdown/popover | `--layer-popover` | 40 |
| Mobile navigation backdrop | `--layer-nav-backdrop` | 50 |
| Mobile navigation/drawer backdrop | `--layer-drawer-backdrop` | 60 |
| Drawer panel | `--layer-drawer` | 70 |
| Modal backdrop | `--layer-modal-backdrop` | 80 |
| Modal/confirmation | `--layer-modal` | 90 |
| Toast/notification | `--layer-toast` | 100 |
| Emergency/system intervention | `--layer-system` | 110 |

Rules:

- Components consume semantic layer tokens
- No arbitrary `9999`
- Child content cannot escape its component layer without documented need
- Only one active blocking overlay is presented at a time
- Toasts may appear above dialogs but must not steal focus

# 32. Anti-patterns

Prohibited:

- Hard-coded brand colors outside centralized token definitions
- Page-local semantic color palettes
- Arbitrary font sizes
- Arbitrary spacing or radius values
- Inline visual styles
- Runtime-generated hard-coded visual colors
- Clickable `div` where a link or button is correct
- New native `alert()`, `confirm()`, or `prompt()`
- New page-local sidebar
- New page-local topbar
- New theme runtime or storage key
- New unshared status palette
- New unshared card family without architecture approval
- New modal behavior implemented independently
- Unlabeled icon-only actions
- Hover-only functionality
- Hidden overflow that masks required content
- Removing actions at mobile widths
- Theme-incompatible fixed surfaces
- Business logic encoded in CSS
- Fake placeholder metrics
- Disabled fake controls representing planned features
- Hiding incomplete product areas to improve readiness appearance
- Page-specific z-index escalation
- Changing business wording, fields, routes, permissions, or workflow during visual migration

# 33. Shared Component Catalog

## Existing foundations

- Design tokens
- Theme base
- Theme runtime
- Theme toggle
- Shared app-shell route registry
- Shared sidebar/topbar on five pages
- Operations ticket renderer
- Operations detail drawer
- History modal
- Media viewer

## Components to formalize or create

### Layout

- Internal App Shell
- Public Shell
- Authentication Shell
- System Shell
- Page Container
- Page Header
- Section Header

### Navigation

- Sidebar
- Sidebar Group
- Sidebar Link
- Topbar
- Mobile Navigation
- User Badge
- Role Badge
- Breadcrumb/context

### Actions

- Button
- Icon Button
- Button Group
- Confirmation Dialog

### Content

- Surface Card
- Metric Card
- Module Card
- Ticket Card
- Directory Card
- Profile Summary
- Information Card
- Status Guide

### Forms

- Field
- Input
- Textarea
- Select
- MultiSelect
- Checkbox
- Radio
- Switch
- Date/Time
- File Control
- Search Field
- Filter Toolbar

### Data

- Data Table
- Table Container
- Status Badge
- Data State
- Pagination, only when justified

### Workflow

- Kanban Board
- Kanban Column
- Detail Drawer
- Modal
- Profile Workspace
- Queue Workspace

### Feedback

- Inline Field Error
- Form Error Summary
- Toast
- Persistent Banner
- Data Source Warning
- Inline Status Message
- Loading Indicator/Skeleton

# 34. Component Migration Matrix

Legend: **DONE**, **PARTIAL**, **NOT MIGRATED**, **NOT APPLICABLE**

| Page | Shell | Header | Buttons | Forms | Cards | Tables | Kanban | Modals | Feedback | Data states | Responsive | Theme | Page-specific |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Index | PARTIAL | PARTIAL | PARTIAL | PARTIAL | PARTIAL | NOT APPLICABLE | NOT APPLICABLE | NOT APPLICABLE | PARTIAL | PARTIAL | PARTIAL | PARTIAL | Contact data |
| Login | PARTIAL | PARTIAL | PARTIAL | PARTIAL | PARTIAL | NOT APPLICABLE | NOT APPLICABLE | NOT APPLICABLE | PARTIAL | PARTIAL | PARTIAL | NOT MIGRATED | Auth controls |
| Dashboard | NOT MIGRATED | PARTIAL | PARTIAL | NOT APPLICABLE | PARTIAL | NOT APPLICABLE | NOT APPLICABLE | NOT APPLICABLE | PARTIAL | PARTIAL | PARTIAL | NOT MIGRATED | Launcher hierarchy |
| CCTV | DONE | PARTIAL | PARTIAL | PARTIAL | PARTIAL | NOT APPLICABLE | PARTIAL | PARTIAL | PARTIAL | PARTIAL | PARTIAL | DONE | Board polish |
| CE | DONE | PARTIAL | PARTIAL | PARTIAL | PARTIAL | NOT APPLICABLE | PARTIAL | PARTIAL | PARTIAL | PARTIAL | PARTIAL | DONE | Board polish |
| Complaints | DONE | PARTIAL | PARTIAL | PARTIAL | PARTIAL | NOT APPLICABLE | PARTIAL | PARTIAL | PARTIAL | PARTIAL | PARTIAL | DONE | Board polish |
| Complimentary | DONE | PARTIAL | PARTIAL | PARTIAL | PARTIAL | NOT APPLICABLE | PARTIAL | PARTIAL | PARTIAL | PARTIAL | PARTIAL | DONE | Board polish |
| Requests | NOT MIGRATED | PARTIAL | PARTIAL | PARTIAL | PARTIAL | NOT APPLICABLE | PARTIAL | PARTIAL | PARTIAL | PARTIAL | PARTIAL | NOT MIGRATED | Workflow integration |
| Share | NOT MIGRATED | PARTIAL | PARTIAL | PARTIAL | PARTIAL | NOT APPLICABLE | PARTIAL | PARTIAL | PARTIAL | PARTIAL | PARTIAL | NOT MIGRATED | Workflow integration |
| Call Queue | NOT MIGRATED | PARTIAL | PARTIAL | PARTIAL | PARTIAL | NOT APPLICABLE | PARTIAL | NOT APPLICABLE | NOT MIGRATED | PARTIAL | NOT MIGRATED | NOT MIGRATED | Prototype completion |
| Attendance | NOT MIGRATED | PARTIAL | PARTIAL | PARTIAL | PARTIAL | PARTIAL | NOT APPLICABLE | NOT APPLICABLE | PARTIAL | PARTIAL | PARTIAL | NOT MIGRATED | Migration/source state |
| Employee Profiles | DONE | PARTIAL | PARTIAL | PARTIAL | PARTIAL | PARTIAL | NOT APPLICABLE | PARTIAL | PARTIAL | PARTIAL | PARTIAL | DONE | Linked modules |
| Client Profiles | NOT MIGRATED | PARTIAL | PARTIAL | PARTIAL | PARTIAL | PARTIAL | NOT APPLICABLE | PARTIAL | PARTIAL | PARTIAL | PARTIAL | NOT MIGRATED | Profile integrations |
| Deductions | NOT MIGRATED | PARTIAL | PARTIAL | PARTIAL | PARTIAL | PARTIAL | NOT APPLICABLE | PARTIAL | PARTIAL | PARTIAL | PARTIAL | NOT MIGRATED | Financial layout |
| Training | NOT MIGRATED | PARTIAL | PARTIAL | PARTIAL | PARTIAL | PARTIAL | NOT APPLICABLE | PARTIAL | PARTIAL | PARTIAL | PARTIAL | NOT MIGRATED | Training guide |
| Ratings | NOT MIGRATED | PARTIAL | PARTIAL | PARTIAL | PARTIAL | PARTIAL | NOT APPLICABLE | PARTIAL | PARTIAL | PARTIAL | PARTIAL | NOT MIGRATED | Rating metrics |
| Admin | NOT MIGRATED | PARTIAL | PARTIAL | PARTIAL | PARTIAL | PARTIAL | NOT APPLICABLE | NOT APPLICABLE | PARTIAL | PARTIAL | NOT MIGRATED | NOT MIGRATED | Admin sections |
| Weekly Quality | NOT MIGRATED | PARTIAL | PARTIAL | PARTIAL | PARTIAL | PARTIAL | NOT APPLICABLE | PARTIAL | PARTIAL | PARTIAL | PARTIAL | NOT MIGRATED | Scoring/mobile |
| System Update | PARTIAL | PARTIAL | NOT APPLICABLE | NOT APPLICABLE | PARTIAL | NOT APPLICABLE | NOT APPLICABLE | NOT APPLICABLE | PARTIAL | PARTIAL | PARTIAL | NOT MIGRATED | Recovery policy |

# 35. Page Template Matrix

| Page | Official template |
|---|---|
| `index.html` | Public Marketing |
| `login.html` | Authentication |
| `dashboard.html` | Module Launcher Dashboard |
| `cctv.html` | Operational Kanban Workspace |
| `ce.html` | Operational Kanban Workspace |
| `complaints.html` | Operational Kanban Workspace |
| `free-orders.html` | Operational Kanban Workspace |
| `free-order-requests.html` | Workflow Kanban Workspace |
| `free-order-share.html` | Workflow Kanban Workspace |
| `call-queue.html` | Queue / Action Workspace |
| `attendance.html` | Table / Form Management Workspace |
| `employee-profiles.html` | Profile / Master-Detail Workspace |
| `client-profiles.html` | Profile / Master-Detail Workspace |
| `employee-deductions.html` | Table / Form Management Workspace |
| `agent-training.html` | Table / Form Management Workspace |
| `restaurant-ratings.html` | Table / Form Management Workspace |
| `anati-admin.html` | Administrative Workspace |
| `weekly-quality.html` | Table / Form Management Workspace |
| `system-update.html` | System Status |

# 36. Recommended Frontend File Architecture

This is an eventual vanilla HTML/CSS/JS structure, not an instruction to move everything at once.

```text
assets/
  css/
    design-tokens.css
    theme-base.css

    layouts/
      app-shell.css
      public-shell.css
      auth-shell.css
      system-shell.css
      page-layout.css

    components/
      page-header.css
      buttons.css
      icons.css
      forms.css
      filters.css
      cards.css
      badges.css
      tables.css
      kanban.css
      profiles.css
      dialogs.css
      drawers.css
      feedback.css
      data-states.css

    pages/
      dashboard.css
      operations.css
      free-order-workflow.css
      call-queue.css
      employee-profiles.css
      client-profiles.css
      people-management.css
      weekly-quality.css
      admin.css
      public.css
      login.css
      maintenance.css

  js/
    theme.js

    shell/
      app-shell.js
      navigation.js
      route-access.js

    components/
      dialog.js
      drawer.js
      confirmation.js
      feedback.js
      filters.js
      data-state.js

    pages/
      page-specific runtime files
```

Rules:

- Preserve vanilla architecture
- No React/Vue migration
- Page modules retain business behavior
- Shared component JS manages interaction only
- CSS components never contain business logic
- Migrate incrementally; compatibility styles may remain temporarily when scoped and tested

# 37. Codex Implementation Rules

Future Codex UI prompts must require:

1. Preserve content, routes, fields, workflows, permissions, authentication, APIs, and statuses.
2. Reuse an approved component before creating a new one.
3. Use semantic tokens; no hard-coded theme colors.
4. No page-local sidebar, topbar, theme runtime, status palette, or modal behavior.
5. Use the page template assigned in this document.
6. Keep incomplete product features visible and define their completion requirements.
7. Add responsive and accessibility behavior with every component.
8. Update focused regression tests.
9. Run theme, audit, syntax, diff, token, contrast, and protected-directory checks.
10. Do not commit, push, or deploy unless explicitly requested.
11. Stop when the requested sprint is complete; do not absorb later roadmap work.

# 38. Implementation Sprint Plan

## Sprint 1.3A — Shell Contract and Dashboard Reference

- **Objective:** Finalize reusable internal shell/header/navigation behavior on Dashboard.
- **Components:** App Shell, Page Header, module card, route lifecycle.
- **Pages:** Dashboard.
- **Dependencies:** Existing theme foundation.
- **Risk:** High.
- **Impact:** Establishes the reference for all remaining migrations.
- **DoD:** Dashboard uses shared shell/theme, semantic links, correct access/maintenance behavior, responsive navigation.

## Sprint 1.3B — Simple HR Shell Migration

- **Objective:** Validate the shell on similar form/table pages.
- **Pages:** Attendance, Deductions, Agent Training.
- **Components:** Shell, header, basic cards/forms/tables.
- **Dependencies:** 1.3A.
- **Risk:** Medium.
- **Impact:** Removes three legacy navigation systems.
- **DoD:** Behavior unchanged; shell/theme complete; no local navigation remains.

## Sprint 1.3C — Business and Quality Shell Migration

- **Pages:** Restaurant Ratings, Weekly Quality, Client Profiles.
- **Components:** Shell, header, profile/table layout.
- **Dependencies:** 1.3B.
- **Risk:** Medium–high.
- **DoD:** Theme and navigation integrated; wide tables/profile modal remain functional.

## Sprint 1.3D — Workflow Shell Migration

- **Pages:** Free Order Requests, Free Order Share.
- **Components:** Shell, workflow header, related-page action.
- **Dependencies:** 1.3A.
- **Risk:** Medium.
- **DoD:** Shared-record workflow unchanged; both pages use shared shell/theme.

## Sprint 1.3E — Admin and Call Queue Shell Migration

- **Pages:** Admin, Call Queue.
- **Components:** Shell, access-aware navigation, full-width workspaces.
- **Dependencies:** Route/access decisions.
- **Risk:** High.
- **DoD:** Existing behavior preserved, direct route checks consistent, no legacy navigation.

## Sprint 1.4 — Typography, Layout, and Page Headers

- **Pages:** All internal.
- **Components:** Page/section headers and layout primitives.
- **Risk:** Medium.
- **DoD:** One `h1`, approved type scale, approved gutters and width exceptions.

## Sprint 1.5 — Buttons, Icons, and Feedback Foundations

- **Pages:** Incremental across all.
- **Components:** Button variants, Lucide strategy, toast/banner/confirmation.
- **Risk:** Medium.
- **DoD:** No new native alerts/confirms; action hierarchy and focus states standardized.

## Sprint 1.6 — Form and Filter System

- **Pages:** Operations first, then table/profile/admin pages.
- **Components:** Fields, validation, long-form sections, filter variants.
- **Risk:** High.
- **DoD:** All field behavior preserved; responsive and accessible form presentation.

## Sprint 1.7 — Cards, Metrics, and Status Registry

- **Pages:** Dashboard, operations, profiles, HR, business, admin.
- **Risk:** Medium.
- **DoD:** Approved card families and centralized business-status mappings.

## Sprint 1.8 — Table System

- **Pages:** Attendance, Employee/Client Profiles, Deductions, Training, Ratings, Admin, Weekly Quality.
- **Risk:** Medium.
- **DoD:** Shared semantics, visuals, overflow, actions, and data states.

## Sprint 1.9 — Dialog and Drawer System

- **Pages:** All modal/drawer pages.
- **Risk:** High.
- **DoD:** Initial focus, trap, Escape, restoration, scroll lock, responsive panels.

## Sprint 1.10 — Kanban System

- **Pages:** Four core operations pages, Requests, Share.
- **Risk:** High.
- **DoD:** Shared primitives, unchanged statuses/logic, verified mobile horizontal behavior.

## Sprint 1.11 — Profile Workspaces

- **Pages:** Employee Profiles, Client Profiles.
- **Risk:** High.
- **DoD:** Shared master-detail behavior and complete mobile directory/profile transition.

## Sprint 1.12 — Call Queue Completion

- **Page:** Call Queue.
- **Risk:** Very high.
- **DoD:** Real selected-work experience, durable states, permission-safe shell, media/history/feedback, responsive flow.

## Sprint 1.13 — Admin Center Completion

- **Page:** Admin.
- **Risk:** Very high.
- **Implemented boundary:** Users and Module Access only. Call Queue is deferred and excluded from the administrable registry; Workflow Permissions and the Audit viewer remain noninteractive planned sections. Maintenance remains in the shared topbar and is controlled/bypassed only by verified active Anati.
- **Authority:** Protected APIs revalidate the current account, role, token purpose, and session version. Permissions fail closed: no assignment, malformed data, and service failure never synthesize access.
- **Account lifecycle:** Employee and External accounts are supported; existing System and Client linkage data is preserved, while new System and Client creation and Client login remain deferred. Admin-set passwords are temporary, require at least 12 characters, and use a reset-only authorization before a fresh login.
- **Verification state:** The accepted Option A boundary is implemented and deterministic production-handler coverage is present. The original disposable-Neon execution completed with 16 passed, 0 failed, 0 skipped and all 21 named PostgreSQL scenarios; its PostgreSQL-enabled canonical run completed with 809 tests, 808 passed, 0 failed, and one unrelated existing opt-in skip. Independent review later found that the grouped audit-rollback evidence could accept an optimistic-conflict path and did not compare every required state, and that setup begun before the outer cleanup guard could escape cleanup. The corrected acceptance suite separates all five rollback mutations, requires their exact sanitized internal-failure envelope, compares complete authoritative state, and uses one guarded cleanup coordinator. The corrected dedicated TAP accounts for its total exactly: 19 child PostgreSQL test results cover the 21 numbered production scenarios because grouped children combine scenarios 6–7, 8–9, 11–14, and 18–19 while scenario 10 expands into five mutation-specific children 10a–10e; one parent PostgreSQL test result records completion of the PostgreSQL parent; and two top-level deterministic lifecycle/mutation-resistance test results complete the total. Therefore the user-run corrected disposable-PostgreSQL summary was 22 tests, 22 passed, 0 failed, and 0 skipped. Its PostgreSQL-enabled canonical run completed with 816 tests, 815 passed, 0 failed, and one unrelated existing opt-in adapter skip. Independent final approval remains pending.
- **Deferred boundaries:** Manual real-browser acceptance remains deferred to the complete-website review. Deployment and production migration remain deferred. The acceptance database was a separate disposable project, not production or staging. Sprint 1.12 Call Queue remains disabled and deferred.
- **DoD:** Corrected disposable-PostgreSQL evidence is complete. Closure still requires independent re-review and the separately deferred real-browser acceptance at the complete-website review.

## Sprint 1.14 — Dashboard Productization

- **Page:** Dashboard.
- **Risk:** Medium.
- **DoD:** Permission-aware hybrid launcher using only supported data.

## Sprint 1.15 — Public, Authentication, and Maintenance

- **Pages:** Index, Login, System Update.
- **Risk:** Medium.
- **DoD:** Production contact data, complete auth controls, approved maintenance recovery, responsive/accessibility acceptance.

## Sprint 1.16 — Responsive and Accessibility Release Hardening

- **Pages:** All.
- **Risk:** High.
- **DoD:** Browser matrix, keyboard, focus, contrast, state, overflow, and touch-target acceptance.

# 39. v1.0 UI Definition of Done

A screen is UI-complete only when:

- It uses its assigned page template
- It uses the correct shell
- It contains exactly one page `h1`
- Typography uses approved tokens
- Spacing uses the approved scale
- Components come from the shared catalog
- Theme behavior is correct
- Light and Dark are materially distinct where required
- System follows OS preference
- Buttons and actions follow hierarchy
- Forms expose labels, required states, errors, and busy states
- Tables/Kanban/profile layouts follow their official contracts
- Dialogs and drawers manage focus correctly
- Loading, empty, error, data, and degraded states exist where applicable
- Feedback is accessible
- Status is not color-only
- It works at 1440, 1280, 1024, 768, 390, 360, and 320px
- Required actions are not clipped or removed
- No placeholder/debug visual behavior remains
- No native production alert/confirm/prompt remains after replacement sprint
- Theme, cascade, contrast, audit, and focused component tests pass
- Manual browser and keyboard acceptance is completed
- Existing visible workflow genuinely functions; UI completion cannot disguise an incomplete workflow

# 40. Cloud Crowd CRM v1.0 UI Rules

## Brand

Use only the approved Cloud Crowd palette through centralized tokens.

## Theme

Internal CRM supports Light, Dark, and System using `cc_theme`. No duplicate runtime or hard-coded theme surface.

## Typography

Use the approved Inter/Tajawal stack and type scale. Every page has one `h1`.

## Spacing

Use only the approved spacing scale. Internal gutters are 24/16/12px.

## Shell

All authenticated pages use one Internal CRM Shell. No new local sidebar or topbar.

## Components

Reuse shared buttons, forms, cards, tables, Kanban, dialogs, feedback, badges, and data states.

## Responsive

Change page structure when relationships change. Scroll tables, Kanban boards, and matrices when comparison width is essential. Never hide required content.

## Accessibility

Keyboard, focus, labels, dialog behavior, semantics, contrast, live feedback, and touch targets are mandatory.

## Feedback

Use field errors, summaries, banners, toasts, and confirmation dialogs according to persistence and severity. No new native alert/confirm/prompt.

## Testing

Every UI sprint must test theme, cascade, contrast, component contracts, protected functionality, responsive behavior, and accessibility.

## Forbidden

No arbitrary colors, typography, spacing, layers, inline visual styles, clickable divs, fake metrics, hidden incomplete features, or page-specific component systems.

## Product decisions required before architecture can be treated as fully implementation-authorized

1. **Login persistence:** Define the approved behavior and security policy for the existing Remember me control.
2. **Call Queue system of record:** Confirm its durable data source and exact relationship to CE/customer/order records.
3. **Call Queue ownership:** Decide whether v1.0 requires assignment/claiming or only current-user attribution.
4. **Admin v1.0 scope:** Decide whether Workflow Permissions, Maintenance, and Audit must be functional in v1.0 or may ship visibly marked as planned.
5. **Maintenance recovery:** Approve Retry, Return to Login, both, or neither, and confirm the universal direct-route maintenance policy.
6. **Dashboard summaries:** Select which, if any, existing-API summaries belong in v1.0. Without approval, Dashboard remains a polished permission-aware launcher.
7. **Profile planned modules:** Confirm whether Employee and Client profile “Coming soon” integrations are v1.0 requirements or explicitly scheduled post-v1.0.
8. **Public production content:** Supply approved telephone, email, and social destinations.

UI ARCHITECTURE STATUS:

REQUIRES PRODUCT DECISIONS
