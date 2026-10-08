import { describe, expect, it } from 'vitest';
import { panelLayout } from '@/features/panel/layout';
import { parseRoomTarget } from './deepLink';

const parse = (search: string) => parseRoomTarget(new URLSearchParams(search), panelLayout);

describe('parseRoomTarget: /room?cell=', () => {
  it('reads a cell address', () => {
    expect(parse('?cell=B2-2A-2D')).toEqual({ kind: 'cell', address: 'B2-2A-2D' });
  });

  it('ignores case and surrounding space, as a typed or spoken link would have them', () => {
    expect(parse('?cell=%20a2-1a%20')).toEqual({ kind: 'cell', address: 'A2-1A' });
  });

  it('reads an open-shelf cell, which has no 3D shelf but does have contents', () => {
    expect(parse('?cell=LB-1')).toEqual({ kind: 'cell', address: 'LB-1' });
  });

  it('is nothing when the parameter is missing or blank', () => {
    expect(parse('')).toEqual({ kind: 'none' });
    expect(parse('?cell=')).toEqual({ kind: 'none' });
    expect(parse('?cell=%20%20')).toEqual({ kind: 'none' });
  });

  it('reports a cell the plan does not have, keeping what was asked for', () => {
    expect(parse('?cell=B2-9Z')).toEqual({ kind: 'unknown', value: 'B2-9Z' });
    // A drawer code is not a cell.
    expect(parse('?cell=B2')).toEqual({ kind: 'unknown', value: 'B2' });
  });

  it('takes the first when the parameter is repeated', () => {
    expect(parse('?cell=A2-1A&cell=B2-2G')).toEqual({ kind: 'cell', address: 'A2-1A' });
  });
});
