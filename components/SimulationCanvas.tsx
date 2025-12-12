import React, { useRef, useEffect, useState } from 'react';
import { RobotState, Vector2D, WorldState, VehicleConfig, ViewTransform, WorldObject } from '../types';
import { computeSensorWorldPose } from '../services/PhysicsEngine';
import { CIRCUIT_PATH_DATA } from '../constants';

interface SimulationCanvasProps {
  robotRef: React.MutableRefObject<RobotState>;
  robotConfig: VehicleConfig;
  world: WorldState;
  isEditing: boolean;
  selectedObjectId: string | null;
  previewObject: WorldObject | null;
  isValidPlacement?: boolean;
  onMouseDown: (e: React.MouseEvent, worldPos: Vector2D) => void;
  onMouseMove: (e: React.MouseEvent, worldPos: Vector2D) => void;
  onMouseUp: (e: React.MouseEvent, worldPos: Vector2D) => void;
  trajectory?: Vector2D[];
}

// Create Path2D once if supported
let circuitPath: Path2D | null = null;
if (typeof Path2D !== 'undefined') {
  circuitPath = new Path2D(CIRCUIT_PATH_DATA);
}


const SimulationCanvas: React.FC<SimulationCanvasProps> = (props) => {
  const {
    robotRef,
    isValidPlacement = true,
    onMouseDown,
    onMouseMove,
    onMouseUp
  } = props;

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [view, setView] = useState<ViewTransform>({ x: 0, y: 0, scale: 1 });
  const [size, setSize] = useState({ width: 800, height: 600 });
  const isPanningRef = useRef(false);
  const lastMouseRef = useRef<Vector2D>({ x: 0, y: 0 });
  const requestRef = useRef<number>();

  // Store latest props in ref to avoid re-triggering the effect loop
  const propsRef = useRef(props);
  useEffect(() => { propsRef.current = props; });

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const screenToWorld = (sx: number, sy: number): Vector2D => ({
    x: (sx - view.x) / view.scale,
    y: (sy - view.y) / view.scale
  });

  // Handlers
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const scaleFactor = 1.1;
    const direction = e.deltaY > 0 ? 1 / scaleFactor : scaleFactor;
    const rect = canvasRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const wx = (mx - view.x) / view.scale;
    const wy = (my - view.y) / view.scale;
    const newScale = Math.max(0.1, Math.min(5, view.scale * direction));
    setView({ x: mx - wx * newScale, y: my - wy * newScale, scale: newScale });
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    if (e.button === 1 || e.button === 2 || (e.button === 0 && e.shiftKey)) {
      isPanningRef.current = true;
      lastMouseRef.current = { x: mx, y: my };
      e.preventDefault();
      return;
    }
    const worldPos = screenToWorld(mx, my);
    onMouseDown(e, worldPos);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    if (isPanningRef.current) {
      const dx = mx - lastMouseRef.current.x;
      const dy = my - lastMouseRef.current.y;
      setView(v => ({ ...v, x: v.x + dx, y: v.y + dy }));
      lastMouseRef.current = { x: mx, y: my };
      return;
    }
    const worldPos = screenToWorld(mx, my);
    onMouseMove(e, worldPos);
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    if (isPanningRef.current) {
      isPanningRef.current = false;
      return;
    }
    const rect = canvasRef.current!.getBoundingClientRect();
    const worldPos = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
    onMouseUp(e, worldPos);
  };

  // --- Main Render Loop ---
  const render = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Read latest state from refs
    const {
      robotConfig,
      world,
      isEditing,
      selectedObjectId,
      previewObject,
      isValidPlacement = true,
      trajectory
    } = propsRef.current;

    // Use current robot state directly from Ref (passed via props, but stable object)
    const robot = robotRef.current;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.translate(view.x, view.y);
    ctx.scale(view.scale, view.scale);

    ctx.translate(view.x, view.y);
    ctx.scale(view.scale, view.scale);

    // 0. Trajectory (Draw beneath everything or on top? On top)
    if (trajectory && trajectory.length > 1) {
      ctx.save();
      ctx.strokeStyle = 'rgba(16, 185, 129, 0.6)'; // Emerald-500 transparent
      ctx.lineWidth = 4 / view.scale;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(trajectory[0].x, trajectory[0].y);
      for (let i = 1; i < trajectory.length; i++) {
        ctx.lineTo(trajectory[i].x, trajectory[i].y);
      }
      ctx.stroke();

      // End Point
      const last = trajectory[trajectory.length - 1];
      ctx.fillStyle = '#10b981';
      ctx.beginPath(); ctx.arc(last.x, last.y, 6 / view.scale, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }

    // 1. Grid
    const gridSize = 100;
    ctx.lineWidth = 1 / view.scale;
    ctx.strokeStyle = isEditing ? '#334155' : '#1e293b';
    ctx.beginPath();
    const startX = Math.floor((-view.x / view.scale) / gridSize) * gridSize;
    const startY = Math.floor((-view.y / view.scale) / gridSize) * gridSize;
    const endX = startX + (canvas.width / view.scale) + gridSize;
    const endY = startY + (canvas.height / view.scale) + gridSize;
    for (let x = startX; x <= endX; x += gridSize) { ctx.moveTo(x, startY); ctx.lineTo(x, endY); }
    for (let y = startY; y <= endY; y += gridSize) { ctx.moveTo(startX, y); ctx.lineTo(endX, y); }
    ctx.stroke();

    // 2. Objects
    // Use a local variable for sorting to avoid mutating props
    const renderObjects = [...world.objects];
    if (previewObject) renderObjects.push(previewObject);

    renderObjects
      .sort((a, b) => (a.isPhysical === b.isPhysical) ? 0 : a.isPhysical ? 1 : -1)
      .forEach(obj => {
        ctx.save();
        ctx.translate(obj.x, obj.y);
        ctx.rotate(obj.rotation);

        const isSelected = isEditing && selectedObjectId === obj.id;
        const isPreview = obj.id === 'ghost';

        if (obj.type === 'circle') {
          ctx.beginPath();
          ctx.arc(0, 0, obj.radius || 20, 0, Math.PI * 2);
          ctx.fillStyle = obj.color;
          if (isPreview) ctx.globalAlpha = 0.5;
          ctx.fill();
          if (isSelected) { ctx.strokeStyle = '#fbbf24'; ctx.lineWidth = 2 / view.scale; ctx.stroke(); }
        } else if (obj.type === 'circuit') {
          if (circuitPath) {
            ctx.save();
            // Map 1200x900 to obj.width x obj.height
            // Scale first, then translate to center drawing
            ctx.scale(obj.width / 1200, obj.height / 900);
            // The rect (0, 0, 1200, 900) needs to be centered at (0,0) in the current context (which is at obj.x, obj.y)
            // But wait, the previous code translated -600, -450.
            // Explanation:
            // Context is at Obj Center (obj.x, obj.y).
            // We want the Top-Left of the circuit path (0,0) to be at (-Width/2, -Height/2).
            // Since we scaled by (Width/1200), the geometry 0..1200 spans 0..Width.
            // So we translate by -600, -450 in the LOCAL (unscaled) space?
            // No, transform order matters.
            // If we Scale first: coordinate system is small. 1 unit = 1 pixel.
            // ctx.translate(-600, -450) moves it by -600 units (which are now small?). 
            // Logic:
            // 1. ctx.scale(sx, sy).
            // 2. Draw at (-600, -450).
            // This maps local -600 to -Width/2. Correct.

            ctx.translate(-600, -450);

            // 1. Fill Background (Solid Wall)
            ctx.fillStyle = obj.color;
            ctx.fillRect(0, 0, 1200, 900);

            // 2. Cut out the Path (Hollow Track)
            ctx.globalCompositeOperation = 'destination-out';
            ctx.lineWidth = 75;
            ctx.strokeStyle = '#000'; // Color irrelevant
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.stroke(circuitPath);

            // 3. Restore
            ctx.globalCompositeOperation = 'source-over';
            ctx.restore();

            if (isSelected) {
              ctx.strokeStyle = '#fbbf24';
              ctx.lineWidth = 2 / view.scale;
              ctx.strokeRect(-obj.width / 2, -obj.height / 2, obj.width, obj.height);
            }
          }
        } else {
          ctx.fillStyle = obj.color;
          if (isPreview) ctx.globalAlpha = 0.5;
          ctx.fillRect(-obj.width / 2, -obj.height / 2, obj.width, obj.height);
          if (isSelected) { ctx.strokeStyle = '#fbbf24'; ctx.lineWidth = 2 / view.scale; ctx.strokeRect(-obj.width / 2, -obj.height / 2, obj.width, obj.height); }
        }
        ctx.restore();
      });

    // 3. Robot
    ctx.save();
    ctx.translate(robot.position.x, robot.position.y);
    ctx.rotate(robot.rotation);

    // Chassis
    ctx.fillStyle = isValidPlacement ? '#3b82f6' : '#ef4444'; // Red if invalid
    if (robotConfig.chassis.shape === 'circle') {
      ctx.beginPath();
      ctx.arc(0, 0, robotConfig.chassis.radius || 20, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillRect(-robotConfig.chassis.length / 2, -robotConfig.chassis.width / 2, robotConfig.chassis.length, robotConfig.chassis.width);
      // Front indicator
      ctx.fillStyle = isValidPlacement ? '#60a5fa' : '#f87171';
      ctx.fillRect(robotConfig.chassis.length / 2 - 4, -robotConfig.chassis.width / 2, 4, robotConfig.chassis.width);
    }

    // Motors/Wheels
    robotConfig.motors.forEach(motor => {
      ctx.save();
      ctx.translate(motor.mount.x, motor.mount.y);
      ctx.rotate(motor.mount.rotation);
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(-6, -3, 12, 6); // Simple wheel
      ctx.restore();
    });

    ctx.restore(); // End Robot Transform for base

    // 4. Sensors & Servos (Use calculated world pose)
    robotConfig.sensors.forEach(sensor => {
      const { pos, rot } = computeSensorWorldPose(robot, sensor);

      ctx.save();
      ctx.translate(pos.x, pos.y);
      ctx.rotate(rot);

      ctx.fillStyle = sensor.color || '#fff';
      if (sensor.type === 'ultrasonic') {
        // Body
        ctx.beginPath(); ctx.rect(-2, -5, 4, 10); ctx.fill();
        // FOV
        ctx.globalAlpha = 0.2;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        const range = sensor.params.range || 100;
        const fov = sensor.params.fov || 0.2;
        ctx.arc(0, 0, range, -fov, fov);
        ctx.lineTo(0, 0);
        ctx.fill();
        ctx.globalAlpha = 1.0;

        // Ray hit
        const pin = sensor.pins.trigger ?? sensor.pins.analog ?? 0;
        const reading = robot.sensorReadings[pin];
        if (reading !== undefined && reading < range) {
          ctx.strokeStyle = '#ef4444';
          ctx.lineWidth = 1 / view.scale;
          ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(reading, 0); ctx.stroke();
          ctx.fillStyle = '#ef4444'; ctx.beginPath(); ctx.arc(reading, 0, 3 / view.scale, 0, Math.PI * 2); ctx.fill();
        }

      } else if (sensor.type === 'line') {
        ctx.fillStyle = '#fbbf24'; // Sensor body
        ctx.beginPath(); ctx.arc(0, 0, 3, 0, Math.PI * 2); ctx.fill();
        // LED Status
        const pin = sensor.pins.analog ?? 0;
        const val = robot.sensorReadings[pin];
        ctx.fillStyle = val < 500 ? '#ef4444' : '#10b981';
        ctx.beginPath(); ctx.arc(0, 0, 1.5, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    });

    // 5. Ghost for start
    if (isEditing) {
      ctx.save();
      ctx.translate(world.startPosition.x, world.startPosition.y);
      ctx.rotate(world.startRotation);
      ctx.strokeStyle = '#10b981';
      ctx.lineWidth = 2 / view.scale;
      ctx.globalAlpha = 0.5;

      if (robotConfig.chassis.shape === 'circle') {
        ctx.beginPath(); ctx.arc(0, 0, robotConfig.chassis.radius || 20, 0, Math.PI * 2); ctx.stroke();
      } else {
        ctx.strokeRect(-robotConfig.chassis.length / 2, -robotConfig.chassis.width / 2, robotConfig.chassis.length, robotConfig.chassis.width);
      }

      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(20, 0); ctx.stroke();
      ctx.restore();
    }

    requestRef.current = requestAnimationFrame(render);
  };

  // Start/Stop loop depending on component mount - dependencies ONLY view/size which restart the loop
  useEffect(() => {
    requestRef.current = requestAnimationFrame(render);
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    }
  }, [view, size]);

  return (
    <div ref={containerRef} className="w-full h-full">
      <canvas
        ref={canvasRef}
        width={size.width} height={size.height}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onContextMenu={e => e.preventDefault()}
        className={`block rounded-lg shadow-inner border border-slate-700 touch-none ${props.isEditing ? 'cursor-crosshair bg-slate-800' : 'bg-slate-900 cursor-move'}`}
      />
    </div>
  );
};

export default SimulationCanvas;
