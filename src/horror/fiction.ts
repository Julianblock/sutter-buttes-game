/**
 * FICTIONAL DATA LAYER.
 *
 * Nothing in this file describes a real place, person or business. Haunts are
 * hung on anonymous houses picked by a seeded draw (never on a named building,
 * landmark or business), and the Hollow House is an invented structure on an
 * empty lot that only exists while Nightmare mode is on. Kept apart from the
 * verified (OSM, USGS) and approximated (ML footprints, generated massing)
 * layers on purpose.
 */

export const FICTION_NOTICE = 'Fiction: these hauntings are invented and say nothing about real residents, buildings or businesses.';

export type SignText = 'CONDEMNED' | 'KEEP OUT' | 'NO ENTRY AFTER DARK' | 'DO NOT LOOK BACK' | 'THEY ARE SMALL' | 'STAY ON THE ROAD';

export const SIGNS: SignText[] = ['CONDEMNED', 'KEEP OUT', 'NO ENTRY AFTER DARK', 'DO NOT LOOK BACK', 'THEY ARE SMALL', 'STAY ON THE ROAD'];

/** Invented names for the invented hauntings, handed out in seeded order. */
export const HAUNT_NAMES = ['The house with the open door', 'The boarded house', 'The house that knocks back', 'The quiet house', 'The house with the face', 'The house nobody mows'];

export const HAUNTS_PER_TOWN: Record<string, number> = { Princeton: 3, Marysville: 4 };

/** Seed per town so the same houses are picked every run. */
export const HAUNT_SEED: Record<string, number> = { Princeton: 0x9e3779b9, Marysville: 0x85ebca6b };

export const HOLLOW_HOUSE = {
  name: 'The Hollow House',
  town: 'Princeton',
  /** Footprint (m) and wall height. */
  w: 5.2,
  d: 7.4,
  h: 2.7,
};
