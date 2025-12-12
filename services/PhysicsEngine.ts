
import { Vector2D, RobotState, HardwareState, WorldState, WorldObject, VehicleConfig, SensorConfig } from '../types';
import { DT, FRICTION_DEFAULT, CIRCUIT_PATH_DATA } from '../constants';

// --- Circuit Collision Helper ---
let circuitCtx: CanvasRenderingContext2D | null = null;
let circuitPath: Path2D | null = null;

const checkCircuitCollision = (x: number, y: number, circuitObj: WorldObject): boolean => {
  if (typeof window === 'undefined') return false; // SSG safety

  if (!circuitCtx) {
    const cvs = document.createElement('canvas');
    cvs.width = 1; cvs.height = 1; // Size doesn't matter for isPointInStroke
    circuitCtx = cvs.getContext('2d');
  }
  if (!circuitPath && circuitCtx) {
    circuitPath = new Path2D(CIRCUIT_PATH_DATA);
  }

  if (!circuitCtx || !circuitPath) return false;

  // Transform point to local 1200x900 space
  // The object has x, y (center), width, height.
  // The path is defined in 0..1200, 0..900 space.
  // We rendered it by translating -600, -450 and scaling.

  // Inverse Transform:
  // 1. Validating 0,0 is center of object
  const dx = x - circuitObj.x;
  const dy = y - circuitObj.y;

  // 2. Un-rotate (if rotation supported, though usually 0 for this map)
  // Assuming 0 rotation for simplicity on complex mesh or use rotatePoint
  // const localRot = rotatePoint({x,y}, {x: circuitObj.x, y: circuitObj.y}, -circuitObj.rotation);

  // 3. Un-scale
  // The canvas scale was: scale(obj.width / 1200, obj.height / 900)
  const sx = circuitObj.width / 1200;
  const sy = circuitObj.height / 900;

  // Local point in the "1200x900 centered at 0,0" space
  const lx = dx / sx;
  const ly = dy / sy;

  // 4. Trace back to original path coordinates (0..1200)
  // We translated -600, -450 before drawing centered.
  // So lx = originalX - 600 => originalX = lx + 600
  const originalX = lx + 600;
  const originalY = ly + 450;

  // Check
  circuitCtx.lineWidth = 75;
  circuitCtx.lineCap = 'round';
  circuitCtx.lineJoin = 'round';

  // If we are IN the stroke, it is safe (hollow). If NOT, it is collision (solid).
  return !circuitCtx.isPointInStroke(circuitPath, originalX, originalY);
};

// --- Math Helpers ---

const rotatePoint = (p: Vector2D, center: Vector2D, angle: number): Vector2D => {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = p.x - center.x;
  const dy = p.y - center.y;
  return {
    x: center.x + (dx * cos - dy * sin),
    y: center.y + (dx * sin + dy * cos)
  };
};

const closestPointOnRect = (p: Vector2D, rectHalfW: number, rectHalfH: number): Vector2D => {
  return {
    x: Math.max(-rectHalfW, Math.min(p.x, rectHalfW)),
    y: Math.max(-rectHalfH, Math.min(p.y, rectHalfH))
  };
};

const isPointInRotatedRect = (p: Vector2D, rect: WorldObject): boolean => {
  const localP = rotatePoint(p, { x: rect.x, y: rect.y }, -rect.rotation);
  const halfW = rect.width / 2;
  const halfH = rect.height / 2;
  return (
    localP.x >= rect.x - halfW &&
    localP.x <= rect.x + halfW &&
    localP.y >= rect.y - halfH &&
    localP.y <= rect.y + halfH
  );
};

// --- Raycasting ---

const rayIntersectCircle = (origin: Vector2D, dir: Vector2D, center: Vector2D, radius: number): number | null => {
  const L = { x: center.x - origin.x, y: center.y - origin.y };
  const tca = L.x * dir.x + L.y * dir.y;
  const d2 = (L.x * L.x + L.y * L.y) - (tca * tca);
  if (d2 > radius * radius) return null;
  const thc = Math.sqrt(radius * radius - d2);
  let t0 = tca - thc;
  let t1 = tca + thc;
  if (t0 < 0 && t1 < 0) return null;
  if (t0 < 0) return t1;
  return t0;
};

const rayIntersectSegment = (p: Vector2D, r: Vector2D, q: Vector2D, s: Vector2D): number | null => {
  const rxs = r.x * s.y - r.y * s.x;
  const qpx = q.x - p.x;
  const qpy = q.y - p.y;
  if (rxs === 0) return null;
  const t = (qpx * s.y - qpy * s.x) / rxs;
  const u = (qpx * r.y - qpy * r.x) / rxs;
  if (t >= 0 && u >= 0 && u <= 1) return t;
  return null;
};

const rayIntersectRect = (origin: Vector2D, dir: Vector2D, rect: WorldObject): number | null => {
  const halfW = rect.width / 2;
  const halfH = rect.height / 2;
  const center = { x: rect.x, y: rect.y };
  const corners = [
    { x: rect.x - halfW, y: rect.y - halfH },
    { x: rect.x + halfW, y: rect.y - halfH },
    { x: rect.x + halfW, y: rect.y + halfH },
    { x: rect.x - halfW, y: rect.y + halfH }
  ].map(p => rotatePoint(p, center, rect.rotation));

  let minT: number | null = null;
  for (let i = 0; i < 4; i++) {
    const p1 = corners[i];
    const p2 = corners[(i + 1) % 4];
    const segmentVec = { x: p2.x - p1.x, y: p2.y - p1.y };
    const t = rayIntersectSegment(origin, dir, p1, segmentVec);
    if (t !== null) {
      if (minT === null || t < minT) minT = t;
    }
  }
  return minT;
};

// --- Transforms ---

export const computeSensorWorldPose = (robot: RobotState, sensor: SensorConfig): { pos: Vector2D, rot: number } => {
  let mountTheta = sensor.mount.rotation;

  if (sensor.servoId) {
    const servo = robot.servos.find(s => s.id === sensor.servoId);
    if (servo) {
      mountTheta += (servo.angle * Math.PI / 180);
    }
  }

  const rx = Math.cos(robot.rotation);
  const ry = Math.sin(robot.rotation);

  const worldOffsetX = sensor.mount.x * rx - sensor.mount.y * ry;
  const worldOffsetY = sensor.mount.x * ry + sensor.mount.y * rx;

  return {
    pos: {
      x: robot.position.x + worldOffsetX,
      y: robot.position.y + worldOffsetY
    },
    rot: robot.rotation + mountTheta
  };
};

// --- Main Update ---

export const updatePhysics = (
  robot: RobotState,
  hardware: HardwareState,
  world: WorldState,
  config: VehicleConfig
): { robot: RobotState; hardware: HardwareState; world: WorldState } => {

  // 1. Servo Kinematics
  const nextServos = robot.servos.map(state => {
    const cfg = config.servos.find(s => s.id === state.id);
    if (!cfg) return state;

    const diff = state.targetAngle - state.angle;
    const maxStep = cfg.maxSpeed * DT;

    let newAngle = state.angle;
    if (Math.abs(diff) <= maxStep) {
      newAngle = state.targetAngle;
    } else {
      newAngle += Math.sign(diff) * maxStep;
    }
    return { ...state, angle: newAngle };
  });

  // 2. Robot Friction
  let currentFriction = FRICTION_DEFAULT;
  world.objects.forEach(obj => {
    if (obj.type === 'zone') {
      if (isPointInRotatedRect(robot.position, obj)) {
        currentFriction = FRICTION_DEFAULT * obj.frictionMultiplier;
      }
    }
  });

  // 3. Differential Drive Kinematics
  // Determine Wheelbase dynamically from motor positions
  const leftMotor = config.motors.find(m => m.role === 'left');
  const rightMotor = config.motors.find(m => m.role === 'right');

  let v = 0;
  let omega = 0;

  if (leftMotor && rightMotor) {
    // Calculate effective lateral wheelbase
    // Assuming motors are mounted symmetric relative to center Y, but calculating generic dist
    const lateralDist = Math.abs(leftMotor.mount.y - rightMotor.mount.y);
    const wheelBase = lateralDist || 20; // fallback

    const lp = hardware.pins[leftMotor.pwmPin] || 0;
    const rp = hardware.pins[rightMotor.pwmPin] || 0;

    // Normalize 0-255 to Speed
    // TODO: Direction pins support (for now assumes 0-255 is forward only unless user mapped logic)
    // Actually, simple sim: 0 = stop, 255 = full speed.
    // If we want reverse, we need dir pins in `hardware`.

    const vl = (lp / 255) * leftMotor.maxSpeed;
    const vr = (rp / 255) * rightMotor.maxSpeed;

    v = (vr + vl) / 2;
    omega = (vr - vl) / wheelBase;
  }

  const effectiveV = v * currentFriction;
  const effectiveOmega = omega * (currentFriction < 1 ? 0.8 : 1.0);

  const newRotation = robot.rotation + effectiveOmega * DT;
  const newX = robot.position.x + effectiveV * Math.cos(newRotation) * DT;
  const newY = robot.position.y + effectiveV * Math.sin(newRotation) * DT;

  // 4. Collision
  let finalX = newX;
  let finalY = newY;

  // Use config to determine collision radius roughly
  const robotRadius = Math.max(config.chassis.width, config.chassis.length) / 2;

  world.objects.forEach(obj => {
    if (!obj.isPhysical) return;

    if (obj.type === 'circle') {
      const distSq = Math.pow(finalX - obj.x, 2) + Math.pow(finalY - obj.y, 2);
      const minDist = robotRadius + (obj.radius || 20);
      if (distSq < minDist * minDist) {
        const dist = Math.sqrt(distSq);
        const overlap = minDist - dist;
        const dx = (finalX - obj.x) / dist;
        const dy = (finalY - obj.y) / dist;
        finalX += dx * overlap;
        finalY += dy * overlap;
      }
    } else if (obj.type === 'rect') {
      const localC = rotatePoint({ x: finalX, y: finalY }, { x: obj.x, y: obj.y }, -obj.rotation);
      const halfW = obj.width / 2;
      const halfH = obj.height / 2;
      const closestLocal = closestPointOnRect({ x: localC.x - obj.x, y: localC.y - obj.y }, halfW, halfH);
      const distX = (localC.x - obj.x) - closestLocal.x;
      const distY = (localC.y - obj.y) - closestLocal.y;
      const distSq = distX * distX + distY * distY;

      if (distSq < robotRadius * robotRadius) {
        finalX = robot.position.x;
        finalY = robot.position.y;
      }
    } else if (obj.type === 'circuit') {
      if (checkCircuitCollision(finalX, finalY, obj)) {
        // Collision!
        // Simple resolve: keep old position (stop)
        finalX = robot.position.x;
        finalY = robot.position.y;
      }
    }
  });

  const nextRobotState = {
    ...robot,
    position: { x: finalX, y: finalY },
    rotation: newRotation,
    velocity: effectiveV,
    angularVelocity: effectiveOmega,
    servos: nextServos
  };

  // 5. Update Dynamic Objects
  const nextObjects = world.objects.map(obj => {
    if (!obj.movementType || obj.movementType === 'static') return obj;

    let vx = obj.velocity?.x || 0;
    let vy = obj.velocity?.y || 0;
    const speed = (obj.speed || 50);

    // Initialize velocity if missing
    if (vx === 0 && vy === 0) {
      if (obj.movementType === 'random') {
        const angle = Math.random() * Math.PI * 2;
        vx = Math.cos(angle) * speed;
        vy = Math.sin(angle) * speed;
      } else if (obj.movementType === 'linear') {
        // Use initial rotation
        vx = Math.cos(obj.rotation) * speed;
        vy = Math.sin(obj.rotation) * speed;
      }
    }

    if (obj.movementType === 'chase') {
      const dx = nextRobotState.position.x - obj.x;
      const dy = nextRobotState.position.y - obj.y;
      const dist = Math.hypot(dx, dy);
      // Safety distance: Robot Radius (approx 20) + Obj Radius + Margin (10)
      const safetyDist = 20 + (obj.radius || Math.max(obj.width, obj.height) / 2) + 10;

      if (dist > safetyDist) {
        vx = (dx / dist) * speed;
        vy = (dy / dist) * speed;
      } else {
        vx = 0; vy = 0;
      }
    } else { // Update velocity for non-chase types based on speed config if it changed
      const currentSpeed = Math.hypot(vx, vy);
      if (Math.abs(currentSpeed - speed) > 1 && currentSpeed > 0) {
        vx = (vx / currentSpeed) * speed;
        vy = (vy / currentSpeed) * speed;
      }
    }

    // Proposed Position
    let nextX = obj.x + vx * DT;
    let nextY = obj.y + vy * DT;

    // Bounce off ANY Physical Object & Robot
    if (obj.movementType !== 'chase') {
      let bounced = false;

      // Check against other objects
      world.objects.forEach(other => {
        if (other.id === obj.id || !other.isPhysical) return;

        // Simple Circular Collision Check for bounce (Fastest)
        // Treat dynamic obj as circle for reflection logic
        const r1 = obj.radius || Math.max(obj.width, obj.height) / 2;
        const r2 = other.radius || Math.max(other.width, other.height) / 2;

        // Use simple distance check to trigger detailed check
        const distSq = Math.pow(nextX - other.x, 2) + Math.pow(nextY - other.y, 2);
        const minDist = r1 + r2;

        if (distSq < minDist * minDist) {
          // Determine normal
          const dx = nextX - other.x;
          const dy = nextY - other.y;
          const len = Math.hypot(dx, dy);
          if (len > 0) {
            const nx = dx / len;
            const ny = dy / len;

            // Reflect velocity: v' = v - 2 * (v . n) * n
            const dot = vx * nx + vy * ny;
            vx = vx - 2 * dot * nx;
            vy = vy - 2 * dot * ny;

            // Push out
            const overlap = minDist - len;
            nextX += nx * overlap;
            nextY += ny * overlap;
            bounced = true;
          }
        }
      });

      // Bounce off Robot
      const robotRadius = Math.max(config.chassis.width, config.chassis.length) / 2;
      const dx = nextX - nextRobotState.position.x;
      const dy = nextY - nextRobotState.position.y;
      const distSq = dx * dx + dy * dy;
      const minDist = (obj.radius || Math.max(obj.width, obj.height) / 2) + robotRadius;

      if (distSq < minDist * minDist) {
        const len = Math.sqrt(distSq);
        if (len > 0) {
          const nx = dx / len;
          const ny = dy / len;

          // Elastic bounce for object (simulate robot infinite mass for stability)
          const dot = vx * nx + vy * ny;
          vx = vx - 2 * dot * nx;
          vy = vy - 2 * dot * ny;

          const overlap = minDist - len;
          nextX += nx * overlap;
          nextY += ny * overlap;
          bounced = true;
        }
      }
    }

    return { ...obj, x: nextX, y: nextY, velocity: { x: vx, y: vy } };
  });

  // 6. Update Sensors
  const nextSensorReadings = { ...robot.sensorReadings };

  config.sensors.forEach(sensor => {
    const { pos: sensorPos, rot: sensorRot } = computeSensorWorldPose(nextRobotState, sensor);
    const pin = sensor.pins.analog ?? sensor.pins.trigger ?? sensor.pins.echo;

    if (pin === undefined) return;

    if (sensor.type === 'ultrasonic') {
      const maxDist = sensor.params.range || 300;
      const rayDir = { x: Math.cos(sensorRot), y: Math.sin(sensorRot) };
      let minT = maxDist;

      nextObjects.forEach(obj => {
        if (!obj.isPhysical) return;
        let t: number | null = null;
        if (obj.type === 'circle') {
          t = rayIntersectCircle(sensorPos, rayDir, { x: obj.x, y: obj.y }, obj.radius || 20);
        } else if (obj.type === 'rect') {
          t = rayIntersectRect(sensorPos, rayDir, obj);
        } else if (obj.type === 'circuit') {
          // Ray Marching for Circuit
          // Optimization: Check only if within rough range? 
          // Circuit is usually global, but we can skip if dist is already smaller than current d
          // We march from 0 to minT (or maxDist)

          const step = 4; // Precision
          // Start slightly out to avoid self-collision if scraping wall
          for (let d = 0; d < Math.min(maxDist, minT); d += step) {
            const cx = sensorPos.x + rayDir.x * d;
            const cy = sensorPos.y + rayDir.y * d;
            if (checkCircuitCollision(cx, cy, obj)) {
              // Hit!
              // Binary Refine for better precision
              let left = d - step;
              let right = d;
              let mid = d;
              for (let i = 0; i < 4; i++) {
                mid = (left + right) / 2;
                const mx = sensorPos.x + rayDir.x * mid;
                const my = sensorPos.y + rayDir.y * mid;
                if (checkCircuitCollision(mx, my, obj)) {
                  right = mid;
                } else {
                  left = mid;
                }
              }
              t = right;
              break;
            }
          }
        }
        if (t !== null && t < minT) minT = t;
      });
      nextSensorReadings[pin] = minT;
    }
    else if (sensor.type === 'line') {
      let reading = 1023; // White default
      nextObjects.forEach(obj => {
        if (!obj.isPhysical && (obj.color === '#000000' || obj.color === 'black')) {
          if (obj.type === 'rect' && isPointInRotatedRect(sensorPos, obj)) {
            reading = 0; // Black line
          }
        }
      });
      nextSensorReadings[pin] = reading;
    }
  });

  return {
    robot: { ...nextRobotState, sensorReadings: nextSensorReadings },
    hardware: { ...hardware },
    world: { ...world, objects: nextObjects }
  };
};

export const checkRobotCollision = (x: number, y: number, radius: number, objects: WorldObject[]): boolean => {
  for (const obj of objects) {
    if (!obj.isPhysical) continue;

    if (obj.type === 'circle') {
      const distSq = Math.pow(x - obj.x, 2) + Math.pow(y - obj.y, 2);
      const minDist = radius + (obj.radius || 20);
      if (distSq < minDist * minDist) return true;
    } else if (obj.type === 'rect') {
      const localC = rotatePoint({ x, y }, { x: obj.x, y: obj.y }, -obj.rotation);
      const halfW = obj.width / 2;
      const halfH = obj.height / 2;
      const closestLocal = closestPointOnRect({ x: localC.x - obj.x, y: localC.y - obj.y }, halfW, halfH);
      const distX = (localC.x - obj.x) - closestLocal.x;
      const distY = (localC.y - obj.y) - closestLocal.y;
      const distSq = distX * distX + distY * distY;

      if (distSq < radius * radius) return true;
    } else if (obj.type === 'circuit') {
      if (checkCircuitCollision(x, y, obj)) return true;
    }
  }
  return false;
};
