// Pre-built "AI extraction" results used when the user processes a tender that
// has no results yet. Purely a demo device: the live system produces these from
// the actual documents.

import type { ChecklistItem, Clause, Qualification, Tender } from '../types';
import { daysFromNow } from './mock';

export interface ExtractedTenderData {
  checklist: ChecklistItem[];
  quals: Qualification[];
  clauses: Clause[];
}

function sourceFor(tender: Tender, role: string, fallback: string): string {
  return tender.pack.find((doc) => doc.role === role && doc.status !== 'Failed')?.name
    ?? tender.pack.find((doc) => doc.status !== 'Failed')?.name
    ?? tender.pack[0]?.name
    ?? fallback;
}

export function buildDemoExtraction(tender: Tender): ExtractedTenderData {
  const general = sourceFor(tender, 'General Requirements', 'General Requirements.pdf');
  const technical = sourceFor(tender, 'Technical Specification', general);
  const commercial = sourceFor(tender, 'Commercial Conditions', general);
  const legal = sourceFor(tender, 'Legal Conditions', general);
  const close = tender.closingDate || daysFromNow(30);

  const checklist: ChecklistItem[] = [
    { id: `${tender.id}-k1`, item: 'Signed Form of Tender', format: 'PDF, signed by authorised representative', deadline: close, sourceDoc: general, clause: '2.1', owner: tender.owner, status: 'Not started' },
    { id: `${tender.id}-k2`, item: 'Non-Disclosure Agreement', format: 'PDF, signed', deadline: close, sourceDoc: legal, clause: '2.3(a)', owner: tender.owner, status: 'Not started' },
    { id: `${tender.id}-k3`, item: 'Technical compliance response', format: 'Excel compliance matrix', deadline: close, sourceDoc: technical, clause: '4.1', owner: 'Chee Wee', status: 'Not started' },
    { id: `${tender.id}-k4`, item: 'Pricing schedule', format: 'Excel, completed template', deadline: close, sourceDoc: commercial, clause: '5.2', owner: 'Felicia Phan', status: 'Not started' },
    { id: `${tender.id}-k5`, item: 'Company ACRA business profile', format: 'PDF, issued within 3 months', deadline: close, sourceDoc: general, clause: '2.2', status: 'Not started' },
    { id: `${tender.id}-k6`, item: 'Key personnel CVs', format: 'PDF, prescribed template', deadline: close, sourceDoc: general, clause: '5.4', owner: 'Priya Nair', status: 'Not started' },
    { id: `${tender.id}-k7`, item: 'Track record references', format: 'Prescribed template', deadline: close, sourceDoc: general, clause: '5.1', status: 'Not started' },
    { id: `${tender.id}-k8`, item: 'Clarification acknowledgement', format: 'PDF or portal submission', deadline: close, sourceDoc: general, clause: '3.6', owner: tender.owner, status: 'Not started' },
  ];

  const quals: Qualification[] = [
    { id: `${tender.id}-q1`, kind: 'Experience', requirement: 'At least two comparable implementations completed in the last five years', sourceDoc: general, clause: '6.1', evidence: 'bp2' },
    { id: `${tender.id}-q2`, kind: 'Role', requirement: 'Project manager with at least eight years of relevant delivery experience', sourceDoc: general, clause: '6.2', evidence: 'cv1' },
    { id: `${tender.id}-q3`, kind: 'Certification', requirement: 'Lead security engineer certified to CISSP or equivalent', sourceDoc: technical, clause: '6.3', evidence: 'cv4' },
    { id: `${tender.id}-q4`, kind: 'Past project', requirement: 'Reference project supporting a minimum of 300 concurrent users', sourceDoc: technical, clause: '6.4' },
    { id: `${tender.id}-q5`, kind: 'Certification', requirement: 'Company ISO 27001 certification', sourceDoc: general, clause: '6.5', evidence: 'bp3' },
    { id: `${tender.id}-q6`, kind: 'Role', requirement: 'Service manager with ITIL 4 and operations experience', sourceDoc: general, clause: '6.6', evidence: 'cv5' },
  ];

  const clause = (
    number: string,
    text: string,
    category: Clause['category'],
    sourceDoc: string,
    page: number,
  ): Clause => ({
    id: `${tender.id}-c-${number.replace(/[^a-z0-9]/gi, '')}`,
    number,
    text,
    category,
    subTags: [],
    sourceDoc,
    page,
    compliance: 'Unset',
    response: '',
  });

  const clauses: Clause[] = [
    clause('2.1', 'Tenderers shall submit all mandatory forms in the formats prescribed in the tender pack.', 'Commercial', general, 6),
    clause('2.3(a)', 'A signed Non-Disclosure Agreement shall accompany the tender submission.', 'Legal', legal, 7),
    clause('3.2', 'The proposed solution shall meet the functional requirements and provide a clear implementation approach.', 'Technical', technical, 9),
    clause('3.4', 'The solution shall support secure access controls, audit logging and role-based administration.', 'Technical', technical, 11),
    clause('4.1', 'The supplier shall provide service support during business hours with escalation for severity-one incidents.', 'Commercial', commercial, 4),
    clause('5.2', 'Prices shall remain valid for the stated validity period and include all implementation costs.', 'Finance', commercial, 7),
    clause('5.4', 'Key personnel shall hold the certifications prescribed by the Authority.', 'HR', general, 8),
    clause('6.1', 'All personnel assigned to the engagement shall comply with the Authority security policies.', 'Legal', legal, 5),
    clause('6.2', 'The project manager shall hold a recognised project management certification.', 'HR', general, 9),
    clause('7.1', 'The supplier shall protect confidential information and return or securely destroy it at contract end.', 'Legal', legal, 8),
    clause('8.1', 'Payment shall be made within thirty (30) days of a correctly rendered invoice.', 'Finance', commercial, 9),
    clause('9.2', 'System availability shall be no less than 99.5% measured monthly.', 'Technical', technical, 14),
  ];

  return { checklist, quals, clauses };
}
