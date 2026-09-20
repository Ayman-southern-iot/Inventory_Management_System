import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Zone } from '@ims/shared';
import { t } from '@/i18n/en';
import { CompartmentPicker } from './CompartmentPicker';

/**
 * Room, then zone, then the compartments inside it.
 *
 * This file asserted a two-step picker until migration 0033 put rooms above zones (ask #3). The
 * rule it is guarding did not change, only the number of steps: **the level above must survive
 * the level below being empty.** Deriving room and zone from the chosen compartment looks tidier
 * and cannot work — changing a level has to clear everything under it, and a derived level would
 * clear itself along with them, so the next select could never be reached at all.
 *
 * The other half of the rule: changing a level must clear the levels below, or the form submits
 * a perfectly valid id for the wrong shelf — a wrong answer made of individually correct parts,
 * which nothing downstream can catch.
 */

function compartment(id: string, code: string, zoneId: string, zoneName: string, isActive = true) {
  return {
    id,
    code,
    zoneId,
    zoneName,
    roomId: zoneId === 'zone-meta' ? 'room-lab' : 'room-store',
    roomName: zoneId === 'zone-meta' ? 'Lab' : 'Store',
    storageId: `${zoneId === 'zone-meta' ? 'LAB' : 'STO'}-ZON-${code}-0001`,
    isActive,
    placementCount: 0,
  };
}

const ZONES: Zone[] = [
  {
    id: 'zone-meta',
    name: 'Meta',
    roomId: 'room-lab',
    roomName: 'Lab',
    isActive: true,
    compartments: [
      compartment('c-1a', '1A', 'zone-meta', 'Meta'),
      compartment('c-2a', '2A', 'zone-meta', 'Meta'),
    ],
  },
  {
    id: 'zone-nvidia',
    name: 'Nvidia',
    roomId: 'room-store',
    roomName: 'Store',
    isActive: true,
    compartments: [compartment('c-3c', '3C', 'zone-nvidia', 'Nvidia')],
  },
];

/**
 * The capability rooms exist for: the same zone name in two different rooms. Globally-unique
 * zone names made this impossible before 0033.
 */
const SAME_NAME_ZONES: Zone[] = [
  {
    id: 'zone-lab-a',
    name: 'Shelf A',
    roomId: 'room-lab',
    roomName: 'Lab',
    isActive: true,
    compartments: [
      { ...compartment('c-lab-a1', 'A1', 'zone-meta', 'Shelf A'), roomId: 'room-lab', roomName: 'Lab' },
    ],
  },
  {
    id: 'zone-store-a',
    name: 'Shelf A',
    roomId: 'room-store',
    roomName: 'Store',
    isActive: true,
    compartments: [
      {
        ...compartment('c-store-a1', 'A1', 'zone-nvidia', 'Shelf A'),
        roomId: 'room-store',
        roomName: 'Store',
      },
    ],
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

const roomSelect = () => screen.getByLabelText(new RegExp(t.compartmentPicker.room));
const zoneSelect = () => screen.getByLabelText(new RegExp(`^${t.compartmentPicker.zone}`));
const compartmentSelect = () => screen.getByLabelText(new RegExp(t.compartmentPicker.compartment));
const chosen = () => screen.getByTestId('chosen').textContent;

describe('the compartment picker', () => {
  it('offers the rooms and nothing below them until one is picked', () => {
    render(<Host />);

    expect(screen.getByRole('option', { name: 'Lab' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Store' })).toBeInTheDocument();
    expect(zoneSelect()).toBeDisabled();
    expect(compartmentSelect()).toBeDisabled();
    expect(screen.queryByRole('option', { name: 'Meta' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: '1A' })).not.toBeInTheDocument();
  });

  it('shows only the zones in the chosen room', async () => {
    const user = userEvent.setup();
    render(<Host />);

    await user.selectOptions(roomSelect(), 'room-lab');

    expect(zoneSelect()).toBeEnabled();
    expect(screen.getByRole('option', { name: 'Meta' })).toBeInTheDocument();
    // Nvidia is in the Store room and must not be offered here.
    expect(screen.queryByRole('option', { name: 'Nvidia' })).not.toBeInTheDocument();
    // Still nothing below until a zone is chosen.
    expect(compartmentSelect()).toBeDisabled();
  });

  it('shows only the compartments in the chosen zone', async () => {
    const user = userEvent.setup();
    render(<Host />);

    await user.selectOptions(roomSelect(), 'room-lab');
    await user.selectOptions(zoneSelect(), 'zone-meta');

    expect(compartmentSelect()).toBeEnabled();
    expect(screen.getByRole('option', { name: '1A' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '2A' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: '3C' })).not.toBeInTheDocument();
  });

  /** The whole point of the three-step: each level survives the one below it being empty. */
  it('lets a compartment be chosen after the room and the zone', async () => {
    const user = userEvent.setup();
    render(<Host />);

    await user.selectOptions(roomSelect(), 'room-lab');
    await user.selectOptions(zoneSelect(), 'zone-meta');
    await user.selectOptions(compartmentSelect(), 'c-2a');

    expect(chosen()).toBe('c-2a');
  });

  it('clears the compartment when the zone changes', async () => {
    const user = userEvent.setup();
    render(<Host />);

    await user.selectOptions(roomSelect(), 'room-lab');
    await user.selectOptions(zoneSelect(), 'zone-meta');
    await user.selectOptions(compartmentSelect(), 'c-2a');
    expect(chosen()).toBe('c-2a');

    await user.selectOptions(zoneSelect(), '');

    expect(chosen()).toBe('');
  });

  /** Changing the room clears BOTH levels under it — the new rule 0033 introduces. */
  it('clears the zone and the compartment when the room changes', async () => {
    const user = userEvent.setup();
    render(<Host />);

    await user.selectOptions(roomSelect(), 'room-lab');
    await user.selectOptions(zoneSelect(), 'zone-meta');
    await user.selectOptions(compartmentSelect(), 'c-2a');
    expect(chosen()).toBe('c-2a');

    await user.selectOptions(roomSelect(), 'room-store');

    expect(chosen()).toBe('');
    expect(zoneSelect()).toHaveValue('');
    // And the new room's zones are what is on offer now.
    expect(screen.getByRole('option', { name: 'Nvidia' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Meta' })).not.toBeInTheDocument();
  });

  /** A value set from outside has to bring its room AND zone with it, or the form opens blank. */
  it('shows the owning room and zone when a compartment arrives already chosen', () => {
    render(<Host initial="c-3c" />);

    expect(roomSelect()).toHaveValue('room-store');
    expect(zoneSelect()).toHaveValue('zone-nvidia');
    expect(compartmentSelect()).toHaveValue('c-3c');
  });

  /**
   * Two rooms may each have a "Shelf A" — the capability the room level was added for. The zone
   * select must show only the one in the chosen room, not both.
   */
  it('keeps same-named zones in different rooms apart', async () => {
    const user = userEvent.setup();
    render(<Host zones={SAME_NAME_ZONES} />);

    await user.selectOptions(roomSelect(), 'room-lab');
    expect(screen.getAllByRole('option', { name: 'Shelf A' })).toHaveLength(1);
    expect(zoneSelect()).toHaveValue('');

    await user.selectOptions(zoneSelect(), 'zone-lab-a');
    await user.selectOptions(compartmentSelect(), 'c-lab-a1');
    expect(chosen()).toBe('c-lab-a1');
  });

  it('does not offer a deactivated zone', async () => {
    const user = userEvent.setup();
    const zones: Zone[] = [{ ...ZONES[0]!, isActive: false }, ZONES[1]!];
    render(<Host zones={zones} />);

    await user.selectOptions(roomSelect(), 'room-lab');
    expect(screen.queryByRole('option', { name: 'Meta' })).not.toBeInTheDocument();
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

    const view = render(<Host zones={zones} />);
    await user.selectOptions(roomSelect(), 'room-lab');
    await user.selectOptions(zoneSelect(), 'zone-meta');
    expect(screen.queryByRole('option', { name: '2A' })).not.toBeInTheDocument();

    view.unmount();
    render(<Host zones={zones} initial="c-2a" />);
    expect(screen.getAllByRole('option', { name: '2A' })).not.toHaveLength(0);
  });
});
