import type * as THREE from 'three';
import type { Discoveries, Discovery } from '../ui/discoveries';
import type { CemeteryPlan } from './cemetery';
import type { Heightfield } from './heightfield';
import type { Town } from './town';
import type { VolcanoVision } from './volcano';
import type { WaterKind } from './water';

export interface LoreState {
  pos: THREE.Vector3;
  driving: boolean;
  /** Camera under a river or pond. */
  underwater: boolean;
  /** Truck cab below the surface. */
  truckUnder: boolean;
  water: { name: string; kind: WaterKind } | null;
  /** Height of the actor above the water or ground. */
  agl: number;
  night: number;
  snowCover: number;
}

const BUTTES = { x: -500, z: -1700 };

type Spot = Discovery & { test: (s: LoreState) => boolean };

/** Peaks as mapped; the summit height comes from the terrain itself. */
const PEAKS = {
  north: { x: 2467, z: -3392 },
  south: { x: -487, z: -80 },
  west: { x: -2802, z: -1399 },
};

function townSpots(town: Town): Spot[] {
  const near = (id: string, r: number, agl: number) => {
    const l = town.landmark(id);
    return (s: LoreState) => !!l && Math.hypot(s.pos.x - l.x, s.pos.z - l.z) < r && s.agl < agl;
  };
  const downtown = (s: LoreState) => town.inCore(s.pos.x, s.pos.z);
  return [
    {
      id: 'marysville',
      kind: 'lore',
      kicker: 'Marysville · laid out 1850',
      title: 'The river port of the northern mines',
      text: 'Where the Yuba meets the Feather, steamboats from Sacramento unloaded for the gold camps of the Sierra, and Marysville became one of the largest towns in California. It is named for Mary Murphy Covillaud, a survivor of the Donner Party. Mining debris later raised the riverbeds, and the town has lived inside a ring of levees ever since.',
      test: (s) => downtown(s) && s.agl < 150,
    },
    {
      id: 'stjoseph',
      kind: 'lore',
      kicker: 'St. Joseph Church · 1855',
      title: 'A cathedral for half the West',
      text: 'The cornerstone was laid in September 1855. From 1860 St. Joseph’s was the cathedral of a vicariate reaching from the 39th parallel to Oregon and east to the Rockies. The stained glass came from the Zettler studio in Munich in 1899.',
      test: near('stjoseph', 70, 120),
    },
    {
      id: 'bokkai',
      kind: 'lore',
      kicker: 'Bok Kai Temple · 1880',
      title: 'The god who holds back the water',
      text: 'Built by Marysville’s Chinese community on the levee at the foot of D Street, the temple honours Bok Eye, the Taoist god of water, who keeps floods away. Every spring the Bok Kai Festival fills the streets with lion dancers, a dragon and firecrackers.',
      test: near('bokkai', 60, 100),
    },
    {
      id: 'twincities',
      kind: 'lore',
      kicker: 'Feather River · Fifth Street',
      title: 'Twin Cities',
      text: 'The concrete Fifth Street bridge between Yuba City and Marysville opened in 2019. Beside it stand the steel Pratt trusses built in 1906–07 for the Northern Electric interurban, which ran from Sacramento to Chico.',
      test: near('twincities', 160, 120),
    },
    {
      id: 'saturday-night',
      kind: 'secret',
      kicker: 'Downtown Marysville · after dark',
      title: 'Saturday night on D Street',
      text: 'Shopfronts lit, neon humming, the sidewalks full. Someone in Yuba City swears Marysville is the New York of the West.',
      test: (s) => downtown(s) && s.night > 0.6 && s.agl < 60,
    },
  ];
}

/**
 * Places and moments around the Buttes that tell a bit of their story when
 * you find them, plus the volcano vision from the top of North Butte.
 */
export class Lore {
  private spots: Spot[] = [];
  private visionArmed = true;
  readonly ids: string[];

  constructor(
    hf: Heightfield,
    private journal: Discoveries,
    private volcano: VolcanoVision,
    witches: CemeteryPlan | undefined,
    town?: Town | null,
  ) {
    const summit = (p: { x: number; z: number }) => {
      const h = hf.height(p.x, p.z);
      return (s: LoreState) => Math.hypot(s.pos.x - p.x, s.pos.z - p.z) < 150 && s.pos.y > h - 30 && s.pos.y < h + 220;
    };
    const fromButtes = (s: LoreState) => Math.hypot(s.pos.x - BUTTES.x, s.pos.z - BUTTES.z);
    const onWater = (re: RegExp) => (s: LoreState) => !!s.water && re.test(s.water.name) && s.agl < 60;
    this.northSummit = summit(PEAKS.north);
    this.spots = [
      {
        id: 'north-butte',
        kind: 'lore',
        kicker: 'Summit · North Butte',
        title: 'A volcano, 1.6 million years ago',
        text: 'The Sutter Buttes are what is left of a volcano that pushed up through the floor of the valley. For a few hundred thousand years, domes of andesite and rhyolite swelled and blew out ash, shoving the old seabed up into the ring of hills around you.',
        test: this.northSummit,
      },
      {
        id: 'south-butte',
        kind: 'lore',
        kicker: 'Summit · South Butte · 2,122 ft',
        title: 'The smallest mountain range in the world',
        text: 'Only about ten miles across, the Buttes rise alone out of a perfectly flat valley. The towers up here carry the valley’s radio and TV; their red lights blink all night. On a clear day you can see Lassen Peak to the north and the Sierra Nevada to the east.',
        test: summit(PEAKS.south),
      },
      {
        id: 'west-butte',
        kind: 'lore',
        kicker: 'Summit · West Butte',
        title: 'Frémont’s camp, 1846',
        text: 'In the spring of 1846 Captain John C. Frémont camped at the foot of the Buttes. American settlers rode out from his camp in June to seize Sonoma and raise the Bear Flag.',
        test: summit(PEAKS.west),
      },
      {
        id: 'histum-yani',
        kind: 'lore',
        kicker: 'Above the Buttes',
        title: 'Histum Yani · the Middle Mountain',
        text: 'To the Maidu, the Buttes are Histum Yani, the Middle Mountain of the valley. Spirits of the dead were said to rest here before setting out on their journey to the afterlife.',
        test: (s) => fromButtes(s) < 6000 && s.pos.y > 900,
      },
      {
        id: 'ring',
        kind: 'lore',
        kicker: 'Very high above the Buttes',
        title: 'The shape of an old volcano',
        text: 'From this high up you can see how it is built: a rugged core of lava domes in the middle, a moat of softer valley ground around it, and an outer ring of rock layers tipped on edge by the rising magma.',
        test: (s) => fromButtes(s) < 9000 && s.pos.y > 1900,
      },
      {
        id: 'witches-cemetery',
        kind: 'lore',
        kicker: 'North Butte Cemetery',
        title: 'The “witches’ cemetery”',
        text: 'A pioneer burial ground under North Butte, with weathered, toppled stones from the 1800s. Locals call it the witches’ cemetery, and swear something walks here after dark. Come back at night…',
        test: (s) => !!witches && s.night < 0.6 && Math.hypot(s.pos.x - witches.cx, s.pos.z - witches.cz) < 70 && s.agl < 40,
      },
      {
        id: 'sacramento',
        kind: 'lore',
        kicker: 'Sacramento River',
        title: 'California’s great river',
        text: 'About 400 miles from the slopes of Mount Shasta to the Delta. Winter-run Chinook salmon spawn in this river and nowhere else on Earth.',
        test: onWater(/sacramento/i),
      },
      {
        id: 'feather',
        kind: 'lore',
        kicker: 'Feather River',
        title: 'Gold Rush silt',
        text: 'The Feather drains the northern Sierra through Lake Oroville. In the 1860s–80s, mud washed down from hydraulic gold mines buried farms along it and raised its bed by many feet.',
        test: onWater(/feather/i),
      },
      {
        id: 'butte-creek',
        kind: 'lore',
        kicker: 'Butte Creek & Butte Slough',
        title: 'Spring-run salmon',
        text: 'Butte Creek holds the largest run of spring-run Chinook salmon left in the Central Valley. The fish hold in its cold pools all summer and spawn in the fall.',
        test: onWater(/butte (creek|slough)/i),
      },
      {
        id: 'underwater',
        kind: 'secret',
        kicker: 'Under the surface',
        title: 'Green water',
        text: 'Valley rivers run cloudy with fine Sierra silt, so you can only see a few metres. Look closely: a dozen native and introduced fish live down here.',
        test: (s) => s.underwater && !s.driving,
      },
      {
        id: 'truck-underwater',
        kind: 'secret',
        kicker: 'Achievement',
        title: 'Warranty void',
        text: 'The truck is now a submarine. The dealership would like a word.',
        test: (s) => s.truckUnder,
      },
      {
        id: 'snow-buttes',
        kind: 'secret',
        kicker: 'Rare weather',
        title: 'Snow on the Buttes',
        text: 'Snow sticks to the Buttes only once every few winters, and is gone within a day or two. Valley towns turn out with cameras.',
        test: (s) => s.snowCover > 0.3 && fromButtes(s) < 6000 && s.pos.y > 250,
      },
    ];
    if (town) this.spots.push(...townSpots(town));
    this.ids = this.spots.map((s) => s.id);
  }

  private northSummit: (s: LoreState) => boolean;

  update(s: LoreState) {
    for (const spot of this.spots) {
      if (this.journal.has(spot.id) || !spot.test(s)) continue;
      const { test: _t, ...d } = spot;
      this.journal.discover(d);
    }
    // Every visit to the North Butte summit replays the vision.
    const atTop = this.northSummit(s);
    if (atTop && this.visionArmed && !this.volcano.active) {
      this.volcano.start();
      this.visionArmed = false;
      if (this.journal.has('north-butte'))
        this.journal.whisper({ kind: 'lore', kicker: 'North Butte', title: 'The Buttes awaken', text: 'For a moment you see it as it was, 1.6 million years ago.' });
    }
    if (!atTop && !this.volcano.active) this.visionArmed = true;
  }
}
