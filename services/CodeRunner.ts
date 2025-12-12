import { ArduinoAPI } from "../types";
import { WORKER_CODE } from "./WorkerSource";

export class CodeRunner {
  private worker: Worker | null = null;
  private api: ArduinoAPI;
  private isLoaded: boolean = false;

  constructor(api: ArduinoAPI) {
    this.api = api;
  }

  public loadCode(code: string): boolean {
    // Terminate existing worker if any
    if (this.worker) {
      this.worker.terminate();
    }

    try {
      // Create new Worker from Blob
      const blob = new Blob([WORKER_CODE], { type: 'application/javascript' });
      this.worker = new Worker(URL.createObjectURL(blob));

      this.worker.onmessage = this.handleWorkerMessage.bind(this);
      this.worker.onerror = (e) => {
        this.api.console.log("Worker Error:", e.message);
      };

      // Send Code
      this.worker.postMessage({ type: 'LOAD', data: { code } });

      // We assume sync load mostly, but it's async in reality.
      // For UI feedback, we'll mark loaded on callback.
      // But for `loadCode` return, we return true if dispatch succeeds.
      return true;
    } catch (e) {
      this.api.console.log("Failed to initialize worker:", e);
      return false;
    }
  }

  private handleWorkerMessage(e: MessageEvent) {
    const { type, ops, message } = e.data;

    if (type === 'LOAD_SUCCESS') {
      this.isLoaded = true;
      // this.api.console.log("Code loaded in isolated environment.");
    }
    else if (type === 'ERROR') {
      this.api.console.log(message);
    }
    else if (type === 'BATCH') {
      // Execute all operations on the Main Thread API
      ops.forEach((op: { method: string, args: any[] }) => {
        const fn = (this.api as any)[op.method];
        if (typeof fn === 'function') {
          // Special case for logs to avoid double-array wrapping if spread is used
          if (op.method === 'log') {
            // The worker sends args joined, so it's a single string
            this.api.console.log(...op.args);
          } else if (op.method === 'console') { // catch any recursive structure
            // ignore
          } else {
            fn(...op.args);
          }
        }
      });
    }
  }

  public runSetup() {
    if (this.worker) {
      this.worker.postMessage({ type: 'RUN_SETUP' });
    }
  }

  public runLoop() {
    if (this.worker) {
      // Gather Sensor Data to send to Worker
      // We need to read ALL potential sensors efficiently.
      // For now, let's just dump the `robot.sensorReadings` and maybe a range of pins?
      // Since `digitalRead(pin)` can read any pin, we should technically provide the full state.
      // `ArduinoAPI` in App.tsx reads from `robotRef.current.sensorReadings`.

      // We need to access the underlying data source of `this.api`. 
      // `CodeRunner` holds `api`. 
      // Unlike the original CodeRunner which had direct access via closure in executing code,
      // here we need to extract state.

      // BUT `ArduinoAPI` interface doesn't expose `getSensorState`.
      // We can hack it or rely on `api` implementation details if we knew them.
      // Better: we can iterate known pins if we knew them.

      // Implementation HACK: The `api` passed to `CodeRunner` is the one from `createArduinoAPI`.
      // It has `analogRead` and `digitalRead`.
      // We can pre-fetch 0-20 pins? Or just pass what we can.

      // Optimization: We simply pass the `sensorReadings` map if we can access it.
      // But `api` hides the `robotRef`.

      // Alternate: We modify `ArduinoAPI` to expose `_getSensors()` or similar?
      // Or we just loop 0..40 and read.

      const sensors: { [key: number]: number } = {};
      for (let i = 0; i < 40; i++) {
        const val = this.api.analogRead(i);
        if (val > 0) sensors[i] = val; // Sparse optimization
      }

      this.worker.postMessage({
        type: 'STEP',
        data: {
          millis: this.api.millis(),
          sensors
        }
      });
    }
  }

  public dispose() {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }
}
