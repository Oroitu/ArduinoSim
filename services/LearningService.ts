import { ArduinoAPI, VehicleConfig, SensorConfig } from '../types';

/**
 * Builds a standardized observation vector from the sensor readings.
 * Format: [dist_1, dist_2, ..., dist_N, v_current, w_current]
 * 
 * NOTE: The order of sensors must be deterministic. We sort them by ID or channel.
 */
export function buildObservationVector(
    api: ArduinoAPI,
    config: VehicleConfig,
    currentV: number = 0,
    currentW: number = 0
): number[] {
    const obs: number[] = [];

    // 1. Sensor Readings (Normalized 0..1 if possible, or raw distances)
    // We'll use raw distances for now, or clamped.
    // Let's sort sensors to ensure consistent ordering across sessions.
    const sortedSensors = [...config.sensors].sort((a, b) => a.id.localeCompare(b.id));

    for (const sensor of sortedSensors) {
        // Read from the analog pin defined in the config
        // If the sensor is mounted on a servo, we might want to include the servo angle too?
        // For this MVP, we assume the scanner is sweeping and we take the instantaneous reading.
        // Or better: the "observation" might usually need to include the ANGLE of the sensor if it's moving.
        // However, the prompt suggested a simple vector. We will stick to the reading value.

        let val = 0;
        if (sensor.pins.analog !== undefined) {
            val = api.analogRead(sensor.pins.analog);
        } else if (sensor.pins.trigger !== undefined && sensor.pins.echo !== undefined) {
            // For ultrasonic in Arduino, we'd use pulseIn. Here we might simulate it via analogRead or a custom API.
            // In this sim, we are using analogRead(pin) to get the distance from the physics engine.
            // The simulator writes distance to the 'echo' pin or 'analog' pin?
            // Checking MobilityBehavior: ctx.inputs.analogRead(pin)
            // It seems the simulator physics puts the reading on the 'analog' pin if defined, or we check 'pins.analog'.
            // Let's rely on 'pins.analog' being populated by the user/config as the read pin.

            if (sensor.pins.analog !== undefined) {
                val = api.analogRead(sensor.pins.analog);
            } else {
                // Fallback or complex logic if using trigger/echo pairs strictly.
                // In this environment, let's assume analogRead works for distance if the pin is mapped.
                // If not, we might miss data.
                val = 0;
            }
        }

        // Normalize? 
        // Max range is often ~200-400cm. Let's send raw or basic normalization.
        // Prompt suggested: [dist_front, dist_left, ... ]
        obs.push(val);

        // If the sensor is on a servo, we SHOULD include the servo angle to make sense of the distance.
        // Prompt says: "obs[]: [ dist_front, dist_left... v_actual, w_actual ]"
        // It didn't explicitly demand servo angles, but for a scanning sensor, distance without angle is ambiguous.
        // We will add the servo angle if the sensor has a servoId.
        if (sensor.servoId) {
            // Find current servo angle
            // Since we don't have direct access to 'RobotState' here easily without passing it,
            // we can rely on 'api' if extended, or just ignore for the MVP as per prompt.
            // The prompt example was simple. Let's stick to the prompt's simplicity.
        }
    }

    // 2. State (Velocities)
    obs.push(currentV);
    obs.push(currentW);

    return obs;
}

export interface PolicyWeights {
    mean: number[];
    std: number[];
    weights: number[][][]; // [layer][input][unit] ?? Check python export. 
    // Python export was: [w.T.tolist()] where w is [in, out]. So w.T is [out, in].
    // So weights[layer] is [rows=out_units][cols=inputs].
    biases: number[][];    // [layer][unit]
    activations: string[];
}

export class PolicyNetwork {
    private weights: PolicyWeights | null = null;

    load(json: any) {
        // Validate or just cast
        this.weights = json as PolicyWeights;

        // Return metadata if possible
        if (this.weights && this.weights.weights && this.weights.weights.length > 0) {
            // weights[0] is [units][inputs]
            // So input dim is weights[0][0].length
            // Output dim is weights[last].length
            const inputDim = this.weights.weights[0][0].length;
            const outputDim = this.weights.weights[this.weights.weights.length - 1].length;
            return { inputDim, outputDim };
        }
        return null;
    }

    predict(obs: number[]): { v: number, w: number } {
        if (!this.weights) return { v: 0, w: 0 };

        const { mean, std, weights, biases, activations } = this.weights;

        // 1. Normalize
        let x = obs.map((val, i) => (val - (mean[i] || 0)) / (std[i] || 1));

        // 2. Forward Pass
        // weights is list of layers. 
        // weights[i] is matrix of shape [n_neurons, n_inputs_prev]
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
                if (i === weights.length - 1) {
                    // Output layer: usually also tanh for v,w in [-1, 1]
                    nextX.push(Math.tanh(sum));
                } else {
                    // Hidden layers
                    if (act === 'tanh') nextX.push(Math.tanh(sum));
                    else if (act === 'relu') nextX.push(Math.max(0, sum));
                    else nextX.push(sum);
                }
            }
            x = nextX;
        }

        // Output x is [v_norm, w_norm]
        return { v: x[0], w: x[1] };
    }
}

export const policyNetwork = new PolicyNetwork();
export const rlPolicyNetwork = new PolicyNetwork();

