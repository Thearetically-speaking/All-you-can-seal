# BGAM Quick（list_metadata.py）

一个用于**自动修改切片后 G-code 参数**的小工具。  
它支持直接处理：

- `.gcode` 文件
- `.gcode.3mf` 文件（会在压缩包内定位并修改 `Metadata/plate_1.gcode`）

适合场景：你已经切片完成，但想在不重新切片的情况下，快速统一一些关键打印参数（如喷嘴温度、Z 偏移、挤出倍率、移动速度）。

---

## 这个工具能做什么

脚本会自动把目标文件中的参数调整为以下固定值：

- 喷嘴温度：`260°C`
- Z 偏移（Textured PEI）：`-0.15`
- 挤出倍率：`120%`（通过 `M221 S120`）
- 移动速度：`5 mm/s`（对应 `F300`）

并且会同时更新 G-code 中的多处相关字段（配置区、启动段、打印主体段）。

---

## 输入是什么

命令行输入一个文件路径：

- 支持：`.gcode` / `.gcode.3mf`
- 不传参数时，默认输入：`test.gcode.3mf`

示例：

```bash
python list_metadata.py test.gcode.3mf
python list_metadata.py your_file.gcode
```

---

## 输出是什么

### 1) 原文件会被直接改写（in-place）

- 输入文件会被替换成修改后的内容。

### 2) 会额外生成前后对比文件

在当前工作目录下输出：

- `<basename>.before.gcode`
- `<basename>.after.gcode`

例如输入 `test.gcode.3mf`，会生成：

- `test.before.gcode`
- `test.after.gcode`

### 3) 终端会打印报告

包括：

- 输入/输出文件名
- before/after gcode 路径
- 各参数替换次数
- 警告信息（如缺少某些标记段）

---

## 处理逻辑（简要）

脚本会按 G-code 常见分段标记执行修改：

- `; CONFIG_BLOCK_END`
- `; MACHINE_START_GCODE_END`
- `; MACHINE_END_GCODE_START`

主要行为：

1. 在 config header 中更新：
	- `nozzle_temperature`
	- `nozzle_temperature_initial_layer`
	- `filament_flow_ratio`

2. 在 startup 段中：
	- 仅把 `M104/M109` 中 `230` 改为 `260`（并跳过一些排除温度）
	- 把 `G29.1 Z... ; for Textured PEI Plate` 改为 `Z-0.15`

3. 在打印主体中：
	- 在 `;VT0` 后注入或更新 `M221 S120`
	- 将移动速度相关进给改为 `F300`（即 5mm/s）

---

## 快速开始

### 环境要求

- Python 3.9+

### 运行

```bash
python list_metadata.py <你的文件路径>
```

如果你在项目虚拟环境中运行，也可以：

```bash
.venv/bin/python list_metadata.py <你的文件路径>
```

---

## 示例

```bash
.venv/bin/python list_metadata.py test.gcode.3mf
```

运行后你会得到：

- 已改写的 `test.gcode.3mf`
- `test.before.gcode`
- `test.after.gcode`

并在终端看到修改统计。

---

## 注意事项

- 工具会**直接覆盖输入文件**，请保留备份（脚本会生成 before 文件，但建议仍保留原始切片文件）。
- 若 `.gcode.3mf` 内部不存在 `Metadata/plate_1.gcode`，脚本会报错并退出。
- 若文件中缺少分段标记，相关修改会跳过并给出警告。
- 当前参数是写死在 `list_metadata.py` 顶部常量中的（`NOZZLE_TEMP`、`Z_OFFSET`、`FLOW_RATE`、`TRAVEL_SPEED`）。如需改目标值，可直接修改这些常量。

---

## 文件说明

- `list_metadata.py`：主脚本
- `test.gcode.3mf` / `test1.gcode.3mf`：示例输入
- `test.before.gcode` / `test.after.gcode`：示例输出
- `TPU_Inflatable.pdf`：项目相关资料（当前 README 主要基于脚本实际行为编写）
1
