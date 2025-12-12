import { IBehavior, BehaviorContext } from './types';
import { VehicleConfig } from '../../types';
import { RobotNavigation } from './Navigation';
import { buildObservationVector, rlPolicyNetwork } from '../LearningService';

export class MobilityRLBehavior implements IBehavior {
    name = "MOVILIDAD_RL";
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
        const { inputs } = ctx;
        let v = 0, w = 0;
        if ((ctx as any).robotState) {
            v = (ctx as any).robotState.velocity;
            w = (ctx as any).robotState.angularVelocity;
        }

        const obs = buildObservationVector(inputs, this.config, v, w);

        // Predict using RL Policy
        const action = rlPolicyNetwork.predict(obs);

        // Apply action
        // RL also outputs normalized [-1, 1]
        // We map to max speeds defined in Navigation or Config.
        // Assuming action.v/w are directly usable as ratios if Navigation handles scaling,
        // or we scale them here if Navigation expects absolute units.
        // MobilityImit assumed normalized was presumably handled or passed directly.
        // Let's pass directly for consistency with Imitation.

        this.nav.setVelocity(action.v, action.w);
    }
}
