import { IBehavior, BehaviorContext } from './types';
import { VehicleConfig } from '../../types';
import { RobotNavigation } from './Navigation';

export class ManualBehavior implements IBehavior {
    name = "MANUAL";
    private nav: RobotNavigation;
    private config: VehicleConfig;

    constructor(nav: RobotNavigation, config: VehicleConfig) {
        this.nav = nav;
        this.config = config;
    }

    init() {
        this.nav.stop();
    }

    step(ctx: BehaviorContext) {
        // 1. Manage Scanners (Keep them moving for consistent observations)
        this.config.sensors.forEach(s => {
            if (s.servoId) {
                const servo = this.config.servos.find(srv => srv.id === s.servoId);
                // Sweep sensor +/- 60 degrees
                const scanAngle = 60 * Math.sin(ctx.time * 4);
                if (servo) ctx.inputs.servoWrite(servo.pin, scanAngle);
            }
        });

        // 2. Apply Teleop
        if (ctx.teleop) {
            // Debug: Log only if there is any input
            if (Math.abs(ctx.teleop.v) > 0.01 || Math.abs(ctx.teleop.w) > 0.01) {
                ctx.inputs.console.log(`Manual Input: v=${ctx.teleop.v.toFixed(2)}, w=${ctx.teleop.w.toFixed(2)}`);
            }
            this.nav.setVelocity(ctx.teleop.v, ctx.teleop.w);
        } else {
            this.nav.stop();
        }
    }
}
