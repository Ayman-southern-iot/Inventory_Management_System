import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Zone } from '@ims/shared';
import { t } from '@/i18n/en';
import { CompartmentPicker } from './CompartmentPicker';

/**
 * Zone first, then the compartments inside it.
 *
 * The trap this file exists for: deriving the zone from the chosen compartment looks tidier and
 * cannot work. Changing the zone has to clear the compartment — otherwise the form submits a
 * perfectly valid id for the wrong shelf, which nothing downstream can catch — and a derived zone
 * would clear itself along with it, so the second select could never be reached at all.
 */

function compartment(id: string, code: string, zoneId: string, zoneName: string, isActive = true) {
  return { id, code, zoneId, zoneName, isActive, placementCount: 0 };
}

const ZONES: Zone[] = [
  {
    id: 'zone-meta',
    name: 'Meta',
    isActive: true,
    compartments: [
      compartment('c-1a', '1A', 'zone-meta', 'Meta'),
      compartment('c-2a', '2A', 'zone-meta', 'Meta'),
    ],
  },
  {
    id: 'zone-nvidia',
    name: 'Nvidia',
    isActive: true,
    compartments: [compartment('c-3c', '3C', 'zone-nvidia', 'Nvidia')],
  },
];

/** A host that holds the value, the way every real caller does. */
function Host({ zones = ZONES, initial = '' }: { zones?: Zone[]; initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <CompartmentPicker zones={zones} value={value} onChange={setValue} />
      <output data-testid="chosen">{value}</output>
    </>
  );
}

const zoneSelect = () => screen.getByLabelText(new RegExp(t.compartmentPicker.zone));
const compartmentSelect = () =>
  screen.getByLabelText(new RegExp(t.compartmentPicker.compartment));
const chosen = () => screen.getByTestId('chosen').textContent;

describe('the compartment picker', () => {
  it('offers the zones and nothing else until one is picked', () => {
    render(<Host />);

    expect(screen.getByRole('option', { name: 'Meta' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Nvidia' })).toBeInTheDocument();
    expect(compartmentSelect()).toBeDisabled();
    expect(screen.queryByRole('option', { name: '1A' })).not.toBeInTheDocument();
  });

  it('shows only the compartments in the chosen zone', async () => {
    const user = userEvent.setup();
    render(<Host />);

    await user.selectOptions(zoneSelect(), 'zone-meta');

    expect(compartmentSelect()).toBeEnabled();
    expect(screen.getByRole('option', { name: '1A' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '2A' })).toBeInTheDocument();
    // Nvidia's shelf belongs to the other zone and must not be offered here.
    expect(screen.queryByRole('option', { name: '3C' })).not.toBeInTheDocument();
  });

  /** The whole point of the two-step: the zone must survive the compartment being empty. */
  it('lets a compartment be chosen after the zone', async () => {
    const user = userEvent.setup();
    render(<Host />);

    await user.selectOptions(zoneSelect(), 'zone-meta');
    await user.selectOptions(compartmentSelect(), 'c-2a');

    expect(chosen()).toBe('c-2a');
  });

  /**
   * Changing the zone clears the compartment. Keeping it would leave a form holding a shelf from
   * a zone nobody is looking at — a wrong answer made of two individually valid halves.
   */
  it('clears the compartment when the zone changes', async () => {
    const user = userEvent.setup();
    render(<Host />);

    await user.selectOptions(zoneSelect(), 'zone-meta');
    await user.selectOptions(compartmentSelect(), 'c-2a');
    expect(chosen()).toBe('c-2a');

    await user.selectOptions(zoneSelect(), 'zone-nvidia');

    expect(chosen()).toBe('');
    expect(screen.getByRole('option', { name: '3C' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: '2A' })).not.toBeInTheDocument();
  });

  /** A value set from outside has to bring its zone with it, or the form opens half-blank. */
  it('shows the owning zone when a compartment arrives already chosen', () => {
    render(<Host initial="c-3c" />);

    expect(zoneSelect()).toHaveValue('zone-nvidia');
    expect(compartmentSelect()).toHaveValue('c-3c');
  });

  it('does not offer a deactivated zone', () => {
    const zones: Zone[] = [
      { ...ZONES[0]!, isActive: false },
      ZONES[1]!,
    ];
    render(<Host zones={zones} />);

    expect(screen.queryByRole('option', { name: 'Meta' })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Nvidia' })).toBeInTheDocument();
  });

  /**
   * A deactivated compartment is out of use, but one already on the record stays selectable — an
   * in-flight form must not silently lose the value it was opened with.
   */
  it('hides a deactivated compartment unless it is the one already chosen', async () => {
    const user = userEvent.setup();
    const zones: Zone[] = [
      {
        ...ZONES[0]!,
        compartments: [
          compartment('c-1a', '1A', 'zone-meta', 'Meta'),
          compartment('c-2a', '2A', 'zone-meta', 'Meta', false),
        ],
      },
    ];

    render(<Host zones={zones} />);
    await user.selectOptions(zoneSelect(), 'zone-meta');
    expect(screen.queryByRole('option', { name: '2A' })).not.toBeInTheDocument();

    screen.getByTestId('chosen');
    render(<Host zones={zones} initial="c-2a" />);
    expect(screen.getAllByRole('option', { name: '2A' })).not.toHaveLength(0);
  });
});
