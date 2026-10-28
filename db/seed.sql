-- =============================================================================
-- TendrAI — reference data seed (idempotent)
--   * Final Check rules shipped with the system (frontend DEFAULT_RULES)
--   * MSPO mapping defaults (frontend DEFAULT_MSPO_MAPPING)
--   * Boilerplate tag list
--   * Demo users (matching frontend/src/config.ts) — remove for production;
--     real users are created on first Cognito sign-in.
-- =============================================================================

BEGIN;

-- ----- Final Check rules -----------------------------------------------------

INSERT INTO final_check_rules (id, name, description, severity, enabled, kind, definition, sort_order, is_builtin) VALUES
('billing-equals-ccb', 'Billing plan equals CCB',
 'The sum of the billing plan must equal the contract value (CCB/TCV) stated on the Summary tab.',
 'error', true, 'compare',
 '{"left":{"tab":"Basic Info","ref":"C31:C42"},"right":{"tab":"Summary","ref":"B6"},"tolerance":1}', 10, true),
('product-total-reconciles', 'Product Plan reconciles with Summary',
 'The Product Plan line totals must add up to the product cost stated on the Summary tab.',
 'error', true, 'compare',
 '{"left":{"tab":"Product Plan","ref":"G6:G25"},"right":{"tab":"Summary","ref":"B16:B20"},"tolerance":1}', 20, true),
('labour-total-reconciles', 'Resource Plan reconciles with Summary',
 'The Resource Plan line totals must add up to the internal labour cost stated on the Summary tab.',
 'error', true, 'compare',
 '{"left":{"tab":"Resource Plan","ref":"G8:G27"},"right":{"tab":"Summary","ref":"B15"},"tolerance":1}', 30, true),
('line-totals-consistent', 'Line totals equal unit x quantity',
 'Every Product Plan line total must equal unit price x quantity; every labour line total must equal man-days x day rate.',
 'error', true, 'builtin',
 '{"builtin":"line-totals-consistent","tabs":["Product Plan","Resource Plan"],"tolerance":1}', 40, true),
('irate-resolvable', 'Every labour line has a day rate',
 'Each labour line must carry a resolvable iRate (day rate above zero) for its team and grade.',
 'error', true, 'every-line',
 '{"target":{"tab":"Labour Inputs","ref":"F8:F27"},"op":">","value":0}', 50, true),
('quote-line-assigned', 'Every line belongs to a defined quote line',
 'Product and labour lines must be assigned to quote line 1-3 as defined on Basic Info.',
 'warning', true, 'builtin',
 '{"builtin":"quote-line-assigned","tabs":["Basic Info","Product Plan","Resource Plan"]}', 60, true),
('billing-within-duration', 'Billing dates fall within the project duration',
 'No billing milestone may fall outside project start plus the contract duration.',
 'warning', true, 'builtin',
 '{"builtin":"billing-within-duration","tabs":["Basic Info","Cash Flow"]}', 70, true),
('mandays-nonzero', 'No zero-effort labour lines',
 'A labour line with zero man-days is usually a leftover row and should be removed.',
 'warning', true, 'every-line',
 '{"target":{"tab":"Resource Plan","ref":"F8:F27"},"op":">","value":0}', 80, true),
('margin-range', 'Margin within guardrails',
 'Stated margin should be between 10% and 45%; outside that range the DRB expects an explanation.',
 'warning', true, 'range',
 '{"target":{"tab":"Summary","ref":"C22"},"min":10,"max":45}', 90, true),
('has-billing-plan', 'Billing plan is present',
 'At least one billing milestone must exist.',
 'error', true, 'builtin',
 '{"builtin":"billing-present","tabs":["Basic Info"]}', 100, true)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name, description = EXCLUDED.description, kind = EXCLUDED.kind,
  definition = EXCLUDED.definition, sort_order = EXCLUDED.sort_order, is_builtin = true;

-- ----- MSPO mapping defaults ------------------------------------------------

DELETE FROM mspo_mapping_defaults;

-- Product plan ("Sub Grid For Quote Line")
INSERT INTO mspo_mapping_defaults ("group", position, target, source, tab, from_cell, span, note, dropdown) VALUES
('product', 1,  'Quote Line (Quote Line) (Quote Line)', 'mspo', NULL, NULL, NULL, 'Keyed in once per tender - the same quote line for all three plans', NULL),
('product', 2,  'Category', 'workbook', 'Product Plan', 'C6', 'rows', NULL, 'category'),
('product', 3,  'Sub-Category', 'manual', NULL, NULL, NULL, 'Dropdown in the downloaded file, filtered by Category', 'subcategory'),
('product', 4,  'Delivery Date', 'manual', NULL, NULL, NULL, NULL, NULL),
('product', 5,  'Margin(%)', 'workbook', 'Summary', 'C22', 'single', NULL, NULL),
('product', 6,  'Commodity/Service descriptions', 'workbook', 'Product Plan', 'D6', 'rows', NULL, NULL),
('product', 7,  'Unit Price', 'workbook', 'Product Plan', 'F6', 'rows', NULL, NULL),
('product', 8,  'Quantity', 'workbook', 'Product Plan', 'H6', 'rows-cols', 'One MSPO row per fiscal year for each business case line', NULL),
('product', 9,  'Vendor Commitment', 'workbook', 'Product Plan', 'E6', 'rows', NULL, NULL),
('product', 10, 'Vendor Quotation', 'mspo', NULL, NULL, NULL, 'Created in MSPO - key in after download', NULL),
('product', 11, 'UoM', 'manual', NULL, NULL, NULL, NULL, NULL);

-- Resource plan ("Resource Plans For Quoteline")
INSERT INTO mspo_mapping_defaults ("group", position, target, source, tab, from_cell, span, note, dropdown) VALUES
('resource', 1, 'Quote Line Number (Quote Line) (Quote Line)', 'mspo', NULL, NULL, NULL, 'Keyed in once per tender - the same quote line for all three plans', NULL),
('resource', 2, 'IT Code (Resource) (Bookable Resource)', 'mspo', NULL, NULL, NULL, 'Created in MSPO - key in after download', NULL),
('resource', 3, 'Role', 'workbook', 'Resource Plan', 'D8', 'rows', NULL, NULL),
('resource', 4, 'Skill', 'workbook', 'Resource Plan', 'H8', 'rows', NULL, NULL),
('resource', 5, 'Position Name', 'workbook', 'Resource Plan', 'H8', 'rows', 'Skill numbered per row within each fiscal year, e.g. Onsite Desktop L1 -1, -2', NULL),
('resource', 6, 'Grade', 'workbook', 'Resource Plan', 'E8', 'rows', NULL, NULL),
('resource', 7, 'Team Code (Team) (Solution Offering Team)', 'mspo', NULL, NULL, NULL, 'Created in MSPO - key in after download', NULL),
('resource', 8, 'Margin(%)', 'workbook', 'Summary', 'C22', 'single', NULL, NULL),
('resource', 9, 'Fiscal Year', 'workbook', 'Resource Plan', 'I6', 'cols', 'Business case 26/27 is written as FY26. Rows per line and year = man-days (I8 onward) / (man-days per month x months the project runs in that year)', NULL);
INSERT INTO mspo_mapping_defaults ("group", position, target, source, note)
SELECT 'resource', 9 + ord, m, 'calculated', 'Man-days per month in the months the project runs; blank outside the project period'
FROM unnest(ARRAY['Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar']) WITH ORDINALITY AS t(m, ord);

-- Billing plan ("Billing Plans For Quoteline")
INSERT INTO mspo_mapping_defaults ("group", position, target, source, tab, from_cell, span, note) VALUES
('billing', 1, 'Quote Line Number (Quote Line) (Quote Line)', 'mspo', NULL, NULL, NULL, 'Keyed in once per tender - the same quote line for all three plans'),
('billing', 2, 'Billing Plan Name', 'workbook', 'Basic Info', 'B31', 'rows', NULL),
('billing', 3, 'Target Billing Date', 'workbook', 'Basic Info', 'A31', 'rows', NULL),
('billing', 4, 'Billing Amount (Before Tax)', 'workbook', 'Basic Info', 'C31', 'rows', NULL),
('billing', 5, 'Remark', 'workbook', 'Basic Info', 'D31', 'rows', NULL);

-- Headline figures keyed into MSPO
INSERT INTO mspo_mapping_defaults ("group", position, target, source, tab, from_cell, span) VALUES
('figures', 1, 'TCV', 'workbook', 'Summary', 'B6', 'single'),
('figures', 2, 'Indirect cost', 'workbook', 'Summary', 'B24', 'single'),
('figures', 3, 'Direct cost', 'workbook', 'Summary', 'B14', 'single'),
('figures', 4, 'EBITDA', 'workbook', 'Summary', 'B50', 'single'),
('figures', 5, 'EBITDA (%)', 'workbook', 'Summary', 'C50', 'single');

-- ----- Boilerplate tags -------------------------------------------------------

INSERT INTO tags (name)
SELECT unnest(ARRAY[
  'Company profile', 'History', 'Capabilities', 'Corporate', 'UEN', 'GST', 'Legal entity', 'Financial standing',
  'Organisation', 'Governance', 'Escalation', 'Key personnel', 'Track record', 'Case study', 'References',
  'Testimonials', 'Public sector', 'Contact centre', 'Commercial', 'Warranty', 'Maintenance', 'SLA', 'Policy',
  'BCP', 'Disaster recovery', 'Quality', 'Security', 'Cybersecurity', 'PDPA', 'Data protection', 'Privacy',
  'Legal', 'Insurance', 'Health and safety', 'Sustainability', 'Methodology', 'Project management',
  'Service management', 'Training', 'Transition', 'Risk management', 'Cloud'
])
ON CONFLICT (name) DO NOTHING;

-- ----- Demo users (development only) -----------------------------------------

INSERT INTO users (email, name, role, role_label) VALUES
('felicia.phan@lpstech.com', 'Felicia Phan',   'bd',              'Business Development'),
('john.price@lpstech.com',   'John Price',     'bidding-manager', 'Bidding Manager'),
('chee.wee@lpstech.com',     'Chee Wee',       'presales',        'Presales'),
('priya.nair@lpstech.com',   'Priya Nair',     'delivery',        'Delivery'),
('ruey.lin@lpstech.com',     'Ruey Lin',       'finance',         'Finance'),
('ecpuay@lpstech.com',       'Eng Chuan Puay', 'drb',             'Head of South East Asia'),
('thomas.low@lpstech.com',   'Thomas Low',     'drb',             'Head of Singapore Delivery & CEO, LPS'),
('ethan.lim@lpstech.com',    'Ethan Lim',      'drb',             'Senior Manager Financial P&A'),
('kelyn.wong@lpstech.com',   'Kelyn Wong',     'admin',           'Administrator')
ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role, role_label = EXCLUDED.role_label;

COMMIT;
