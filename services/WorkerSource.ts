export const WORKER_CODE = `
"use strict";

let userSetup = null;
let userLoop = null;
let lastMillis = 0;
let sensors = {}; // { [pin]: value }

// Buffer for operations to send back to main thread
let opBatch = [];

const queueOp = (method, args) => {
  opBatch.push({ method, args });
};

// API Definition
const api = {
  pinMode: (pin, mode) => queueOp('pinMode', [pin, mode]),
  digitalWrite: (pin, level) => queueOp('digitalWrite', [pin, level]),
  analogWrite: (pin, value) => queueOp('analogWrite', [pin, value]),
  servoWrite: (pin, angle) => queueOp('servoWrite', [pin, angle]),
  digitalRead: (pin) => {
    return (sensors[pin] || 0) > 500 ? 1 : 0;
  },
  analogRead: (pin) => {
    return sensors[pin] || 0;
  },
  millis: () => lastMillis,
  delay: (ms) => {
    // Semi-blocking delay to simulate Arduino (busy wait)
    // Only works if we want to block the worker thread. 
    // Given the previous impl was async promise (ignorable), 
    // we'll try to support a simple busy-wait for small delays 
    // or just return to stay compatible with JS patterns?
    // Let's stick to non-blocking for now to avoid freezing the worker completely if they do delay(100000)
    // Actually, users might expect blocking.
    const start = Date.now();
    while (Date.now() - start < ms) {
        // busy wait
    }
  },
  console: {
    log: (...args) => queueOp('log', [args.join(' ')])
  }
};

self.onmessage = (e) => {
  const { type, data } = e.data;

  if (type === 'LOAD') {
    try {
      // 1. Construct the user code factory
      // The user code expects the API functions to be in scope.
      const apiKeys = Object.keys(api);
      const apiValues = Object.values(api);

      const wrappedCode = \`
        return (function(\${apiKeys.join(',')}) {
          \${data.code}
          return { 
            setup: typeof setup === 'function' ? setup : null, 
            loop: typeof loop === 'function' ? loop : null 
          };
        });
      \`;

      const factory = new Function(wrappedCode);
      const scopeCreator = factory();
      const userFns = scopeCreator(...apiValues);

      userSetup = userFns.setup;
      userLoop = userFns.loop;

      self.postMessage({ type: 'LOAD_SUCCESS' });

    } catch (err) {
      self.postMessage({ type: 'ERROR', message: err.toString() });
    }
  } 
  else if (type === 'RUN_SETUP') {
    if (userSetup) {
      opBatch = [];
      try {
        userSetup();
        self.postMessage({ type: 'BATCH', ops: opBatch });
      } catch (err) {
        self.postMessage({ type: 'ERROR', message: "Setup Error: " + err.toString() });
      }
    }
  }
  else if (type === 'STEP') {
    // Update local state
    lastMillis = data.millis;
    sensors = data.sensors || {};
    opBatch = []; // Reset batch

    if (userLoop) {
      try {
        userLoop();
        // Send back all the operations performed during this loop
        self.postMessage({ type: 'BATCH', ops: opBatch });
      } catch (err) {
        // Send error but don't crash worker completely
        self.postMessage({ type: 'ERROR', message: "Loop Error: " + err.toString() });
      }
    }
  }
};
`;
