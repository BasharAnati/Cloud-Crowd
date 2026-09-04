const { test: base, expect } = require('@playwright/test');

const modules = [
  ['cctv', 'CCTV Requests'], ['customer_experience', 'Customer Experience'],
  ['daily_complaints', 'Daily Complaints'], ['complimentary_orders', 'Complimentary Orders'],
  ['free_order_requests', 'Free Order Requests'], ['free_order_share', 'Free Order Share'],
  ['employee_profiles', 'Employee Profiles'], ['attendance', 'Attendance'],
  ['weekly_quality', 'Weekly Quality'], ['agent_training', 'Agent Training'],
  ['employee_deductions', 'Employee Deductions'], ['client_profiles', 'Client Profiles'],
  ['restaurant_ratings', 'Restaurant Ratings'], ['anati_admin', 'Anati Admin Center']
].map(([moduleKey, moduleName]) => ({ moduleKey, moduleName, label: moduleName }));

const access = modules.map(({ moduleKey }) => ({
  moduleKey, canView: true, canCreate: true, canEdit: true, canDelete: true
}));

const seededEmployee = {
  employeeId: 'employee-s116', fullName: 'Sprint Browser Employee', primaryPhone: '+962 7 9000 0000',
  status: 'active', notes: '', phones: [], emergencyContacts: [], assignedRestaurants: ['Browser Bistro']
};
const seededRestaurant = {
  restaurantId: 'restaurant-s116', brandName: 'Browser Bistro', status: 'active', callCenterNumber: '1000',
  originalRestaurantNumber: '', forwardedNumber: '', brandOwnerName: 'Test Owner', brandOwnerPhone: '',
  accountManagerName: 'Test Manager', restaurantManagerName: '', notes: '', logoUrl: ''
};

const populatedTickets = {
  cctv: [
    { caseNumber: 'CCTV-S116-1', status: 'Under Review', branch: 'Swefieh', staff: ['Sprint Operator'], sections: ['Kitchen'], dateTime: '2026-08-20T09:00:00Z' },
    { caseNumber: 'CCTV-S116-2', status: 'Closed', branch: 'Manara', staff: ['Sprint Reviewer'], sections: ['Cash Wrap'], dateTime: '2026-08-21T10:00:00Z' }
  ],
  ce: [
    { caseNumber: 'CE-S116-1', orderNumber: 'CE-1001', status: 'Under Review', customerName: 'Mira', branch: 'Swefieh', restaurant: 'Sager', creationDate: '2026-08-20T09:00:00Z' },
    { caseNumber: 'CE-S116-2', orderNumber: 'CE-1002', status: 'Closed', customerName: 'Omar', branch: 'Wadi Saqra', restaurant: 'Bun Run', creationDate: '2026-08-21T10:00:00Z' }
  ],
  complaints: [
    { caseNumber: 'CMP-S116-1', orderNumber: 'CMP-1001', status: 'Under Review', customerName: 'Lina', branch: 'Swefieh', restaurant: 'Sager', issueCategory: 'Service Quality', department: 'Customer Service', phone: '0790000000', creationDate: '2026-08-20' },
    { caseNumber: 'CMP-S116-2', orderNumber: 'CMP-1002', status: 'Closed', customerName: 'Sami', branch: 'Wadi Saqra', restaurant: 'Sager', issueCategory: 'Food Quality', department: 'Customer Service', phone: '0790000000', creationDate: '2026-08-21' }
  ],
  'free-orders': [
    { caseNumber: 'FO-S116-1', orderNumber: 'FO-1001', status: 'Active', customerName: 'Rami', discountAmount: '4.00', orderDate: '2026-08-20T09:00:00Z' },
    { caseNumber: 'FO-S116-2', orderNumber: 'FO-1002', status: 'Taken', customerName: 'Dana', discountAmount: '6.00', orderDate: '2026-08-21T10:00:00Z' }
  ]
};

const requestFixtures = [
  { requestId: 'request-pending-s116', orderNumber: 'REQ-1001', customerName: 'Nour', phoneNumber: '0790000001', discountAmount: 5, reasonForDiscount: 'Service recovery', internalStage: 'pending_details', shareStage: '', createdBy: 'Anati', creationTime: '2026-08-20T09:00:00Z' },
  { requestId: 'request-ready-s116', orderNumber: 'REQ-1002', customerName: 'Yara', phoneNumber: '0790000002', discountAmount: 7, reasonForDiscount: 'Approved recovery', internalStage: 'ready_to_share', shareStage: '', decisionMaker: 'Manager', deductionFrom: 'Operations', createdBy: 'Anati', creationTime: '2026-08-21T09:00:00Z' },
  { requestId: 'request-response-s116', orderNumber: 'REQ-1003', customerName: 'Tariq', phoneNumber: '0790000003', discountAmount: 8, reasonForDiscount: 'Follow-up needed', internalStage: 'ready_to_share', shareStage: 'needs_response', shareNote: 'Confirm contact number', shareNoteBy: 'Reviewer', shareNoteAt: '2026-08-22T09:00:00Z', createdBy: 'Anati', creationTime: '2026-08-22T09:00:00Z' },
  { requestId: 'request-done-s116', orderNumber: 'REQ-1004', customerName: 'Salma', phoneNumber: '0790000004', discountAmount: 9, reasonForDiscount: 'Completed recovery', internalStage: 'done', shareStage: 'done', decisionMaker: 'Manager', deductionFrom: 'Operations', createdBy: 'Anati', creationTime: '2026-08-23T09:00:00Z' }
];

const populatedData = {
  attendance: [{ attendanceId: 'attendance-s116', date: '2026-08-20', employeeId: seededEmployee.employeeId, employeeNameSnapshot: seededEmployee.fullName, loginStatus: 'On Time', logoutStatus: 'Left Early', extraTime: 'Yes', extraDuration: '15 minutes', note: 'Populated fixture', fromTime: '09:00', toTime: '17:00', filledBy: 'Anati', createdAt: '2026-08-20T09:00:00Z' }],
  deductions: [{ deductionId: 'deduction-s116', employeeId: seededEmployee.employeeId, employeeNameSnapshot: seededEmployee.fullName, deductionType: 'Order Error', restaurantName: seededRestaurant.brandName, orderNumber: 'ORD-116', originalAmount: 20, applyEmployeeDiscount: true, finalDeductionAmount: 18, orderDateTime: '2026-08-20T12:00', approvedBy: 'Manager' }],
  training: [{ trainingId: 'training-s116', employeeId: seededEmployee.employeeId, employeeNameSnapshot: seededEmployee.fullName, restaurantId: seededRestaurant.restaurantId, restaurantNameSnapshot: seededRestaurant.brandName, assignmentStatus: 'Assigned', trainingStatus: 'Coaching Needed', trainingDate: '2026-08-20', updatedBy: 'Anati', notes: 'Populated fixture' }],
  records: [{ id: 'quality-s116', qualityId: 'quality-s116', callDateTime: '2026-08-20 12:00:00', auditorEmployeeId: 'auditor-s116', auditorNameSnapshot: 'Sprint Auditor', agentEmployeeId: seededEmployee.employeeId, agentNameSnapshot: seededEmployee.fullName, restaurantId: seededRestaurant.restaurantId, restaurantNameSnapshot: seededRestaurant.brandName, phoneNumber: '0790000000', notes: 'Populated fixture', scores: { greetings: 10, knowledge: 10, upselling: 7, closure: 10, repeatingOrders: 7, phoneEtiquette: 10, clarity: 10, environment: 7, equipment: 10, aat: 10 }, totalScore: 91 }],
  ratings: [{ ratingId: 'rating-s116', restaurantId: seededRestaurant.restaurantId, restaurantNameSnapshot: seededRestaurant.brandName, platform: 'Talabat', monthName: 'August', weekName: 'Week 3', rating: 4.7, reviewsCount: 116, ratingDate: '2026-08-20', updatedBy: 'Anati', notes: 'Populated fixture' }]
};

const populatedUsers = [{
  userId: 'user-s116', version: 1, username: 'sprint.reviewer', displayName: 'Sprint Reviewer',
  email: 'reviewer@example.test', accountType: 'employee', linkStatus: 'linked',
  employeeId: seededEmployee.employeeId, employeeNameSnapshot: seededEmployee.fullName,
  role: 'manager', status: 'active', isSystemAccount: false
}];
const populatedAdminAccess = modules.map(({ moduleKey }) => ({
  username: populatedUsers[0].username,
  moduleKey,
  canView: true,
  canCreate: true,
  canEdit: true,
  canDelete: true
}));

function responseFor(url, pageUrl, options = {}) {
  const { seeded = false, populated = false } = options;
  const requestUrl = new URL(url);
  const pathname = requestUrl.pathname;
  if (pathname.endsWith('/maintenance')) {
    return pageUrl.includes('/system-update.html')
      ? { maintenance: true, admin: false }
      : { maintenance: false, admin: true };
  }
  if (requestUrl.searchParams.get('my-access') === '1' || pathname.endsWith('/permissions') || pathname.endsWith('/module-access')) {
    return { ok: true, modules, access, hasConfiguredAccess: true, legacyFallback: false, unavailable: false };
  }
  if (pathname.endsWith('/admin-users') || pathname.endsWith('/users')) {
    return { ok: true, users: populated ? populatedUsers : [], access: populated ? populatedAdminAccess : access, modules, seeded: false };
  }
  if ((seeded || populated) && pathname.endsWith('/employees')) {
    return requestUrl.searchParams.has('id')
      ? { ok: true, employee: seededEmployee }
      : { ok: true, employees: [seededEmployee] };
  }
  if ((seeded || populated) && pathname.endsWith('/restaurants')) {
    return requestUrl.searchParams.has('id')
      ? { ok: true, restaurant: seededRestaurant }
      : { ok: true, restaurants: [seededRestaurant] };
  }
  if (populated && pathname.endsWith('/tickets')) {
    const section = requestUrl.searchParams.get('section');
    return { ok: true, tickets: (populatedTickets[section] || []).map((payload, index) => ({ id: index + 1, section, status: payload.status, payload, created_at: payload.dateTime || payload.creationDate || payload.orderDate, updated_at: payload.dateTime || payload.creationDate || payload.orderDate })) };
  }
  if (populated && pathname.endsWith('/sheets')) {
    const section = requestUrl.searchParams.get('section');
    const serializers = {
      cctv: (ticket) => [ticket.status, ticket.branch, ticket.dateTime, 'Kitchen', ticket.sections.join(', '), ticket.staff.join(', '), 'Recorded', 'Cleanliness', 'Populated fixture', 'Reviewed', ticket.caseNumber, 'Anati', ticket.dateTime],
      ce: (ticket) => [ticket.status, 'Customer Service', ticket.customerName, '0790000000', ticket.creationDate, 'Shift A', 'Delivery', ticket.branch, ticket.restaurant, 'Web', ticket.creationDate, 'Service Quality', 'Populated fixture', 'Reviewed', 'Satisfied', ticket.orderNumber],
      complaints: (ticket) => [ticket.status, 'Customer Service', ticket.customerName, '0790000000', ticket.creationDate, 'Shift A', 'Delivery', ticket.branch, 'Sager', 'Direct Order (From Store)', ticket.issueCategory, 'Populated fixture', 'Reviewed', ticket.caseNumber],
      'free-orders': (ticket) => [ticket.status, ticket.customerName, '0790000000', ticket.orderDate, ticket.discountAmount, 'Service recovery', 'Manager', ticket.orderDate, 'NEW-116', 'Operations', 'Populated fixture', 'Reviewed', ticket.orderNumber]
    };
    return { ok: true, values: (populatedTickets[section] || []).map(serializers[section] || (() => [])) };
  }
  if (populated && pathname.endsWith('/free-order-requests')) {
    return { ok: true, requests: requestUrl.searchParams.get('view') === 'share'
      ? requestFixtures.filter((request) => request.internalStage === 'ready_to_share' || request.internalStage === 'done')
      : requestFixtures };
  }
  if (populated && pathname.endsWith('/attendance')) return { ok: true, attendance: populatedData.attendance };
  if (populated && pathname.endsWith('/deductions')) return { ok: true, deductions: populatedData.deductions };
  if (populated && pathname.endsWith('/training')) return { ok: true, training: populatedData.training };
  if (populated && pathname.endsWith('/weekly-quality')) return { ok: true, records: populatedData.records };
  if (populated && pathname.endsWith('/restaurant-ratings')) return { ok: true, ratings: populatedData.ratings };
  return {
    ok: true,
    access,
    attendance: [],
    deductions: [],
    employees: [],
    history: [],
    modules,
    ratings: [],
    records: [],
    requests: [],
    restaurants: [],
    statistics: {},
    tickets: [],
    training: [],
    users: [],
    values: []
  };
}

const test = base.extend({
  appPage: async ({ page }, use) => {
    await configurePage(page);
    await use(page);
  },
  seededPage: async ({ page }, use) => {
    await configurePage(page, { seeded: true });
    await use(page);
  },
  populatedPage: async ({ page }, use) => {
    await configurePage(page, { populated: true });
    await use(page);
  }
});

async function configurePage(page, options = {}) {
    await page.addInitScript(() => {
      sessionStorage.setItem('cc_auth', '1');
      sessionStorage.setItem('cc_user', 'Anati');
      sessionStorage.setItem('cc_role', 'admin');
      sessionStorage.setItem('cc_token', 'sprint-1-16-browser-token');
      localStorage.setItem('cc_theme', 'light');
    });
    if (options.populated) {
      await page.addInitScript((ticketData) => {
        localStorage.setItem('cloudCrowdTickets', JSON.stringify(ticketData));
      }, populatedTickets);
    }
    await page.route('**/.netlify/functions/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(responseFor(route.request().url(), route.request().frame().url(), options))
      });
    });
}

async function waitForSettledPage(page) {
  await page.waitForLoadState('load');
  await page.waitForFunction(() => !document.fonts || document.fonts.status === 'loaded');
}

module.exports = { test, expect, waitForSettledPage, modules };
