// Submission Form section of a tender: after the business case is approved,
// the user uploads the customer-issued submission form and the system fills it
// from the approved business case as far as its fields allow.

import { useRef, useState } from 'react';
import { Download, FileUp, Loader2 } from 'lucide-react';
import { computeSummary } from '../lib/calc';
import { dateShort, money, ts } from '../lib/format';
import { can, useBc, useStore, useTender } from '../state/store';
import { TextCell } from '../components/common';
import { Banner, Button } from '../ui/ui';
import { useToast } from '../ui/toast';

interface FormField {
  label: string;
  value: string;
  manual?: boolean; // not derivable from the business case
}

export default function SubmissionPage() {
  const { state, dispatch } = useStore();
  const user = state.user!;
  const tender = useTender();
  const bc = useBc();
  const s = computeSummary(bc);
  const toast = useToast();
  const approved = bc.status === 'approved' || bc.status === 'submitted';

  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const canUpload = can.uploadTender(user.role); // Bidding Manager owns the submission

  const acceptForm = (file: File | undefined | null) => {
    if (!file || !canUpload || analyzing) return;
    setAnalyzing(true);
    window.setTimeout(() => {
      setAnalyzing(false);
      dispatch({ type: 'upload-submission-form', fileName: file.name });
    }, 1800);
  };

  const fields: FormField[] = [
    { label: 'Tender Reference', value: tender.ref },
    { label: 'Tender Title', value: tender.title },
    { label: 'Tenderer', value: 'Lenovo PCCW Solutions (LPS)' },
    { label: 'Contact Person', value: 'John Price, Bidding Manager' },
    { label: 'Project Title', value: bc.basicInfo.projectName },
    { label: 'Contract Period', value: `${dateShort(bc.basicInfo.projectStart)} – ${dateShort(bc.basicInfo.projectEnd)} (${s.durationMonths} months)` },
    { label: 'Total Contract Value (before GST)', value: money(s.total.tcv) },
    { label: 'Price Validity', value: '120 days from closing date' },
    { label: 'Solution Summary', value: bc.quoteLines.map((q) => q.solutionOffering).join('; ') },
    { label: 'Key Personnel', value: 'Project Manager (M3), Solution Architect (P5), Service Delivery Manager (M2)' },
    { label: 'Payment Milestones', value: `${bc.billing.length} milestones per attached billing plan` },
    { label: 'Compliance - Security Requirements (cl. 7)', value: 'Comply. Annual penetration test included; 24x7 SOC monitoring priced under Quote Line 3.' },
    { label: 'Compliance - Service Levels (cl. 9)', value: 'Comply. L2 support and Service Delivery Manager staffed for the full contract period.' },
    { label: 'Authorised Signatory & Designation', value: 'Requires manual input', manual: true },
    { label: 'Bank / Performance Guarantee Reference', value: 'Requires manual input', manual: true },
    { label: 'Company Stamp & Date', value: 'Requires manual input', manual: true },
  ];
  const overrides = tender.submissionOverrides ?? {};
  const effective = fields.map((f) => {
    const edited = overrides[f.label];
    return {
      label: f.label,
      value: edited ?? f.value,
      manual: f.manual === true && edited === undefined,
      edited: edited !== undefined,
    };
  });
  const filled = effective.filter((f) => !f.manual).length;

  // build the Word-compatible download
  const download = () => {
    const rows = effective
      .map((f) =>
        `<tr><td style="width:38%;background:#f0f0f0;padding:6px 10px;border:1px solid #999"><b>${f.label}</b></td><td style="padding:6px 10px;border:1px solid #999;${f.manual ? 'color:#9a6700;font-style:italic' : ''}">${f.value}</td></tr>`)
      .join('');
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Tender Submission Form</title></head>
<body style="font-family:Arial, sans-serif"><h2>Tender Submission Form - ${tender.ref}</h2>
<p>Generated from approved business case ${bc.basicInfo.crmId} on ${new Date().toLocaleDateString('en-SG')}.</p>
<table style="border-collapse:collapse;width:100%">${rows}</table>
<p style="color:#666;font-size:12px">Auto-populated by LPS TendrAI from the approved business case. Fields not derivable from the business case are left for manual completion.</p>
</body></html>`;
    const blob = new Blob([html], { type: 'application/msword' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `Tender_Submission_${tender.ref.replace(/\//g, '-')}.doc`;
    a.click();
    URL.revokeObjectURL(a.href);
    if (bc.status === 'approved') dispatch({ type: 'mark-submitted' });
  };

  if (!approved) {
    return (
      <Banner kind='locked'>
        The tender submission form unlocks after both sponsors approve the business case.
        Current status: <b>{bc.status === 'draft' ? 'Draft' : 'In review'}</b>.
        Both the Executive and Business Sponsors approve it in the Business Case section.
      </Banner>
    );
  }

  if (!tender.submissionFormName) {
    return (
      <div className="card">
        <h3>Upload the tender submission form</h3>
        <p className="sub">
          Upload the submission form issued with {tender.ref}. The system fills it in from the approved
          business case as far as its fields allow; anything it cannot derive is flagged for manual completion.
        </p>
        {analyzing ? (
          <div className="dropzone analyzing">
            <Loader2 size={16} aria-hidden className="spin-icon" /> Reading the form and matching fields to the
            approved business case…
          </div>
        ) : (
          <div
            className={`dropzone ${canUpload ? '' : 'disabled'} ${dragging ? 'dragging' : ''}`}
            onDragOver={(e) => { e.preventDefault(); if (canUpload) setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); acceptForm(e.dataTransfer.files?.[0]); }}
            onClick={() => canUpload && inputRef.current?.click()}
            onKeyDown={(e) => { if (canUpload && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); inputRef.current?.click(); } }}
            role="button"
            tabIndex={0}
            aria-label="Upload the tender submission form"
          >
            <input
              ref={inputRef}
              type="file"
              accept=".pdf,.doc,.docx"
              style={{ display: 'none' }}
              onChange={(e) => { acceptForm(e.target.files?.[0]); e.target.value = ''; }}
            />
            {canUpload ? (
              <>
                <b><FileUp size={16} aria-hidden style={{ verticalAlign: "-3px" }} /> Drop the submission form here</b> or click to browse (DOCX, PDF)
                <br />
                <span className="muted small">Business case {bc.basicInfo.crmId} approved by {bc.approvedBy} - ready to populate</span>
              </>
            ) : (
              <>
                Uploading the submission form is reserved for the Bidding Manager.
                <br />
                <span className="muted small">Sign in as John Price to upload the form.</span>
              </>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="card">
      <h3>
        Prefilled submission form - {tender.ref}
        <span className="fill-count">{filled} of {fields.length} fields auto-filled</span>
      </h3>
      <p className="sub">
        Source: {tender.submissionFormName}, uploaded {ts(tender.submissionFilledAt!)} · populated from
        approved business case {bc.basicInfo.crmId}
      </p>
      <table className="grid form-grid">
        <tbody>
          {effective.map((f) => (
            <tr key={f.label}>
              <td className="form-label">{f.label}</td>
              <td className={f.manual ? 'manual-field' : ''}>
                {canUpload ? (
                  <TextCell
                    value={f.value}
                    editable
                    onCommit={(v) => dispatch({ type: 'update-submission-field', label: f.label, value: v })}
                  />
                ) : (
                  f.value
                )}
                {f.edited && <span className="muted small"> (edited)</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {canUpload && (
        <p className="sub">Drafted values can be edited before export - select a value to change it.</p>
      )}
      <div className="form-actions">
        <Button variant='primary' icon={Download} onClick={() => { download(); toast.push('success', 'Submission form downloaded', 'Prefilled DOCX saved; fields needing manual input are marked.'); }}>Download prefilled form (DOCX)</Button>
      </div>
    </div>
  );
}
