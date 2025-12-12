import { IBehavior, BehaviorContext } from './types';
import { RobotNavigation } from './Navigation';
import { VehicleConfig } from '../../types';

enum MoveState {
    CRUISE,
    AVOID,
    STUCK_RECOVERY
}

export class MobilityBehavior implements IBehavior {
    name = "MOVILIDAD";

    private nav: RobotNavigation;
    private config: VehicleConfig;

    // Parameters
    private readonly MAX_SPEED = 0.8;
    private readonly SAFE_DIST = 100;
    private readonly STUCK_TIMEOUT = 2.0; // Seconds before flagging as stuck
    private readonly RECOVERY_TIME = 1.5; // Seconds to spend backing up

    // State
    private state: MoveState = MoveState.CRUISE;
    private stateTimer = 0;

    // Stuck Detection (Odometry)
    private lastPos = { x: 0, y: 0 };
    private stuckCheckTimer = 0;

    constructor(nav: RobotNavigation, config: VehicleConfig) {
        this.nav = nav;
        this.config = config;
    }

    init() {
        this.nav.stop();
        this.state = MoveState.CRUISE;
        this.stateTimer = 0;
        this.stuckCheckTimer = 0;
        // We don't have access to initial pos here easily without context, 
        // but step() will handle first frame initialization or drift.
    }

    step(ctx: BehaviorContext) {
        // 1. Stuck Detection (Physical)
        // Check actual movement every 0.5s
        this.stuckCheckTimer += ctx.dt;
        if (this.stuckCheckTimer > 0.5) {
            const currentPos = ctx.robotState.position;
            const dx = currentPos.x - this.lastPos.x;
            const dy = currentPos.y - this.lastPos.y;
            const distMoved = Math.hypot(dx, dy);

            // If we are supposed to be moving (CRUISE) but haven't moved enough
            if (this.state === MoveState.CRUISE && distMoved < 5) {
                // We are physically stuck (wall collision likely)
                console.log("Stuck detected! (Movement check)");
                this.state = MoveState.STUCK_RECOVERY;
                this.stateTimer = 0;
            }

            this.lastPos = { ...currentPos };
            this.stuckCheckTimer = 0;
        }

        // 2. Read Sensors
        let minDist = 999;

        this.config.sensors.forEach(s => {
            if (s.type === 'ultrasonic') {
                if (Math.abs(s.mount.rotation) < 0.5) {
                    if (s.servoId) {
                        const servo = this.config.servos.find(srv => srv.id === s.servoId);
                        // Sweep sensor +/- 60 degrees to detect obstacles in a wider arc
                        const scanAngle = 60 * Math.sin(ctx.time * 4);
                        if (servo) ctx.inputs.servoWrite(servo.pin, scanAngle);
                    }

                    const pin = s.pins.analog ?? s.pins.trigger;
                    if (pin !== undefined) {
                        const d = ctx.inputs.analogRead(pin);
                        if (d > 0 && d < minDist) {
                            minDist = d;
                        }
                    }
                }
            }
        });

        const distFront = minDist;

        // 2. State Machine Update
        switch (this.state) {
            case MoveState.CRUISE:
                if (distFront < this.SAFE_DIST) {
                    this.state = MoveState.AVOID;
                    this.stateTimer = 0;
                }
                break;

            case MoveState.AVOID:
                this.stateTimer += ctx.dt;
                if (distFront > this.SAFE_DIST * 1.1) { // Hysteresis
                    this.state = MoveState.CRUISE;
                    this.stateTimer = 0;
                } else if (this.stateTimer > this.STUCK_TIMEOUT) {
                    this.state = MoveState.STUCK_RECOVERY;
                    this.stateTimer = 0;
                }
                break;

            case MoveState.STUCK_RECOVERY:
                this.stateTimer += ctx.dt;
                if (this.stateTimer > this.RECOVERY_TIME) {
                    // Try to resume normal operation (will likely go to Avoid if still close)
                    this.state = MoveState.AVOID; // Go back to avoid (turning) rather than forward immediately
                    this.stateTimer = 0;
                }
                break;
        }

        // 3. Actuation
        let v = 0;
        let w = 0;

        switch (this.state) {
            case MoveState.CRUISE:
                v = this.MAX_SPEED;
                w = 0;
                break;

            case MoveState.AVOID:
                // Simple Turn
                v = 0;
                w = 0.6;
                break;

            case MoveState.STUCK_RECOVERY:
                // Backup and turn hard
                v = -0.5;
                w = -0.8;
                break;
        }

        this.nav.setVelocity(v, w);
    }
}
