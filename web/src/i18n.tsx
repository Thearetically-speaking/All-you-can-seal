import { createContext, useCallback, useContext, useMemo, useState, ReactNode } from 'react';

export type Lang = 'en' | 'zh';

const STRINGS = {
  // Header
  'app.title': { en: 'All You Can Seal', zh: 'All You Can Seal' },
  'app.subtitle': {
    en: 'Turn Bambu G-code into TPU heat-sealing G-code — entirely in your browser',
    zh: '把 Bambu 切片 G-code 改写为 TPU 热封 G-code——全程在浏览器内完成',
  },
  'app.privacy': {
    en: 'Your file never leaves this browser. No uploads, no servers, no telemetry.',
    zh: '文件不会离开你的浏览器：不上传、无服务器、无遥测。',
  },
  // Tabs
  'tabs.convert': { en: 'Convert', zh: '改写' },
  'tabs.validate': { en: 'Validate', zh: '校验' },
  // Validator
  'validate.title': { en: 'Parameter validator (read-only)', zh: '参数校验（只读）' },
  'validate.hint': {
    en: 'Nothing is modified: this reads the G-code inside an uploaded .gcode.3mf (or .gcode) and shows the four seal parameters actually present in it, so you can verify a file by eye before printing.',
    zh: '不修改任何内容：读取上传的 .gcode.3mf（或 .gcode）中的 G-code，显示文件里实际存在的四个热封参数，供人工核对后再打印。',
  },
  'validate.param': { en: 'Parameter', zh: '参数' },
  'validate.detected': { en: 'Found in G-code', zh: 'G-code 中检出值' },
  'validate.evidence': { en: 'Evidence line', zh: '证据行' },
  'validate.nozzleTemp': { en: 'Nozzle temperature (M104/M109)', zh: '喷嘴温度（M104/M109）' },
  'validate.flow': { en: 'Extrusion multiplier (M221)', zh: '挤出倍率（M221）' },
  'validate.flowShort': { en: 'Extrusion multiplier', zh: '挤出倍率' },
  'validate.speed': { en: 'Move speed (standalone G1 F)', zh: '移动速度（独立 G1 F）' },
  'validate.zOffset': { en: 'Z offset (G29.1, Textured PEI)', zh: 'Z 偏移（G29.1，Textured PEI）' },
  'validate.notFound': { en: 'not found', zh: '未找到' },
  'validate.more': { en: '+{n} more distinct value(s)', zh: '另有 {n} 个不同值' },
  'validate.noM221': { en: 'no M221 in body', zh: '主体中无 M221' },
  'validate.marker.found': {
    en: 'Processing marker found (v{version}) — the file claims it was sealed with:',
    zh: '检测到处理标记（v{version}）——文件声明的处理参数：',
  },
  'validate.marker.none': {
    en: 'No processing marker — this file has not been processed by this tool. Values below are what the slicer produced.',
    zh: '未发现处理标记——该文件未经本工具处理，下表为切片器原始值。',
  },
  // Dropzone
  'drop.title': { en: 'Drop your .gcode.3mf here', zh: '把 .gcode.3mf 拖到这里' },
  'drop.or': { en: 'or click to choose a file', zh: '或点击选择文件' },
  'drop.hint': {
    en: 'Accepts .gcode.3mf exported by Bambu Studio, or a bare .gcode',
    zh: '接受 Bambu Studio 导出的 .gcode.3mf，或裸 .gcode 文件',
  },
  'drop.badExt': {
    en: 'Unsupported file type. Please drop a .gcode.3mf or .gcode file.',
    zh: '不支持的文件类型。请拖入 .gcode.3mf 或 .gcode 文件。',
  },
  'err.not-a-zip': {
    en: 'This file is not a valid 3mf (zip) archive. Export it again from Bambu Studio.',
    zh: '该文件不是有效的 3mf（zip）压缩包。请从 Bambu Studio 重新导出。',
  },
  'err.no-plate-gcode': {
    en: 'No Metadata/plate_N.gcode found inside this 3mf. Make sure you exported a sliced plate file (.gcode.3mf), not a project file (.3mf).',
    zh: '3mf 内未找到 Metadata/plate_N.gcode。请确认导出的是切片文件（.gcode.3mf）而不是工程文件（.3mf）。',
  },
  'err.generic': { en: 'Failed to read the file:', zh: '文件解析失败：' },
  // File info
  'file.info': { en: 'File', zh: '文件信息' },
  'file.machine': { en: 'Machine', zh: '机型' },
  'file.plates': { en: 'Plates', zh: '盘数' },
  'file.layers': { en: 'Layers', zh: '层数' },
  'file.slicedTemp': { en: 'Sliced nozzle temp', zh: '切片喷嘴温度' },
  'file.slicedTempArrow': { en: 'detected {src}°C → will become {dst}°C', zh: '检测到 {src}°C → 将改为 {dst}°C' },
  'file.pathLength': { en: 'Seal path length', zh: '热封路径长度' },
  'file.unknown': { en: 'unknown', zh: '未知' },
  'file.another': { en: 'Load another file', zh: '换一个文件' },
  'file.sourceTempMissing': {
    en: 'Could not read the sliced temperature from the config header. Enter it manually:',
    zh: '无法从配置头读取切片温度，请手动输入：',
  },
  // Plates
  'plates.title': { en: 'Plates', zh: '盘（Plate）' },
  'plates.hint': {
    en: 'Choose the plates to convert. Unselected plates are kept untouched in the exported file.',
    zh: '选择要改写的盘；未选中的盘在导出文件中原样保留。',
  },
  'plates.all': { en: 'Select all', zh: '全部改写' },
  'plates.plate': { en: 'Plate', zh: '盘' },
  // Params
  'params.title': { en: 'Seal parameters', zh: '热封参数' },
  'params.reset': { en: 'Restore defaults', zh: '恢复默认' },
  'params.remember': { en: 'Remember my parameters', zh: '记住我的参数' },
  'params.nozzleTemp': { en: 'Nozzle temperature', zh: '喷嘴温度' },
  'params.nozzleTemp.hint': {
    en: 'Heat-seal temperature. Seal won’t hold → +5°C. Film burns → −10°C first.',
    zh: '热封温度。封不牢 → 温度 +5°C；烧穿/焦痕 → 先降 10°C。',
  },
  'params.zOffset': { en: 'Z offset', zh: 'Z 偏移' },
  'params.zOffset.hint': {
    en: 'Negative presses the nozzle into the film stack. Seal won’t hold → go lower (−0.20). Nozzle scrapes → raise toward 0.',
    zh: '负值 = 将喷嘴压入膜面。封不牢 → 压低到 −0.20；刮床 → 向 0 调高。',
  },
  'params.zOffset.warn': {
    en: 'Below −0.20 mm: high risk of scratching the plate — use a silicone mat.',
    zh: '低于 −0.20 mm：极易刮伤打印床，请务必垫硅胶垫。',
  },
  'params.flowRate': { en: 'Flow rate', zh: '流量倍率' },
  'params.flowRate.hint': {
    en: 'Injected as M221. Higher gives more consistent heat and pressure on the film.',
    zh: '以 M221 注入。更高的倍率让热量与压力更稳定。',
  },
  'params.travelSpeed': { en: 'Move speed', zh: '移动速度' },
  'params.travelSpeed.hint': {
    en: 'Applied to all standalone G1 F lines in the body. Seal won’t hold → try 3 mm/s.',
    zh: '应用于主体所有独立 G1 F 行。封不牢 → 试试 3 mm/s。',
  },
  // Preview
  'preview.title': { en: '3D path preview', zh: '3D 路径预览' },
  'preview.colorBy': { en: 'Color', zh: '着色' },
  'preview.byType': { en: 'Seal / travel', zh: '热封 / 空驶' },
  'preview.bySpeed': { en: 'Speed', zh: '速度' },
  'preview.layer': { en: 'Layer', zh: '层' },
  'preview.allLayers': { en: 'All layers', zh: '全部层' },
  'preview.top': { en: 'Top view', zh: '俯视图' },
  'preview.play': { en: 'Play', zh: '播放' },
  'preview.pause': { en: 'Pause', zh: '暂停' },
  'preview.speed': { en: 'Playback', zh: '步进速度' },
  'preview.step': { en: 'Step', zh: '步' },
  'preview.sealLine': { en: 'Seal line', zh: '热封线' },
  'preview.travel': { en: 'Travel', zh: '空驶' },
  'preview.estTime': { en: 'Estimated seal time', zh: '预计热封耗时' },
  'preview.sealLen': { en: 'Seal length', zh: '热封长度' },
  'preview.extruding': { en: 'sealing', zh: '热封中' },
  'preview.traveling': { en: 'travel', zh: '空驶' },
  'preview.empty': { en: 'Drop a file to see its path', zh: '导入文件后显示路径' },
  'preview.slow': { en: 'slow', zh: '慢' },
  'preview.fast': { en: 'fast', zh: '快' },
  // Checks
  'checks.title': { en: 'Safety checks', zh: '安全检查' },
  'checks.pass': { en: 'OK', zh: '通过' },
  'checks.hardFail': {
    en: 'Blocking issues found. Fix them or explicitly accept the risk below.',
    zh: '存在阻止导出的问题。请修复，或在下方明确确认风险。',
  },
  'checks.force': { en: 'I understand the risks, export anyway', zh: '我了解风险，仍要导出' },
  'checks.markers.title': { en: 'Structure markers present', zh: '结构标记齐全' },
  'checks.markers.desc': {
    en: 'CONFIG_BLOCK_END / MACHINE_START_GCODE_END / MACHINE_END_GCODE_START locate the sections we rewrite. If any is missing the file is not touched at all — a half-rewritten file could crash the nozzle into the bed. Missing: {missing}. Re-slice with Bambu Studio using a Bambu printer profile.',
    zh: 'CONFIG_BLOCK_END / MACHINE_START_GCODE_END / MACHINE_END_GCODE_START 用于定位改写区间。缺任一项则完全不改写——半成品文件可能让喷嘴撞床。缺失：{missing}。请用 Bambu Studio 选择 Bambu 打印机档位重新切片。',
  },
  'checks.temp-exec.title': { en: 'Executable temperature lines rewritten', zh: '可执行温度行已改写' },
  'checks.temp-exec.desc': {
    en: 'Rewrote {exec} executable M104/M109 line(s) (plus {config} config-header line(s), counted separately) matching source temp {sources}°C. Zero executable changes means the printer would seal at the wrong temperature — usually the file was already processed, or the sliced temperature was not detected.',
    zh: '按源温度 {sources}°C 改写了 {exec} 行可执行 M104/M109（另有 {config} 行配置头，分开计数）。可执行行为 0 意味着打印机会用错误温度热封——通常是文件已被处理过，或未能识别切片温度。',
  },
  'checks.m221.title': { en: 'Flow rate M221 injected', zh: '流量 M221 已注入' },
  'checks.m221.desc': {
    en: 'M221 S{flow} must be injected after the ;VT0 marker at the start of the print body. Without it the seal pressure profile is wrong. If ;VT0 is missing, re-slice with Bambu Studio.',
    zh: 'M221 S{flow} 需注入打印主体开头的 ;VT0 标记之后。未注入则热封压力不正确。若找不到 ;VT0，请用 Bambu Studio 重新切片。',
  },
  'checks.residual-speed.title': { en: 'No residual fast move lines', zh: '无残留高速移动行' },
  'checks.residual-speed.desc': {
    en: 'Reverse assertion: after rewriting, the body must contain no standalone G1 F line faster than the target speed. Found {count} (e.g. “{example}”). A residual fast line would drag the hot nozzle across the film at print speed.',
    zh: '反向断言：改写后主体不应残留快于目标速度的独立 G1 F 行。发现 {count} 处（如 “{example}”）。残留高速行会让热喷嘴以打印速度划过薄膜。',
  },
  'checks.max-temp.title': { en: 'Temperature within machine limit', zh: '温度未超机型上限' },
  'checks.max-temp.desc': {
    en: 'Target {target}°C vs {machine} hotend limit {max}°C. Exceeding the hotend rating can damage the printer and is blocked.',
    zh: '目标 {target}°C，{machine} 热端上限 {max}°C。超过热端额定温度可能损坏打印机，禁止导出。',
  },
  'checks.already-processed.title': { en: 'Not previously processed', zh: '未被重复处理' },
  'checks.already-processed.desc': {
    en: 'This file carries a processing marker ({marker}). Running the conversion twice stacks changes (e.g. speeds already slowed). Prefer starting from the original sliced file.',
    zh: '该文件带有处理标记（{marker}）。二次处理会叠加修改（例如速度已被降过）。建议从原始切片文件重新开始。',
  },
  'checks.corrupt-lines.title': { en: 'No corrupted concatenated lines', zh: '无损坏拼接行' },
  'checks.corrupt-lines.desc': {
    en: 'Found {count} corrupted line(s) like “{example}” (line {lineNo}) — a fingerprint of the old Python script joining lines without newlines. The printer may ignore or misread these commands. Re-slice a clean file if possible.',
    zh: '发现 {count} 处损坏行，如第 {lineNo} 行 “{example}”——这是旧脚本丢失换行的特征。打印机可能忽略或误读这些命令。建议重新切片。',
  },
  'checks.machine-verified.title': { en: 'Machine verified for sealing', zh: '机型已验证' },
  'checks.machine-verified.desc': {
    en: '“{machine}” is not in the verified list (A1 mini, P1S). The G-code structure is likely compatible, but proceed with a dry run first.',
    zh: '“{machine}” 不在已验证列表（A1 mini、P1S）中。G-code 结构大概率兼容，但请先空跑测试。',
  },
  'checks.textured-pei.title': { en: 'Z offset applied (Textured PEI)', zh: 'Z 偏移已生效（Textured PEI）' },
  'checks.textured-pei.desc': {
    en: 'No “G29.1 Z… ; for Textured PEI Plate” line found (bed type: {bedType}). The Z offset {z} mm will NOT take effect, so the nozzle may not press into the film. Either re-slice with the Textured PEI plate selected, or compensate with a thicker silicone mat.',
    zh: '未找到 “G29.1 Z… ; for Textured PEI Plate” 行（床型：{bedType}）。Z 偏移 {z} mm 将不会生效，喷嘴可能压不进薄膜。请改用 Textured PEI 床型重新切片，或用更厚的硅胶垫补偿。',
  },
  'checks.z-deep.title': { en: 'Z offset within safe range', zh: 'Z 偏移在安全范围' },
  'checks.z-deep.desc': {
    en: 'Z offset {z} mm is below {threshold} mm. This presses hard into the plate — make sure a silicone mat / cardboard protects the bed.',
    zh: 'Z 偏移 {z} mm 低于 {threshold} mm，会强力压向打印床——务必垫硅胶垫或厚纸板。',
  },
  'checks.why': { en: 'Why this matters', zh: '这是什么、为什么重要' },
  // Export
  'export.title': { en: 'Export', zh: '导出' },
  'export.button': { en: 'Export sealed file', zh: '导出热封文件' },
  'export.changes': { en: 'Change report', zh: '变更报告' },
  'export.plate': { en: 'Plate {n}', zh: '盘 {n}' },
  'export.temp': { en: 'Nozzle temp', zh: '喷嘴温度' },
  'export.tempVal': { en: '{old}°C → {new}°C ({exec} exec + {config} config lines)', zh: '{old}°C → {new}°C（可执行 {exec} 处 + 配置 {config} 处）' },
  'export.z': { en: 'Z offset', zh: 'Z 偏移' },
  'export.zVal': { en: '{old} mm → {new} mm ({n} line)', zh: '{old} mm → {new} mm（{n} 处）' },
  'export.zNone': { en: 'no Textured PEI line — not applied', zh: '未找到 Textured PEI 行——未生效' },
  'export.flow': { en: 'Flow rate', zh: '流量倍率' },
  'export.flowVal': { en: '{old} → {new} (M221 S{flow}, {config} config line)', zh: '{old} → {new}（M221 S{flow}，配置 {config} 处）' },
  'export.speed': { en: 'Move speed', zh: '移动速度' },
  'export.speedVal': { en: '→ {new} mm/s ({n} lines)', zh: '→ {new} mm/s（{n} 处）' },
  'export.before': { en: 'Download before.gcode', zh: '下载 before.gcode' },
  'export.after': { en: 'Download after.gcode', zh: '下载 after.gcode' },
  'export.done': { en: 'Exported {name}', zh: '已导出 {name}' },
  'export.safety.title': { en: 'Before you print — safety', zh: '打印前——安全须知' },
  'export.safety.mat': {
    en: 'Protect the bed: silicone mat or thick cardboard under the film, parchment paper above and below the TPU.',
    zh: '保护打印床：膜下垫硅胶垫或厚纸板，TPU 上下各垫一层烘焙纸。',
  },
  'export.safety.vent': {
    en: '260°C TPU releases fumes — ventilate the room.',
    zh: '260°C 的 TPU 会释放气味/烟雾——保持通风。',
  },
  'export.safety.watch': {
    en: 'Never leave the printer unattended; a stalled toolhead scorches within seconds.',
    zh: '打印全程不可离人；喷头一旦停滞几秒内就会烧焦。',
  },
  'export.safety.dry': {
    en: 'Always do a dry run first with the heater off, watching the toolhead path.',
    zh: '先关闭加热空跑一遍，确认喷头路径无误后再放入 TPU 膜。',
  },
  // Misc
  'misc.loading': { en: 'Parsing file…', zh: '正在解析文件…' },
  'misc.processing': { en: 'Rewriting…', zh: '正在改写…' },
  'misc.lang': { en: '中文', zh: 'EN' },
  'misc.previewPlate': { en: 'Previewing plate {n}', zh: '预览盘 {n}' },
  'misc.footer': {
    en: 'Runs fully offline after load · MIT licensed · Not endorsed by Bambu Lab',
    zh: '加载后完全离线运行 · MIT 许可 · 与 Bambu Lab 无关',
  },
} as const;

export type StringKey = keyof typeof STRINGS;

interface I18n {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: StringKey, vars?: Record<string, string | number>) => string;
}

const Ctx = createContext<I18n>(null!);

export function detectLang(): Lang {
  const stored = localStorage.getItem('aycs-lang');
  if (stored === 'en' || stored === 'zh') return stored;
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(detectLang);
  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    localStorage.setItem('aycs-lang', l);
  }, []);
  const t = useCallback(
    (key: StringKey, vars?: Record<string, string | number>) => {
      let s: string = STRINGS[key][lang];
      if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
      return s;
    },
    [lang],
  );
  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18n {
  return useContext(Ctx);
}
