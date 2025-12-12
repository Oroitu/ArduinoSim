import { ArduinoAPI } from "../types";

// Types for the extracted user functions
type UserCodeFunctions = {
  setup: (() => void) | null;
  loop: (() => void) | null;
};

export class CodeRunner {
  private setupFn: (() => void) | null = null;
  private loopFn: (() => void) | null = null;
  private api: ArduinoAPI;

  constructor(api: ArduinoAPI) {
    this.api = api;
  }

  public loadCode(code: string): boolean {
    try {
      // Create a function that takes the API and returns the user's setup/loop
      // We wrap in an async IIFE to allow top-level await if we wanted, 
      // but primarily we want 'loop' to be async.
      
      const apiKeys = Object.keys(this.api);
      const apiValues = Object.values(this.api);
      
      const wrappedCode = `
        "use strict";
        return (function(${apiKeys.join(',')}) {
          // User code starts here
          ${code}
          // User code ends here
          
          return { 
            setup: typeof setup === 'function' ? setup : null, 
            loop: typeof loop === 'function' ? loop : null 
          };
        });
      `;

      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const factory = new Function(wrappedCode); 
      
      // Execute factory to get the scope creator
      const scopeCreator = factory();
      
      // Execute scope creator with injected API
      const userFns = scopeCreator(...apiValues) as UserCodeFunctions;

      this.setupFn = userFns.setup;
      this.loopFn = userFns.loop;
      
      return true;
    } catch (e) {
      this.api.console.log("Syntax/Runtime Error during load:", e);
      return false;
    }
  }

  public runSetup() {
    if (this.setupFn) {
      try {
        this.setupFn();
      } catch (e) {
        this.api.console.log("Error in setup():", e);
      }
    }
  }

  public runLoop() {
    if (this.loopFn) {
      try {
        this.loopFn();
      } catch (e) {
        this.api.console.log("Error in loop():", e);
      }
    }
  }
}
