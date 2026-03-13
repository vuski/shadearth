# ShadEarth

A photorealistic 3D globe renderer with terrain-based shadow and ambient occlusion effects.

This project adapts [wwwtyro's 2D map tile lighting technique](https://github.com/wwwtyro/map-tile-lighting-demo) to a 3D globe, with atmospheric rendering ported from [takram/three-geospatial](https://github.com/takram-design-engineering/three-geospatial). It combines these excellent works into a unified Earth visualization.

Roughly speaking, this project consists of ~40% borrowed code, ~55% vibe coding with Claude Code, and ~5% tweaking variables and parameters until it looked right.

## Features

- Real-time hillshading and soft shadows using DEM (Digital Elevation Model) 2D ray traversal
- Monte Carlo sampled soft shadows simulating solar disc size
- Ambient occlusion for realistic terrain lighting
- Physical sun/moon position based on date and time
- Day/night cycle with city lights
- Atmospheric scattering (Rayleigh/Mie) and aerial perspective
- Lens flare effect

## Demo

[https://shadearth.vw-lab.com](https://shadearth.vw-lab.com)

**Note:** Works on mobile but the UI covers most of the screen, and navigation will be very slow. Rendering is not optimized, so the 128-step soft shadow pass can take up to a minute depending on the scene.

### How to Use

1. Navigate the globe by dragging and zooming
2. Set the sun position using the time/date controls
3. Click the **Render** button to calculate soft shadows
4. For distant views, increase **Elevation Scale** to emphasize terrain relief (exaggerated elevation is not realistic, but helps visualize topography from space where actual mountains would be imperceptible)
5. If the scene looks too dark, adjust **Brightness** and other settings in Post Processing

## References

This project builds upon several excellent open-source works:

| Component            | Source                                                                                   | Usage                                                                                                                                                                                                                |
| -------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Render Engine**    | [wwwtyro/map-tile-lighting-demo](https://github.com/wwwtyro/map-tile-lighting-demo)      | Core rendering algorithm: multi-pass soft shadows and ambient occlusion using ping-pong buffer accumulation. Amanatides-Woo 2D DDA algorithm for shadow ray traversal in texture space.                              |
| **XYZ Tile System**  | [NASA-AMMOS/3DTilesRendererJS](https://github.com/NASA-AMMOS/3DTilesRendererJS)          | Globe geometry via `XYZTilesPlugin`, tile loading/caching, and `GlobeControls` for intuitive Earth navigation.                                                                                                       |
| **Atmosphere + Sky** | [takram/three-geospatial](https://github.com/takram-design-engineering/three-geospatial) | Bruneton precomputed atmospheric scattering textures (transmittance, scattering, irradiance), `SkyMaterial` for physically-based sky rendering, `AerialPerspectiveEffect` for distance fog, and starfield rendering. |

## Map Sources

| Layer                 | Source                                                                                          | License                       |
| --------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------- |
| **Satellite Imagery** | [Esri World Imagery](https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9) | Esri Master License Agreement |
| **DEM (Elevation)**   | [Mapterhorn](https://mapterhorn.com/)                                                           | CC BY 4.0                     |
| **Night Lights**      | [NASA Earth Observatory](https://science.nasa.gov/earth/earth-observatory/earth-at-night/maps/) | Public Domain                 |
| **Star Map**          | [NASA SVS Deep Star Maps 2020](https://svs.gsfc.nasa.gov/4851/)                                 | Public Domain                 |

## Keyboard Shortcuts

| Key     | Action                   |
| ------- | ------------------------ |
| A / F   | Day -/+                  |
| S / D   | Time -/+                 |
| U       | Toggle UI                |
| P       | Screenshot (canvas only) |
| Shift+P | Screenshot (with UI)     |

## Tech Stack

- **Framework**: Vite + TypeScript
- **3D Engine**: Three.js
- **Post-processing**: postprocessing
- **Globe**: 3d-tiles-renderer
- **Shaders**: Custom GLSL

## Author

**VWL Inc.**
[www.vw-lab.com](https://www.vw-lab.com)

## License

MIT License

Copyright (c) 2026 VWL Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
