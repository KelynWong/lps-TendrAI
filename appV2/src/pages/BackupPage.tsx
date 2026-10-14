// Backup and redundancy (simulated). Plain-words explanation of why one
// storage location is not enough, plus a restore-from-backup demo flow.

import { useState } from 'react';
import { DatabaseBackup, ShieldCheck } from 'lucide-react';
import { ts } from '../lib/format';
import { useStore } from '../state/store';
import { Banner, Button, ConfirmDialog } from '../ui/ui';
import { ProgressStages } from '../components/ProgressStages';
import { useToast } from '../ui/toast';

export default function BackupPage() {
  const { state, dispatch } = useStore();
  const toast = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const b = state.backup;

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Backup and redundancy</h2>
          <div className="sub">Simulated status panel - the live system reads this from the storage accounts.</div>
        </div>
      </div>

      <Banner kind="info">
        One storage location is not enough: a single mistaken delete, a bad script or a compromised
        account could wipe every tender and business case at once. That is why the repository keeps
        versioning with delete protection AND a second copy in a different location under a
        different account - so no single action can destroy both copies.
      </Banner>

      <div className="kpi-row">
        <div className="kpi"><span>Primary storage</span><b className="pos">{b.primary.status}</b><div className="muted small">{b.primary.location} · {b.primary.objects.toLocaleString()} objects · {b.primary.size}</div></div>
        <div className="kpi"><span>Versioning</span><b className="pos">{b.versioning.status}</b><div className="muted small">{b.versioning.deleteProtection}</div></div>
        <div className="kpi"><span>Second copy</span><b className="pos">{b.secondCopy.status}</b><div className="muted small">{b.secondCopy.location} · replication lag {b.secondCopy.lag}</div></div>
        <div className="kpi"><span>Last backup</span><b>{ts(b.lastBackup)}</b><div className="muted small">Daily cycle (assumed - see Assumptions)</div></div>
      </div>

      <section className="card" style={{ maxWidth: 680 }}>
        <h3><ShieldCheck size={16} aria-hidden style={{ verticalAlign: '-3px' }} /> Restore test record</h3>
        <p>
          {b.lastRestoreTest.date} by {b.lastRestoreTest.by}: {b.lastRestoreTest.result}. A backup
          that has never been restored is only a hope - the test restores a sample into an isolated
          location and verifies checksums.
        </p>
        {restoring ? (
          <ProgressStages
            stages={[
              { label: 'Selecting restore point (second copy, ap-southeast-2)', ms: 900 },
              { label: 'Restoring 25 sampled files to the isolated test location', ms: 1600 },
              { label: 'Verifying checksums against the catalogue', ms: 1200 },
              { label: 'Restore test passed', ms: 500 },
            ]}
            onComplete={() => {
              setRestoring(false);
              dispatch({ type: 'backup-restore-demo' });
              toast.push('success', 'Restore test passed', '25 files restored and checksum-verified (simulated).');
            }}
          />
        ) : (
          <Button variant="primary" icon={DatabaseBackup} onClick={() => setConfirmOpen(true)}>
            Restore from backup (demo)
          </Button>
        )}
        {b.lastRestoreDemo && !restoring && (
          <p className="muted small">Demo restore run completed {ts(b.lastRestoreDemo)}.</p>
        )}
      </section>

      <ConfirmDialog
        open={confirmOpen}
        title="Run a restore from the second copy?"
        confirmLabel="Run restore test"
        onConfirm={() => { setConfirmOpen(false); setRestoring(true); }}
        onClose={() => setConfirmOpen(false)}
      >
        This restores a sample of files from the second-copy backup into an isolated test location
        and verifies them. It does not touch the live repository. (Simulated in this demo.)
      </ConfirmDialog>
    </div>
  );
}
