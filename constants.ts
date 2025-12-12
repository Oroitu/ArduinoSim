
import { VehicleConfig, WorldState } from './types';

// Physics
export const DT = 0.016; // 60hz
export const FRICTION_DEFAULT = 0.95;
export const MAX_SPEED_DEFAULT = 150;

// World
export const WORLD_WIDTH = 1200;
export const WORLD_HEIGHT = 800;
export const CIRCUIT_PATH_DATA = "M 150,800 C 50,800 50,600 150,550 S 350,650 400,550 C 450,450 350,350 250,400 S 100,200 200,150 S 450,250 550,150 C 650,50 850,50 950,150 S 1050,350 950,450 S 750,350 650,450 C 550,550 650,700 750,650 S 950,550 1050,650 C 1150,750 1100,850 1000,850 S 800,750 700,800 S 500,850 400,800 S 250,850 150,800 Z";

export const DEFAULT_VEHICLE_CONFIG: VehicleConfig = {
  chassis: {
    shape: 'rect',
    width: 24,
    length: 32,
  },
  motors: [
    {
      id: 'm_left',
      name: 'Left Motor',
      role: 'left',
      pwmPin: 5,
      dirPin: -1,
      maxSpeed: 150,
      mount: { x: 0, y: -14, rotation: 0 } // y is lateral offset
    },
    {
      id: 'm_right',
      name: 'Right Motor',
      role: 'right',
      pwmPin: 6,
      dirPin: -1,
      maxSpeed: 150,
      mount: { x: 0, y: 14, rotation: 0 }
    }
  ],
  servos: [
    {
      id: 's_scan',
      name: 'Scan Servo',
      pin: 9,
      minAngle: -90,
      maxAngle: 90,
      maxSpeed: 180
    }
  ],
  sensors: [
    {
      id: 'us_front',
      name: 'Front Sonar',
      type: 'ultrasonic',
      channel: 'DIST_FRONT',
      mount: { x: 16, y: 0, rotation: 0 },
      color: '#10b981',
      params: { range: 200, fov: 0.2 },
      pins: { trigger: 14, echo: 14, analog: 14 } // Using analog pin 14 (A0) for simplicity in sim
    },
    {
      id: 'us_scan',
      name: 'Scan Sonar',
      type: 'ultrasonic',
      channel: 'DIST_SCAN',
      mount: { x: 5, y: 0, rotation: 0 },
      servoId: 's_scan',
      color: '#ef4444',
      params: { range: 200, fov: 0.2 },
      pins: { trigger: 15, echo: 15, analog: 15 } // A1
    }
  ]
};

export const DEFAULT_WORLD: WorldState = {
  width: WORLD_WIDTH,
  height: WORLD_HEIGHT,
  startPosition: { x: 100, y: 400 },
  startRotation: 0,
  objects: [
    { id: 'w1', type: 'rect', x: WORLD_WIDTH / 2, y: 5, width: WORLD_WIDTH, height: 10, rotation: 0, color: '#94a3b8', isPhysical: true, frictionMultiplier: 1 },
    { id: 'w2', type: 'rect', x: WORLD_WIDTH / 2, y: WORLD_HEIGHT - 5, width: WORLD_WIDTH, height: 10, rotation: 0, color: '#94a3b8', isPhysical: true, frictionMultiplier: 1 },
    { id: 'w3', type: 'rect', x: 5, y: WORLD_HEIGHT / 2, width: 10, height: WORLD_HEIGHT, rotation: 0, color: '#94a3b8', isPhysical: true, frictionMultiplier: 1 },
    { id: 'w4', type: 'rect', x: WORLD_WIDTH - 5, y: WORLD_HEIGHT / 2, width: 10, height: WORLD_HEIGHT, rotation: 0, color: '#94a3b8', isPhysical: true, frictionMultiplier: 1 },
    { id: 'o1', type: 'rect', x: 400, y: 400, width: 50, height: 300, rotation: 0, color: '#64748b', isPhysical: true, frictionMultiplier: 1 },
    { id: 'c1', type: 'circle', x: 600, y: 300, width: 0, height: 0, radius: 40, rotation: 0, color: '#64748b', isPhysical: true, frictionMultiplier: 1 },
    { id: 'c2', type: 'circle', x: 600, y: 500, width: 0, height: 0, radius: 40, rotation: 0, color: '#64748b', isPhysical: true, frictionMultiplier: 1 },
  ]
};

export const DEMO_CODE = `
// NOTE: Use the Generated Config tab to see 
// pin definitions based on your Workshop build.

// Include the virtual headers
// #include "robot_hw.h"

// For this sim, we just use standard Arduino calls
// mapped to the pins you configured.

const PIN_MOTOR_L = 5;
const PIN_MOTOR_R = 6;
const PIN_SERVO   = 9;
const PIN_FRONT   = 14; // A0
const PIN_SCAN    = 15; // A1

let state = 0; // 0: DRIVE, 1: SCAN, 2: TURN
let lastStateTime = 0;
let scanAngle = -90;
let bestAngle = 0;
let maxDistFound = 0;

function setup() {
  console.log("System Online");
  servoWrite(PIN_SERVO, 0);
}

async function loop() {
  const t = millis();
  const frontDist = analogRead(PIN_FRONT);
  
  if (state == 0) { // Drive
    if (frontDist < 60) {
      analogWrite(PIN_MOTOR_L, 0);
      analogWrite(PIN_MOTOR_R, 0);
      state = 1;
      lastStateTime = t;
      console.log("Obstacle! Scanning...");
      await delay(500); // Stop for a bit
    } else {
      analogWrite(PIN_MOTOR_L, 120);
      analogWrite(PIN_MOTOR_R, 120);
    }
  } 
  else if (state == 1) { // Scan
    if (t - lastStateTime > 200) {
       servoWrite(PIN_SERVO, scanAngle);
       // Wait for servo to move (simulated)
       await delay(50);
       const scanDist = analogRead(PIN_SCAN);
       
       if (scanDist > maxDistFound) {
         maxDistFound = scanDist;
         bestAngle = scanAngle;
       }
       
       scanAngle += 10;
       if (scanAngle > 90) {
         state = 2;
         scanAngle = -90;
         console.log("Turn to " + bestAngle);
         lastStateTime = t;
       }
    }
  }
  else if (state == 2) { // Turn
    const turnDir = bestAngle > 0 ? 1 : -1;
    // Simple differential turn
    if (turnDir > 0) {
       analogWrite(PIN_MOTOR_L, 100);
       analogWrite(PIN_MOTOR_R, 0); 
    } else {
       analogWrite(PIN_MOTOR_L, 0);
       analogWrite(PIN_MOTOR_R, 100); 
    }
    
    if (t - lastStateTime > Math.abs(bestAngle) * 5) {
       state = 0;
       maxDistFound = 0;
    }
  }
  // Small delay to prevent infinite loop locking if logic is empty, 
  // though animation frame handles it, good practice in async loops.
  await delay(10); 
}
`;
