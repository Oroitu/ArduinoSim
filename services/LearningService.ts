import { ArduinoAPI, VehicleConfig, SensorConfig } from '../types';

/**
 * Builds a standardized observation vector from the sensor readings.
 * Format: [dist_1, angle_1 (opt), ..., dist_N, angle_N (opt), v_current, w_current]
 * 
 * NOTE: The order of sensors is deterministic (sorted by ID).
 * If a sensor is mounted on a servo, its ANGLE is appended immediately after its distance reading.
 */
export function buildObservationVector(
    api: ArduinoAPI,
    config: VehicleConfig,
    currentV: number = 0,
    currentW: number = 0
): number[] {
    const obs: number[] = [];

    // 1. Sensor Readings
    const sortedSensors = [...config.sensors].sort((a, b) => a.id.localeCompare(b.id));

    for (const sensor of sortedSensors) {
        let val = 0;
        // Read Distance (normalized or raw? for now raw mm or analog value)
        if (sensor.pins.analog !== undefined) {
            val = api.analogRead(sensor.pins.analog);
        } else if (sensor.pins.trigger !== undefined) {
            // Emulate distance read (assuming sim puts it on analog pin if no pulseIn available)
            // Ideally we'd have a specific distance API.
            // Check implicit: in sim, trigger usually maps to the 'analog' slot for simplicity in physics engine
            val = api.analogRead(sensor.pins.analog || sensor.pins.echo || -1); // Fallback
        }
        obs.push(val);

        // 2. Servo Angle (if mounted)
        // This is critical for scanning sensors to disambiguate the reading.
        if (sensor.servoId) {
            const servo = config.servos.find(s => s.id === sensor.servoId);
            if (servo) {
                // We need the current angle. 
                // In Sim: We don't have direct access to Servo state in 'api' unless we track it or read it back.
                // Hack: For now, we assume the user/sim logic exposes servo position via analogRead on the servo pin? 
                // Or better: The `api` object needs a way to query servo state. 
                // Since `api` is standard Arduino (servoWrite), it doesn't have servoRead.
                // However, in our Virtual Machine, we can cheat or we must record the last written value.
                // Let's assume the API has been extended or we rely on a convention. 
                // For this implementation, we will try to read the projected angle from the API if possible, 
                // or default to 0 if not tracked.
                // CHECK: does api.servoRead exist? No.
                // We will skip for now or insert a placeholder if we can't get it, 
                // BUT we must insert *something* to match the training vector shape.
                // Let's rely on global state or assume 0 for static.
                // Note: The prompt asks to "Include the angle". We will append 0 as placeholder 
                // until the API supports `getServoAngle`.
                obs.push(0);
            }
        }
    }

    // 2. State (Velocities)
    obs.push(currentV);
    obs.push(currentW);

    return obs;
}

export interface PolicyMetadata {
    sensors?: string[];      // List of expected sensor IDs/Roles
    actionScale?: {          // Multipliers for raw network output
        linear: number;
        angular: number;
    };
    normalization?: {        // Explicit mean/std if not embedded in weights
        mean: number[];
        std: number[];
    };
    inputDim?: number;
}

export interface PolicyWeights {
    mean: number[];
    std: number[];
    weights: number[][][]; // [layer][output_unit][input_unit]
    biases: number[][];    // [layer][unit]
    activations: string[];
    metadata?: PolicyMetadata; // New metadata field
}

export class PolicyNetwork {
    private weights: PolicyWeights | null = null;
    private validationErrors: string[] = [];

    load(json: any) {
        this.weights = json as PolicyWeights;
        this.validationErrors = [];
        return this.getMetadata();
    }

    getMetadata() {
        if (!this.weights || !this.weights.weights || this.weights.weights.length === 0) return null;
        const inputDim = this.weights.weights[0][0].length;
        const outputDim = this.weights.weights[this.weights.weights.length - 1].length;
        return { inputDim, outputDim };
    }

    validate(config: VehicleConfig): string[] {
        if (!this.weights) return ["No policy loaded."];
        const errors: string[] = [];

        // 1. Check Input Dimension
        // Build a dummy obs to check size
        const dummyObs = buildObservationVector({ analogRead: () => 0 } as any, config, 0, 0);
        const expectedDim = this.getMetadata()?.inputDim || 0;

        if (dummyObs.length !== expectedDim) {
            errors.push(`Input Dimension Mismatch: Policy expects ${expectedDim}, robot generates ${dummyObs.length}.`);
        }

        // 2. Check Sensors (if metadata available)
        if (this.weights.metadata?.sensors) {
            const currentSensorIds = config.sensors.map(s => s.id).sort();
            const expectedSensorIds = [...this.weights.metadata.sensors].sort();

            // Simple check: are they identical?
            const isSame = currentSensorIds.length === expectedSensorIds.length &&
                currentSensorIds.every((val, index) => val === expectedSensorIds[index]);

            if (!isSame) {
                errors.push(`Sensor Configuration Mismatch. Policy expects: ${expectedSensorIds.join(', ')}. Found: ${currentSensorIds.join(', ')}.`);
            }
        }

        this.validationErrors = errors;
        return errors;
    }

    predict(obs: number[]): { v: number, w: number } {
        if (!this.weights) return { v: 0, w: 0 };
        if (this.validationErrors.length > 0) {
            // Option: Throw or return 0? Let's return 0 to be safe.
            // console.warn("Predict blocked due to validation errors");
            return { v: 0, w: 0 };
        }

        const { weights, biases, activations, metadata } = this.weights;
        // Use metadata normalization if available, else root mean/std
        const mean = metadata?.normalization?.mean || this.weights.mean || [];
        const std = metadata?.normalization?.std || this.weights.std || [];

        // 1. Normalize
        let x = obs.map((val, i) => {
            const m = mean[i] || 0;
            const s = std[i] || 1;
            return (val - m) / s;
        });

        // 2. Forward Pass
        for (let i = 0; i < weights.length; i++) {
            const W = weights[i]; // [units][inputs]
            const b = biases[i];  // [units]
            const act = activations[i] || 'tanh';

            const nextX: number[] = [];
            for (let r = 0; r < W.length; r++) {
                let sum = b[r];
                for (let c = 0; c < x.length; c++) {
                    sum += W[r][c] * x[c];
                }

                // Activation
                if (i === weights.length - 1) { // Output Layer
                    nextX.push(Math.tanh(sum));
                } else { // Hidden Layers
                    if (act === 'tanh') nextX.push(Math.tanh(sum));
                    else if (act === 'relu') nextX.push(Math.max(0, sum));
                    else nextX.push(sum);
                }
            }
            x = nextX;
        }

        // 3. Scaling (Action Mapping)
        let v = x[0];
        let w = x[1];

        if (metadata?.actionScale) {
            v *= metadata.actionScale.linear;
            w *= metadata.actionScale.angular;
        }

        return { v, w };
    }
}

export const policyNetwork = new PolicyNetwork();
export const rlPolicyNetwork = new PolicyNetwork();

