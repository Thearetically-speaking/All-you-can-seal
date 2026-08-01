# All You Can SEAL

> Modify Bambu Lab 3D printers into a TPU heat-sealing tool by patching G-code.

This project rewrites the G-code inside Bambu Studio's `.gcode` and `.gcode.3mf` files to repurpose any Bambu printer (tested on **A1 mini** and **P1S**) as a heat-sealing machine. Instead of extruding filament to build a 3D object, the modified printer traces a 2D path with the nozzle hovering just above the bed — fusing two layers of TPU film into a custom-shaped inflatable pouch.

## What it does
 
Soft pneumatic wearables need airtight TPU chambers, and making them has traditionally required an impulse sealer, an ultrasonic welder, or a custom CNC sealing platform. This method produces them on a stock consumer 3D printer.
 
Heat sealing needs three inputs — **heat, contact pressure, and dwell time**. All three are recovered from parameters the printer already has:
 
| Input | How it's delivered |
|---|---|
| **Heat** | Raised nozzle temperature |
| **Pressure** | A negative Z offset presses the nozzle into the film stack, with the force distributed by a bead of over-extruded molten TPU |
| **Dwell time** | A heavily reduced feed rate |
 
**Extrusion stays on — that's the point.** Prior 3D-printer sealing methods disable extrusion and use the bare nozzle as a passive heat source, which lets residue build up and wears the nozzle. Here the deposited bead acts as a continuously refreshed interface between nozzle and film: it transmits heat and pressure into the stack while lubricating the nozzle so it doesn't drag on the release layer. The bead is part of the mechanism, not a by-product.
 
Nothing is modified or sacrificed. Only the parchment release layer is consumed per seal, and the printer goes back to normal printing immediately afterwards.
 
---
 
## Two ways to use it
 
### 🛜 Web app (recommended)
 
<https://thearetically-speaking.github.io/All-you-can-seal/>
 
1. **Convert** — drop in a `.gcode.3mf` exported by Bambu Studio (or a bare `.gcode`), pick your film thickness, download the patched file.
2. **Validate** — check a patched file before you send it to the printer. Worth doing every time; this workflow drives the nozzle *below* the bed's zero point.
Available in English and 中文. All processing happens client-side.
 
### 🐍 Python script
 
```bash
git clone https://github.com/Thearetically-speaking/All-you-can-seal.git
cd All-you-can-seal
python3 allyoucanseal-bambu.py path/to/your_sliced_file.gcode.3mf
```
 
Python 3.10+, standard library only. The script edits the file in place and writes two copies alongside it for diffing:
 
```
your_file.before.gcode    # original
your_file.after.gcode     # patched
your_file.gcode.3mf       # patched, ready to send
```
 
It works by treating the `.gcode.3mf` as the ZIP archive it is, locating `Metadata/plate_1.gcode`, patching both the config header and the machine body, and repacking.
 
---
 
## Parameters
 
**Verified on 0.03 mm and 0.05 mm TPU film**, across the **A1 mini**, **A1**, and **P1S**. For each thickness a single parameter set transfers across all three printers with no per-device tuning. Everything below is measured, not extrapolated — see [Other films](#other-films) for what is and isn't expected to carry over.
 
| Parameter | Stock | 0.03 mm film | 0.05 mm film | Role |
|---|---|---|---|---|
| Nozzle temperature | 230 °C | **250 °C** | **260 °C** | Heat |
| Z offset | 0 mm | −0.10 mm | −0.15 mm | Pressure |
| Extrusion multiplier | 100 % | 120 % | 120 % | Bead |
| Feed rate | 30 000 mm/min | **300 mm/min** | **180 mm/min** | Dwell |
 
Only the two thermal parameters change with thickness — heat delivery has to scale with the film's thermal mass. The pressure parameters hold constant across the tested range.
 
**Minimum reliable seam width: 2 mm**, at both thicknesses. Below that (tested at 1 mm) seals show occasional unbonded segments. The limit appears to be set by nozzle diameter and bead width rather than by the film.
 
---
 
## Other films
 
**The workflow is material-agnostic. The parameters are not.**
 
The stack-up, the slicer integration, and the patching script make no assumptions about what's being sealed — they only control heat, pressure and dwell. Any thin thermoplastic film that can be heat-sealed should be sealable this way. What has to be re-found for a new material is the *values*.
 
Splitting the four parameters by how far they're expected to travel:
 
| | Expected to transfer | Why |
|---|---|---|
| **Z offset**, **extrusion multiplier** | Likely, within a similar thickness range | These deliver mechanical contact pressure, and they held constant across our two thicknesses — the mechanism looks thickness-independent in the tested range |
| **Nozzle temperature**, **feed rate** | **No — must be re-tuned** | These deliver heat, which has to scale with the melting point and thermal mass of the specific film |
 
So a reasonable starting point for a new material: keep Z offset and extrusion multiplier, and search temperature and feed rate. Change one at a time. Prior work characterizing household thermoplastic films on stock FDM printers ([Therms-Up!](https://doi.org/10.1145/3430524.3442457)) is a useful reference for where different materials sit.
 
PVC and EVA are the obvious next candidates and are named as future work in the paper — **but read the safety note on PVC below before you try it.**
 
If you characterize a film we haven't, please open an issue with your parameters, film thickness and printer. A community-contributed table mapping film properties to parameter values is exactly what this needs.
 
---
 
## Hardware and materials
 
| Item | Notes |
|---|---|
| **Bambu Lab printer** | Verified on A1 mini, A1, P1S. Other Bambu models sharing the same G-code structure should work but are untested |
| **TPU film** | The material being sealed. Two layers. Characterized at 0.03 mm and 0.05 mm. Other thermoplastic films should work with re-tuned thermal parameters — see [Other films](#other-films) |
| **TPU filament** | Supplies the sealing bead. Generic Bambu TPU works |
| **Silicone mat, 2–3 mm** | Sits on the build plate. Absorbs the vertical contact force so the heated bed isn't indented and the nozzle never meets a rigid surface. **Not optional, and don't substitute cardboard** at these temperatures |
| **Parchment paper** | Release layer over the top of the stack. The bead adheres to the parchment, not to your film |
| **High-temperature tape** | Holds the stack at its edges. Kapton or equivalent — ordinary packing tape will not survive a 260 °C nozzle passing over it |
| **Spray bottle of water** | For misting between film layers |
 
---
 
## Material stack-up
 
Bottom to top:
 
1. Standard build plate
2. **2–3 mm silicone mat**
3. **Lower TPU film**, lightly misted with water — surface tension pulls it flat against the mat and eliminates trapped bubbles
4. **Upper TPU film**, again misted against the lower film so no air pocket remains between the two
5. **Parchment paper** covering the top, as the release layer
Tape the edges down with high-temperature tape so nothing shifts under nozzle motion.
 
The water misting is a functional step, not a nicety — trapped air between the layers produces unsealed segments.
 
---
 
## Full workflow
 
1. **Draw the seal path.** A closed 2D vector path (SVG). Keep the stroke ≥ 2 mm. Avoid sharp corners — the nozzle decelerates at corners and can scorch the film.
2. **Extrude to 0.28 mm** in Fusion 360 or any CAD tool, export STL. The 0.28 mm matches Bambu Studio's *Extra Draft* layer-height preset for a 0.4 mm nozzle, so the slicer emits exactly one layer of toolpath.
3. **Slice in Bambu Studio:** layer height 0.28 mm (Extra Draft), 1 layer, 1 wall, 100 % infill, no support, no brim. TPU filament profile, **bed temperature 30 °C**, **part cooling fan off** — active cooling stops the bead delivering sustained heat. Export as a **single-plate** slice file.
4. **Patch** with the web app or the script.
5. **Validate**, then dry-run with the heater off and watch the toolhead path before committing film.
6. **Seal.** Watch it.
---
 
## ⚠️ Safety
 
The printer is not permanently modified, but the process bypasses the slicer's safety checks. Read this before your first run.
 
- **The negative Z offset presses the nozzle below the bed's zero point.** Without the silicone mat you can scratch the build plate, damage the nozzle, or jam the toolhead.
- **250–260 °C is above the rated temperature of many TPU filaments.** Ventilate. Do not breathe the fumes.
- **Do not seal PVC or other chlorinated films without proper extraction.** PVC decomposes well below these temperatures and releases hydrogen chloride — corrosive to your lungs and to the printer. Room ventilation is not sufficient. This applies to any chlorine-containing film, including cling film and much craft vinyl. If you're exploring new materials, check the decomposition temperature and decomposition products *before* the melting point.
- **At 180–300 mm/min with the heater on, the nozzle dwells over every point.** Do not leave the printer unattended — if the toolhead stalls, the stack scorches within seconds.
- **Always dry-run first** with the heater off.
- Not endorsed by Bambu Lab. May void your warranty.
Intended for researchers, makers, and educators experimenting with soft fabrication. Not a product.
 
---
 
## Troubleshooting
 
**"Metadata/plate_1.gcode not found."** Your file was exported as multi-plate. In Bambu Studio use *Export single-plate slice file*.
 
**"CONFIG_BLOCK_END / MACHINE_START_GCODE_END not found."** The file wasn't sliced by Bambu Studio against a Bambu printer profile. Re-slice.
 
**Seal peels apart after cooling.** Not enough heat into the stack: raise temperature ~5 °C, or lower the feed rate. Change one variable at a time.
 
**Film scorches or browns.** Too much heat: drop the temperature first, then raise the Z offset toward zero. Confirm the parchment is between nozzle and film.
 
**Unsealed gaps along the path.** Seam width below 2 mm, trapped air between layers (mist more), or the stack shifted (more tape).
 
**Nozzle scrapes the bed.** Z offset too aggressive for your stack, or the silicone mat is too thin. Try −0.05 mm.
 
**Non-Bambu printer?** Not directly — the script targets Bambu's G-code dialect and the `.3mf` layout. Adapting it for Prusa or Klipper is feasible but unimplemented.
 
---
 
## Repository contents
 
| File | |
|---|---|
| `allyoucanseal-bambu.py` | The patching script |
| `test1.gcode.3mf` | Sample sliced file for testing the workflow |
| `TPU_Inflatable.pdf` | Reference seal patterns |
 
---
 
## Project context
 
Developed for **Catlike**, a Research-through-Design thesis on emotion-responsive pneumatic wearables at OCAD University — an HRV-responsive headpiece and a plantar-pressure-responsive shoe, both built on TPU bladders sealed in custom shapes.
 
The sealing method went through four stages: soldering iron → hair straightener → Cricut heat press → Bambu printer. Structures made with this workflow ran continuously in a four-day exhibition with no observed leakage.
 
If you use this for soft-robotics or wearable research, I'd like to hear about it.
 
## License
 
MIT.
 
You are free to share and adapt the material for non-commercial purposes, with attribution. Commercial use requires explicit permission.

