import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ErrorCode, createProjectSchema, type CreateProjectInput } from '@ims/shared';
import { ApiError } from '@/api/client';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { TextField } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { t } from '@/i18n/en';
import { messageForError } from '@/lib/error-message';
import { useCreateProject } from '../api';

interface Props {
  open: boolean;
  onClose: () => void;
}

type FormValues = CreateProjectInput;

const EMPTY: FormValues = { name: '', allowDuplicateName: false };

export function ProjectFormDialog({ open, onClose }: Props) {
  const toast = useToast();
  const createProject = useCreateProject();
  const [duplicate, setDuplicate] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(createProjectSchema),
    defaultValues: EMPTY,
  });

  useEffect(() => {
    if (!open) return;
    setDuplicate(false);
    form.reset(EMPTY);
  }, [open, form]);

  async function submit(values: FormValues, allowDuplicateName = false) {
    try {
      await createProject.mutateAsync({ name: values.name, allowDuplicateName });
      toast.success(t.projects.created);
      onClose();
    } catch (error) {
      // OQ-09: a duplicate name is a warning the user can override, not a failure. Two teams
      // may legitimately run a "Falcon", so the second submit carries the override.
      if (error instanceof ApiError && error.code === ErrorCode.DUPLICATE_PROJECT_NAME) {
        setDuplicate(true);
        return;
      }
      toast.error(messageForError(error));
    }
  }

  const { errors, isSubmitting } = form.formState;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t.projects.create}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>
            {t.common.cancel}
          </Button>
          <Button form="project-form" type="submit" isLoading={isSubmitting}>
            {isSubmitting ? t.common.saving : t.common.create}
          </Button>
        </>
      }
    >
      <form
        id="project-form"
        noValidate
        onSubmit={form.handleSubmit((values) => submit(values))}
        className="flex flex-col gap-4"
      >
        <TextField
          label={t.projects.nameLabel}
          error={errors.name?.message}
          {...form.register('name', {
            // Clearing the warning on edit stops "Create anyway" from applying to a name the
            // user has since changed.
            onChange: () => setDuplicate(false),
          })}
        />

        {duplicate ? (
          <div className="rounded-[--radius-control] bg-pending-subtle px-3 py-2 text-xs text-ink">
            <p className="font-medium">{t.projects.duplicateTitle}</p>
            <p className="mt-0.5">{t.projects.duplicateBody}</p>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="mt-2"
              onClick={() => void submit(form.getValues(), true)}
            >
              {t.projects.createAnyway}
            </Button>
          </div>
        ) : null}
      </form>
    </Dialog>
  );
}
