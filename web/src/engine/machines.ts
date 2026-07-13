import machinesJson from '../data/machines.json';
import type { MachineDef } from './types';

interface MachinesFile {
  machines: Record<string, Omit<MachineDef, 'key'>>;
  default: Omit<MachineDef, 'key'>;
}

const data = machinesJson as unknown as MachinesFile;

export const MACHINES: MachineDef[] = Object.entries(data.machines).map(([key, m]) => ({
  key,
  ...m,
  bed: [m.bed[0], m.bed[1]],
}));

export const DEFAULT_MACHINE: MachineDef = { key: 'unknown', ...data.default };

/** Resolve a machine from "; printer_model = ..." or the ";===== machine: ..." header line. */
export function findMachine(name: string | null | undefined): MachineDef {
  if (!name) return DEFAULT_MACHINE;
  const needle = name.trim().toLowerCase();
  for (const m of MACHINES) {
    if (m.names.some((n) => n.toLowerCase() === needle)) return m;
  }
  return DEFAULT_MACHINE;
}
