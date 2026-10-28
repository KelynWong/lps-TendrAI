// Template matching — port of SubmissionSection.runSearch / wantedType and
// QualSection.suggestCert in frontend/src/components/rfp.tsx.
import type { LibraryItem, TemplateMatch, TemplateType } from '../types.js';

/** Which template type fits a submission document, by its wording. */
export function wantedTemplateType(itemText: string): TemplateType | null {
  const text = itemText.toLowerCase();
  return text.includes('compliance') ? 'Compliance table'
    : /cover|form of tender|declaration|acknowledgement|nda/.test(text) ? 'Cover letter'
      : /acra|profile|company|financial/.test(text) ? 'Company profile'
        : /cv|personnel|track record|reference/.test(text) ? 'Form'
          : null;
}

export function matchTemplates(tender: { agency: string; type: 'Agency' | 'Commercial' }, templates: LibraryItem[]) {
  const agencyTemplates = templates.filter((tpl) => tpl.agency !== 'Generic' && tpl.agency.toLowerCase() === tender.agency.toLowerCase());
  const matches: TemplateMatch[] = agencyTemplates.map((tpl) => ({ templateId: tpl.id, reason: `Agency name matches ${tpl.agency}` }));
  const haveTypes = new Set(agencyTemplates.map((x) => x.type));
  for (const tpl of templates.filter((x) => x.agency === 'Generic')) {
    if (!haveTypes.has(tpl.type)) {
      matches.push({
        templateId: tpl.id,
        reason: tender.type === 'Commercial'
          ? 'Type: Commercial - no agency template applies, generic offered'
          : `Type: Agency, but ${tender.agency || 'this agency'} has no ${tpl.type.toLowerCase()} template - generic offered`,
      });
    }
  }
  return { matches, genericFallback: agencyTemplates.length === 0 };
}

/** Proposed template per checklist item (first match of the wanted type). */
export function proposeTemplate(itemText: string, matches: TemplateMatch[], templates: LibraryItem[]): string | undefined {
  const want = wantedTemplateType(itemText);
  if (!want) return undefined;
  return matches.find((m) => templates.find((tpl) => tpl.id === m.templateId)?.type === want)?.templateId;
}

/** Library certificate whose name appears in the requirement wording. */
export function suggestCertificate(requirement: string, certs: LibraryItem[]): LibraryItem | undefined {
  const text = requirement.toLowerCase();
  return certs.find((c) => text.includes(c.name.toLowerCase().replace(/ certificate$/, '')));
}

/** "3.1" -> "3.2", "2026" -> "2027", "v2" -> "v3". */
export function bumpVersion(v: string): string {
  const m = /^(.*?)(\d+)(\D*)$/.exec(v.trim());
  return m ? `${m[1]}${Number(m[2]) + 1}${m[3]}` : `${v}.1`;
}
