; HEADER_BLOCK_START
; BambuStudio 02.06.00.51
; model printing time: 17m 33s; total estimated time: 26m 50s
; total layer number: 2
; HEADER_BLOCK_END

; CONFIG_BLOCK_START
; curr_bed_type = Textured PEI Plate
; filament_flow_ratio = 0.98
; nozzle_temperature = 230
; nozzle_temperature_initial_layer = 230
; nozzle_temperature_range_high = 240
; printer_model = Bambu Lab A1 mini
; CONFIG_BLOCK_END

; EXECUTABLE_BLOCK_START
M73 P0 R26
; FEATURE: Custom
;===== machine: A1 mini =========================
;===== date: 20251031 ==================
M1002 gcode_claim_action : 2
M104 S170
M140 S30
M109 S100 H170
M104 S170
M109 S250 ;set nozzle to common flush temp
M109 S230
M104 S250
M104 S230
G28 X
G1 X0.0 F30000
G1 X-13.5 F3000
M109 S170
M104 S140
M400
M109 S230 H170
M104 S230
G1 X25 Y175 F30000.1 ;Brush material
M400
;curr_bed_type=Textured PEI Plate
G29.1 Z-0.04 ; for Textured PEI Plate
M960 S1 P0 ; turn off laser
G90
M83
; MACHINE_START_GCODE_END
; filament start gcode

;VT0 H-1
G90
G21
M83 ; use relative distances for extrusion
; CHANGE_LAYER
; Z_HEIGHT: 0.2
; LAYER_HEIGHT: 0.2
G1 E-.4 F1800
; layer num/total_layer_count: 1/2
G1 X10 Y10 F42000
G1 Z.2
G1 E.4 F1800
; FEATURE: Outer wall
G1 F30000
G1 X20 Y10 E.5 F300
G1 X20 Y20 E.5
G2 X10 Y20 I-5 J0 E.5
G1 F30000
G1 X25 Y175 F30000.1
; CHANGE_LAYER
; Z_HEIGHT: 0.4
; layer num/total_layer_count: 2/2
G1 Z.4
G1 X10 Y10 F42000
G1 X30 Y30 E1.0 F300
; MACHINE_END_GCODE_START
M104 S0
M140 S0
; EXECUTABLE_BLOCK_END
