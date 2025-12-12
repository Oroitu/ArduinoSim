import { IBehavior, BehaviorContext } from './types';
import { RobotNavigation } from './Navigation';
import { VehicleConfig } from '../../types';

export class EscapeBehavior implements IBehavior {
    name = "ESCAPE";
    private nav: RobotNavigation;
    private config: VehicleConfig;

    private lastDist = 999;
    private isFleeing = false;
    private fleeTimer = 0;

    constructor(nav: RobotNavigation, config: VehicleConfig) {
        this.nav = nav;
        this.config = config;
    }

    init() {
        this.nav.stop();
        this.isFleeing = false;
    }

    step(ctx: BehaviorContext) {
        // 1. Detect Threat (Rapid decrease in distance)
        let minDist = 999;

        // Lock scanners and aggregate readings
        this.config.sensors.forEach(s => {
            if (s.type === 'ultrasonic' && Math.abs(s.mount.rotation) < 0.5) {
                if (s.servoId) {
                    const servo = this.config.servos.find(srv => srv.id === s.servoId);
                    // Enable scanning
                    const scanAngle = 60 * Math.sin(ctx.time * 4);
                    if (servo) ctx.inputs.servoWrite(servo.pin, scanAngle);
                }
                const pin = s.pins.analog ?? s.pins.trigger;
                if (pin !== undefined) {
                    const d = ctx.inputs.analogRead(pin);
                    if (d > 0 && d < minDist) minDist = d;
                }
            }
        });

        const dist = minDist;

        const deltaDist = dist - this.lastDist;
        this.lastDist = dist;

        // Threshold: if distance drops faster than 5 units/frame
        const THREAT_THRESHOLD = -2.0;

        if (deltaDist < THREAT_THRESHOLD && dist < 150) {
            this.isFleeing = true;
            this.fleeTimer = 2.0; // Flee for 2 seconds
        }

        if (this.isFleeing) {
            this.fleeTimer -= ctx.dt;
            if (this.fleeTimer <= 0) {
                this.isFleeing = false;
            } else {
                // Flee: Back up and turn
                this.nav.setVelocity(-0.5, 0.8);
                return;
            }
        }

        // Idle / Patrol
        this.nav.setVelocity(0, 0);
    }
}
