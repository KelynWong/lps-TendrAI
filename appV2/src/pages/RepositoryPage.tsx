// Historical data: every tender, proposal, business case and BOM with stored
// documents and version history, archive (simulated compression) and a
// realistic restore flow - archived items stay searchable, but opening their
// files needs a restore, which is not instant. Restored records can be
// archived again.

import { Fragment, useEffect, useState } from 'react';
import { Archive, ArchiveRestore, ChevronDown, ChevronRight, Clock, Download, FileText } from 'lucide-react';
import * as XLSX from 'xlsx';
import { canDo } from '../config';
import { dateShort, ts } from '../lib/format';
import { useStore } from '../state/store';
import { Pager, SortTh, StatusPill, usePagedTable, useColFilters, useSort } from '../components/common';
import { Button, ConfirmDialog, IconButton } from '../ui/ui';
import { useToast } from '../ui/toast';
import type { RepoRecord } from '../types';

/** Simulated restore duration. The real restore from archive storage takes up
 *  to several hours - the UI promises a range, never an exact time. */
const DEMO_RESTORE_MS = 10000;

export default function RepositoryPage() {
  const { state, dispatch } = useStore();
  const toast = useToast();
  const editable = canDo.manageRepo(state.role);
  const { sort, toggle, apply } = useSort();
  const cf = useColFilters();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [toArchive, setToArchive] = useState<RepoRecord | null>(null);
  const [toRestore, setToRestore] = useState<RepoRecord | null>(null);

  // complete pending restores after a delay (demo device)
  const pending = state.repository.filter((r) => r.restore?.state === 'requested').map((r) => r.id).join(',');
  useEffect(() => {
    if (!pending) return;
    const ids = pending.split(',');
    const timer = window.setTimeout(() => {
      ids.forEach((id) => dispatch({ type: 'complete-restore', id }));
      const names = state.repository.filter((r) => ids.includes(r.id)).map((r) => r.name);
      toast.push('success', 'Restore complete', `${names.join(', ')}: files are available to open and download.`);
    }, DEMO_RESTORE_MS);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);

  const colAcc = {
    name: (r: RepoRecord) => r.name,
    agency: (r: RepoRecord) => r.agency,
    type: (r: RepoRecord) => r.type,
    status: (r: RepoRecord) => r.status,
    statusReason: (r: RepoRecord) => r.statusReason,
    created: (r: RepoRecord) => r.created,
    updated: (r: RepoRecord) => r.updated,
  };
  const rows = cf.apply(state.repository, colAcc);
  const sorted = apply(rows, colAcc);
  const pager = usePagedTable(sorted);
  const fcol = (k: keyof typeof colAcc) => ({
    filterValues: state.repository.map((r) => String(colAcc[k](r))),
    filter: cf.filters[k],
    onFilter: (f: Parameters<typeof cf.set>[1]) => cf.set(k, f),
  });

  const filesLocked = (r: RepoRecord) => r.status === 'Archived' && r.restore?.state !== 'available';
  const lockTitle = 'Archived: request a restore first - archived files cannot be opened directly';

  const downloadFile = (r: RepoRecord, name: string) => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      [`${r.name} - ${name}`],
      ['Demo file generated from mock data; the live system serves the stored original.'],
    ]), 'Info');
    XLSX.writeFile(wb, `${name.replace(/\.[^.]+$/, '').replace(/\W+/g, '_')}.xlsx`);
    dispatch({ type: 'log', event: { action: 'File downloaded', detail: `${r.name} - ${name}`, section: 'Historical data' } });
  };

  const archiveSizes = (r: RepoRecord) => {
    const from = 16 + ((r.name.length * 7) % 140);
    return { from: `${from} MB`, to: `${Math.max(3, Math.round(from * 0.24))} MB` };
  };

  return (
    <div className="fill-page">
      <div className="table-viewport">
        <table className="grid">
          <thead>
            <tr>
              <th aria-label="Expand" />
              <SortTh label="Name" k="name" sort={sort} onToggle={toggle} {...fcol('name')} />
              <SortTh label="Customer / agency" k="agency" sort={sort} onToggle={toggle} {...fcol('agency')} />
              <SortTh label="Type" k="type" sort={sort} onToggle={toggle} {...fcol('type')} />
              <SortTh label="Status" k="status" sort={sort} onToggle={toggle} {...fcol('status')} />
              <SortTh label="Status reason" k="statusReason" sort={sort} onToggle={toggle} {...fcol('statusReason')} />
              <SortTh label="Created at" k="created" sort={sort} onToggle={toggle} />
              <SortTh label="Last updated" k="updated" sort={sort} onToggle={toggle} />
              <th aria-label="Archive actions" />
            </tr>
          </thead>
          <tbody>
            {pager.slice.map((r) => {
              const open = expanded === r.id;
              const locked = filesLocked(r);
              return (
                <Fragment key={r.id}>
                  <tr>
                    <td className="expand-cell">
                      <button className="expand-btn" aria-expanded={open} aria-label={open ? 'Hide documents and versions' : 'Show documents and versions'} onClick={() => setExpanded(open ? null : r.id)}>
                        {open ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
                      </button>
                    </td>
                    <td>
                      <b>{r.name}</b>
                      {r.archived && (
                        <div className="muted small">
                          Archived {dateShort(r.archived.at)} · compressed {r.archived.sizeFrom} to {r.archived.sizeTo}
                          {r.restore?.state === 'available' && <> · files restored, available to open</>}
                        </div>
                      )}
                    </td>
                    <td>{r.agency}</td>
                    <td><span className="badge badge-sector">{r.type}</span></td>
                    <td><StatusPill value={r.status} /></td>
                    <td>
                      <StatusPill value={r.statusReason} />
                      {r.restore?.state === 'requested' && (
                        <div className="attn" title={`Requested ${ts(r.restore.requestedAt)}`}>
                          <Clock size={12} aria-hidden /> Restore requested
                        </div>
                      )}
                    </td>
                    <td className="muted" style={{ whiteSpace: 'nowrap' }}>{dateShort(r.created)}</td>
                    <td className="muted" style={{ whiteSpace: 'nowrap' }}>{dateShort(r.updated)}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {r.status === 'Archived' ? (
                        r.restore?.state === 'requested' ? (
                          <span className="muted small">Restoring - typically minutes to hours (seconds in this demo)</span>
                        ) : r.restore?.state === 'available' ? (
                          <Button
                            compact icon={Archive}
                            disabled={!editable}
                            title={editable ? 'Return the restored files to archive storage' : 'Only the BD team manages the repository'}
                            onClick={() => setToArchive(r)}
                          >
                            Archive again
                          </Button>
                        ) : (
                          <Button
                            compact icon={ArchiveRestore}
                            disabled={!editable}
                            title={editable ? 'Request a restore so the stored files can be opened' : 'Only the BD team manages the repository'}
                            onClick={() => setToRestore(r)}
                          >
                            Restore files
                          </Button>
                        )
                      ) : (r.status === 'Closed' || r.status === 'Won' || r.status === 'Lost') ? (
                        <Button
                          compact icon={Archive}
                          disabled={!editable}
                          title={editable ? 'Compress and move to archive storage' : 'Only the BD team manages the repository'}
                          onClick={() => setToArchive(r)}
                        >
                          Archive
                        </Button>
                      ) : <span className="muted small">Open</span>}
                    </td>
                  </tr>
                  {open && (
                    <tr className="expand-row">
                      <td />
                      <td colSpan={8}>
                        <div className="two-col">
                          <div>
                            <div className="muted small" style={{ margin: '4px 0' }}>Stored documents:</div>
                            <table className="grid">
                              <tbody>
                                {r.documents.map((name) => (
                                  <tr key={name}>
                                    <td><FileText size={13} aria-hidden style={{ verticalAlign: '-2px' }} /> {name}</td>
                                    <td className="table-actions" style={{ width: 48 }}>
                                      <IconButton label={locked ? lockTitle : `Download ${name}`} icon={Download} disabled={locked} onClick={() => downloadFile(r, name)} />
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          <div>
                            <div className="muted small" style={{ margin: '4px 0' }}>
                              Business case version history (latest first):
                            </div>
                            <table className="grid">
                              <tbody>
                                {[...r.versions].reverse().map((v, i) => (
                                  <tr key={v.v}>
                                    <td style={{ whiteSpace: 'nowrap' }}><b>v{v.v}</b> {i === 0 && <span className="badge badge-human">Latest</span>}</td>
                                    <td className="muted">{dateShort(v.date)} · {v.by}</td>
                                    <td>{v.note}</td>
                                    <td className="table-actions" style={{ width: 48 }}>
                                      <IconButton label={locked ? lockTitle : `Download v${v.v}`} icon={Download} disabled={locked} onClick={() => downloadFile(r, `${r.name}_v${v.v}`)} />
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {sorted.length === 0 && (
              <tr><td colSpan={9} className="muted">No records match these filters. Archived records are included.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <Pager {...pager} />

      <ConfirmDialog
        open={toArchive !== null}
        title={`Archive ${toArchive?.name}?`}
        confirmLabel="Archive record"
        onConfirm={() => {
          if (toArchive) {
            const sizes = toArchive.archived
              ? { from: toArchive.archived.sizeFrom, to: toArchive.archived.sizeTo }
              : archiveSizes(toArchive);
            dispatch({ type: 'archive-repo', id: toArchive.id, sizeFrom: sizes.from, sizeTo: sizes.to });
            toast.push('success', `${toArchive.name} archived`, `Compressed ${sizes.from} to ${sizes.to} (simulated). It stays searchable; opening its files later needs a restore.`);
          }
          setToArchive(null);
        }}
        onClose={() => setToArchive(null)}
      >
        The files are compressed and moved to archive storage. The record stays searchable by its
        metadata, but opening or downloading the files later requires a restore, which can take up
        to several hours.
      </ConfirmDialog>

      <ConfirmDialog
        open={toRestore !== null}
        title={`Restore files for ${toRestore?.name}?`}
        confirmLabel="Request restore"
        onConfirm={() => {
          if (toRestore) {
            dispatch({ type: 'request-restore', id: toRestore.id });
            toast.push('info', 'Restore requested', `${toRestore.name}: you will see "Available" here when the files are ready. This typically takes minutes to hours (seconds in this demo).`);
          }
          setToRestore(null);
        }}
        onClose={() => setToRestore(null)}
      >
        Restoring retrieves the compressed files from archive storage. It is not instant - the
        record shows "Restore requested" until the files are available. The record itself stays
        archived and can be archived again after use.
      </ConfirmDialog>
    </div>
  );
}
