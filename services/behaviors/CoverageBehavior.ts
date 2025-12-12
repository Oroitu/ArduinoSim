import { IBehavior, BehaviorContext } from './types';
import { RobotNavigation } from './Navigation';
import { VehicleConfig } from '../../types';

enum State {
    FIND_WALL,
    FOLLOW_WALL,
    INTERIOR
}

export class CoverageBehavior implements IBehavior {
    name = "COBERTURA";
    private nav: RobotNavigation;
    private config: VehicleConfig;
    private state = State.FIND_WALL;

    constructor(nav: RobotNavigation, config: VehicleConfig) {
        this.nav = nav;
        this.config = config;
    }

    init() {
        this.nav.stop();
        this.state = State.FIND_WALL;
    }

    step(ctx: BehaviorContext) {
        this.manageScanners(ctx);
        const dist = this.getFrontDistance(ctx);

        switch (this.state) {
            case State.FIND_WALL:
                // Drive forward until wall
                this.nav.setVelocity(0.5, 0);
                if (dist < 50) {
                    this.state = State.FOLLOW_WALL;
                }
                break;
            case State.FOLLOW_WALL:
                // Valid Wall Follow logic (Bang-bang controller)
                if (dist < 30) {
                    // Too close to front wall -> Turn Left
                    this.nav.setVelocity(0, 0.5);
                } else {
                    // Check side? 
                    // Simple square trace: Drive Fwd, Turn if hit.
                    this.nav.setVelocity(0.4, -0.1); // Curve right slightly to find wall?
                }
                break;
        }
    }

    private getFrontDistance(ctx: BehaviorContext): number {
        let minDist = 999;
        this.config.sensors.forEach(s => {
            if (s.type === 'ultrasonic' && Math.abs(s.mount.rotation) < 0.5) {
                // Servos are centered in step(), just read here
                const pin = s.pins.analog ?? s.pins.trigger;
                if (pin !== undefined) {
                    const d = ctx.inputs.analogRead(pin);
                    if (d > 0 && d < minDist) minDist = d;
                }
            }
        });
        return minDist;
    }

    private manageScanners(ctx: BehaviorContext) {
        this.config.sensors.forEach(s => {
            if (s.servoId) {
                const servo = this.config.servos.find(srv => srv.id === s.servoId);
                if (servo) {
                    const scanAngle = 60 * Math.sin(ctx.time * 4);
                    ctx.inputs.servoWrite(servo.pin, scanAngle);
                }
            }
        });
    }
}
