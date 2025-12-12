import { ArduinoAPI, RobotState } from '../../types';

export interface BehaviorContext {
    dt: number;        // Time delta in seconds
    time: number;      // Total elapsed time in seconds
    inputs: ArduinoAPI; // Abstraction to read sensors/actuators
    robotState: RobotState;
    teleop?: { v: number; w: number };
}

export interface IBehavior {
    /**
     * Initialize internal state
     */
    init(): void;

    /**
     * Execute one step of the behavior
     * @param ctx Context containing time and hardware API
     */
    step(ctx: BehaviorContext): void;

    /**
     * Name of the behavior for UI/Debug
     */
    name: string;
}
