#!/usr/bin/env python3
import argparse
import os
import re
import sys
import tempfile
import zipfile
from pathlib import Path, PurePosixPath


NOZZLE_TEMP = 260
Z_OFFSET = -0.15
FLOW_RATE = 120
TRAVEL_SPEED = 5


INTERNAL_GCODE_PATH = "Metadata/plate_1.gcode"
EXCLUDED_TEMPS = {75.0, 140.0, 210.0, 250.0}
SOURCE_PRINT_TEMP = 230.0


def fmt_temp(value: float) -> str:
    if float(value).is_integer():
        return str(int(value))
    return f"{value:g}"


def fmt_ratio(flow_rate_percent: float) -> str:
    ratio = flow_rate_percent / 100.0
    return f"{ratio:g}"


def fmt_z(value: float) -> str:
    return f"{value:g}"


def parse_boundaries(lines: list[str]) -> dict[str, int | None]:
    config_end = None
    machine_start = None
    machine_end = None

    for idx, line in enumerate(lines):
        if config_end is None and "; CONFIG_BLOCK_END" in line:
            config_end = idx
        if machine_start is None and "; MACHINE_START_GCODE_END" in line:
            machine_start = idx
        if machine_end is None and "; MACHINE_END_GCODE_START" in line:
            machine_end = idx

    return {
        "config_end": config_end,
        "machine_start": machine_start,
        "machine_end": machine_end,
    }


def replace_config_value(lines: list[str], key: str, new_value: str) -> tuple[int, str | None, str | None]:
    pattern = re.compile(rf"^(\s*;\s*{re.escape(key)}\s*=\s*)([^\r\n]*)(\r?\n?)$")
    count = 0
    old_value = None

    for idx, line in enumerate(lines):
        match = pattern.match(line)
        if not match:
            continue
        prefix, value, line_end = match.groups()
        if old_value is None:
            old_value = value.strip()
        if value.strip() == new_value:
            continue
        lines[idx] = f"{prefix}{new_value}{line_end}"
        count += 1

    return count, old_value, new_value


def apply_nozzle_temp_in_startup(lines: list[str]) -> tuple[int, str | None]:
    pattern = re.compile(r"^(\s*M10[49]\s+S)(-?\d+(?:\.\d+)?)([^\r\n]*)(\r?\n?)$")
    replacement_value = fmt_temp(NOZZLE_TEMP)
    count = 0
    first_old = None

    for idx, line in enumerate(lines):
        match = pattern.match(line)
        if not match:
            continue

        prefix, value_str, suffix, line_end = match.groups()
        value = float(value_str)

        if value in EXCLUDED_TEMPS:
            continue
        if value != SOURCE_PRINT_TEMP:
            continue
        if value_str == replacement_value:
            continue

        if first_old is None:
            first_old = value_str
        lines[idx] = f"{prefix}{replacement_value}{suffix}{line_end}"
        count += 1

    return count, first_old


def apply_z_offset_in_startup(lines: list[str]) -> tuple[int, str | None]:
    pattern = re.compile(
        r"^(\s*G29\.1\s+Z)(-?\d+(?:\.\d+)?)(\s*;\s*for Textured PEI Plate\s*)(\r?\n?)$"
    )
    replacement_value = fmt_z(Z_OFFSET)

    for idx, line in enumerate(lines):
        match = pattern.match(line)
        if not match:
            continue

        prefix, old_z, suffix, line_end = match.groups()
        if old_z == replacement_value:
            return 0, old_z
        lines[idx] = f"{prefix}{replacement_value}{suffix}{line_end}"
        return 1, old_z

    return 0, None


def inject_m221_after_vt0(lines: list[str]) -> tuple[int, bool]:
    target = f"M221 S{int(FLOW_RATE)}"
    vt0_index = None

    for idx, line in enumerate(lines):
        if line.lstrip().startswith(";VT0"):
            vt0_index = idx
            break

    if vt0_index is None:
        return 0, False

    search_end = len(lines)
    for idx in range(vt0_index + 1, len(lines)):
        stripped = lines[idx].strip()
        if stripped.startswith("G0") or stripped.startswith("G1"):
            search_end = idx
            break

    for idx in range(vt0_index + 1, search_end):
        if lines[idx].strip().startswith("M221 S"):
            if lines[idx].strip() == target:
                return 0, True
            lines[idx] = target + "\n"
            return 1, True

    lines.insert(vt0_index + 1, target + "\n")
    return 1, True


def apply_travel_speed_in_body(lines: list[str]) -> tuple[int, str, str]:
    target_feedrate = int(TRAVEL_SPEED * 60)
    source = "F30000"
    target = f"F{target_feedrate}"
    standalone_target = "G1 F300"
    standalone_pattern = re.compile(r"^\s*G1\s+F-?\d+(?:\.\d+)?\s*(?:;[^\r\n]*)?(\r?\n?)$")
    count = 0

    for idx, line in enumerate(lines):
        standalone_match = standalone_pattern.match(line)
        if standalone_match:
            line_end = standalone_match.group(1)
            newline = line_end if line_end else "\n"
            replacement = f"{standalone_target}{newline}"
            if line != replacement:
                lines[idx] = replacement
                count += 1
            continue

        new_line, replaced = re.subn(r"\bF30000\b", target, line)
        if replaced:
            lines[idx] = new_line
            count += replaced

    return count, source, target


def modify_gcode_text(content: str) -> tuple[str, dict[str, object], list[str]]:
    lines = content.splitlines(keepends=True)
    boundaries = parse_boundaries(lines)
    warnings: list[str] = []

    config_end = boundaries["config_end"]
    machine_start = boundaries["machine_start"]
    machine_end = boundaries["machine_end"]

    results: dict[str, object] = {
        "temp_changes": 0,
        "temp_old": None,
        "z_changes": 0,
        "z_old": None,
        "flow_injected": 0,
        "flow_config_changes": 0,
        "travel_changes": 0,
        "travel_old": "500",
        "travel_new": str(TRAVEL_SPEED),
    }

    if config_end is None:
        warnings.append("未找到 CONFIG_BLOCK_END，跳过 config header 相关修改。")
    if machine_start is None:
        warnings.append("未找到 MACHINE_START_GCODE_END，跳过 startup/body 相关修改。")
    if machine_end is None:
        warnings.append("未找到 MACHINE_END_GCODE_START，跳过打印主体移动速度修改。")

    if config_end is not None and machine_start is not None:
        startup = lines[config_end + 1 : machine_start + 1]

        temp_count, temp_old = apply_nozzle_temp_in_startup(startup)
        z_count, z_old = apply_z_offset_in_startup(startup)

        lines[config_end + 1 : machine_start + 1] = startup
        results["temp_changes"] = int(results["temp_changes"]) + temp_count
        results["z_changes"] = z_count
        results["z_old"] = z_old
        if temp_old is not None:
            results["temp_old"] = temp_old

    if config_end is not None:
        config_header = lines[: config_end + 1]

        c1, temp_old_1, _ = replace_config_value(config_header, "nozzle_temperature", fmt_temp(NOZZLE_TEMP))
        c2, _temp_old_2, _ = replace_config_value(
            config_header,
            "nozzle_temperature_initial_layer",
            fmt_temp(NOZZLE_TEMP),
        )
        cf, _flow_old, _ = replace_config_value(config_header, "filament_flow_ratio", fmt_ratio(FLOW_RATE))

        lines[: config_end + 1] = config_header

        results["temp_changes"] = int(results["temp_changes"]) + c1 + c2
        results["flow_config_changes"] = cf
        if results["temp_old"] is None and temp_old_1 is not None:
            results["temp_old"] = temp_old_1

    if machine_start is not None and machine_end is not None and machine_start < machine_end:
        body = lines[machine_start + 1 : machine_end]

        flow_injected, has_vt0 = inject_m221_after_vt0(body)
        if not has_vt0:
            warnings.append("打印主体未找到 ;VT0，跳过 M221 注入。")
        travel_count, _travel_old, _travel_new = apply_travel_speed_in_body(body)

        lines[machine_start + 1 : machine_end] = body
        results["flow_injected"] = flow_injected
        results["travel_changes"] = travel_count

    return "".join(lines), results, warnings


def read_text_with_fallback(data: bytes) -> str:
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        return data.decode("latin-1")


def build_compare_paths(input_path: Path, output_dir: Path) -> tuple[Path, Path]:
    name_lower = input_path.name.lower()
    if name_lower.endswith(".gcode.3mf"):
        base = input_path.name[: -len(".gcode.3mf")]
    elif name_lower.endswith(".gcode"):
        base = input_path.name[: -len(".gcode")]
    else:
        base = input_path.stem

    before_path = output_dir / f"{base}.before.gcode"
    after_path = output_dir / f"{base}.after.gcode"
    return before_path, after_path


def process_gcode_file(path: Path, compare_dir: Path) -> tuple[int, dict[str, object], list[str], Path, Path]:
    try:
        content = path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        content = path.read_text(encoding="latin-1")

    modified, results, warnings = modify_gcode_text(content)
    before_path, after_path = build_compare_paths(path, compare_dir)
    before_path.write_text(content, encoding="utf-8")
    after_path.write_text(modified, encoding="utf-8")
    path.write_text(modified, encoding="utf-8")
    return 0, results, warnings, before_path, after_path


def process_3mf_file(path: Path, compare_dir: Path) -> tuple[int, dict[str, object], list[str], Path | None, Path | None]:
    internal_target = INTERNAL_GCODE_PATH.lower()

    with zipfile.ZipFile(path, mode="r") as zin:
        infos = zin.infolist()
        entries: list[tuple[zipfile.ZipInfo, bytes]] = []
        found = False
        results: dict[str, object] = {}
        warnings: list[str] = []
        before_path: Path | None = None
        after_path: Path | None = None

        for info in infos:
            data = zin.read(info.filename)
            if not info.is_dir() and str(PurePosixPath(info.filename)).lower() == internal_target:
                found = True
                text = read_text_with_fallback(data)
                modified, results, warnings = modify_gcode_text(text)
                before_path, after_path = build_compare_paths(path, compare_dir)
                before_path.write_text(text, encoding="utf-8")
                after_path.write_text(modified, encoding="utf-8")
                data = modified.encode("utf-8")
            entries.append((info, data))

    if not found:
        print(f"[BGAM Quick] 警告: 未找到内部文件 {INTERNAL_GCODE_PATH}，未进行修改。", file=sys.stderr)
        return 4, {}, [], None, None

    with tempfile.NamedTemporaryFile(delete=False, suffix=path.suffix, dir=path.parent) as tmp_file:
        temp_path = Path(tmp_file.name)

    try:
        with zipfile.ZipFile(temp_path, mode="w") as zout:
            for info, data in entries:
                zout.writestr(info, data)
        os.replace(temp_path, path)
    finally:
        if temp_path.exists():
            temp_path.unlink(missing_ok=True)

    return 0, results, warnings, before_path, after_path


def print_report(
    input_name: str,
    output_name: str,
    results: dict[str, object],
    warnings: list[str],
    before_path: Path | None,
    after_path: Path | None,
) -> None:
    print(f"[BGAM Quick] Input:  {input_name}")
    print(f"[BGAM Quick] Output: {output_name}")
    if before_path is not None and after_path is not None:
        print(f"[BGAM Quick] Before G-code: {before_path}")
        print(f"[BGAM Quick] After G-code:  {after_path}")
    print()

    temp_old = str(results.get("temp_old") or fmt_temp(SOURCE_PRINT_TEMP))
    temp_changes = int(results.get("temp_changes") or 0)
    print(f"  喷嘴温度    {temp_old}°C  →  {NOZZLE_TEMP}°C    ({temp_changes} 处)")

    z_old = results.get("z_old")
    z_old_text = f"{z_old}mm" if z_old is not None else "?mm"
    z_changes = int(results.get("z_changes") or 0)
    print(f"  Z偏移      {z_old_text} → {fmt_z(Z_OFFSET)}mm  ({z_changes} 处)")

    print(f"  挤出倍率    100%   →  {int(FLOW_RATE)}%     (注入 M221 S{int(FLOW_RATE)})")

    travel_changes = int(results.get("travel_changes") or 0)
    print(f"  移动速度    500mm/s →  {TRAVEL_SPEED}mm/s   ({travel_changes} 处)")

    if warnings:
        print()
        for warning in warnings:
            print(f"[BGAM Quick] 警告: {warning}")

    print()
    print("[BGAM Quick] Done.")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Modify Bambu G-code parameters in place for .gcode or .gcode.3mf files."
    )
    parser.add_argument(
        "input_file",
        nargs="?",
        default="test.gcode.3mf",
        help="Path to input .gcode or .gcode.3mf file (default: test.gcode.3mf)",
    )
    args = parser.parse_args()

    input_path = Path(args.input_file)

    if not input_path.exists():
        print(f"[BGAM Quick] 警告: 文件不存在: {input_path}", file=sys.stderr)
        return 1

    name_lower = input_path.name.lower()
    if not (name_lower.endswith(".gcode") or name_lower.endswith(".gcode.3mf")):
        print("[BGAM Quick] 警告: 仅支持 .gcode 或 .gcode.3mf 文件。", file=sys.stderr)
        return 2

    try:
        if name_lower.endswith(".gcode.3mf"):
            code, results, warnings, before_path, after_path = process_3mf_file(input_path, Path.cwd())
            if code != 0:
                return code
        else:
            code, results, warnings, before_path, after_path = process_gcode_file(input_path, Path.cwd())
            if code != 0:
                return code
    except zipfile.BadZipFile:
        print("[BGAM Quick] 警告: 3mf 不是有效 zip 文件。", file=sys.stderr)
        return 3
    except OSError as exc:
        print(f"[BGAM Quick] 警告: 文件处理失败: {exc}", file=sys.stderr)
        return 5

    print_report(input_path.name, input_path.name, results, warnings, before_path, after_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
