/** Tiny promise-based RPC wrapper around the seal worker. */
import type { SealParams } from '../engine/types';
import type { ExportResult, LoadResult, ProcessResult, WorkerRequest, WorkerResponse } from './protocol';

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };
/** Omit that distributes over a union. */
type DistOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export class SealWorkerClient {
  private worker: Worker;
  private nextId = 1;
  private pending = new Map<number, Pending>();

  constructor() {
    this.worker = new Worker(new URL('./seal.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      const p = this.pending.get(ev.data.id);
      if (!p) return;
      this.pending.delete(ev.data.id);
      if (ev.data.ok) p.resolve(ev.data.result);
      else p.reject(new Error(ev.data.error));
    };
  }

  private call<T>(msg: DistOmit<WorkerRequest, 'id'>, transfers: Transferable[] = []): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.worker.postMessage({ ...msg, id }, transfers);
    });
  }

  load(fileName: string, buffer: ArrayBuffer): Promise<LoadResult> {
    return this.call({ type: 'load', fileName, buffer }, [buffer]);
  }

  process(selected: number[], previewPlate: number, params: SealParams, sourceTempOverride: number | null): Promise<ProcessResult> {
    return this.call({ type: 'process', selected, previewPlate, params, sourceTempOverride });
  }

  export(selected: number[], params: SealParams, sourceTempOverride: number | null): Promise<ExportResult> {
    return this.call({ type: 'export', selected, params, sourceTempOverride });
  }

  plainText(plate: number, which: 'before' | 'after', params: SealParams, sourceTempOverride: number | null): Promise<{ text: string }> {
    return this.call({ type: 'plainText', plate, which, params, sourceTempOverride });
  }
}
