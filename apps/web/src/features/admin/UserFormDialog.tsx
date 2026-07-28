import { useEffect } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Role,
  createUserSchema,
  updateUserSchema,
  type CreateUserInput,
  type Department,
  type UpdateUserInput,
  type User,
} from '@ims/shared';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Checkbox, SelectField, TextField } from '@/components/ui/Field';
import { t } from '@/i18n/en';
import { messageForError } from '@/lib/error-message';
import { useToast } from '@/components/ui/Toast';
import { useCreateUser, useUpdateUser } from './api';

/** GENERAL is implicit and always held, so it is not offered as a removable choice. */
const ASSIGNABLE_ROLES: Role[] = [Role.APPROVER, Role.INVENTORY_MANAGER, Role.ADMIN];

interface Props {
  open: boolean;
  onClose: () => void;
  departments: Department[];
  /** Undefined means "create"; a user means "edit". */
  editing?: User;
}

type FormValues = CreateUserInput;

export function UserFormDialog({ open, onClose, departments, editing }: Props) {
  const toast = useToast();
  const createUser = useCreateUser();
  const updateUser = useUpdateUser();
  const isEditing = editing !== undefined;

  const form = useForm<FormValues>({
    // Editing never touches the password, so the two modes need different schemas — the
    // create schema would demand a password field the edit form does not show.
    resolver: zodResolver(isEditing ? (updateUserSchema as never) : createUserSchema),
    defaultValues: {
      email: '',
      fullName: '',
      designation: '',
      departmentId: null,
      roles: [Role.GENERAL],
      password: '',
      mustChangePassword: true,
    },
  });

  useEffect(() => {
    if (!open) return;
    form.reset(
      editing
        ? {
            email: editing.email,
            fullName: editing.fullName,
            designation: editing.designation,
            departmentId: editing.departmentId,
            roles: editing.roles,
            password: '',
            mustChangePassword: editing.mustChangePassword,
          }
        : {
            email: '',
            fullName: '',
            designation: '',
            departmentId: null,
            roles: [Role.GENERAL],
            password: '',
            mustChangePassword: true,
          },
    );
  }, [open, editing, form]);

  async function onSubmit(values: FormValues) {
    try {
      if (isEditing) {
        const patch: UpdateUserInput = {
          fullName: values.fullName,
          designation: values.designation,
          departmentId: values.departmentId,
          roles: values.roles,
        };
        await updateUser.mutateAsync({ id: editing.id, input: patch });
        toast.success(t.users.updated);
      } else {
        await createUser.mutateAsync(values);
        toast.success(t.users.created);
      }
      onClose();
    } catch (error) {
      toast.error(messageForError(error));
    }
  }

  const { errors, isSubmitting } = form.formState;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={isEditing ? t.users.editUser : t.users.newUser}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>
            {t.common.cancel}
          </Button>
          <Button form="user-form" type="submit" isLoading={isSubmitting}>
            {isSubmitting ? t.common.saving : t.common.save}
          </Button>
        </>
      }
    >
      <form
        id="user-form"
        noValidate
        onSubmit={form.handleSubmit(onSubmit)}
        className="flex flex-col gap-4"
      >
        <TextField
          label={t.users.fullName}
          error={errors.fullName?.message}
          {...form.register('fullName')}
        />
        <TextField
          label={t.users.email}
          type="email"
          autoComplete="off"
          // Changing an email would silently break the audit trail's identity; do it by
          // creating a new account instead.
          disabled={isEditing}
          error={errors.email?.message}
          {...form.register('email')}
        />
        <TextField
          label={t.users.designation}
          hint={t.users.designationHint}
          error={errors.designation?.message}
          {...form.register('designation')}
        />

        <Controller
          control={form.control}
          name="departmentId"
          render={({ field }) => (
            <SelectField
              label={t.users.department}
              value={field.value ?? ''}
              onChange={(event) => field.onChange(event.target.value || null)}
              error={errors.departmentId?.message}
            >
              <option value="">{t.users.noDepartment}</option>
              {departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </SelectField>
          )}
        />

        <Controller
          control={form.control}
          name="roles"
          render={({ field }) => (
            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-medium text-ink">{t.users.roles}</legend>
              <p className="text-xs text-ink-subtle">{t.users.rolesHint}</p>
              {ASSIGNABLE_ROLES.map((role) => (
                <Checkbox
                  key={role}
                  label={t.roles[role]}
                  checked={field.value.includes(role)}
                  onChange={(event) =>
                    field.onChange(
                      event.target.checked
                        ? [...field.value, role]
                        : field.value.filter((held) => held !== role),
                    )
                  }
                />
              ))}
            </fieldset>
          )}
        />

        {isEditing ? null : (
          <>
            <TextField
              label={t.users.password}
              type="password"
              autoComplete="new-password"
              hint={t.auth.passwordRules}
              error={errors.password?.message}
              {...form.register('password')}
            />
            <Checkbox
              label={t.users.mustChangePassword}
              {...form.register('mustChangePassword')}
            />
          </>
        )}
      </form>
    </Dialog>
  );
}
