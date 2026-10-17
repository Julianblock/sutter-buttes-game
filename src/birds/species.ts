// Birds that really work the skies over the Sutter Buttes, Butte Sink and the
// Sutter National Wildlife Refuge. Dimensions from Cornell / Sibley field data.

export type TailShape = 'fan' | 'square' | 'wedge' | 'notched' | 'short';
export type BeakType = 'hook' | 'falcon' | 'goose' | 'spear' | 'pelican' | 'owl' | 'vulture';
export type WingTip = 'slotted' | 'pointed' | 'rounded';

export interface Palette {
  name: string;
  head: string;
  throat: string;
  breast: string;
  belly: string;
  back: string;
  coverts: string;
  secondaries: string;
  primaries: string;
  underCoverts: string;
  underFlight: string;
  tail: string;
  tailUnder: string;
  beak: string;
  cere: string;
  legs: string;
  eye: string;
  skin: string; // bare head / crown patch
  bellyBand?: number;
  barring?: number;
  tailBands?: number;
  tailBandColor?: string;
  wingtipDark?: number;
  trailingEdge?: number;
  patagial?: number;
  carpal?: number;
  rump?: number;
  mottle?: number;
  helmet?: number; // falcon moustache / dark hood
  skinHead?: number; // fraction of head that is bare skin
  crown?: number; // red crown patch (crane)
  wingPanel?: number; // pale panel in primaries (golden eagle juv.)
}

export interface Shape {
  wingspan: number;
  length: number;
  bodyWidth: number;
  bodyDepth: number;
  neckLen: number;
  headSize: number;
  chord: number; // root chord as a fraction of semi-span
  taper: number; // 0 broad .. 1 pointed
  sweep: number; // radians of tip sweep-back
  tip: WingTip;
  fingers: number;
  fingerLen: number;
  tailLen: number;
  tailWidth: number;
  tail: TailShape;
  beak: BeakType;
  beakLen: number;
  legs: 'tucked' | 'trailing';
  legLen: number;
  dihedral: number; // radians at glide
  disk?: boolean; // owl facial disk
}

export interface FlightTraits {
  massKg: number;
  cruise: number; // m/s best glide speed
  stall: number;
  maxDive: number;
  glideRatio: number;
  flapHz: number;
  flapPower: number; // m/s^2 of thrust when flapping at cruise
  climb: number; // agility factor
  hover?: boolean;
  soarer?: boolean;
  nocturnal?: boolean;
  swimmer?: boolean;
}

export interface Species {
  id: string;
  name: string;
  latin: string;
  blurb: string;
  facts: string[];
  call: 'scream' | 'kek' | 'honk' | 'bugle' | 'croak' | 'hiss' | 'whistle' | 'screech' | 'chitter' | 'grunt';
  shape: Shape;
  flight: FlightTraits;
  palettes: Palette[];
}

const base = {
  eye: '#2a1a0c',
  legs: '#e8c23a',
  cere: '#e3b93c',
  skin: '#c43a2c',
};

export const SPECIES: Species[] = [
  {
    id: 'redtail',
    name: 'Red-tailed Hawk',
    latin: 'Buteo jamaicensis',
    blurb: 'The signature raptor of the Buttes. Rides ridge lift off the rampart and circles the thermals over Peace Valley.',
    facts: [
      'Its raspy keee-eeer scream is the "eagle" call Hollywood dubs into every movie.',
      'Hunts ground squirrels from oak snags along Pass Road.',
      'Pairs often stay together for life, reusing the same nest in a blue oak.',
    ],
    call: 'scream',
    shape: {
      wingspan: 1.24, length: 0.55, bodyWidth: 0.15, bodyDepth: 0.16, neckLen: 0.02, headSize: 0.07,
      chord: 0.42, taper: 0.25, sweep: 0.12, tip: 'slotted', fingers: 5, fingerLen: 0.24,
      tailLen: 0.22, tailWidth: 0.16, tail: 'fan', beak: 'hook', beakLen: 0.035, legs: 'tucked', legLen: 0.09, dihedral: 0.09,
    },
    flight: { massKg: 1.1, cruise: 13, stall: 6.5, maxDive: 55, glideRatio: 13, flapHz: 2.7, flapPower: 6, climb: 1, soarer: true },
    palettes: [
      { ...base, name: 'Light morph', head: '#6b4a2e', throat: '#efe6d6', breast: '#f2e9da', belly: '#efe3cf', back: '#5a3d26', coverts: '#6e4c30', secondaries: '#5b4330', primaries: '#3d2c1f', underCoverts: '#efe4d2', underFlight: '#e9e3da', tail: '#b5532c', tailUnder: '#e8c7b3', beak: '#2e2a28', bellyBand: 0.8, patagial: 0.9, trailingEdge: 0.7, wingtipDark: 0.25, mottle: 0.6, tailBands: 1, tailBandColor: '#2a1d14' },
      { ...base, name: 'Rufous morph', head: '#5a3520', throat: '#c78a5a', breast: '#b9703f', belly: '#a65e34', back: '#4a2e1c', coverts: '#5a3822', secondaries: '#4a3424', primaries: '#30231a', underCoverts: '#9c5a34', underFlight: '#dcd2c6', tail: '#b0502a', tailUnder: '#d9a587', beak: '#2e2a28', bellyBand: 0.5, patagial: 0.6, trailingEdge: 0.8, wingtipDark: 0.3, mottle: 0.4, tailBands: 1, tailBandColor: '#2a1d14' },
      { ...base, name: 'Dark morph', head: '#2c1e16', throat: '#33241a', breast: '#30221a', belly: '#2b1f17', back: '#261a13', coverts: '#2c1f17', secondaries: '#2a2019', primaries: '#1d1612', underCoverts: '#2a1d15', underFlight: '#bdb5ad', tail: '#a14a26', tailUnder: '#c98a6c', beak: '#2e2a28', trailingEdge: 0.9, wingtipDark: 0.3, mottle: 0.15, tailBands: 1, tailBandColor: '#1a120d' },
      { ...base, name: 'Juvenile', head: '#6e5136', throat: '#efe6d8', breast: '#efe5d3', belly: '#e9dcc5', back: '#5e4430', coverts: '#73563a', secondaries: '#6a5038', primaries: '#4a3726', underCoverts: '#eadfcc', underFlight: '#e2dcd2', tail: '#7a6248', tailUnder: '#d8cfc2', beak: '#2e2a28', eye: '#c9b26a', bellyBand: 0.9, patagial: 0.8, trailingEdge: 0.3, wingtipDark: 0.2, mottle: 0.8, tailBands: 6, tailBandColor: '#3a2a1c' },
    ],
  },
  {
    id: 'goldeneagle',
    name: 'Golden Eagle',
    latin: 'Aquila chrysaetos',
    blurb: 'Rare, enormous, unmistakable. Patrols the castellated core above South Butte on two-metre wings.',
    facts: [
      'Can dive at over 240 km/h onto jackrabbits on the open rampart.',
      'The golden hackles on the nape catch low sun like burnished bronze.',
      'Holds a dihedral so slight its wings look perfectly flat in a glide.',
    ],
    call: 'kek',
    shape: {
      wingspan: 2.05, length: 0.86, bodyWidth: 0.22, bodyDepth: 0.24, neckLen: 0.04, headSize: 0.1,
      chord: 0.4, taper: 0.2, sweep: 0.1, tip: 'slotted', fingers: 6, fingerLen: 0.26,
      tailLen: 0.34, tailWidth: 0.22, tail: 'square', beak: 'hook', beakLen: 0.06, legs: 'tucked', legLen: 0.14, dihedral: 0.06,
    },
    flight: { massKg: 4.5, cruise: 17, stall: 8, maxDive: 70, glideRatio: 15, flapHz: 1.9, flapPower: 5, climb: 0.8, soarer: true },
    palettes: [
      { ...base, name: 'Adult', head: '#c08a3e', throat: '#3a2618', breast: '#3a2718', belly: '#34231a', back: '#3e2a1c', coverts: '#6a4a2c', secondaries: '#3a2a1e', primaries: '#21170f', underCoverts: '#33241a', underFlight: '#4a3b30', tail: '#3e3024', tailUnder: '#5a4a3c', beak: '#3a3532', cere: '#e8c050', mottle: 0.5, tailBands: 3, tailBandColor: '#26190f', trailingEdge: 0.4 },
      { ...base, name: 'Juvenile (white patches)', head: '#b98238', throat: '#3a2618', breast: '#3a2718', belly: '#34231a', back: '#3a281b', coverts: '#4e3622', secondaries: '#3a2a1e', primaries: '#21170f', underCoverts: '#30211a', underFlight: '#3e3128', tail: '#f0ebe2', tailUnder: '#f0ebe2', beak: '#3a3532', cere: '#e8c050', wingPanel: 0.9, tailBands: 1, tailBandColor: '#1e150e', mottle: 0.2 },
    ],
  },
  {
    id: 'vulture',
    name: 'Turkey Vulture',
    latin: 'Cathartes aura',
    blurb: 'Teeters in a deep V over the valley for hours without a single wingbeat, sniffing out the world below.',
    facts: [
      'One of the few birds with a keen sense of smell; it can find carrion under the oak canopy.',
      'Kettles of dozens gather over the Buttes on warm autumn afternoons before migrating.',
      'The silvery flight feathers flash when it rocks in the wind.',
    ],
    call: 'hiss',
    shape: {
      wingspan: 1.75, length: 0.7, bodyWidth: 0.17, bodyDepth: 0.17, neckLen: 0.05, headSize: 0.06,
      chord: 0.36, taper: 0.15, sweep: 0.06, tip: 'slotted', fingers: 6, fingerLen: 0.25,
      tailLen: 0.27, tailWidth: 0.15, tail: 'fan', beak: 'vulture', beakLen: 0.04, legs: 'tucked', legLen: 0.1, dihedral: 0.26,
    },
    flight: { massKg: 1.6, cruise: 12, stall: 5.5, maxDive: 40, glideRatio: 16, flapHz: 1.8, flapPower: 4, climb: 0.7, soarer: true },
    palettes: [
      { ...base, name: 'Adult', head: '#b8362a', throat: '#2a2220', breast: '#251d19', belly: '#221b18', back: '#2b211c', coverts: '#3a2c22', secondaries: '#2b231f', primaries: '#221c19', underCoverts: '#1e1816', underFlight: '#b9b4ae', tail: '#26201c', tailUnder: '#a8a29b', beak: '#efe6d6', cere: '#d9c9b4', legs: '#d8c3b0', skin: '#b8362a', skinHead: 1, mottle: 0.4 },
      { ...base, name: 'Juvenile (grey head)', head: '#4b4440', throat: '#2a2220', breast: '#251d19', belly: '#221b18', back: '#2b211c', coverts: '#33271f', secondaries: '#2b231f', primaries: '#221c19', underCoverts: '#1e1816', underFlight: '#aca69f', tail: '#26201c', tailUnder: '#9c968f', beak: '#3a3532', cere: '#3a3532', legs: '#d8c3b0', skin: '#4b4440', skinHead: 1, mottle: 0.6 },
    ],
  },
  {
    id: 'prairiefalcon',
    name: 'Prairie Falcon',
    latin: 'Falco mexicanus',
    blurb: 'A pale desert falcon that winters along West Butte Road, screaming low over the stubble after larks.',
    facts: [
      'Black "armpits" give it away from below.',
      'Flies fast and low, using the terrain of the rampart to ambush prey.',
      'Birders drive the Buttes loop in winter specifically to find it.',
    ],
    call: 'kek',
    shape: {
      wingspan: 1.0, length: 0.42, bodyWidth: 0.11, bodyDepth: 0.12, neckLen: 0.01, headSize: 0.055,
      chord: 0.32, taper: 0.85, sweep: 0.38, tip: 'pointed', fingers: 0, fingerLen: 0,
      tailLen: 0.18, tailWidth: 0.1, tail: 'square', beak: 'falcon', beakLen: 0.025, legs: 'tucked', legLen: 0.06, dihedral: 0.02,
    },
    flight: { massKg: 0.7, cruise: 16, stall: 8, maxDive: 85, glideRatio: 11, flapHz: 4.2, flapPower: 9, climb: 1.4 },
    palettes: [
      { ...base, name: 'Adult', head: '#9a7a58', throat: '#f2ebe0', breast: '#efe4d4', belly: '#ece0cd', back: '#8b6e52', coverts: '#977a5c', secondaries: '#86694f', primaries: '#6a5440', underCoverts: '#2e241c', underFlight: '#ddd2c4', tail: '#9a7e62', tailUnder: '#e2d6c6', beak: '#4c5058', cere: '#e8c84a', barring: 0.45, helmet: 0.5, mottle: 0.5, tailBands: 5, tailBandColor: '#6a5440' },
    ],
  },
  {
    id: 'peregrine',
    name: 'Peregrine Falcon',
    latin: 'Falco peregrinus',
    blurb: 'The fastest animal alive. Hunts the clouds of ducks and shorebirds over the Butte Sink.',
    facts: [
      'Stoops at more than 320 km/h, wings folded into a teardrop.',
      'Back from the brink of extinction after DDT was banned.',
      'Winters in the valley to prey on the enormous waterfowl flocks.',
    ],
    call: 'kek',
    shape: {
      wingspan: 1.04, length: 0.43, bodyWidth: 0.12, bodyDepth: 0.13, neckLen: 0.01, headSize: 0.057,
      chord: 0.3, taper: 0.9, sweep: 0.42, tip: 'pointed', fingers: 0, fingerLen: 0,
      tailLen: 0.17, tailWidth: 0.1, tail: 'square', beak: 'falcon', beakLen: 0.026, legs: 'tucked', legLen: 0.06, dihedral: 0.02,
    },
    flight: { massKg: 0.9, cruise: 17, stall: 8.5, maxDive: 100, glideRatio: 11, flapHz: 4.5, flapPower: 10, climb: 1.5 },
    palettes: [
      { ...base, name: 'Adult', head: '#24272c', throat: '#f4efe6', breast: '#efe6da', belly: '#e1d7ca', back: '#4e5966', coverts: '#5a6573', secondaries: '#4a5360', primaries: '#30353d', underCoverts: '#d6cdc1', underFlight: '#cfc8bf', tail: '#46505c', tailUnder: '#d2cbc2', beak: '#3c4250', cere: '#f0c440', helmet: 1, barring: 0.7, tailBands: 6, tailBandColor: '#262a30' },
      { ...base, name: 'Juvenile', head: '#3a2e26', throat: '#efe2cf', breast: '#d9c4a6', belly: '#d2bb9b', back: '#4a3a2e', coverts: '#544336', secondaries: '#46372c', primaries: '#30261f', underCoverts: '#bfa98c', underFlight: '#c9bcaa', tail: '#4a3b30', tailUnder: '#cdbfae', beak: '#3c4250', cere: '#a8b0b8', helmet: 0.9, barring: 0.3, mottle: 0.3, tailBands: 6, tailBandColor: '#2a211b' },
    ],
  },
  {
    id: 'kite',
    name: 'White-tailed Kite',
    latin: 'Elanus leucurus',
    blurb: 'A ghost-white hunter that hangs motionless on beating wings over the grass, then drops like a stone.',
    facts: [
      '"Kiting" lets it hover in place against the breeze while it scans for voles.',
      'Nests in valley oaks and cottonwoods along the Sutter Bypass.',
      'Ruby-red eyes and coal-black shoulders on snow white.',
    ],
    call: 'whistle',
    shape: {
      wingspan: 1.0, length: 0.38, bodyWidth: 0.1, bodyDepth: 0.11, neckLen: 0.01, headSize: 0.055,
      chord: 0.3, taper: 0.7, sweep: 0.22, tip: 'pointed', fingers: 0, fingerLen: 0,
      tailLen: 0.18, tailWidth: 0.09, tail: 'square', beak: 'hook', beakLen: 0.022, legs: 'tucked', legLen: 0.06, dihedral: 0.12,
    },
    flight: { massKg: 0.33, cruise: 10, stall: 4.5, maxDive: 40, glideRatio: 12, flapHz: 3.4, flapPower: 8, climb: 1.2, hover: true },
    palettes: [
      { ...base, name: 'Adult', head: '#f4f2ee', throat: '#f7f5f1', breast: '#f6f4f0', belly: '#f5f3ef', back: '#a8adb2', coverts: '#1c1c1e', secondaries: '#b4b8bc', primaries: '#7c8086', underCoverts: '#f2f0ec', underFlight: '#d9dadb', tail: '#f4f3f0', tailUnder: '#f8f7f4', beak: '#1e1e20', cere: '#e8c24a', eye: '#b8201a', carpal: 1, wingtipDark: 0.35 },
      { ...base, name: 'Juvenile', head: '#e9d8bf', throat: '#f2ebe0', breast: '#eedcc2', belly: '#f3ece2', back: '#7d7468', coverts: '#26221e', secondaries: '#a4a29e', primaries: '#6e6c6a', underCoverts: '#efe8dc', underFlight: '#d4d2cf', tail: '#e8e6e2', tailUnder: '#f2f0ec', beak: '#1e1e20', eye: '#c27a3a', carpal: 1, mottle: 0.5, wingtipDark: 0.35 },
    ],
  },
  {
    id: 'harrier',
    name: 'Northern Harrier',
    latin: 'Circus hudsonius',
    blurb: 'Quarters low over the rice stubble and wetlands, tilting on raised wings, listening for mice like an owl.',
    facts: [
      'Its owl-like facial disk funnels sound to its ears.',
      'Males are pale grey "grey ghosts"; females brown with a bright white rump.',
      'Flies just metres above the ground for hours.',
    ],
    call: 'chitter',
    shape: {
      wingspan: 1.12, length: 0.5, bodyWidth: 0.11, bodyDepth: 0.12, neckLen: 0.01, headSize: 0.058,
      chord: 0.3, taper: 0.45, sweep: 0.16, tip: 'slotted', fingers: 4, fingerLen: 0.2,
      tailLen: 0.25, tailWidth: 0.1, tail: 'square', beak: 'hook', beakLen: 0.022, legs: 'tucked', legLen: 0.08, dihedral: 0.2, disk: true,
    },
    flight: { massKg: 0.45, cruise: 10, stall: 4.8, maxDive: 40, glideRatio: 12, flapHz: 3.2, flapPower: 7, climb: 1.1 },
    palettes: [
      { ...base, name: 'Grey ghost male', head: '#9da3a8', throat: '#b8bcbf', breast: '#c8cacb', belly: '#f4f3f0', back: '#8d949a', coverts: '#9aa1a7', secondaries: '#a3aaaf', primaries: '#2a2a2c', underCoverts: '#f3f2ef', underFlight: '#ececea', tail: '#9aa0a4', tailUnder: '#e8e7e4', beak: '#26262a', eye: '#e8c43a', rump: 1, wingtipDark: 0.45, trailingEdge: 0.6, tailBands: 4, tailBandColor: '#7d8389' },
      { ...base, name: 'Brown female', head: '#6a4c32', throat: '#cdb08c', breast: '#c49a6c', belly: '#d8bc94', back: '#5c4230', coverts: '#6a4e36', secondaries: '#5e4734', primaries: '#3e2e22', underCoverts: '#c7a27a', underFlight: '#cdbba6', tail: '#7a5c42', tailUnder: '#d2bea4', beak: '#26262a', eye: '#d2a640', rump: 1, barring: 0.3, mottle: 0.6, tailBands: 5, tailBandColor: '#3c2b1f' },
    ],
  },
  {
    id: 'snowgoose',
    name: 'Snow Goose',
    latin: 'Anser caerulescens',
    blurb: 'Arrives from the Arctic in October; by December tens of thousands blizzard over the flooded rice around the Buttes.',
    facts: [
      'Their constant, high-pitched yelping can be heard kilometres away.',
      'The rare "blue goose" morph is a dark variant of the same species.',
      'Flocks lift off all at once in a roaring white storm when a raptor passes.',
    ],
    call: 'honk',
    shape: {
      wingspan: 1.45, length: 0.75, bodyWidth: 0.2, bodyDepth: 0.19, neckLen: 0.16, headSize: 0.065,
      chord: 0.28, taper: 0.6, sweep: 0.18, tip: 'pointed', fingers: 0, fingerLen: 0,
      tailLen: 0.13, tailWidth: 0.12, tail: 'fan', beak: 'goose', beakLen: 0.055, legs: 'tucked', legLen: 0.1, dihedral: 0.04,
    },
    flight: { massKg: 2.6, cruise: 19, stall: 9.5, maxDive: 45, glideRatio: 9, flapHz: 3.4, flapPower: 9, climb: 0.9, swimmer: true },
    palettes: [
      { ...base, name: 'White morph', head: '#f3f1ec', throat: '#f4f2ed', breast: '#f5f3ee', belly: '#f6f4ef', back: '#f2f0eb', coverts: '#efede8', secondaries: '#ecebe7', primaries: '#1b1b1d', underCoverts: '#f5f3ee', underFlight: '#e9e8e4', tail: '#efede8', tailUnder: '#f4f2ed', beak: '#e88c8c', cere: '#e88c8c', legs: '#e8857a', wingtipDark: 0.42 },
      { ...base, name: 'Blue morph', head: '#f1efea', throat: '#e9e6e0', breast: '#5c616a', belly: '#6a6f77', back: '#5a5f68', coverts: '#8e98a6', secondaries: '#4a4f58', primaries: '#1e1f22', underCoverts: '#6c727b', underFlight: '#7c838d', tail: '#7c838c', tailUnder: '#e8e6e2', beak: '#e88c8c', cere: '#e88c8c', legs: '#e8857a', wingtipDark: 0.45 },
    ],
  },
  {
    id: 'crane',
    name: 'Sandhill Crane',
    latin: 'Antigone canadensis',
    blurb: 'Ancient bugling grey giants that roost in the Butte Sink wetlands and spiral high on thermals in winter.',
    facts: [
      'Their rolling, trumpeting call carries more than three kilometres.',
      'Fossils of near-identical cranes are 2.5 million years old, older than the Buttes themselves.',
      'Flies with neck outstretched and long legs trailing behind.',
    ],
    call: 'bugle',
    shape: {
      wingspan: 1.9, length: 1.05, bodyWidth: 0.2, bodyDepth: 0.2, neckLen: 0.36, headSize: 0.06,
      chord: 0.3, taper: 0.25, sweep: 0.08, tip: 'slotted', fingers: 6, fingerLen: 0.22,
      tailLen: 0.17, tailWidth: 0.13, tail: 'fan', beak: 'spear', beakLen: 0.11, legs: 'trailing', legLen: 0.55, dihedral: 0.06,
    },
    flight: { massKg: 4.0, cruise: 15, stall: 8, maxDive: 40, glideRatio: 12, flapHz: 2.2, flapPower: 5, climb: 0.7, soarer: true },
    palettes: [
      { ...base, name: 'Adult', head: '#b4b2ae', throat: '#efedea', breast: '#a7a6a3', belly: '#9fa09f', back: '#9d9a95', coverts: '#a8a29a', secondaries: '#8e8d8b', primaries: '#3a3836', underCoverts: '#b3b2b0', underFlight: '#7f7f80', tail: '#8e8c89', tailUnder: '#a8a7a5', beak: '#2e2e30', legs: '#2c2b2a', eye: '#c8902a', skin: '#c42e26', crown: 1, wingtipDark: 0.4, mottle: 0.35 },
      { ...base, name: 'Rusty (stained)', head: '#a8a29a', throat: '#ece8e2', breast: '#a67c5a', belly: '#9a8270', back: '#a17556', coverts: '#a8805e', secondaries: '#8a7c70', primaries: '#3a3634', underCoverts: '#a99a8c', underFlight: '#7a7878', tail: '#8a7c6e', tailUnder: '#a69a8e', beak: '#2e2e30', legs: '#2c2b2a', eye: '#c8902a', skin: '#c42e26', crown: 1, wingtipDark: 0.4, mottle: 0.5 },
    ],
  },
  {
    id: 'egret',
    name: 'Great Egret',
    latin: 'Ardea alba',
    blurb: 'Stately white wader of the rice checks and the heron rookery at Sutter National Wildlife Refuge.',
    facts: [
      'Its breeding plumes were nearly hunted to extinction for ladies\u2019 hats; the egret became the Audubon symbol.',
      'Flies with neck tucked into an S and black legs trailing.',
      'Follows tractors in rice fields to snatch frogs and crayfish.',
    ],
    call: 'croak',
    shape: {
      wingspan: 1.35, length: 0.95, bodyWidth: 0.12, bodyDepth: 0.13, neckLen: 0.08, headSize: 0.045,
      chord: 0.36, taper: 0.2, sweep: 0.05, tip: 'rounded', fingers: 0, fingerLen: 0,
      tailLen: 0.12, tailWidth: 0.1, tail: 'fan', beak: 'spear', beakLen: 0.11, legs: 'trailing', legLen: 0.5, dihedral: 0.0,
    },
    flight: { massKg: 0.9, cruise: 11, stall: 5, maxDive: 35, glideRatio: 10, flapHz: 2.4, flapPower: 6, climb: 0.9 },
    palettes: [
      { ...base, name: 'Breeding', head: '#f6f5f1', throat: '#f8f7f3', breast: '#f7f6f2', belly: '#f6f5f1', back: '#f5f4f0', coverts: '#f4f3ef', secondaries: '#f2f1ed', primaries: '#efeeea', underCoverts: '#f6f5f1', underFlight: '#eeede9', tail: '#f4f3ef', tailUnder: '#f6f5f1', beak: '#e6b82e', cere: '#9bc44a', legs: '#1c1c1c', eye: '#e2c23a' },
    ],
  },
  {
    id: 'pelican',
    name: 'American White Pelican',
    latin: 'Pelecanus erythrorhynchos',
    blurb: 'Squadrons of these 2.7-metre giants wheel in perfect unison over the Sutter Bypass all winter.',
    facts: [
      'Among the heaviest flying birds in North America.',
      'Flocks soar in silent, synchronised spirals, flashing black and white as they turn.',
      'They herd fish cooperatively rather than diving for them.',
    ],
    call: 'grunt',
    shape: {
      wingspan: 2.7, length: 1.6, bodyWidth: 0.3, bodyDepth: 0.28, neckLen: 0.18, headSize: 0.08,
      chord: 0.3, taper: 0.25, sweep: 0.06, tip: 'slotted', fingers: 6, fingerLen: 0.2,
      tailLen: 0.17, tailWidth: 0.18, tail: 'fan', beak: 'pelican', beakLen: 0.33, legs: 'tucked', legLen: 0.12, dihedral: 0.04,
    },
    flight: { massKg: 7, cruise: 15, stall: 7.5, maxDive: 40, glideRatio: 15, flapHz: 1.7, flapPower: 4, climb: 0.6, soarer: true, swimmer: true },
    palettes: [
      { ...base, name: 'Adult', head: '#f6f4ef', throat: '#f5f3ee', breast: '#f7f5f0', belly: '#f4f2ed', back: '#f5f3ee', coverts: '#f3f1ec', secondaries: '#1c1c1e', primaries: '#151517', underCoverts: '#f4f2ed', underFlight: '#1f1f22', tail: '#f2f0eb', tailUnder: '#f4f2ed', beak: '#e88a2c', cere: '#e8952e', legs: '#e8862a', eye: '#e8e0c0', wingtipDark: 0.5, trailingEdge: 1.0 },
    ],
  },
  {
    id: 'barnowl',
    name: 'Barn Owl',
    latin: 'Tyto alba',
    blurb: 'Silent golden phantom of the night, hunting voles along the levees and the old barns of the Buttes.',
    facts: [
      'Comb-like feather edges make its flight almost perfectly silent.',
      'Can catch prey in total darkness using hearing alone.',
      'Farmers set up owl boxes across the valley; a family eats thousands of rodents a year.',
    ],
    call: 'screech',
    shape: {
      wingspan: 1.0, length: 0.37, bodyWidth: 0.12, bodyDepth: 0.13, neckLen: 0.01, headSize: 0.075,
      chord: 0.4, taper: 0.3, sweep: 0.08, tip: 'rounded', fingers: 0, fingerLen: 0,
      tailLen: 0.12, tailWidth: 0.1, tail: 'square', beak: 'owl', beakLen: 0.018, legs: 'tucked', legLen: 0.1, dihedral: 0.03, disk: true,
    },
    flight: { massKg: 0.5, cruise: 8, stall: 3.8, maxDive: 30, glideRatio: 10, flapHz: 2.6, flapPower: 7, climb: 1.1, nocturnal: true, hover: true },
    palettes: [
      { ...base, name: 'Pale male', head: '#d6a868', throat: '#f7f3ea', breast: '#f6f1e6', belly: '#f8f4ec', back: '#c99a5a', coverts: '#d4a666', secondaries: '#d8b27a', primaries: '#cfa874', underCoverts: '#f6f2ea', underFlight: '#f0ebe0', tail: '#d6b07a', tailUnder: '#f4efe5', beak: '#e6d8c0', cere: '#e6d8c0', legs: '#d8cfc2', eye: '#100c0a', mottle: 0.7, tailBands: 4, tailBandColor: '#a07a4a' },
      { ...base, name: 'Buff female', head: '#c99654', throat: '#efe0c6', breast: '#e6c9a0', belly: '#ead3b0', back: '#bc8a4c', coverts: '#c9985a', secondaries: '#cfa46e', primaries: '#c39c68', underCoverts: '#ecdcc0', underFlight: '#e6d8c0', tail: '#cba670', tailUnder: '#ead9bc', beak: '#e6d8c0', cere: '#e6d8c0', legs: '#d8cfc2', eye: '#100c0a', mottle: 0.8, barring: 0.2, tailBands: 4, tailBandColor: '#94703f' },
    ],
  },
  {
    id: 'baldeagle',
    name: 'Bald Eagle',
    latin: 'Haliaeetus leucocephalus',
    blurb: 'Follows the waterfowl south each winter, hunting the Feather River and the Butte Sink marshes.',
    facts: [
      'Wintering bald eagles often steal fish from ospreys mid-air.',
      'Takes five years to grow the iconic white head and tail.',
      'Nests can weigh more than a tonne after decades of use.',
    ],
    call: 'chitter',
    shape: {
      wingspan: 2.03, length: 0.9, bodyWidth: 0.23, bodyDepth: 0.25, neckLen: 0.06, headSize: 0.1,
      chord: 0.42, taper: 0.15, sweep: 0.06, tip: 'slotted', fingers: 6, fingerLen: 0.24,
      tailLen: 0.3, tailWidth: 0.2, tail: 'wedge', beak: 'hook', beakLen: 0.075, legs: 'tucked', legLen: 0.14, dihedral: 0.03,
    },
    flight: { massKg: 4.7, cruise: 16, stall: 8, maxDive: 60, glideRatio: 14, flapHz: 2.0, flapPower: 5, climb: 0.8, soarer: true },
    palettes: [
      { ...base, name: 'Adult', head: '#f6f4ef', throat: '#f3f1ec', breast: '#2a1d14', belly: '#26190f', back: '#2c1f15', coverts: '#3a2a1c', secondaries: '#2a1f16', primaries: '#1c140e', underCoverts: '#24170f', underFlight: '#2c241e', tail: '#f5f3ee', tailUnder: '#f2f0eb', beak: '#f0c23a', cere: '#f0c23a', eye: '#e8d48a', mottle: 0.3 },
      { ...base, name: 'Immature (mottled)', head: '#3a2c20', throat: '#4a3a2c', breast: '#5c4632', belly: '#d8c8b0', back: '#4a3624', coverts: '#5c4530', secondaries: '#3a2c20', primaries: '#22180f', underCoverts: '#d6c6ae', underFlight: '#6a5a4a', tail: '#a69684', tailUnder: '#c8b8a2', beak: '#3a3532', cere: '#8a8274', eye: '#7a5a3a', mottle: 0.9, barring: 0.2 },
    ],
  },
];

export function speciesById(id: string): Species {
  return SPECIES.find((s) => s.id === id) ?? SPECIES[0];
}
