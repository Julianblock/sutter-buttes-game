# Sutter Buttes

Fly as a bird over the Sutter Buttes, the small volcanic range in the middle of California's Sacramento Valley.

**Play:** https://julianblock.github.io/sutter-buttes-game/

The terrain, land cover, roads, buildings and trees all come from real survey data. The landscape changes with the season and time of day: snow geese over flooded winter rice, almond bloom in February, golden summer grassland, and sodium-lit farm towns at night.

## Features

- **Real terrain.** USGS elevation and aerial imagery cover the Buttes in high detail, with a 400 km valley stretching out to the Sierra Nevada and Coast Ranges. The horizon follows the curvature of the Earth.
- **Physically based sky.** Rayleigh and Mie atmospheric scattering, with sun and moon positions calculated for the real date and place. Includes moon phases, stars, volumetric clouds and valley haze.
- **Thirteen local birds**, each with researched plumage variants and its own flight model: red-tailed hawk, golden eagle, turkey vulture, prairie falcon, peregrine, white-tailed kite, northern harrier, snow goose, sandhill crane, great egret, American white pelican, barn owl and bald eagle.
- **Vegetation.** About 1.4 million trees: blue oak and valley oak woodland detected from the imagery, plus almond, walnut and prune orchards planted on survey grids, with bloom and leaf colour that change by season.
- **Wildlife.** Grazing cattle, black-tailed deer, wild turkeys and coyotes that flee when you swoop low. Snow goose skeins, vulture kettles, egrets and blackbird murmurations, all varying by season.
- **Roads and traffic.** Cars, pickups and big rigs drive the real road network, including Pass Road through the Buttes. Headlights and taillights show at night.
- **Ranch tracks.** The private dirt tracks that wind into the range are mapped too: two-rut adobe lanes with a grassy crown that turn to mud in the rain. A graded one leaves North Butte Road for the slopes of North Butte.
- **Old cemeteries.** North Butte Cemetery (the "witches' cemetery") sits at the end of a long dirt lane off North Butte Road under a big valley oak, with weathered marble tablets, obelisks, toppled and broken stones, an iron fence and a "closed sunset to sunrise" sign. Noyesburg, Stohlman and the tiny Pugh family plot are built from their real outlines too.
- **Marysville.** Fly east across the Feather River to the old Gold Rush river port. Every building in a 5 km square around downtown is extruded from its real OpenStreetMap footprint, with tagged heights where mappers have recorded them and roof shapes, materials and storeys estimated from building type everywhere else. Downtown gets brick fronts with shopfronts, sash windows and cornices. St. Joseph Church (1855) has its white nave, lancet windows, rose window and 100 ft spire, and the Bok Kai Temple (1880) stands on the levee at the foot of D Street. Over the river are the 2019 Twin Cities Memorial Bridge beside the 1906–07 Northern Electric Pratt trusses, the 1947 Tenth Street bridge and the E Street bridge over the Yuba, all on piers above the water. Cars and the truck drive across their decks. On a Saturday night (or any night) the downtown sidewalks fill with people heading out. See [docs/marysville.md](docs/marysville.md).
- **Places.** The menu's Places tab starts you on Pass Road, North Butte Road, West Butte Road, at the cemetery gate, on the ranch track to North Butte, in downtown Marysville, on the Twin Cities Memorial Bridge or in front of St. Joseph Church.
- **Weather.** Clear, haze, scattered cloud, overcast, tule fog, rain, thunderstorms and snow. Rain soaks the ground and roads into reflective puddles with raindrop rings; snow builds up on fields, trees, roads and the truck, then melts depending on the season and sun. Lightning lights up the valley, and its thunder arrives late by the strike's distance. Wet roads cut tyre grip and can aquaplane the truck, fields turn to mud, snow makes everything slide, and showers bring downdrafts and turbulence that weigh a bird down.
- **Drive a pickup.** Swap between bird and truck at any time. The truck has a first-person cockpit with live gauges, headlights, wipers, dust and spray trails, and collisions with trees.
- **Structures.** Farmhouses, metal sheds, rice silos and the South Butte antenna farm with blinking beacons. Towns get lit windows, porch lights and streetlights.
- **Rivers and ponds.** The Sacramento, Feather and Yuba rivers, Butte Creek, the sloughs, canals and ponds are carved into the terrain at their real widths. The water reflects the sky, and from below you see Snell's window. Birds float and can dive under, and the truck can wade in (or drown).
- **Under water.** The water is green and murky with caustics on the riverbed. Fifteen real species swim there: Chinook salmon, steelhead, white sturgeon, striped bass, Sacramento pikeminnow, sucker, hardhead, splittail, tule perch, Sacramento perch, largemouth bass, bluegill, channel catfish, carp and American shad. Each lives in its own habitat and season.
- **The whole valley.** Away from the detailed imagery, procedural detail fills in: square-mile sections split into fields with crop rows and weedy ditches, flooded rice with levees and contour checks, and marsh with tule stands. Orchards, riverbank forest and farmstead groves grow in 3D around you wherever you fly.
- **Easter eggs and lore.** About thirty discoveries are hidden around the Buttes, with a card for each one you find. Reach the summits, follow the rivers and spot the fish. Visit the witches' cemetery after dark. And stand on top of North Butte to see the Buttes as they were 1.6 million years ago.
- **Procedural sound.** Wind rises with airspeed and whistles in a stoop, and wingbeats are audible. The ambience follows the time, season and terrain: meadowlarks, red-winged blackbirds, crickets that chirp at the right rate for the temperature, frogs over the rice, cattle, coyotes and honking geese.

## Controls

| Key | Action |
| --- | --- |
| W / S | Dive / climb |
| A / D | Bank |
| Q / E | Rudder |
| Space | Flap; take off when perched |
| Shift | Tuck and stoop |
| F / Ctrl | Flare, land |
| C | Cycle cameras |
| V | Call |
| M | Mute |
| H | Help |
| G | Switch between bird and truck |
| Esc | Menu |

Driving:

| Key | Action |
| --- | --- |
| W / S | Throttle / brake and reverse |
| A / D | Steer |
| Space | Handbrake |
| Shift | Boost |
| Mouse | Look around |
| C | Cockpit, chase or hood camera |
| L | Headlights |
| V | Horn |

On phones and tablets, on-screen controls replace the keyboard. A floating thumb-stick on the left pitches and banks the bird, or steers the truck (push it up for gas, down to brake). Buttons on the right flap, dive, flare, sprint and call, or work the gas, brake, handbrake, horn and lights. Drag the view to look around and pinch to zoom. Buttons along the top open the menu, change the camera, swap between bird and truck, and show help. The game goes full screen in landscape where the browser allows it, and you can add it to your home screen as an app. Mobile uses lighter rendering automatically; add `?hq` to the URL for full quality, or `?touch` to try the touch controls on a desktop.

## Development

```sh
npm install
npm run dev       # http://localhost:5173
npm run build
npm run data      # rebuild public/data from USGS / USDA / OSM sources
```

Debug URL parameters: `?fly` skips the menu, `?drive` starts in the truck, `?weather=rain` (or `storm`, `snow`, `tulefog`, …) and `?time=midday` pick conditions, `?place=cemetery` (or `pass`, `northbutte`, `westbutte`, `track`, `marysville`, `bridge`, `stjoseph`) picks the start point, and `?free&cam=x,y,z,yaw,pitch` starts a free camera.

## Data sources

- Elevation: AWS Terrain Tiles (USGS 3DEP / SRTM)
- Imagery: USGS National Map imagery (including a 1.7 m/pixel mosaic of Marysville)
- Land cover: USDA NASS Cropland Data Layer
- Roads, buildings, bridges and masts: © OpenStreetMap contributors
