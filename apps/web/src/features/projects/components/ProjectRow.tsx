import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ProjectStatus, Role, type Project } from '@ims/shared';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/primitives';
import { ReasonDialog } from '@/components/ui/ReasonDialog';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/features/auth/auth-context';
import { t } from '@/i18n/en';
import { formatDateTime } from '@/lib/format';
import { messageForError } from '@/lib/error-message';
import { ROUTES } from '@/routes/paths';
import { useDecideProject } from '../api';

const TONE = {
  [ProjectStatus.PROPOSED]: 'pending',
  [ProjectStatus.ACTIVE]: 'success',
  [ProjectStatus.REJECTED]: 'neutral',
} as const;

const LABEL = {
  [ProjectStatus.PROPOSED]: t.projects.statusProposed,
  [ProjectStatus.ACTIVE]: t.projects.statusActive,
  [ProjectStatus.REJECTED]: t.projects.statusRejected,
} as const;

/**
 * One project in the hub list.
 *
 * The decision buttons sit beside the link rather than inside it: a button nested in an anchor
 * is both a navigation and an action, and which one fires depends on where the pointer landed.
 */
export function ProjectRow({ project }: { project: Project }) {
  const { hasRole } = useAuth();
  const toast = useToast();
  const decide = useDecideProject();
  const [rejecting, setRejecting] = useState(false);

  const canDecide =
    hasRole(Role.INVENTORY_MANAGER, Role.ADMIN) && project.status === ProjectStatus.PROPOSED;

  async function send(approve: boolean, note?: string) {
    try {
      await decide.mutateAsync({ id: project.id, approve, note });
      toast.success(approve ? t.projects.accepted : t.projects.rejected);
      setRejecting(false);
    } catch (error) {
      toast.error(messageForError(error));
    }
  }

  return (
    <li className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-surface-muted">
      <Link to={ROUTES.projects.detail(project.id)} className="min-w-0 flex-1">
        <span className="font-medium text-ink">{project.name}</span>
        <span className="mt-0.5 block text-xs text-ink-subtle">
          {t.projects.createdOn(formatDateTime(project.createdAt))}
          {project.createdByName ? ` · ${t.projects.proposedBy} ${project.createdByName}` : ''}
        </span>
      </Link>

      <Badge tone={TONE[project.status]}>{LABEL[project.status]}</Badge>

      {canDecide ? (
        <span className="flex gap-2">
          <Button type="button" onClick={() => void send(true)} disabled={decide.isPending}>
            {t.projects.accept}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => setRejecting(true)}
            disabled={decide.isPending}
          >
            {t.projects.reject}
          </Button>
        </span>
      ) : null}

      {/* The reason is required by the contract: the proposer is told why, or proposes it again. */}
      <ReasonDialog
        open={rejecting}
        title={t.projects.reject}
        description={t.projects.rejectReasonHint}
        label={t.projects.rejectReasonLabel}
        confirmLabel={t.projects.reject}
        isPending={decide.isPending}
        onClose={() => setRejecting(false)}
        onConfirm={(note) => void send(false, note)}
      />
    </li>
  );
}
