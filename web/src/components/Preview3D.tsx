/**
 * 3D toolpath preview (FR-5): incremental path drawing with a step slider,
 * seal/travel + speed color modes, per-layer filter, orbit + top view camera.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { useI18n } from '../i18n';
import type { ToolpathTransfer } from '../worker/protocol';

interface Props {
  toolpath: ToolpathTransfer | null;
  bed: [number, number];
  dark: boolean;
}

type ColorMode = 'type' | 'speed';

const RAMP = [
  [0x22 / 255, 0x55 / 255, 0xdd / 255],
  [0x22 / 255, 0xbb / 255, 0x88 / 255],
  [0xdd / 255, 0xcc / 255, 0x22 / 255],
  [0xdd / 255, 0x33 / 255, 0x22 / 255],
];

function rampColor(t: number): [number, number, number] {
  const x = Math.min(0.9999, Math.max(0, t)) * (RAMP.length - 1);
  const i = Math.floor(x);
  const f = x - i;
  return [
    RAMP[i][0] + (RAMP[i + 1][0] - RAMP[i][0]) * f,
    RAMP[i][1] + (RAMP[i + 1][1] - RAMP[i][1]) * f,
    RAMP[i][2] + (RAMP[i + 1][2] - RAMP[i][2]) * f,
  ];
}

function fmtDuration(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  if (m >= 60) return `${Math.floor(m / 60)}h ${m % 60}m`;
  return `${m}m ${sec.toString().padStart(2, '0')}s`;
}

interface SceneRefs {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  sealGeo: THREE.BufferGeometry | null;
  travelGeo: THREE.BufferGeometry | null;
  sealLine: THREE.LineSegments | null;
  travelLine: THREE.LineSegments | null;
  nozzle: THREE.Mesh;
  bedGroup: THREE.Group;
  colorAttrs: {
    sealType: THREE.BufferAttribute | null;
    sealSpeed: THREE.BufferAttribute | null;
    travelType: THREE.BufferAttribute | null;
    travelSpeed: THREE.BufferAttribute | null;
  };
}

export function Preview3D({ toolpath, bed, dark }: Props) {
  const { t } = useI18n();
  const mountRef = useRef<HTMLDivElement>(null);
  const refs = useRef<SceneRefs | null>(null);
  const [colorMode, setColorMode] = useState<ColorMode>('type');
  const [layerFilter, setLayerFilter] = useState<number>(-1); // -1 = all
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [playRate, setPlayRate] = useState(120); // segments per second
  const playRef = useRef({ playing: false, rate: 120, step: 0, max: 0 });

  // Segment range for the active layer filter.
  const range = useMemo(() => {
    if (!toolpath) return { start: 0, end: 0 };
    if (layerFilter < 0 || layerFilter >= toolpath.layers.length) return { start: 0, end: toolpath.count };
    const l = toolpath.layers[layerFilter];
    return { start: l.start, end: l.end };
  }, [toolpath, layerFilter]);
  const maxStep = range.end - range.start;

  // --- scene bootstrap (once) ---------------------------------------------
  useEffect(() => {
    const mount = mountRef.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 5000);
    camera.up.set(0, 0, 1);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;

    const nozzle = new THREE.Mesh(
      new THREE.ConeGeometry(1.6, 4, 16),
      new THREE.MeshBasicMaterial({ color: 0xff5f2e }),
    );
    nozzle.rotation.x = Math.PI / 2; // point down (-Z)
    nozzle.visible = false;
    scene.add(nozzle);

    const bedGroup = new THREE.Group();
    scene.add(bedGroup);

    refs.current = {
      renderer, scene, camera, controls,
      sealGeo: null, travelGeo: null, sealLine: null, travelLine: null,
      nozzle, bedGroup,
      colorAttrs: { sealType: null, sealSpeed: null, travelType: null, travelSpeed: null },
    };

    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      controls.update();
      renderer.render(scene, camera);
    };
    loop();

    const resize = () => {
      const w = mount.clientWidth, h = mount.clientHeight;
      if (w === 0 || h === 0) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(mount);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      mount.removeChild(renderer.domElement);
      refs.current = null;
    };
  }, []);

  // --- bed ------------------------------------------------------------------
  useEffect(() => {
    const r = refs.current;
    if (!r) return;
    r.bedGroup.clear();
    const [bx, by] = bed;
    const grid = new THREE.GridHelper(Math.max(bx, by), Math.max(bx, by) / 10, dark ? 0x3a4450 : 0xc4ccd6, dark ? 0x252c36 : 0xe2e7ee);
    grid.rotation.x = Math.PI / 2;
    grid.position.set(bx / 2, by / 2, 0);
    r.bedGroup.add(grid);
    const outline = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0), new THREE.Vector3(bx, 0, 0),
        new THREE.Vector3(bx, by, 0), new THREE.Vector3(0, by, 0),
      ]),
      new THREE.LineBasicMaterial({ color: dark ? 0x5b6672 : 0x8a95a3 }),
    );
    r.bedGroup.add(outline);
    // origin marker
    const origin = new THREE.Mesh(new THREE.SphereGeometry(1.2), new THREE.MeshBasicMaterial({ color: 0x0d84ff }));
    r.bedGroup.add(origin);
  }, [bed, dark]);

  const setTopView = useCallback(() => {
    const r = refs.current;
    if (!r) return;
    const [bx, by] = bed;
    const cx = bx / 2, cy = by / 2;
    r.controls.target.set(cx, cy, 0);
    r.camera.position.set(cx, cy - 0.01, Math.max(bx, by) * 1.35);
    r.camera.updateProjectionMatrix();
  }, [bed]);

  // --- geometry rebuild on new toolpath -------------------------------------
  useEffect(() => {
    const r = refs.current;
    if (!r) return;
    for (const key of ['sealLine', 'travelLine'] as const) {
      const line = r[key];
      if (line) {
        r.scene.remove(line);
        line.geometry.dispose();
        (line.material as THREE.Material).dispose();
        r[key] = null;
      }
    }
    r.sealGeo = r.travelGeo = null;
    r.nozzle.visible = false;
    if (!toolpath || toolpath.count === 0) return;

    const n = toolpath.count;
    const nSeal = toolpath.sealPrefix[n];
    const nTravel = toolpath.travelPrefix[n];
    const sealPos = new Float32Array(nSeal * 6);
    const travelPos = new Float32Array(nTravel * 6);
    const sealType = new Float32Array(nSeal * 6);
    const travelType = new Float32Array(nTravel * 6);
    const sealSpeed = new Float32Array(nSeal * 6);
    const travelSpeed = new Float32Array(nTravel * 6);

    const sealRGB: [number, number, number] = dark ? [1.0, 0.48, 0.3] : [1.0, 0.37, 0.18];
    const travelRGB: [number, number, number] = dark ? [0.45, 0.5, 0.56] : [0.62, 0.67, 0.73];
    const maxSpeed = Math.max(1, toolpath.maxFeed / 60);

    let si = 0, ti = 0;
    for (let i = 0; i < n; i++) {
      const isSeal = toolpath.extrude[i] === 1;
      const speed = toolpath.feeds[i] / 60;
      const [cr, cg, cb] = rampColor(Math.sqrt(speed / maxSpeed));
      const pos = isSeal ? sealPos : travelPos;
      const typeC = isSeal ? sealType : travelType;
      const speedC = isSeal ? sealSpeed : travelSpeed;
      const base = isSeal ? si : ti;
      for (let k = 0; k < 6; k++) pos[base + k] = toolpath.positions[i * 6 + k];
      const flat = isSeal ? sealRGB : travelRGB;
      for (let v = 0; v < 2; v++) {
        typeC[base + v * 3] = flat[0]; typeC[base + v * 3 + 1] = flat[1]; typeC[base + v * 3 + 2] = flat[2];
        speedC[base + v * 3] = cr; speedC[base + v * 3 + 1] = cg; speedC[base + v * 3 + 2] = cb;
      }
      if (isSeal) si += 6; else ti += 6;
    }

    const mkGeo = (pos: Float32Array) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      return g;
    };
    const sealGeo = mkGeo(sealPos);
    const travelGeo = mkGeo(travelPos);
    r.colorAttrs = {
      sealType: new THREE.BufferAttribute(sealType, 3),
      sealSpeed: new THREE.BufferAttribute(sealSpeed, 3),
      travelType: new THREE.BufferAttribute(travelType, 3),
      travelSpeed: new THREE.BufferAttribute(travelSpeed, 3),
    };

    const sealLine = new THREE.LineSegments(
      sealGeo,
      new THREE.LineBasicMaterial({ vertexColors: true, linewidth: 2 }),
    );
    const travelLine = new THREE.LineSegments(
      travelGeo,
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.35 }),
    );
    r.scene.add(sealLine);
    r.scene.add(travelLine);
    Object.assign(r, { sealGeo, travelGeo, sealLine, travelLine });

    setLayerFilter(-1);
    setStep(n);
    setPlaying(false);
    setTopView();
  }, [toolpath, dark, setTopView]);

  // --- color mode swap -------------------------------------------------------
  useEffect(() => {
    const r = refs.current;
    if (!r || !r.sealGeo || !r.travelGeo) return;
    const a = r.colorAttrs;
    r.sealGeo.setAttribute('color', (colorMode === 'type' ? a.sealType : a.sealSpeed)!);
    r.travelGeo.setAttribute('color', (colorMode === 'type' ? a.travelType : a.travelSpeed)!);
    r.sealGeo.getAttribute('color').needsUpdate = true;
    r.travelGeo.getAttribute('color').needsUpdate = true;
    if (r.travelLine) {
      (r.travelLine.material as THREE.LineBasicMaterial).opacity = colorMode === 'type' ? 0.35 : 0.8;
    }
    // `dark` rebuilds the geometry above, so the color attribute must be reattached here too.
  }, [colorMode, toolpath, dark]);

  // --- draw range from step + layer filter ------------------------------------
  useEffect(() => {
    const r = refs.current;
    if (!r || !toolpath || !r.sealGeo || !r.travelGeo) return;
    const from = range.start;
    const to = Math.min(range.start + step, range.end);
    const sealStart = toolpath.sealPrefix[from];
    const sealCount = toolpath.sealPrefix[to] - sealStart;
    const travelStart = toolpath.travelPrefix[from];
    const travelCount = toolpath.travelPrefix[to] - travelStart;
    r.sealGeo.setDrawRange(sealStart * 2, sealCount * 2);
    r.travelGeo.setDrawRange(travelStart * 2, travelCount * 2);

    if (to > from) {
      const i = to - 1;
      r.nozzle.visible = true;
      r.nozzle.position.set(
        toolpath.positions[i * 6 + 3],
        toolpath.positions[i * 6 + 4],
        toolpath.positions[i * 6 + 5] + 2.2,
      );
    } else {
      r.nozzle.visible = false;
    }
  }, [toolpath, range, step]);

  // Clamp step when the filter changes.
  useEffect(() => {
    setStep(maxStep);
  }, [range.start, range.end, maxStep]);

  // --- playback ---------------------------------------------------------------
  playRef.current = { ...playRef.current, playing, rate: playRate, max: maxStep };
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    let acc = playRef.current.step >= playRef.current.max ? 0 : playRef.current.step;
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      acc += playRef.current.rate * dt;
      const next = Math.min(Math.floor(acc), playRef.current.max);
      playRef.current.step = next;
      setStep(next);
      if (next >= playRef.current.max) {
        setPlaying(false);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  // --- HUD data ----------------------------------------------------------------
  const hud = useMemo(() => {
    if (!toolpath || step === 0 || maxStep === 0) return null;
    const i = Math.min(range.start + step, range.end) - 1;
    if (i < 0) return null;
    return {
      x: toolpath.positions[i * 6 + 3].toFixed(2),
      y: toolpath.positions[i * 6 + 4].toFixed(2),
      z: toolpath.positions[i * 6 + 5].toFixed(2),
      speed: (toolpath.feeds[i] / 60).toFixed(1),
      sealing: toolpath.extrude[i] === 1,
      layer: toolpath.layerOf[i] + 1,
      line: toolpath.lineNo[i],
    };
  }, [toolpath, range, step, maxStep]);

  return (
    <div className="preview panel">
      <h2>{t('preview.title')}</h2>
      <div className="toolbar">
        <span className="hint" style={{ margin: 0 }}>{t('preview.colorBy')}</span>
        <select value={colorMode} onChange={(e) => setColorMode(e.target.value as ColorMode)}>
          <option value="type">{t('preview.byType')}</option>
          <option value="speed">{t('preview.bySpeed')}</option>
        </select>
        <span className="hint" style={{ margin: 0 }}>{t('preview.layer')}</span>
        <select value={layerFilter} onChange={(e) => setLayerFilter(parseInt(e.target.value, 10))}>
          <option value={-1}>{t('preview.allLayers')}</option>
          {toolpath?.layers.map((l, i) => (
            <option key={i} value={i}>
              {t('preview.layer')} {i + 1} · z={l.z.toFixed(2)}
            </option>
          ))}
        </select>
        <button onClick={setTopView}>{t('preview.top')}</button>
        <button onClick={() => setPlaying((p) => !p)} disabled={!toolpath || maxStep === 0}>
          {playing ? `⏸ ${t('preview.pause')}` : `▶ ${t('preview.play')}`}
        </button>
        <select value={playRate} onChange={(e) => setPlayRate(parseInt(e.target.value, 10))} title={t('preview.speed')}>
          {[30, 120, 600, 3000].map((r) => (
            <option key={r} value={r}>{r}/s</option>
          ))}
        </select>
      </div>
      <div className="canvas-wrap" ref={mountRef}>
        {hud && (
          <div className="nozzle-hud">
            X {hud.x} · Y {hud.y} · Z {hud.z}
            <br />
            {hud.speed} mm/s · {hud.sealing ? t('preview.extruding') : t('preview.traveling')}
            <br />
            {t('preview.layer')} {hud.layer} · L{hud.line}
          </div>
        )}
        {toolpath && (
          <div className="legend">
            {colorMode === 'type' ? (
              <>
                <span><span className="sw" style={{ background: '#ff5f2e' }} />{t('preview.sealLine')}</span>
                <span><span className="sw" style={{ background: '#98a2ae', opacity: 0.6 }} />{t('preview.travel')}</span>
              </>
            ) : (
              <>
                <span className="grad" />
                <span>{t('preview.slow')} → {t('preview.fast')} ({(toolpath.maxFeed / 60).toFixed(0)} mm/s)</span>
              </>
            )}
          </div>
        )}
        {!toolpath && <div className="nozzle-hud">{t('preview.empty')}</div>}
      </div>
      <div className="step-row">
        <input
          type="range"
          min={0}
          max={maxStep}
          value={Math.min(step, maxStep)}
          onChange={(e) => {
            setPlaying(false);
            const v = parseInt(e.target.value, 10);
            playRef.current.step = v;
            setStep(v);
          }}
          disabled={!toolpath || maxStep === 0}
        />
        <span className="count">
          {t('preview.step')} {Math.min(step, maxStep).toLocaleString()} / {maxStep.toLocaleString()}
        </span>
      </div>
      {toolpath && (
        <div className="stats">
          <span>
            {t('preview.estTime')}: <b>{fmtDuration(toolpath.estSeconds)}</b>
          </span>
          <span>
            {t('preview.sealLen')}: <b>{(toolpath.sealLength / 10).toFixed(1)} cm</b>
          </span>
          <span>
            {t('preview.travel')}: <b>{(toolpath.travelLength / 10).toFixed(1)} cm</b>
          </span>
        </div>
      )}
    </div>
  );
}
