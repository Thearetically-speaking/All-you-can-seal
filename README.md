# All You Can SEAL

> Modify Bambu Lab 3D printers into a TPU heat-sealing tool by patching G-code.

`bgam_quick.py` (or `list_metadata.py`) is a small Python utility that rewrites the G-code inside Bambu Studio's `.gcode` and `.gcode.3mf` files to repurpose any Bambu printer (tested on **A1 mini** and **P1S**) as a heat-sealing machine. Instead of extruding filament to build a 3D object, the modified printer traces a 2D path with the nozzle hovering just above the bed — fusing two layers of TPU film into a custom-shaped inflatable pouch.

This repository accompanies the MDes/MDF thesis ***Catlike: Emotion-Responsive Pneumatic Wearables*** (OCAD University, 2026). The heat-sealing method was developed iteratively across four fabrication stages — soldering iron → hair straightener → Cricut heat press → modified Bambu A1 mini — and this script is the final iteration.

---

## What it does

The script edits four parameters in the sliced G-code so the printer behaves as a heat sealer rather than a 3D printer:

| Parameter | Stock value | Modified value | Purpose |
|---|---|---|---|
| Nozzle temperature | 230 °C | **260 °C** | Hot enough to fuse TPU film |
| Z offset | varies | **−0.15 mm** | Press nozzle *into* the film stack |
| Flow rate (M221) | 100 % | **120 %** | Injected after `;VT0` (no actual extrusion, retained as a marker) |
| Travel speed | 500 mm/s | **5 mm/s** | Slow enough to transfer heat through TPU |

It works by:
1. Unpacking the `.gcode.3mf` archive (it is just a renamed `.zip`)
2. Locating `Metadata/plate_1.gcode`
3. Patching both the config header and the machine body
4. Repacking the archive in place
5. Saving `.before.gcode` and `.after.gcode` next to the original for inspection

---

## ⚠️ Safety warning — read before running

Modifying G-code bypasses the slicer's safety checks. **Run at your own risk.** In particular:

- **Negative Z offset (−0.15 mm) presses the nozzle below the bed's zero point.** If your bed is not protected by a silicone mat or thick cardboard, you can scratch the build plate, damage the nozzle, or jam the toolhead.
- **260 °C is above the rated temperature for many TPU filaments.** Ensure adequate ventilation — TPU at this temperature releases fumes you should not breathe.
- **Travel speed at 5 mm/s with the heater on means the nozzle dwells over each point.** Do not leave the printer unattended. If the toolhead stalls, the bed material will scorch within seconds.
- **Always do a dry run first** with the heater off, watching the toolhead path, before committing TPU film.
- This workflow is **not endorsed by Bambu Lab** and may void your warranty.

This tool is intended for researchers, makers, and educators experimenting with soft fabrication. It is not a product.

---

## Hardware you'll need

| Item | Notes |
|---|---|
| **Bambu Lab 3D printer** | Tested on [A1 mini](https://bambulab.com/en/a1-mini) and [P1S](https://bambulab.com/en/p1). Other Bambu models with the same G-code structure should work but are untested. |
| **TPU filament** | Used to print the initial 0.28 mm "stamp" line that defines the seal path. [Bambu Generic TPU](https://bambulab.com/en/filament-guide/tpu) works well. |
| **TPU film** | The actual material being sealed. ~0.1–0.2 mm thickness, two layers. |
| **Silicone mat or thick cardboard** | Sits between the bed and the TPU stack to protect the build plate. |
| **Parchment paper** | Prevents the TPU from sticking to the silicone mat / nozzle. |
| **Tape** | Any clear packing tape works. Used to fix the TPU stack in place so it does not shift mid-print. |

---

## Software requirements

- Python 3.10+
- [Bambu Studio](https://bambulab.com/en/download/studio) (to slice the initial `.gcode.3mf`)
- [Fusion 360](https://www.autodesk.com/products/fusion-360) or any tool that exports STL (to build the 2D shape)
- [Adobe Illustrator](https://www.adobe.com/products/illustrator.html) or [The Noun Project](https://thenounproject.com/icons/) (to source SVGs)

No external Python dependencies — only the standard library.

---

## Quick start

```bash
# Clone the repo
git clone https://github.com/<your-username>/all-you-can-seal.git
cd all-you-can-seal

# Patch a sliced .gcode.3mf in place
python3 list_metadata.py path/to/your_sliced_file.gcode.3mf
```

The script edits the file in place and writes two side-by-side files for diffing:

```
your_sliced_file.before.gcode   # original
your_sliced_file.after.gcode    # patched
your_sliced_file.gcode.3mf      # patched, ready to send to printer
```

You can also patch a raw `.gcode` file directly:

```bash
python3 list_metadata.py path/to/your_file.gcode
```

---

## Full workflow

The script handles step 4. The full pipeline:

1. **Draw or find a shape.** SVG, simple closed path. Avoid sharp corners — the nozzle slows at corners and may scorch the film.
2. **Convert to STL.** Import the SVG into Fusion 360. Set stroke thickness to 2–3 mm and extrude height to **0.28 mm**. Export as STL.
3. **Slice in Bambu Studio.** Drag in the STL, set layer height to **0.28 mm Extra Draft**, choose a Generic TPU profile, and export the single-plate `.gcode.3mf`.
4. **Patch the G-code.** Run `python3 list_metadata.py your_file.gcode.3mf`.
5. **Print.** Place the cardboard / silicone mat on the bed, parchment paper on top, then your TPU film stack, then more parchment, then tape it all down. Send the patched file to the printer. Watch it.

---

## Configuration

The four key parameters are constants at the top of the script:

```python
NOZZLE_TEMP = 260       # °C
Z_OFFSET = -0.15        # mm (negative = press into bed)
FLOW_RATE = 120         # percent
TRAVEL_SPEED = 5        # mm/s
```

Tune these for your specific TPU film thickness and brand. Thicker films may want `−0.20 mm` Z offset; thinner films may scorch and need `+0.0` and lower temperature.

---

## FAQ / Troubleshooting

**The script says "未找到 CONFIG_BLOCK_END" / "MACHINE_START_GCODE_END".**
The G-code structure differs from what the script expects. This usually means it was sliced with a non-Bambu slicer (e.g. PrusaSlicer, OrcaSlicer with a non-Bambu profile). Re-slice with Bambu Studio targeting a Bambu printer.

**The script says "未找到内部文件 Metadata/plate_1.gcode".**
Your `.gcode.3mf` was exported as multi-plate. In Bambu Studio, use **Export single-plate slice file** instead of the regular export.

**The seal won't hold — film peels apart after cooling.**
Either the temperature is too low (try +5 °C), the Z offset is too high (try `−0.20 mm`), or the travel speed is too fast (try 3 mm/s). Change one variable at a time.

**The film burns through / leaves brown marks.**
Opposite problem. Reduce temperature first (try 250 °C), then raise Z offset toward zero. Make sure parchment paper is between the nozzle and the TPU.

**The nozzle scrapes the bed.**
Your Z offset is too aggressive for your stack thickness, or your cardboard / silicone mat is too thin. Add a layer or set `Z_OFFSET = -0.05`.

**Can I use this on a non-Bambu printer?**
Not directly. The script targets Bambu's specific G-code dialect (the `;VT0`, `M104`/`M109` placement, and the `Metadata/plate_1.gcode` path inside the 3MF). Adapting it for Prusa or Klipper is feasible but unimplemented.

**Will this void my warranty?**
Probably. Bambu does not document or support G-code modifications of this kind.

---

## Project context

This script was developed as part of ***Catlike***, a Research-through-Design (RtD) thesis exploring emotion-responsive pneumatic wearables at OCAD University. The wearables — an HRV-responsive headpiece and a plantar-pressure-responsive shoe — both rely on TPU air bladders sealed in custom shapes, which is what this tool produces.

Earlier iterations of the sealing method used a soldering iron, then a hair straightener, then a Cricut heat press. Each had constraints (precision, repeatability, shape complexity) that motivated the next step. The Bambu method described here was the original vision; institutional access to the printer arrived late in the project, which is why earlier iterations exist at all.

If you are using this for similar soft-robotics or wearable research, I'd love to hear about it.

---

## License

This project is licensed under [Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)](https://creativecommons.org/licenses/by-nc/4.0/).

You are free to share and adapt the material for non-commercial purposes, with attribution. Commercial use requires explicit permission.
