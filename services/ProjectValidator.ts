import { VehicleConfig, WorldState } from "../types";
import { DEFAULT_TRAINING_PARAMS, TrainingParams } from "../components/RLTrainingConfig";

// Deep validation helpers
const isNumber = (n: any) => typeof n === 'number' && !isNaN(n);
const isString = (s: any) => typeof s === 'string';
const isArray = (a: any) => Array.isArray(a);

const validateVehicleConfig = (config: any): boolean => {
    if (!config || typeof config !== 'object') return false;
    // Check chassis
    if (!config.chassis || !isNumber(config.chassis.width) || !isNumber(config.chassis.length)) return false;
    // Check motors (array)
    if (!isArray(config.motors)) return false;
    // Check sensors (array)
    if (!isArray(config.sensors)) return false;
    return true;
};

const validateWorldState = (world: any): boolean => {
    if (!world || typeof world !== 'object') return false;
    if (!isArray(world.objects)) return false;
    // Bounds check objects count (prevent massive world crash)
    if (world.objects.length > 200) return false;

    if (!world.startPosition || !isNumber(world.startPosition.x) || !isNumber(world.startPosition.y)) return false;
    return true;
};

const validateTrainingParams = (params: any): boolean => {
    if (!params || typeof params !== 'object') return false;
    // Check keys present in default
    const keys = Object.keys(DEFAULT_TRAINING_PARAMS) as (keyof TrainingParams)[];
    return keys.every(k => isNumber(params[k]));
};

export interface ProjectData {
    version: number;
    date: string;
    vehicleConfig: VehicleConfig;
    world: WorldState;
    code: string;
    trainingParams?: TrainingParams;
}

export const validateProjectFile = (json: any): { valid: boolean; error?: string; data?: ProjectData } => {
    try {
        if (!json || typeof json !== 'object') {
            return { valid: false, error: "Invalid JSON Structure" };
        }

        // 1. Basic Schema Check
        if (!json.vehicleConfig || !json.world || !json.code) {
            return { valid: false, error: "Missing core project fields (vehicle, world, code)" };
        }

        // 2. Validate Sub-objects
        if (!validateVehicleConfig(json.vehicleConfig)) {
            return { valid: false, error: "Invalid Vehicle Configuration" };
        }

        if (!validateWorldState(json.world)) {
            return { valid: false, error: "Invalid World State (or too many objects)" };
        }

        if (!isString(json.code)) {
            return { valid: false, error: "Invalid Code format" };
        }

        // 3. Optional Params
        let trainingParams = json.trainingParams;
        if (trainingParams && !validateTrainingParams(trainingParams)) {
            // Fallback or warning? Let's just reset to default if invalid
            trainingParams = undefined;
        }

        // 4. Construct Clean Data
        const cleanData: ProjectData = {
            version: json.version || 1,
            date: json.date || new Date().toISOString(),
            vehicleConfig: json.vehicleConfig,
            world: json.world,
            code: json.code,
            trainingParams
        };

        return { valid: true, data: cleanData };

    } catch (e: any) {
        return { valid: false, error: e.message || "Unknown validation error" };
    }
};
