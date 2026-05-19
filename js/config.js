const CREATOR_ALLOW = {
  all: ['Anati'],
  'time-table': ['Anati', 'Mai']
};

const DELETER_USERNAME = 'Anati';

const mainFields = {
  cctv: ['branch', 'staff', 'sections'],
  ce: ['orderNumber', 'customerName', 'branch', 'restaurant'],
  'free-orders': ['customerName', 'orderNumber', 'discountAmount'],
  complaints: ['customerName', 'branch', 'issueCategory'],
  'time-table': ['customerName', 'orderNumber', 'phone']
};

const STATUS_COLUMNS = {
  cctv: ['Escalated', 'Under Review', 'Closed'],
  ce: ['Escalated', 'Under Review', 'Pending (Customer Call Required)', 'Closed'],
  'free-orders': ['New', 'Active', 'Taken'],
  complaints: ['Escalated', 'Under Review', 'Pending (Customer Call Required)', 'Closed'],
  'time-table': [
    'No Call Needed',
    'Pending Call',
    'No Answer',
    'Scheduled',
    'Issue',
    'Returned'
  ]
};

const STATUS_DISPLAY_MAP = {
  'Pending (Customer Call Required)': 'Pending (Call Back)'
};

const formFields = {
  cctv: [
    { label: 'Case Status', type: 'select', name: 'status', options: ['Closed', 'Under Review', 'Escalated'] },
    { label: 'Branch', type: 'select', name: 'branch', options: ['Wadi Saqra', 'Swefieh', 'Swefieh Village', 'Manara'] },
    { label: 'Date', type: 'text', name: 'date' },
    { label: 'Time', type: 'text', name: 'time' },
    { label: 'Camera(s)', type: 'multi-select', name: 'cameras', options: [
      'Back of Kitchen','Kitchen','Pepsi Kitchen','Storehouse','Cashier','Main Stove','Prep Back Area','Prep Room',
      'Back Corridor','Fingerprint','Posterior View','Refrigerators','2 Pepsi Kitchen','Main Kitchen'
    ]},
    { label: 'Section(s)', type: 'multi-select', name: 'sections', options: [
      'Cash Wrap','Counter','Line','Grill','Fryer','Freezer','Fridge','Oven','Station','Rest Area','Stairs',
      'Front Door','Back Door','Sink','Front Area','Kitchen','Prep Main Stove','Prep Back Area'
    ]},
    { label: 'Staff Involved', type: 'multi-select', name: 'staff', options: [
      'Unknown','Khaled Al-Nimri','Faisal Al-Nimri','Tiffany Ghawi','Alia Al-Fares','Tamer Al-Sayegh',
      'Ibrahim Tamlih','Ahmed Athamneh','Tamer Tamlih','Osama','Mais Taha','Farid Al-Nabulsi',
      'Ahmed Dawood','Mohammed Abu Fadda','Mohammed Marafi','Mohammed Abu Abdullah','Reda Wagih',
      'Farid Al-Nabulsi','Marwa Mahmoud','Shahed Hadib','Amr Diab','Abdul Karim Noufal','Zaid Sawahy',
      'Abdul Rahman Sawalhi','Mohammed Al-Kurdi','Sabih Rani','Duaa Suleiman','Olorunsola oluwafemi bk',
      'Ahmed Al-Nabulsi','Jaber Sakr','Mohammed Awamleh','Zaid Waliili','Ihab Abu Zaid','Ahmed Naamneh',
      'Amer Al-Rantisi','Asid Ayad','Amer Abu Laila','Rand Asfour','Yaqoub Karadsheh','Diaa Al-Muzain',
      'Musab','Layla Qronfleh'
    ]},
    { label: 'Review Type', type: 'select', name: 'reviewType', options: ['Recorded', 'Live'] },
    { label: 'Violated Policy', type: 'multi-select', name: 'violations', options: [
      'Cleanliness','Punctuality','Cash Handling','Equipment Check','Personal Hygiene','Safety/Compliance',
      'Stock Management','Order Accuracy','Staff Behavior','Eating','Kitchen Tools Compliance','Other'
    ] },
    { label: 'Case Details', type: 'textarea', name: 'notes' },
    { label: 'Upload PDF (optional)', type: 'file', name: 'cctvPdf', accept: 'application/pdf' },
    { label: 'Action Taken', type: 'textarea', name: 'actionTaken' }
  ],
  ce: [
    { label: 'Status', type: 'select', name: 'status', options: ['Closed','Under Review','Escalated','Pending (Customer Call Required)'] },
    { label: 'Order Number', type: 'text', name: 'orderNumber' },
    { label: 'Department Responsible', type: 'select', name: 'department', options: [
      'Kitchen','Delivery/Prepared Delay','Customer Service','Frontline / Cashier','IT','Operations','Management'
    ] },
    { label: 'Customer Name', type: 'text', name: 'customerName' },
    { label: 'Phone Number', type: 'text', name: 'phone' },
    { label: 'Creation Date', type: 'datetime-local', name: 'creationDate' },
    { label: 'Shift', type: 'select', name: 'shift', options: ['Shift A','Shift B'] },
    { label: 'Order Type', type: 'select', name: 'orderType', options: ['Delivery','Takeout'] },
    { label: 'Branch Name', type: 'select', name: 'branch', options: ['Swefieh','Wadi Saqra','Swefieh Village'] },
    { label: 'Restaurant', type: 'select', name: 'restaurant', options: [
      'Very Good Burger','Sager','Happy Tummies','Crunchychkn','Bun Run','Butter Me Up','Bint Halal',
      'Colors Catering','Heat Burger','Thyme Table',"Evi's",'Chili Charms'
    ] },
    { label: 'Order Channel', type: 'select', name: 'channel', options: ['Web','Call Center'] },
    { label: 'Feedback Date', type: 'datetime-local', name: 'feedbackDate' },
    { label: 'Issue Category', type: 'select', name: 'issueCategory', options: [
      'Positive Experience','Service Quality','Food Quality','Delivery/Prepared Time','Employee Attitude','Other'
    ] },
    { label: 'Case Details', type: 'textarea', name: 'customerNotes' },
    { label: 'Action Taken', type: 'textarea', name: 'actionTaken' },
    { label: 'Customer Satisfaction Level', type: 'select', name: 'satisfaction', options: ['Satisfied','Not Satisfied'] }
  ],
  'free-orders': [
    { label: 'Status', type: 'select', name: 'status', options: ['New','Active','Taken'] },
    { label: 'Customer Name', type: 'text', name: 'customerName' },
    { label: 'Phone Number', type: 'text', name: 'phone' },
    { label: 'Order Date', type: 'datetime-local', name: 'orderDate' },
    { label: 'Order Number', type: 'text', name: 'orderNumber' },
    { label: 'Order on Circa', type: 'file', name: 'orderOnCirca', accept: 'image/*' },
    { label: 'Discount Amount', type: 'text', name: 'discountAmount' },
    { label: 'Reason for Discount', type: 'textarea', name: 'reasonForDiscount' },
    { label: 'Order Channel', type: 'select', name: 'channel', options: ['Circa','Talabat','Careem','Direct Order (From Store)'] },
    { label: 'Decision Maker', type: 'text', name: 'decisionMaker' },
    { label: 'Attached', type: 'file', name: 'attached', accept: 'image/*' },
    { label: 'The date of using the discount', type: 'datetime-local', name: 'discountDate' },
    { label: 'New order number', type: 'text', name: 'newOrderNumber' },
    { label: 'Deduction from', type: 'text', name: 'deductionFrom' },
    { label: 'Case description', type: 'textarea', name: 'caseDescription' }
  ],
  complaints: [
    { label: 'Status', type: 'select', name: 'status', options: ['Closed','Under Review','Escalated','Pending (Customer Call Required)'] },
    { label: 'Order Number', type: 'text', name: 'orderNumber' },
    { label: 'Department Responsible', type: 'select', name: 'department', options: [
      'Kitchen','Delivery/Prepared Delay','Customer Service','Frontline / Cashier','IT','Operations','Management'
    ] },
    { label: 'Customer Name', type: 'text', name: 'customerName' },
    { label: 'Phone Number', type: 'text', name: 'phone' },
    { label: 'Creation Date', type: 'text', name: 'creationDate' },
    { label: 'Shift', type: 'select', name: 'shift', options: ['Shift A','Shift B'] },
    { label: 'Order Type', type: 'select', name: 'orderType', options: ['Delivery','Takeout'] },
    { label: 'Branch Name', type: 'select', name: 'branch', options: ['Swefieh','Wadi Saqra','Swefieh Village'] },
    { label: 'Restaurant', type: 'select', name: 'restaurant', options: [
      'Very Good Burger','Sager','Happy Tummies','Crunchychkn','Bun Run','Butter Me Up','Bint Halal',
      'Colors Catering','Heat Burger','Thyme Table',"Evi's",'Chili Charms'
    ] },
    { label: 'Order Channel', type: 'select', name: 'channel', options: ['Circa','Talabat','Careem','Direct Order (From Store)'] },
    { label: 'Issue Category', type: 'select', name: 'issueCategory', options: [
      'Positive Experience','Service Quality','Food Quality','Delivery/Prepared Time','Employee Attitude','Other'
    ] },
    { label: 'Case Details', type: 'textarea', name: 'complaintDetails' },
    { label: 'Action Taken', type: 'textarea', name: 'actionTaken' },
  ],
  'time-table': [
    { label: 'Status', type: 'select', name: 'status', options: [
      'No Call Needed', 'Pending Call', 'No Answer', 'Scheduled', 'Issue', 'Returned'
    ] },
    { label: 'Customer Name', type: 'text', name: 'customerName' },
    { label: 'Phone Number', type: 'text', name: 'phone' },
    { label: 'Order Number', type: 'text', name: 'orderNumber' },
    { label: 'Order Date', type: 'datetime-local', name: 'orderDate' },
    { label: 'Return Date', type: 'datetime-local', name: 'returnDate' },
    { label: 'Amount to Be Refunded', type: 'text', name: 'amountToBeRefunded' },
    { label: 'Delivery Fees', type: 'text', name: 'deliveryFees' },
    { label: 'Plates Quantity', type: 'text', name: 'platesQuantity' },
    { label: 'Plates Numbers', type: 'text', name: 'platesNumbers' },
    { label: 'Note', type: 'textarea', name: 'note' }
  ]
};

const FIELD_LABELS = {
  dateTime:'Date & Time', creationDate:'Creation Date', orderDate:'Order Date', returnDate:'Return Date',
  discountDate:'Discount Date', newOrderNumber:'New Order Number', orderNumber:'Order Number',
  phone:'Phone Number', reviewType:'Review Type', issueCategory:'Issue Category', decisionMaker:'Decision Maker',
  deductionFrom:'Deduction From', amountToBeRefunded:'Amount to be Refunded', platesQuantity:'Plates Quantity',
  platesNumbers:'Plates Numbers', caseDescription:'Case Description', customerNotes:'Case Details', actionTaken:'Action Taken'
};

window.CREATOR_ALLOW = CREATOR_ALLOW;
window.DELETER_USERNAME = DELETER_USERNAME;
window.mainFields = mainFields;
window.STATUS_COLUMNS = STATUS_COLUMNS;
window.STATUS_DISPLAY_MAP = STATUS_DISPLAY_MAP;
window.formFields = formFields;
window.FIELD_LABELS = FIELD_LABELS;
