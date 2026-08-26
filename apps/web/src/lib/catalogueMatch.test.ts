import { describe, expect, it } from 'vitest';
import { exactCatalogueMatch, nearestCatalogueMatch, rankMatches } from './catalogueMatch';

/**
 * The Arduino problem, stated once: two people buy the same board, one types "Arduino Uno R3"
 * and one types "arduino uno". If the field does not put the catalogue entry in front of them,
 * the system ends up holding two products that nothing can reconcile.
 *
 * All three are pure so the rules can be tested without a DOM — the ranking *order*, and how
 * strict each match is, are the behaviour rather than an implementation detail of the list.
 */
const CATALOGUE = [
  { id: '1', name: 'Arduino Uno R3', productCode: 'ARD-UNO-R3' },
  { id: '2', name: 'Arduino Uno R3 Starter Kit', productCode: 'ARD-KIT' },
  { id: '6', name: 'Arduino Nano', productCode: 'ARD-NANO' },
  { id: '3', name: 'Uno Case', productCode: 'CASE-UNO' },
  { id: '4', name: 'Breadboard 830', productCode: 'BB-830' },
  { id: '5', name: 'Jumper wires', productCode: 'ARD-JMP' },
];

const namesOf = (products: Array<{ name: string }>) => products.map((product) => product.name);

describe('rankMatches', () => {
  /**
   * The whole catalogue, not a filtered slice. Opening on focus with nothing typed is what makes
   * this a search box rather than a hint you have to guess your way into.
   */
  it('returns every product when nothing is typed', () => {
    expect(rankMatches(CATALOGUE, '')).toHaveLength(CATALOGUE.length);
    expect(rankMatches(CATALOGUE, '   ')).toHaveLength(CATALOGUE.length);
  });

  it('puts an exact name first, ahead of a longer name starting with the same term', () => {
    expect(namesOf(rankMatches(CATALOGUE, 'arduino uno r3'))).toEqual([
      'Arduino Uno R3',
      'Arduino Uno R3 Starter Kit',
    ]);
  });

  /**
   * The assertion with teeth: alphabetical order would put "Aluminium zip tie" first, so this
   * only passes if the exact hit is ranked, not merely sorted.
   */
  it('puts the exact name first even when it sorts last alphabetically', () => {
    const catalogue = [
      { id: 'a', name: 'Aluminium zip tie', productCode: 'AL-ZIP' },
      { id: 'b', name: 'Zip tie mount', productCode: 'ZIP-M' },
      { id: 'c', name: 'Zip tie', productCode: 'ZIP' },
    ];

    expect(namesOf(rankMatches(catalogue, 'zip tie'))).toEqual([
      'Zip tie',
      'Zip tie mount',
      'Aluminium zip tie',
    ]);
  });

  it('ranks a name prefix above a name that merely contains the term', () => {
    const ranked = namesOf(rankMatches(CATALOGUE, 'uno'));

    // "Arduino Uno R3" contains it; "Uno Case" starts with it.
    expect(ranked[0]).toBe('Uno Case');
    expect(ranked).toContain('Arduino Uno R3');
  });

  it('matches on the product code as well as the name', () => {
    expect(namesOf(rankMatches(CATALOGUE, 'BB-830'))).toEqual(['Breadboard 830']);
  });

  it('is case insensitive both ways', () => {
    expect(namesOf(rankMatches(CATALOGUE, 'ARDUINO NANO'))[0]).toBe('Arduino Nano');
    expect(namesOf(rankMatches(CATALOGUE, 'ard-jmp'))).toEqual(['Jumper wires']);
  });

  it('drops what does not match at all', () => {
    expect(rankMatches(CATALOGUE, 'oscilloscope')).toEqual([]);
  });

  /**
   * The regression that motivated the ranking: `filter` + `slice(0, 6)` could push the exact
   * product the requester meant off the end of the list, which reads as "we do not stock it".
   */
  it('never truncates, so the catalogue cannot appear not to hold something', () => {
    const many = Array.from({ length: 40 }, (_, index) => ({
      id: String(index),
      name: `Resistor ${index} ohm`,
      productCode: `RES-${index}`,
    }));

    expect(rankMatches(many, 'resistor')).toHaveLength(40);
  });
});

describe('exactCatalogueMatch', () => {
  it('links free text that differs only by case', () => {
    expect(exactCatalogueMatch(CATALOGUE, 'arduino uno r3')?.id).toBe('1');
  });

  it('links free text that differs only by surrounding or repeated whitespace', () => {
    expect(exactCatalogueMatch(CATALOGUE, '  Arduino   Uno  R3 ')?.id).toBe('1');
  });

  /**
   * Deliberately strict. Anything looser would attach a requisition to the wrong product, which
   * is worse than the duplicate it would prevent — "Arduino Uno" is a different order from
   * "Arduino Uno R3" and only the requester can say which they meant.
   */
  it('does not link a partial name', () => {
    expect(exactCatalogueMatch(CATALOGUE, 'Arduino Uno')).toBeUndefined();
  });

  it('does not link empty text', () => {
    expect(exactCatalogueMatch(CATALOGUE, '   ')).toBeUndefined();
  });
});

/**
 * The looser half of the pair. This one only *offers* — the field renders it as "Did you mean
 * ...?" — so it is allowed to guess where `exactCatalogueMatch`, which links without asking, is
 * not.
 */
describe('nearestCatalogueMatch', () => {
  it('offers the full name when the requester typed a prefix of it', () => {
    // Ayman's example, verbatim: "arduino uno" for the board listed as "Arduino Uno R3".
    const shelf = [CATALOGUE[0]!, CATALOGUE[4]!];
    expect(nearestCatalogueMatch(shelf, 'arduino uno')?.name).toBe('Arduino Uno R3');
  });

  it('offers the catalogue name when the requester typed more than it', () => {
    expect(nearestCatalogueMatch(CATALOGUE, 'Arduino Uno R3 board')?.name).toBe('Arduino Uno R3');
  });

  /**
   * The limit that keeps this honest. With an R3 and an R4 on the shelf, "arduino uno" means
   * nothing in particular, and a coin-flip suggestion is worse than the open list.
   */
  it('offers nothing when two products are equally plausible', () => {
    const r4 = { id: '9', name: 'Arduino Uno R4', productCode: 'ARD-UNO-R4' };
    expect(nearestCatalogueMatch([CATALOGUE[0]!, r4], 'arduino uno')).toBeUndefined();
  });

  it('offers nothing for an exact match, which gets linked outright instead', () => {
    expect(nearestCatalogueMatch(CATALOGUE, 'arduino uno r3')).toBeUndefined();
  });

  /** A shared substring is not evidence: every product containing "cable" is not one cable. */
  it('offers nothing on a mid-string overlap', () => {
    expect(nearestCatalogueMatch(CATALOGUE, 'board')).toBeUndefined();
  });

  it('offers nothing for empty text', () => {
    expect(nearestCatalogueMatch(CATALOGUE, '  ')).toBeUndefined();
  });
});
