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
- **Structures.** Farmhouses, metal sheds, rice silos and the South Butte antenna farm with blinking beacons. Towns get lit windows, porch lights and streetlights.
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
| Esc | Menu |

## Development

```sh
npm install
npm run dev       # http://localhost:5173
npm run build
npm run data      # rebuild public/data from USGS / USDA / OSM sources
```

Debug URL parameters: `?fly` skips the menu, and `?free&cam=x,y,z,yaw,pitch` starts a free camera.

## Data sources

- Elevation: AWS Terrain Tiles (USGS 3DEP / SRTM)
- Imagery: USGS National Map imagery
- Land cover: USDA NASS Cropland Data Layer
- Roads, buildings and masts: © OpenStreetMap contributors
