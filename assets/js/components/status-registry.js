(function (global) {
  'use strict';

  const TONES = new Set(['neutral', 'info', 'success', 'warning', 'danger']);
  const entry = (label, tone, extra) => Object.freeze({ label, tone, ...(extra || {}) });
  const map = (values) => Object.freeze(values);

  const operationalCompatibility = {
    Open: entry('Open', 'info', { compatibility: true }),
    'Follow-Up Needed': entry('Follow-Up Needed', 'warning', { compatibility: true }),
    'No Response': entry('No Response', 'warning', { compatibility: true }),
    'Call Back Scheduled': entry('Call Back Scheduled', 'info', { compatibility: true }),
    'In Progress': entry('In Progress', 'info', { compatibility: true }),
    Resolved: entry('Resolved', 'success', { compatibility: true }),
    'Perfect Feedback': entry('Perfect Feedback', 'success', { compatibility: true })
  };

  const operations = (values) => map({ ...operationalCompatibility, ...values });
  const registry = Object.freeze({
    'operations-cctv': operations({
      Closed: entry('Closed', 'success'),
      'Under Review': entry('Under Review', 'danger'),
      Escalated: entry('Escalated', 'info')
    }),
    'operations-customer-experience': operations({
      Closed: entry('Closed', 'success'),
      'Under Review': entry('Under Review', 'danger'),
      Escalated: entry('Escalated', 'info'),
      'Pending (Customer Call Required)': entry('Pending (Call Back)', 'warning')
    }),
    'operations-complaints': operations({
      Closed: entry('Closed', 'success'),
      'Under Review': entry('Under Review', 'danger'),
      Escalated: entry('Escalated', 'info'),
      'Pending (Customer Call Required)': entry('Pending (Call Back)', 'warning')
    }),
    'complimentary-orders': operations({
      New: entry('New', 'danger'),
      Active: entry('Active', 'info'),
      Taken: entry('Taken', 'success')
    }),
    attendance: map({
      'On Time': entry('On Time', 'success'),
      'Left Early': entry('Left Early', 'warning'),
      'Late Logout': entry('Late Logout', 'danger')
    }),
    'training-assignment': map({
      Assigned: entry('Assigned', 'info'),
      Unassigned: entry('Unassigned', 'neutral')
    }),
    'training-outcome': map({
      Trained: entry('Trained', 'success'),
      'Not Trained': entry('Not Trained', 'warning'),
      'Coaching Needed': entry('Coaching Needed', 'danger'),
      'No training or assignment needed': entry('No training or assignment needed', 'neutral')
    }),
    employee: map({
      active: entry('Active', 'success'),
      inactive: entry('Archived', 'neutral')
    }),
    client: map({
      active: entry('Active', 'success'),
      inactive: entry('Inactive', 'neutral')
    }),
    'free-order-requests': map({
      pending_details: entry('Pending Details', 'warning'),
      ready_to_share: entry('Ready to Share', 'info'),
      needs_response: entry('Needs Response', 'danger'),
      done: entry('Done', 'success')
    }),
    'free-order-share': map({
      received: entry('Received', 'info'),
      needs_response: entry('Needs Response', 'danger'),
      done: entry('Done', 'success')
    }),
    'admin-user': map({
      active: entry('Active', 'success'),
      disabled: entry('Disabled', 'danger')
    }),
    'call-queue': map({
      'Need Call': entry('Need Call', 'info'),
      'In Call': entry('In Call', 'warning'),
      Called: entry('Called', 'success'),
      Pending: entry('Pending', 'warning'),
      Done: entry('Done', 'success')
    })
  });

  function get(domain, rawValue) {
    const metadata = registry[domain]?.[rawValue];
    if (metadata) return Object.freeze({ rawValue, label: metadata.label, tone: metadata.tone, known: true, ...(metadata.compatibility ? { compatibility: true } : {}) });
    const missing = rawValue === undefined || rawValue === null || rawValue === '';
    return Object.freeze({ rawValue, label: missing ? 'Unknown' : String(rawValue), tone: 'neutral', known: false });
  }

  function getToneClass(domain, rawValue) {
    const tone = get(domain, rawValue).tone;
    return `cc-status--${TONES.has(tone) ? tone : 'neutral'}`;
  }

  global.CloudCrowdStatusRegistry = Object.freeze({
    domains: Object.freeze(Object.keys(registry)),
    get,
    getToneClass
  });
})(typeof window !== 'undefined' ? window : globalThis);
