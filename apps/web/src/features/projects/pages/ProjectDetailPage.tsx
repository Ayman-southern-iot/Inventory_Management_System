import { useParams } from 'react-router-dom';
import { Role } from '@ims/shared';
import { PageHeader } from '@/components/ui/primitives';
import { QueryBoundary, SkeletonRows } from '@/components/ui/states';
import { t } from '@/i18n/en';
import { useAuth } from '@/features/auth/auth-context';
import { useProject } from '../api';
import { ProjectItemsPanel } from '../components/ProjectItemsPanel';
import { ProjectRequisitionsPanel } from '../components/ProjectRequisitionsPanel';

/**
 * One project, with everything currently in flight against it: what has been borrowed
 * (with usage tags and a server-side filter) and what has been requisitioned. Both panels
 * handle the four states explicitly — the page cannot reach its layout without them.
 */
export function ProjectDetailPage() {
  const { projectId = '' } = useParams<{ projectId: string }>();
  const project = useProject(projectId);
  const { hasRole } = useAuth();
  // The IM owns stock accuracy — a general user quietly detaching another person's outstanding
  // borrow would hide a liability.
  const canRemove = hasRole(Role.INVENTORY_MANAGER, Role.ADMIN);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <QueryBoundary
        isLoading={project.isPending}
        error={project.error}
        data={project.data}
        onRetry={() => void project.refetch()}
        loadingFallback={<SkeletonRows rows={2} columns={2} />}
      >
        {(detail) => (
          <PageHeader
            title={detail.name}
            subtitle={t.projects.counts(detail.inUseCount, detail.returnedCount)}
          />
        )}
      </QueryBoundary>

      <ProjectItemsPanel projectId={projectId} canRemove={canRemove} />
      <ProjectRequisitionsPanel projectId={projectId} />
    </div>
  );
}