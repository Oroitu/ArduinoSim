
export enum PinMode {
  INPUT,
  OUTPUT,
}

export interface Vector2D {
  x: number;
  y: number;
}

export interface ViewTransform {
  x: number;
  y: number;
  scale: number;
}

// --- Vehicle Configuration Models ---

export type MotorRole = 'left' | 'right' | 'omni' | 'custom';
export type SensorType = 'ultrasonic' | 'line' | 'impact';

export interface MountConfig {
  x: number;
  y: number;
  rotation: number; // Radians
}

export interface MotorConfig {
  id: string;
  name: string;
  role: MotorRole;
  pwmPin: number;
  dirPin?: number; // -1 if not used
  mount: MountConfig;
  maxSpeed: number; // m/s (approx for sim)
}

export interface ServoConfig {
  id: string;
  name: string;
  pin: number;
  minAngle: number; // Degrees
  maxAngle: number; // Degrees
  maxSpeed: number; // Degrees per second
  currentAngle?: number; // Runtime state helper
}

export interface SensorConfig {
  id: string;
  name: string;
  type: SensorType;
  channel: string; // Logical name for code (e.g., "DIST_FRONT")
  mount: MountConfig;
  servoId?: string; // If mounted on a servo

  // Physical mapping
  pins: {
    trigger?: number;
    echo?: number;
    analog?: number;
  };

  // Sim parameters
  params: {
    range?: number;
    fov?: number; // Radians
  };
  color?: string;
}

export interface ChassisConfig {
  width: number;
  length: number;
  radius?: number; // For circular robots
  shape: 'rect' | 'circle';
}

// The "Single Source of Truth"
export interface VehicleConfig {
  chassis: ChassisConfig;
  motors: MotorConfig[];
  servos: ServoConfig[];
  sensors: SensorConfig[];
}

// --- Simulation State ---

export interface ServoState {
  id: string;
  angle: number;
  targetAngle: number;
}

export interface RobotState {
  position: Vector2D;
  rotation: number;
  velocity: number;
  angularVelocity: number;
  servos: ServoState[];
  sensorReadings: Record<number, number>; // Map pin -> value
}

export interface HardwareState {
  pins: number[]; // Array of 0-255 values
  pinModes: PinMode[];
  millis: number;
}

export type ObstacleType = 'rect' | 'circle' | 'zone' | 'hide' | 'circuit';

export interface WorldObject {
  id: string;
  type: ObstacleType;
  x: number;
  y: number;
  width: number;
  height: number;
  radius?: number;
  rotation: number;
  color: string;
  isPhysical: boolean;
  frictionMultiplier: number;
  // Movement Properties
  movementType?: 'static' | 'random' | 'linear' | 'chase';
  velocity?: Vector2D; // Runtime velocity
  speed?: number; // Configured speed property
}

export interface WorldState {
  width: number;
  height: number;
  objects: WorldObject[];
  startPosition: Vector2D;
  startRotation: number;
}

export interface LogEntry {
  id: string;
  timestamp: number;
  message: string;
  type: 'info' | 'error' | 'system';
}

export interface ArduinoAPI {
  pinMode: (pin: number, mode: string) => void;
  digitalWrite: (pin: number, level: string | number | boolean) => void;
  analogWrite: (pin: number, value: number) => void;
  servoWrite: (pin: number, angle: number) => void;
  digitalRead: (pin: number) => number;
  analogRead: (pin: number) => number;
  millis: () => number;
  console: { log: (...args: any[]) => void };
  delay: (ms: number) => Promise<void>;
}

export type EditorTool = 'select' | 'move' | 'rect' | 'wall' | 'circle' | 'zone' | 'start' | 'hide' | 'circuit';

export type AppMode = 'edit' | 'play' | 'workshop' | 'training';

export enum BehaviorType {
  Manual = 'MANUAL', // Teleoperation (Level 3)
  Program = 'PROGRAM', // User Sketch (Legacy Manual)
  Mobility = 'MOVILIDAD',
  Escape = 'ESCAPE',
  Coverage = 'COBERTURA',
  MobilityImit = 'MOVILIDAD_IMIT',
  MobilityRL = 'MOVILIDAD_RL'
}

export interface DemoSample {
  time: number;
  obs: number[];
  action: number[];
  pose?: { x: number; y: number; theta: number };
  scenarioId?: string;
}

export interface DemoEpisode {
  id: string;
  vehicleConfigId: string;
  scenarioId: string;
  behaviorTarget: BehaviorType;
  samples: DemoSample[];
}
