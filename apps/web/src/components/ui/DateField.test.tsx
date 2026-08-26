import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { t } from '@/i18n/en';
import { DateField } from './DateField';

/**
 * The picker exists because `<input type="date">` could not meet three of the requirements at
 * once: show a past date as unreachable *before* it is clicked, refuse to page into a month
 * that is entirely behind you, and be immune to a wheel scroll changing its value.
 *
 * A fixed clock, because "today" is the whole subject. Without it the disabled-days assertions
 * pass or fail depending on which day of the month the suite happens to run.
 */
const FIXED_NOW = new Date('2026-08-15T09:00:00');

function renderField(value: string | null = null) {
  const onChange = vi.fn();
  render(
    <DateField label="Needed by" value={value} onChange={onChange} placeholder="Select a date" />,
  );
  return { onChange };
}

const openCalendar = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: /needed by/i }));
  return screen.getByRole('dialog', { name: /needed by/i });
};

describe('DateField', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('opens from a click anywhere on the field, not just an icon', async () => {
    const user = userEvent.setup();
    renderField();

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    // The label text is inside the trigger, so clicking it is a click on the field body.
    await user.click(screen.getByText('Select a date'));
    expect(screen.getByRole('dialog', { name: /needed by/i })).toBeInTheDocument();
  });

  it('disables every day before today', async () => {
    const user = userEvent.setup();
    renderField();
    const dialog = await openCalendar(user);

    // August 2026: the 14th is yesterday, the 15th is today, the 16th is tomorrow.
    expect(within(dialog).getByRole('button', { name: '14' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: '15' })).toBeEnabled();
    expect(within(dialog).getByRole('button', { name: '16' })).toBeEnabled();
  });

  it('refuses to page into a month that is entirely behind you', async () => {
    const user = userEvent.setup();
    renderField();
    const dialog = await openCalendar(user);

    // Browsing July only to find every day greyed out is a worse answer than not offering it.
    expect(within(dialog).getByRole('button', { name: t.common.previous })).toBeDisabled();

    await user.click(within(dialog).getByRole('button', { name: t.common.next }));
    expect(within(dialog).getByText(/September 2026/)).toBeInTheDocument();
    // Forward is fine, and now back is too — but only as far as this month.
    expect(within(dialog).getByRole('button', { name: t.common.previous })).toBeEnabled();
  });

  it('does not commit until the deadline is set', async () => {
    const user = userEvent.setup();
    const { onChange } = renderField();
    const dialog = await openCalendar(user);

    await user.click(within(dialog).getByRole('button', { name: '20' }));
    // Picking is a draft. The form behind the popover has not changed.
    expect(onChange).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: t.requisitions.setDeadline }));
    expect(onChange).toHaveBeenCalledWith('2026-08-20');
  });

  it('leaves the value alone when the popover is dismissed after a pick', async () => {
    const user = userEvent.setup();
    const { onChange } = renderField('2026-08-18');
    const dialog = await openCalendar(user);

    await user.click(within(dialog).getByRole('button', { name: '25' }));
    await user.keyboard('{Escape}');

    // Exploring the calendar on a half-filled form must not cost you the value you had.
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /needed by/i })).toHaveTextContent('Aug 18, 2026');
  });

  it('clears through to the caller', async () => {
    const user = userEvent.setup();
    const { onChange } = renderField('2026-08-18');
    const dialog = await openCalendar(user);

    await user.click(within(dialog).getByRole('button', { name: t.common.clear }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('shows the selected day in the local calendar, not a UTC-shifted one', () => {
    renderField('2026-08-13');

    // D-014: `new Date('2026-08-13')` parses as UTC midnight and renders as the 12th at +06.
    const trigger = screen.getByRole('button', { name: /needed by/i });
    expect(trigger).toHaveTextContent('Aug 13, 2026');
    expect(trigger).not.toHaveTextContent('Aug 12');
  });

  it('cannot be given a value by a wheel scroll, because it has no native input', () => {
    renderField();
    // The reason this component exists rather than `<input type="date">`. Asserted structurally:
    // there is no input to scroll over.
    expect(document.querySelector('input')).toBeNull();
  });
});
