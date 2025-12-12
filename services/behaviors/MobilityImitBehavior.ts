import { IBehavior, BehaviorContext } from './types';
import { VehicleConfig } from '../../types';
import { RobotNavigation } from './Navigation';
import { buildObservationVector, policyNetwork } from '../LearningService';

export class MobilityImitBehavior implements IBehavior {
    name = "MOVILIDAD_IMIT";
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
        const { inputs, robotState } = ctx;

        // Ensure scanner sweeps (matching Manual Behavior for consistency)
        this.config.sensors.forEach(s => {
            if (s.servoId) {
                const servo = this.config.servos.find(srv => srv.id === s.servoId);
                const scanAngle = 60 * Math.sin(ctx.time * 4);
                if (servo) inputs.servoWrite(servo.pin, scanAngle);
            }
        });

        // 1. Build Observation
        // NOTE: We need velocities. 
        // We can get them from robotState if available in ctx (I added it to App.tsx but need to check types.ts BehaviorContext)
        // In App.tsx I passed 'robotState' to ctx. let's verify BehaviorContext in types.ts.
        // It's likely missing in the interface definition.
        // I should probably cast or update types.ts. I'll update types.ts first to be safe, or just cast here.

        let v = 0, w = 0;
        if ((ctx as any).robotState) {
            v = (ctx as any).robotState.velocity;
            w = (ctx as any).robotState.angularVelocity;
        }

        const obs = buildObservationVector(inputs, this.config, v, w);

        // 2. Predict
        const action = policyNetwork.predict(obs);

        // 3. Act
        // Map [-1, 1] to max speeds?
        // Let's assume the learned policy outputs normalized [-1, 1] fractions of MAX speed.
        // Or if we recorded raw joystick [-1, 1], then we just apply that multiplier to the nav params.

        // Manual mode 'teleop' values were ~ +/- 0.8 for v, +/- 1.5 for w.
        // Let's rely on Navigation.setVelocity to handle limits? 
        // Navigation.setVelocity(v, w) usually expects Speed units, not just -1..1.
        // In App.tsx Manual logic:
        // if (ArrowUp) v_tele += 0.5;
        // Navigation.setVelocity(v_tele, w_tele)

        // So the network learns to output 0.5, 0.8, etc directly?
        // YES, if we trained on 'action = [v_tele, w_tele]'.
        // So we just pass the output directly.

        this.nav.setVelocity(action.v, action.w);

        // Debug
        // if (Math.random() < 0.05) console.log("Imit Action:", action);
    }
}
