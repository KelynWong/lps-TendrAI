// Dropdown lists lifted from the template's Parameter tab
// (business case formula mapping: named ranges SO, GTM, Project_Type,
//  Cost_Cat, YN, Role, Grade and the Basic Info currency table).

export const GTM_UNITS = ['Comm', 'Enterprise', 'FS', 'MC', 'Public HK', 'SEA', 'T&T'] as const;

/** Dependent list: sub-teams selectable under each GTM Unit (INDIRECT lookup) */
export const GTM_SUBTEAMS: Record<string, string[]> = {
  Comm: ['Business Support', 'Digital Transformation', 'CMT SEA'],
  Enterprise: ['HK Enterprise', 'Macau'],
  FS: ['FS'],
  MC: ['MC', 'Lenovo Account'],
  'Public HK': ['Public HK'],
  SEA: ['Enterprise SEA', 'Insys', 'Public SEA', 'T&T SEA'],
  'T&T': ['T&T'],
};

export const PROJECT_TYPES = ['Milestone Based', 'Time Based', 'Usage Based'] as const;

export const SOLUTION_OFFERINGS = [
  'AI Enablement',
  'Application Maintenance Services',
  'ATFM - Agency Tenant Facility Management (SEA)',
  'BSS & OSS Transformation Services',
  'Building Intelligent Systems',
  'Business & Commercial Applications',
  'Cloud Managed Services',
  'Cloud Migration',
  'Communications',
  'Contact Center Solutions',
  'Custom Application Development',
  'Cyber Security Assessment',
  'Data Mining, Analytics & BI Applications',
  'Data Services',
  'Digital Workplace Solutions',
  'ELV',
  'eMPF',
  'ERP',
  'Generative AI',
  'Infrastructure & Network Services',
  'Infrastructure Maintenance Services',
  'Infrastructure Managed Services',
  'Internal Project',
  'Internet of Things',
  'MC - BFSI',
  'MC - Custom Solutions',
  'MC - Digital Solutions',
  'MC - Finance Solutions',
  'MC - HRMS',
  'MC - Management Solutions',
  'Outsourcing Services',
  'Robotics',
  'Salesforce Marketing Cloud',
  'Salesforce Service Cloud',
  'Security Operations (SOC)',
  'Security Solution Implementation',
  'Specialized AV Systems',
  'Sustainability',
  'Technical Service Outsourcing',
  'Video Analytics',
];

/** Currency table (code, name, planning rate to 1 USD) */
export const CURRENCIES: [string, string, number][] = [
  ['AUD', 'Australian Dollar', 1.6023],
  ['CNY', 'CNY', 7.257],
  ['EUR', 'Euro', 0.9246],
  ['HKD', 'Hong Kong Dollar', 7.7799],
  ['MOP', 'Macau Pataca', 8.0133],
  ['TWD', 'New Taiwan Dollar', 33.245],
  ['PHP', 'Philippine Piso', 57.249],
  ['GBP', 'Pound Sterling', 0.7736],
  ['MYR', 'Ringgit Malaysia', 4.4353],
  ['SGD', 'Singapore Dollar', 1.3428],
  ['USD', 'US Dollar', 1.0],
];

export const ROLES = [
  'Analyst Programmer', 'Assistant Business Analyst', 'Assistant Data Engineer',
  'Assistant Database Administrator', 'Assistant Solution Analyst', 'Assistant Technology Analyst',
  'Business Analyst', 'Business Consultant', 'Data Architect', 'Data Engineer',
  'Database Administrator', 'Helpdesk Officer', 'Network Architect', 'Network Engineer',
  'Network Officer', 'Operation Director', 'Operation Manager', 'Operation Officer',
  'Programmer', 'Project Director', 'Project Manager', 'Project Officer',
  'QA Manager', 'QA Officer', 'Quality Consultant', 'Quality Manager', 'Quality Officer',
  'Safety Consultant', 'Safety Manager', 'Safety Officer', 'Security Analyst',
  'Security Officer', 'Security Specialist', 'Software Architect', 'Software Developer',
  'Software Engineer', 'Solution Analyst', 'Solution Consultant', 'System Administrator',
  'System Analyst', 'System Architect', 'System Engineer', 'System Officer',
  'Team Member', 'Technical Director', 'Technical Engineer', 'Technical Manager',
  'Technical Officer', 'Technology Analyst', 'Technology Consultant',
];

export const GRADES = ['3', '4', '5', '6', '7', '8', '9', '10'];

/** Default day rate (iRate) per Lenovo band/grade, SEA rate card.
 *  The rate depends on grade only, never on the role. */
export const GRADE_RATES: Record<string, number> = {
  '3': 210,
  '4': 261,
  '5': 309,
  '6': 447,
  '7': 526,
  '8': 631,
  '9': 1892,
  '10': 3978,
};

export const TEAMS = [
  'Insys - Cloud - SG',
  'Insys - Non-cloud - SG',
  'MC ODC - GZ',
  'MC ODC - SZ',
  'MY ODC - AD - MY',
  'MY ODC - MS - MY',
  'PH ODC - AD - PH',
  'PH ODC - MS - PH',
];

/** Current value first so legacy/fixture values stay selectable */
export function withCurrent(current: string, options: readonly string[]): string[] {
  return [...new Set([current, ...options])].filter(Boolean);
}

/** Company default exchange rates (to 1 USD), managed on the Business case
 *  management page; they start at the planning rates and every new AI draft
 *  copies them as its applied rates. */
export const DEFAULT_FX_RATES: Record<string, number> = Object.fromEntries(CURRENCIES.map(([code, , planning]) => [code, planning]));
