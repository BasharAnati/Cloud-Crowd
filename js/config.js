const CREATOR_ALLOW = {
  all: ['Anati']
};

const DELETER_USERNAME = 'Anati';

const ticketDomainStatuses = TICKET_DOMAIN_CONFIG.statuses;
const ticketStatusOptions = TICKET_DOMAIN_CONFIG.statusOptions;
const ticketDomainOptions = TICKET_DOMAIN_CONFIG.options;

const mainFields = {
  cctv: ['branch', 'staff', 'sections'],
  ce: ['orderNumber', 'customerName', 'branch', 'restaurant'],
  'free-orders': ['customerName', 'orderNumber', 'discountAmount'],
  complaints: ['customerName', 'branch', 'issueCategory']
};

const STATUS_COLUMNS = {
  cctv: [
    ticketDomainStatuses.ESCALATED,
    ticketDomainStatuses.UNDER_REVIEW,
    ticketDomainStatuses.CLOSED
  ],
  ce: [
    ticketDomainStatuses.ESCALATED,
    ticketDomainStatuses.UNDER_REVIEW,
    ticketDomainStatuses.PENDING_CUSTOMER_CALL,
    ticketDomainStatuses.CLOSED
  ],
  'free-orders': [
    ticketDomainStatuses.NEW,
    ticketDomainStatuses.ACTIVE,
    ticketDomainStatuses.TAKEN
  ],
  complaints: [
    ticketDomainStatuses.ESCALATED,
    ticketDomainStatuses.UNDER_REVIEW,
    ticketDomainStatuses.PENDING_CUSTOMER_CALL,
    ticketDomainStatuses.CLOSED
  ]
};

const STATUS_DISPLAY_MAP = {
  [ticketDomainStatuses.PENDING_CUSTOMER_CALL]: 'Pending (Call Back)'
};

const formFields = {
  cctv: [
    { label: 'Case Status', type: 'select', name: 'status', options: ticketStatusOptions.cctv },
    { label: 'Branch', type: 'select', name: 'branch', options: ticketDomainOptions.cctv.branch },
    { label: 'Date', type: 'text', name: 'date' },
    { label: 'Time', type: 'text', name: 'time' },
    { label: 'Camera(s)', type: 'multi-select', name: 'cameras', options: ticketDomainOptions.cctv.cameras },
    { label: 'Section(s)', type: 'multi-select', name: 'sections', options: ticketDomainOptions.cctv.sections },
    { label: 'Staff Involved', type: 'multi-select', name: 'staff', options: ticketDomainOptions.cctv.staff },
    { label: 'Review Type', type: 'select', name: 'reviewType', options: ticketDomainOptions.cctv.reviewType },
    { label: 'Violated Policy', type: 'multi-select', name: 'violations', options: ticketDomainOptions.cctv.violations },
    { label: 'Case Details', type: 'textarea', name: 'notes' },
    { label: 'Upload PDF (optional)', type: 'file', name: 'cctvPdf', accept: 'application/pdf' },
    { label: 'Action Taken', type: 'textarea', name: 'actionTaken' }
  ],
  ce: [
    { label: 'Status', type: 'select', name: 'status', options: ticketStatusOptions.ce },
    { label: 'Order Number', type: 'text', name: 'orderNumber' },
    { label: 'Department Responsible', type: 'select', name: 'department', options: ticketDomainOptions.ce.department },
    { label: 'Customer Name', type: 'text', name: 'customerName' },
    { label: 'Phone Number', type: 'text', name: 'phone' },
    { label: 'Creation Date', type: 'datetime-local', name: 'creationDate' },
    { label: 'Shift', type: 'select', name: 'shift', options: ticketDomainOptions.ce.shift },
    { label: 'Order Type', type: 'select', name: 'orderType', options: ticketDomainOptions.ce.orderType },
    { label: 'Branch Name', type: 'select', name: 'branch', options: ticketDomainOptions.ce.branch },
    { label: 'Restaurant', type: 'select', name: 'restaurant', options: ticketDomainOptions.ce.restaurant },
    { label: 'Order Channel', type: 'select', name: 'channel', options: ticketDomainOptions.ce.channel },
    { label: 'Feedback Date', type: 'datetime-local', name: 'feedbackDate' },
    { label: 'Issue Category', type: 'select', name: 'issueCategory', options: ticketDomainOptions.ce.issueCategory },
    { label: 'Case Details', type: 'textarea', name: 'customerNotes' },
    { label: 'Action Taken', type: 'textarea', name: 'actionTaken' },
    { label: 'Customer Satisfaction Level', type: 'select', name: 'satisfaction', options: ticketDomainOptions.ce.satisfaction }
  ],
  'free-orders': [
    { label: 'Status', type: 'select', name: 'status', options: ticketStatusOptions['free-orders'] },
    { label: 'Customer Name', type: 'text', name: 'customerName' },
    { label: 'Phone Number', type: 'text', name: 'phone' },
    { label: 'Order Date', type: 'datetime-local', name: 'orderDate' },
    { label: 'Order Number', type: 'text', name: 'orderNumber' },
    { label: 'Order on Circa', type: 'file', name: 'orderOnCirca', accept: 'image/*' },
    { label: 'Discount Amount', type: 'text', name: 'discountAmount' },
    { label: 'Reason for Discount', type: 'textarea', name: 'reasonForDiscount' },
    { label: 'Order Channel', type: 'select', name: 'channel', options: ticketDomainOptions['free-orders'].channel },
    { label: 'Decision Maker', type: 'text', name: 'decisionMaker' },
    { label: 'Attached', type: 'file', name: 'attached', accept: 'image/*' },
    { label: 'The date of using the discount', type: 'datetime-local', name: 'discountDate' },
    { label: 'New order number', type: 'text', name: 'newOrderNumber' },
    { label: 'Deduction from', type: 'text', name: 'deductionFrom' },
    { label: 'Case description', type: 'textarea', name: 'caseDescription' }
  ],
  complaints: [
    { label: 'Status', type: 'select', name: 'status', options: ticketStatusOptions.complaints },
    { label: 'Order Number', type: 'text', name: 'orderNumber' },
    { label: 'Department Responsible', type: 'select', name: 'department', options: ticketDomainOptions.complaints.department },
    { label: 'Customer Name', type: 'text', name: 'customerName' },
    { label: 'Phone Number', type: 'text', name: 'phone' },
    { label: 'Creation Date', type: 'text', name: 'creationDate' },
    { label: 'Shift', type: 'select', name: 'shift', options: ticketDomainOptions.complaints.shift },
    { label: 'Order Type', type: 'select', name: 'orderType', options: ticketDomainOptions.complaints.orderType },
    { label: 'Branch Name', type: 'select', name: 'branch', options: ticketDomainOptions.complaints.branch },
    { label: 'Restaurant', type: 'select', name: 'restaurant', options: ticketDomainOptions.complaints.restaurant },
    { label: 'Order Channel', type: 'select', name: 'channel', options: ticketDomainOptions.complaints.channel },
    { label: 'Issue Category', type: 'select', name: 'issueCategory', options: ticketDomainOptions.complaints.issueCategory },
    { label: 'Case Details', type: 'textarea', name: 'complaintDetails' },
    { label: 'Action Taken', type: 'textarea', name: 'actionTaken' },
  ]
};

const FIELD_LABELS = {
  dateTime:'Date & Time', creationDate:'Creation Date', orderDate:'Order Date',
  discountDate:'Discount Date', newOrderNumber:'New Order Number', orderNumber:'Order Number',
  phone:'Phone Number', reviewType:'Review Type', issueCategory:'Issue Category', decisionMaker:'Decision Maker',
  deductionFrom:'Deduction From', caseDescription:'Case Description', customerNotes:'Case Details',
  actionTaken:'Action Taken'
};

window.CREATOR_ALLOW = CREATOR_ALLOW;
window.DELETER_USERNAME = DELETER_USERNAME;
window.mainFields = mainFields;
window.STATUS_COLUMNS = STATUS_COLUMNS;
window.STATUS_DISPLAY_MAP = STATUS_DISPLAY_MAP;
window.formFields = formFields;
window.FIELD_LABELS = FIELD_LABELS;
