const TICKET_DOMAIN_CONFIG = {
  sectionIds: {
    CCTV: 'cctv',
    CUSTOMER_EXPERIENCE: 'ce',
    COMPLAINTS: 'complaints',
    COMPLIMENTARY_ORDERS: 'free-orders'
  },
  statuses: {
    CLOSED: 'Closed',
    UNDER_REVIEW: 'Under Review',
    ESCALATED: 'Escalated',
    PENDING_CUSTOMER_CALL: 'Pending (Customer Call Required)',
    NEW: 'New',
    ACTIVE: 'Active',
    TAKEN: 'Taken'
  },
  statusOptions: {
    cctv: ['Closed', 'Under Review', 'Escalated'],
    ce: ['Closed', 'Under Review', 'Escalated', 'Pending (Customer Call Required)'],
    complaints: ['Closed', 'Under Review', 'Escalated', 'Pending (Customer Call Required)'],
    'free-orders': ['New', 'Active', 'Taken']
  },
  options: {
    cctv: {
      branch: ['Wadi Saqra', 'Swefieh', 'Swefieh Village', 'Manara'],
      cameras: [
        'Back of Kitchen',
        'Kitchen',
        'Pepsi Kitchen',
        'Storehouse',
        'Cashier',
        'Main Stove',
        'Prep Back Area',
        'Prep Room',
        'Back Corridor',
        'Fingerprint',
        'Posterior View',
        'Refrigerators',
        '2 Pepsi Kitchen',
        'Main Kitchen'
      ],
      sections: [
        'Cash Wrap',
        'Counter',
        'Line',
        'Grill',
        'Fryer',
        'Freezer',
        'Fridge',
        'Oven',
        'Station',
        'Rest Area',
        'Stairs',
        'Front Door',
        'Back Door',
        'Sink',
        'Front Area',
        'Kitchen',
        'Prep Main Stove',
        'Prep Back Area'
      ],
      staff: [
        'Unknown',
        'Khaled Al-Nimri',
        'Faisal Al-Nimri',
        'Tiffany Ghawi',
        'Alia Al-Fares',
        'Tamer Al-Sayegh',
        'Ibrahim Tamlih',
        'Ahmed Athamneh',
        'Tamer Tamlih',
        'Osama',
        'Mais Taha',
        'Farid Al-Nabulsi',
        'Ahmed Dawood',
        'Mohammed Abu Fadda',
        'Mohammed Marafi',
        'Mohammed Abu Abdullah',
        'Reda Wagih',
        'Marwa Mahmoud',
        'Shahed Hadib',
        'Amr Diab',
        'Abdul Karim Noufal',
        'Zaid Sawahy',
        'Abdul Rahman Sawalhi',
        'Mohammed Al-Kurdi',
        'Sabih Rani',
        'Duaa Suleiman',
        'Olorunsola oluwafemi bk',
        'Ahmed Al-Nabulsi',
        'Jaber Sakr',
        'Mohammed Awamleh',
        'Zaid Waliili',
        'Ihab Abu Zaid',
        'Ahmed Naamneh',
        'Amer Al-Rantisi',
        'Asid Ayad',
        'Amer Abu Laila',
        'Rand Asfour',
        'Yaqoub Karadsheh',
        'Diaa Al-Muzain',
        'Musab',
        'Layla Qronfleh'
      ],
      reviewType: ['Recorded', 'Live'],
      violations: [
        'Cleanliness',
        'Punctuality',
        'Cash Handling',
        'Equipment Check',
        'Personal Hygiene',
        'Safety/Compliance',
        'Stock Management',
        'Order Accuracy',
        'Staff Behavior',
        'Eating',
        'Kitchen Tools Compliance',
        'Other'
      ]
    },
    ce: {
      department: [
        'Kitchen',
        'Delivery/Prepared Delay',
        'Customer Service',
        'Frontline / Cashier',
        'IT',
        'Operations',
        'Management'
      ],
      shift: ['Shift A', 'Shift B'],
      orderType: ['Delivery', 'Takeout'],
      branch: ['Swefieh', 'Wadi Saqra', 'Swefieh Village'],
      restaurant: [
        'Very Good Burger',
        'Sager',
        'Happy Tummies',
        'Crunchychkn',
        'Bun Run',
        'Butter Me Up',
        'Bint Halal',
        'Colors Catering',
        'Heat Burger',
        "Evi's",
        'Chili Charms'
      ],
      channel: ['Web', 'Call Center'],
      issueCategory: [
        'Positive Experience',
        'Service Quality',
        'Food Quality',
        'Delivery/Prepared Time',
        'Employee Attitude',
        'Other'
      ],
      satisfaction: ['Satisfied', 'Not Satisfied']
    },
    complaints: {
      department: [
        'Kitchen',
        'Delivery/Prepared Delay',
        'Customer Service',
        'Frontline / Cashier',
        'IT',
        'Operations',
        'Management'
      ],
      shift: ['Shift A', 'Shift B'],
      orderType: ['Delivery', 'Takeout'],
      branch: ['Swefieh', 'Wadi Saqra', 'Swefieh Village'],
      restaurant: [
        'Very Good Burger',
        'Sager',
        'Happy Tummies',
        'Crunchychkn',
        'Bun Run',
        'Butter Me Up',
        'Bint Halal',
        'Colors Catering',
        'Heat Burger',
        "Evi's",
        'Chili Charms'
      ],
      channel: ['Circa', 'Talabat', 'Careem', 'Direct Order (From Store)'],
      issueCategory: [
        'Positive Experience',
        'Service Quality',
        'Food Quality',
        'Delivery/Prepared Time',
        'Employee Attitude',
        'Other'
      ]
    },
    'free-orders': {
      channel: ['Circa', 'Talabat', 'Careem', 'Direct Order (From Store)']
    }
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = TICKET_DOMAIN_CONFIG;
}
