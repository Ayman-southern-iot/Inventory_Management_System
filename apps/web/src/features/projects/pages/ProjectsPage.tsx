import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { PageHeader, Panel } from '@/components/ui/primitives';
import { EmptyState, QueryBoundary, SkeletonRows } from '@/components/ui/states';
import { formatDateTime } from '@/lib/format';
import { t } from '@/i18n/en';
import { ROUTES } from '@/routes/paths';
import { useProjects } from '../api';
import { ProjectFormDialog } from '../components/ProjectFormDialog';

/**
 * The hub. Deliberately open to every role: a project is shared context, and anyone who can
 * borrow for one can see what it holds.
 */
export function ProjectsPage() {
  const projects = useProjects();
  const [creating, setCreating] = useState(false);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title={t.projects.title}
        subtitle={t.projects.subtitle}
        action={
          <Button icon={<Plus aria-hidden className="size-4" />} onClick={() => setCreating(true)}>
            {t.projects.create}
          </Button>
        }
      />

      <Panel>
        <QueryBoundary
          isLoading={projects.isPending}
          error={projects.error}
          data={projects.data}
          onRetry={() => void projects.refetch()}
          loadingFallback={<SkeletonRows columns={2} />}
          isEmpty={(items) => items.length === 0}
          emptyFallback={
            <EmptyState
              title={t.projects.empty}
              body={t.projects.emptyBody}
              action={<Button onClick={() => setCreating(true)}>{t.projects.create}</Button>}
            />
          }
        >
          {(items) => (
            <ul className="divide-y divide-border">
              {items.map((project) => (
                <li key={project.id}>
                  <Link
                    to={ROUTES.projects.detail(project.id)}
                    className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-surface-muted"
                  >
                    <span className="font-medium text-ink">{project.name}</span>
                    <span className="text-xs text-ink-subtle">
                      {t.projects.createdOn(formatDateTime(project.createdAt))}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </QueryBoundary>
      </Panel>

      <ProjectFormDialog open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}
