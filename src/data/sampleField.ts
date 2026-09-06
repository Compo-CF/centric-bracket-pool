/**
 * A sample 64-team field so the app opens in a working state before a real
 * bracket exists. These are real programs in an illustrative arrangement --
 * it is not a prediction and not the real field. Every screen that renders it
 * says so. Replaced by the real field on Selection Sunday via the admin import.
 */

import type { RegionIndex, Team } from '../engine/types.js';

export const SAMPLE_FIELD_LABEL = 'Sample field';

/** Region names in bracket order. Region 1 and 2 meet in one semi-final. */
export const REGION_NAMES = ['South', 'East', 'Midwest', 'West'] as const;

/** Index 0 is the 1 seed, index 15 the 16 seed. */
const ROSTERS: readonly (readonly string[])[] = [
  [
    'Duke', 'Alabama', 'Wisconsin', 'Arizona', 'Oregon', 'BYU', "Saint Mary's",
    'Mississippi State', 'Baylor', 'Vanderbilt', 'VCU', 'Liberty', 'Akron',
    'Montana', 'Robert Morris', 'Norfolk State',
  ],
  [
    'Houston', 'Tennessee', 'Texas Tech', 'Purdue', 'Michigan', 'Illinois',
    'UCLA', 'Gonzaga', 'Georgia', 'Utah State', 'Drake', 'McNeese',
    'High Point', 'Troy', 'Wofford', 'SIU Edwardsville',
  ],
  [
    'Auburn', 'Michigan State', 'Iowa State', 'Texas A&M', 'Clemson', 'Missouri',
    'Kansas', 'UConn', 'Oklahoma', 'New Mexico', 'North Carolina',
    'UC San Diego', 'Yale', 'Lipscomb', 'Bryant', 'Alabama State',
  ],
  [
    'Florida', "St. John's", 'Kentucky', 'Maryland', 'Memphis', 'Mississippi',
    'Marquette', 'Louisville', 'Creighton', 'Arkansas', 'Xavier',
    'Colorado State', 'Grand Canyon', 'UNC Wilmington', 'Omaha',
    "Mount St. Mary's",
  ],
];

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function sampleField(): Team[] {
  const teams: Team[] = [];
  ROSTERS.forEach((roster, regionIndex) => {
    roster.forEach((name, seedIndex) => {
      teams.push({
        id: slug(name),
        name,
        seed: seedIndex + 1,
        region: (regionIndex + 1) as RegionIndex,
        espnId: null,
        eliminated: false,
      });
    });
  });
  return teams;
}

export function regionName(region: RegionIndex): string {
  return REGION_NAMES[region - 1] ?? `Region ${region}`;
}
