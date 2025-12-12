import { BehaviorType } from '../../types';
import { IBehavior, BehaviorContext } from './types';

export class BehaviorManager {
    private behaviors: Map<BehaviorType, IBehavior> = new Map();
    private currentId: BehaviorType = BehaviorType.Manual;
    private current: IBehavior | null = null;

    register(id: BehaviorType, behavior: IBehavior) {
        this.behaviors.set(id, behavior);
        if (id === this.currentId) {
            this.current = behavior;
            // Optionally re-init if needed, though usually init() is for state reset on switch.
            // behavior.init(); 
        }
    }

    setBehavior(id: BehaviorType) {
        if (this.currentId === id) return;

        if (this.behaviors.has(id)) {
            this.current = this.behaviors.get(id)!;
            this.current.init();
        } else {
            this.current = null;
        }
        this.currentId = id;
    }

    update(ctx: BehaviorContext) {
        if (this.current) {
            this.current.step(ctx);
        }
    }

    getCurrentId(): BehaviorType {
        return this.currentId;
    }
}
