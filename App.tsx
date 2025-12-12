
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  RobotState, HardwareState, ArduinoAPI, LogEntry, WorldState,
  EditorTool, WorldObject, AppMode, Vector2D, VehicleConfig, BehaviorType,
  DemoEpisode, DemoSample
} from './types';
import {
  DEFAULT_WORLD, DT, DEMO_CODE, DEFAULT_VEHICLE_CONFIG
} from './constants';
import { updatePhysics, checkRobotCollision } from './services/PhysicsEngine';
import { CodeRunner } from './services/CodeRunner';
import { generateRobotHeader } from './services/ArduinoGenerator';
import { BehaviorManager } from './services/behaviors/BehaviorManager';
import { MobilityBehavior } from './services/behaviors/MobilityBehavior';
import { EscapeBehavior } from './services/behaviors/EscapeBehavior';
import { CoverageBehavior } from './services/behaviors/CoverageBehavior';
import { ManualBehavior } from './services/behaviors/ManualBehavior';
import { RobotNavigation } from './services/behaviors/Navigation';
import { MobilityImitBehavior } from './services/behaviors/MobilityImitBehavior';
import { MobilityRLBehavior } from './services/behaviors/MobilityRLBehavior';
import { createArduinoAPI } from './services/ArduinoAPI';
import { policyNetwork, rlPolicyNetwork } from './services/LearningService';
import SimulationCanvas from './components/SimulationCanvas';
import Editor from './components/Editor';
import Console from './components/Console';
import Workshop from './components/Workshop';
import RLTrainingConfig, { DEFAULT_TRAINING_PARAMS, TrainingParams } from './components/RLTrainingConfig';
import {
  Play, Square, RotateCcw, Cpu, MousePointer2, Shield, Wind,
  MapPin, Undo2, Redo2, Circle, Settings, Code2, Tent, Radio,
  Disc, Save, Brain, Route,
  FolderUp, FolderDown, FileCode
} from 'lucide-react';
import { buildObservationVector } from './services/LearningService';
import { validateProjectFile } from './services/ProjectValidator';

function useHistory<T>(initialState: T) {
  const [past, setPast] = useState<T[]>([]);
  const [present, setPresent] = useState<T>(initialState);
  const [future, setFuture] = useState<T[]>([]);

  const canUndo = past.length > 0;
  const canRedo = future.length > 0;

  const undo = useCallback(() => {
    if (!canUndo) return;
    const previous = past[past.length - 1];
    const newPast = past.slice(0, past.length - 1);
    setFuture([present, ...future]);
    setPresent(previous);
    setPast(newPast);
  }, [past, present, future, canUndo]);

  const redo = useCallback(() => {
    if (!canRedo) return;
    const next = future[0];
    const newFuture = future.slice(1);
    setPast([...past, present]);
    setPresent(next);
    setFuture(newFuture);
  }, [past, present, future, canRedo]);

  const setState = useCallback((newState: T | ((prev: T) => T)) => {
    setPresent((curr) => {
      const val = typeof newState === 'function' ? (newState as Function)(curr) : newState;
      if (val === curr) return curr;
      setPast(p => [...p, curr]);
      setFuture([]);
      return val;
    });
  }, []);

  const setStateWithoutHistory = useCallback((newState: T | ((prev: T) => T)) => {
    setPresent((curr) => {
      const val = typeof newState === 'function' ? (newState as Function)(curr) : newState;
      return val;
    });
  }, []);

  return { state: present, setState, setStateWithoutHistory, undo, redo, canUndo, canRedo };
}

const getInitialHardware = (): HardwareState => ({
  pins: new Array(40).fill(0), // Increased pin count
  pinModes: [],
  millis: 0
});

const getInitialRobotState = (startPos: Vector2D, startRot: number, config: VehicleConfig): RobotState => ({
  position: { ...startPos },
  rotation: startRot,
  velocity: 0,
  angularVelocity: 0,
  servos: config.servos.map(s => ({ id: s.id, angle: 0, targetAngle: 0 })),
  sensorReadings: {}
});

const App: React.FC = () => {
  // --- Global State ---
  const { state: world, setState: setWorld, setStateWithoutHistory: setWorldWithoutHistory, undo, redo, canUndo, canRedo } = useHistory<WorldState>(DEFAULT_WORLD);
  const [vehicleConfig, setVehicleConfig] = useState<VehicleConfig>(DEFAULT_VEHICLE_CONFIG);
  const [code, setCode] = useState<string>(DEMO_CODE);
  const [generatedHeader, setGeneratedHeader] = useState<string>('');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [mode, setMode] = useState<AppMode>('play');
  const [activeTab, setActiveTab] = useState<'sketch' | 'header'>('sketch');
  const [isRunning, setIsRunning] = useState(false);
  const [isTraining, setIsTraining] = useState(false);
  const [trainingParams, setTrainingParams] = useState<TrainingParams>(DEFAULT_TRAINING_PARAMS);
  const [lastTrajectory, setLastTrajectory] = useState<Vector2D[]>([]);

  // --- Layout State ---
  const [sidebarWidth, setSidebarWidth] = useState(384);
  const [inspectorWidth, setInspectorWidth] = useState(288);
  const isResizingSidebar = useRef(false);
  const isResizingInspector = useRef(false);

  // --- Editor State ---
  const [tool, setTool] = useState<EditorTool>('select');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [previewObject, setPreviewObject] = useState<WorldObject | null>(null);

  // Drag State
  const [dragTarget, setDragTarget] = useState<'robot' | 'object' | null>(null);
  const [isValidPlacement, setIsValidPlacement] = useState(true);

  // --- Refs ---
  const robotRef = useRef<RobotState>(getInitialRobotState(DEFAULT_WORLD.startPosition, DEFAULT_WORLD.startRotation, DEFAULT_VEHICLE_CONFIG));
  const robotStartPosRef = useRef<Vector2D>({ x: 0, y: 0 }); // For snap-back
  const hardwareRef = useRef<HardwareState>(getInitialHardware());
  const codeRunnerRef = useRef<CodeRunner | null>(null);
  const requestRef = useRef<number>();
  const dragStartRef = useRef<{ x: number, y: number } | null>(null);
  const isDraggingRef = useRef(false);
  const [, setTick] = useState(0);

  // Behavior Layer
  const behaviorManagerRef = useRef<BehaviorManager>(new BehaviorManager());
  const [activeBehavior, setActiveBehavior] = useState<BehaviorType>(BehaviorType.Manual);

  // --- Imitation Learning / Recording State ---
  const [isRecording, setIsRecording] = useState(false);
  const currentEpisodeRef = useRef<DemoEpisode | null>(null);

  const startRecording = () => {
    const id = `demo_${Date.now()}`;
    currentEpisodeRef.current = {
      id,
      vehicleConfigId: 'default', // could be hashed from config
      scenarioId: 'scene_1',
      behaviorTarget: activeBehavior,
      samples: []
    };
    setIsRecording(true);
    addLog(`Started recording episode: ${id}`, 'system');
  };

  const stopRecording = () => {
    setIsRecording(false);
    if (currentEpisodeRef.current) {
      const episode = currentEpisodeRef.current;
      addLog(`Stopped recording. Samples: ${episode.samples.length}`, 'system');

      // Upload to server
      fetch('/api/save-demo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(episode)
      })
        .then(res => res.json())
        .then(d => {
          if (d.success) addLog(`Demo uploaded to project folder`, 'system');
          else addLog(`Demo upload failed: ${d.error}`, 'error');
        })
        .catch(e => addLog(`Demo upload error: ${e}`, 'error'));
    }
    currentEpisodeRef.current = null;
  };

  // --- Logger ---
  const addLog = useCallback((message: string, type: 'info' | 'error' | 'system' = 'info') => {
    setLogs(prev => [...prev.slice(-99), { id: Math.random().toString(36), timestamp: Date.now(), message, type }]);
  }, []);

  // --- Update Generated Code on Config Change ---
  useEffect(() => {
    setGeneratedHeader(generateRobotHeader(vehicleConfig));
  }, [vehicleConfig]);

  // Initialize Behaviors
  useEffect(() => {
    const behaviorAPI = createArduinoAPI(hardwareRef, robotRef, vehicleConfig, addLog);

    // Extract motor pins from config to ensure Navigation works with custom builds
    const leftMotor = vehicleConfig.motors.find(m => m.role === 'left');
    const rightMotor = vehicleConfig.motors.find(m => m.role === 'right');
    const leftPin = leftMotor ? leftMotor.pwmPin : 5;
    const rightPin = rightMotor ? rightMotor.pwmPin : 6;

    const nav = new RobotNavigation(behaviorAPI, leftPin, rightPin);

    const bm = behaviorManagerRef.current;
    bm.register(BehaviorType.Manual, new ManualBehavior(nav, vehicleConfig));
    bm.register(BehaviorType.Mobility, new MobilityBehavior(nav, vehicleConfig));
    bm.register(BehaviorType.Escape, new EscapeBehavior(nav, vehicleConfig));
    bm.register(BehaviorType.Coverage, new CoverageBehavior(nav, vehicleConfig));
    bm.register(BehaviorType.MobilityImit, new MobilityImitBehavior(nav, vehicleConfig));
    bm.register(BehaviorType.MobilityRL, new MobilityRLBehavior(nav, vehicleConfig));
  }, [vehicleConfig, addLog]);

  // Load Imitation Policy
  useEffect(() => {
    fetch('/learned_policy_weights.json')
      .then(res => res.json())
      .then(data => {
        policyNetwork.load(data);
        addLog("Loaded imitation policy weights", "system");
      })
      .catch(err => {
        // Warning is expected if no model trained yet
        // addLog("No trained policy found (learned_policy_weights.json)", "system");
      });

    // Load RL Policy
    fetch('/learned_policy_rl_weights.json')
      .then(res => res.json())
      .then(data => {
        rlPolicyNetwork.load(data);
        addLog("Loaded RL policy weights", "system");
      })
      .catch(err => {
        // Warning is expected if no model trained yet
      });

  }, [addLog]);

  // Synchronize Manager
  useEffect(() => {
    if (activeBehavior !== BehaviorType.Program) {
      behaviorManagerRef.current.setBehavior(activeBehavior);
    }
  }, [activeBehavior]);

  // --- API ---
  const createAPI = useCallback((): ArduinoAPI => {
    return createArduinoAPI(hardwareRef, robotRef, vehicleConfig, addLog);
  }, [addLog, vehicleConfig]);

  // --- Simulation Control ---
  const startSim = () => {
    // Cleanup previous run
    if (codeRunnerRef.current) {
      codeRunnerRef.current.dispose();
      codeRunnerRef.current = null;
    }

    hardwareRef.current = getInitialHardware();
    robotRef.current = getInitialRobotState(world.startPosition, world.startRotation, vehicleConfig);
    const api = createAPI();
    const runner = new CodeRunner(api);
    if (runner.loadCode(code)) {
      codeRunnerRef.current = runner;
      runner.runSetup();
      setIsRunning(true);
      if (mode === 'edit' || mode === 'workshop') setMode('play');
    } else {
      addLog("Compilation/Worker Init Failed", 'error');
    }
  };

  const stopSim = () => {
    setIsRunning(false);
    if (codeRunnerRef.current) {
      codeRunnerRef.current.dispose();
      codeRunnerRef.current = null;
    }
  };

  const resetSim = () => {
    stopSim(); // Disposes runner
    robotRef.current = getInitialRobotState(world.startPosition, world.startRotation, vehicleConfig);
    hardwareRef.current = getInitialHardware();
    setTick(t => t + 1);
    statsRef.current = { distance: 0, coveredArea: new Set<string>() };
    setSimStats({ time: 0, distance: 0, area: 0 });
  };

  // --- Stats ---
  const statsRef = useRef({ distance: 0, coveredArea: new Set<string>() });
  const [simStats, setSimStats] = useState({ time: 0, distance: 0, area: 0 });
  const lastStatsUpdateRef = useRef(0);

  // --- Train & Export Utils ---
  const handleTrainAndExport = async () => {
    if (isTraining) return;
    setIsTraining(true);
    addLog("Saving config and starting training...", "system");

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s timeout

    try {
      // 1. Save Config
      const saveRes = await fetch('/api/save-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(vehicleConfig),
        signal: controller.signal
      });
      if (!saveRes.ok) throw new Error(`Failed to save config: ${saveRes.statusText}`);

      // 2. Trigger Train
      const trainRes = await fetch('/api/train-rl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...trainingParams, world }),
        signal: controller.signal
      });

      if (!trainRes.ok) {
        if (trainRes.status === 504) throw new Error("Training timed out (Gateway Timeout)");
        throw new Error(`Training failed: ${trainRes.statusText}`);
      }

      const trainData = await trainRes.json();

      if (trainData.metrics) {
        const m = trainData.metrics;
        addLog(`Training Success! AvgReward: ${m.avg_reward.toFixed(1)} | Max: ${m.max_reward.toFixed(1)} | Spin: ${(m.w_v_ratio * 100).toFixed(1)}%`, "system");
      } else {
        addLog(`Training finished: ${trainData.message || 'Success'}`, "system");
      }

      // Visualization
      if (trainData.trajectory) {
        addLog(`Received trajectory with ${trainData.trajectory.length} points`, "system");
        setLastTrajectory(trainData.trajectory);
      }

      // 3. Reload Policy
      // We add a random query param to bypass cache
      const weightsRes = await fetch(`/learned_policy_rl_weights.json?t=${Date.now()}`);
      if (weightsRes.ok) {
        const weights = await weightsRes.json();
        const meta = rlPolicyNetwork.load(weights);

        if (meta) {
          addLog(`Loaded Policy: In=${meta.inputDim} Out=${meta.outputDim}`, "system");
          // Validation
          const expectedSensors = vehicleConfig.sensors.length + 2; // + v, w
          if (meta.inputDim !== expectedSensors) {
            addLog(`WARNING: Policy expects ${meta.inputDim} inputs but robot has ${expectedSensors}.`, "error");
          } else {
            // Auto-switch to RL
            setActiveBehavior(BehaviorType.MobilityRL);
            addLog("Switched to RL Behavior", "system");
          }
        }

      } else {
        addLog("Warning: Could not reload weights file", "error");
      }

    } catch (e: any) {
      if (e.name === 'AbortError') {
        addLog("Training timed out > 60s", "error");
      } else {
        addLog(`Error during training: ${e.message}`, "error");
      }
    } finally {
      clearTimeout(timeoutId);
      setIsTraining(false);
    }
  };

  // --- Project Persistence ---
  const saveProject = () => {
    const project = {
      version: 1,
      date: new Date().toISOString(),
      vehicleConfig,
      world,
      code,
      trainingParams
    };
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `arduino_sim_project_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    addLog("Project saved successfully", "system");
  };

  const fileInputRef = useRef<HTMLInputElement>(null);
  const handleLoadProject = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const json = JSON.parse(ev.target?.result as string);

        // VALIDATION
        const result = validateProjectFile(json);
        if (!result.valid || !result.data) {
          throw new Error(result.error || "Validation Failed");
        }

        const project = result.data;

        // Batch Updates?
        setVehicleConfig(project.vehicleConfig);
        setWorldWithoutHistory(project.world); // Clean load (or use setWorld to allow undo?) - Usually loading resets history or starts state.
        // Let's use setWorld to allow undoing the load if user regrets it, 
        // BUT loading usually implies "Open", clearing history. 
        // For now, let's just set it. 
        setWorld(project.world);
        setCode(project.code);
        if (project.trainingParams) setTrainingParams(project.trainingParams);

        addLog("Project loaded successfully", "system");
      } catch (err: any) {
        addLog(`Failed to load project: ${err.message}`, "error");
      }
    };
    reader.readAsText(file);
    // Reset input
    e.target.value = '';
  };

  const exportArduinoCode = () => {
    const fullCode = `/*
 * PROJECT: Arduino Web Sim Export
 * DATE: ${new Date().toISOString()}
 * 
 * NOTE: This file concatenates the configuration header and the user sketch.
 * In a real project, you might split 'robot_config.h' into a separate file.
 */

// ==========================================
//        ROBOT CONFIGURATION
// ==========================================
${generatedHeader}

// ==========================================
//           USER SKETCH
// ==========================================
${code}
`;
    const blob = new Blob([fullCode], { type: 'text/x-c' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `MyRobot_${Date.now()}.ino`;
    a.click();
    URL.revokeObjectURL(url);
    addLog("Arduino Code (.ino) exported", "system");
  };

  // --- Loop ---
  const animate = useCallback(() => {
    if (!isRunning) return;

    const currentRobot = robotRef.current;

    // 1. Logic Update
    // 1. Logic Update
    let v_cmd = 0;
    let w_cmd = 0;
    let v_tele = 0;
    let w_tele = 0;

    // Calculate Input / Run Code
    if (activeBehavior !== BehaviorType.Program) {
      // --- TELEOP / BEHAVIOR MODE ---
      const k = keysRef.current;
      const speed = k.has('Shift') ? 0.8 : k.has('Control') ? 0.2 : 0.5;
      if (k.has('w') || k.has('ArrowUp')) v_tele += speed;
      if (k.has('s') || k.has('ArrowDown')) v_tele -= speed;

      const turn = 1.5;
      if (k.has('d') || k.has('ArrowRight')) w_tele += turn;
      if (k.has('a') || k.has('ArrowLeft')) w_tele -= turn;

      // For recording, we use the teleop command as the "action"
      v_cmd = v_tele;
      w_cmd = w_tele;
    } else {
      // --- PROGRAM MODE ---
      // Run User Code
      codeRunnerRef.current?.runLoop();

      // Extract "Action" from Hardware State (Inverse Kinematics)
      // We need to know which pins are motors.
      const leftMotor = vehicleConfig.motors.find(m => m.role === 'left');
      const rightMotor = vehicleConfig.motors.find(m => m.role === 'right');
      const leftPin = leftMotor ? leftMotor.pwmPin : 5;
      const rightPin = rightMotor ? rightMotor.pwmPin : 6;

      // Read Signed PWM (-255 to 255)
      const lVal = hardwareRef.current.pins[leftPin] || 0;
      const rVal = hardwareRef.current.pins[rightPin] || 0;

      // Inverse Differential Drive
      // L = 255(v - w), R = 255(v + w)
      // v = (L + R) / 510
      // w = (R - L) / 510
      v_cmd = (lVal + rVal) / 510;
      w_cmd = (rVal - lVal) / 510;
    }

    // Common Context
    const ctx = {
      dt: DT,
      time: hardwareRef.current.millis / 1000,
      inputs: createAPI(),
      robotState: currentRobot,
      teleop: { v: v_tele, w: w_tele }
    };

    // --- RECORDING ---
    if (isRecording && currentEpisodeRef.current) {
      const obs = buildObservationVector(ctx.inputs, vehicleConfig, currentRobot.velocity, currentRobot.angularVelocity);
      const action = [v_cmd, w_cmd];

      currentEpisodeRef.current.samples.push({
        time: ctx.time,
        obs,
        action,
        pose: { x: currentRobot.position.x, y: currentRobot.position.y, theta: currentRobot.rotation }
      });
    }

    // Update Behavior (if active)
    if (activeBehavior !== BehaviorType.Program) {
      behaviorManagerRef.current.update(ctx);
    }

    // 2. Physics Update
    const { robot, hardware, world: nextWorld } = updatePhysics(currentRobot, hardwareRef.current, world, vehicleConfig);

    // 3. Stats Calculation
    const distDelta = Math.hypot(robot.position.x - currentRobot.position.x, robot.position.y - currentRobot.position.y);
    // Convert units (assuming 1 unit = 1 cm for display purposes, or arbitrary)
    // Let's say 100 units = 1 meter
    statsRef.current.distance += (distDelta / 100);

    // Area: Simple Grid (20x20 units cell)
    const gridKey = `${Math.floor(robot.position.x / 20)},${Math.floor(robot.position.y / 20)}`;
    statsRef.current.coveredArea.add(gridKey);

    // Throttle UI Updates (every 200ms)
    const now = Date.now();
    if (now - lastStatsUpdateRef.current > 200) {
      setSimStats({
        time: hardware.millis / 1000,
        distance: statsRef.current.distance,
        area: statsRef.current.coveredArea.size * (0.2 * 0.2) // 20 units = 0.2m -> 0.04m^2 per cell
      });
      lastStatsUpdateRef.current = now;
    }

    robotRef.current = robot;
    hardwareRef.current = { ...hardware, millis: hardware.millis + (DT * 1000) };

    setWorldWithoutHistory(nextWorld);

    requestRef.current = requestAnimationFrame(animate);
  }, [isRunning, world, vehicleConfig, activeBehavior]);

  useEffect(() => {
    if (isRunning) requestRef.current = requestAnimationFrame(animate);
    return () => { if (requestRef.current) cancelAnimationFrame(requestRef.current); };
  }, [isRunning, animate]);

  // --- Window Resizing ---
  useEffect(() => {
    const handleWindowMouseUp = () => {
      isResizingSidebar.current = false;
      isResizingInspector.current = false;
    };
    const handleWindowMouseMove = (e: MouseEvent) => {
      if (isResizingSidebar.current) {
        setSidebarWidth(Math.max(200, Math.min(800, e.clientX)));
      }
      if (isResizingInspector.current) {
        setInspectorWidth(Math.max(200, Math.min(600, window.innerWidth - e.clientX)));
      }
    };
    window.addEventListener('mouseup', handleWindowMouseUp);
    window.addEventListener('mousemove', handleWindowMouseMove);
    return () => {
      window.removeEventListener('mouseup', handleWindowMouseUp);
      window.removeEventListener('mousemove', handleWindowMouseMove);
    };
  }, []);

  // --- Keyboard Handling (Teleop) ---
  const keysRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const down = (e: KeyboardEvent) => keysRef.current.add(e.key);
    const up = (e: KeyboardEvent) => keysRef.current.delete(e.key);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  // --- Mouse Interactions ---
  const handleEditorMouseDown = (e: React.MouseEvent, worldPos: Vector2D) => {
    if (mode !== 'edit') return;
    const { x, y } = worldPos;

    if (tool === 'select') {
      // 1. Check Robot Click
      const robotRadius = Math.max(vehicleConfig.chassis.width, vehicleConfig.chassis.length) / 2;
      const distToRobot = Math.hypot(robotRef.current.position.x - x, robotRef.current.position.y - y);

      if (distToRobot < robotRadius) {
        setDragTarget('robot');
        robotStartPosRef.current = { ...robotRef.current.position };
        isDraggingRef.current = true;
        dragStartRef.current = { x, y };
        return;
      }

      // 2. Check Object Click
      const clicked = [...world.objects].reverse().find(o => {
        if (o.type === 'circle') {
          return Math.hypot(o.x - x, o.y - y) < (o.radius || 20);
        } else {
          const halfW = o.width / 2; const halfH = o.height / 2;
          return x > o.x - halfW && x < o.x + halfW && y > o.y - halfH && y < o.y + halfH;
        }
      });
      setSelectedId(clicked ? clicked.id : null);
      if (clicked) {
        setDragTarget('object');
        isDraggingRef.current = true;
        dragStartRef.current = { x, y };
      }
    } else if (tool === 'start') {
      setWorld(w => ({ ...w, startPosition: { x, y } }));
    } else {
      isDraggingRef.current = true;
      dragStartRef.current = { x, y };
    }
  };

  const handleEditorMouseMove = (e: React.MouseEvent, worldPos: Vector2D) => {
    if (!isDraggingRef.current || !dragStartRef.current || mode !== 'edit') return;
    const { x, y } = worldPos;

    if (tool === 'select') {
      if (dragTarget === 'robot') {
        const dx = x - dragStartRef.current.x;
        const dy = y - dragStartRef.current.y;

        robotRef.current.position.x += dx;
        robotRef.current.position.y += dy;

        // Collision Check
        const robotRadius = Math.max(vehicleConfig.chassis.width, vehicleConfig.chassis.length) / 2;
        const isColliding = checkRobotCollision(robotRef.current.position.x, robotRef.current.position.y, robotRadius, world.objects);
        setIsValidPlacement(!isColliding);

        dragStartRef.current = { x, y };
      }
      else if (dragTarget === 'object' && selectedId) {
        const dx = x - dragStartRef.current.x;
        const dy = y - dragStartRef.current.y;
        setWorld(w => ({
          ...w,
          objects: w.objects.map(o => o.id === selectedId ? { ...o, x: o.x + dx, y: o.y + dy } : o)
        }));
        dragStartRef.current = { x, y };
      }
    } else if (tool !== 'select' && tool !== 'start') {
      // PREVIEW GENERATION
      const startX = dragStartRef.current.x;
      const startY = dragStartRef.current.y;
      let cx = (startX + x) / 2;
      let cy = (startY + y) / 2;
      let w = Math.abs(x - startX);
      let h = Math.abs(y - startY);

      const ghost: WorldObject = {
        id: 'ghost',
        type: tool === 'circle' ? 'circle' : tool === 'zone' ? 'zone' : tool === 'circuit' ? 'circuit' : 'rect',
        x: cx, y: cy, width: w, height: h,
        radius: Math.max(w, h) / 2,
        rotation: 0,
        color: tool === 'zone' || tool === 'hide' ? 'rgba(56, 189, 248, 0.2)' : tool === 'wall' ? '#475569' : '#64748b',
        isPhysical: tool !== 'zone' && tool !== 'hide',
        frictionMultiplier: 1
      };
      if (tool === 'wall') { if (w > h) h = 10; else w = 10; ghost.width = w; ghost.height = h; }
      if (tool === 'hide') { ghost.color = 'rgba(74, 222, 128, 0.3)'; } // Green for Hide
      setPreviewObject(ghost);
    }
  };

  const handleEditorMouseUp = (e: React.MouseEvent, worldPos: Vector2D) => {
    setPreviewObject(null);
    if (!isDraggingRef.current || !dragStartRef.current || mode !== 'edit') {
      isDraggingRef.current = false;
      return;
    }

    if (tool === 'select') {
      if (dragTarget === 'robot') {
        if (!isValidPlacement) {
          // Snap back
          robotRef.current.position = { ...robotStartPosRef.current };
          setIsValidPlacement(true);
          addLog("Invalid placement: Collision detected", "error");
        }
        setDragTarget(null);
      } else {
        setDragTarget(null);
      }
    }
    else if (tool !== 'select' && tool !== 'start') {
      const endX = worldPos.x;
      const endY = worldPos.y;
      const startX = dragStartRef.current.x;
      const startY = dragStartRef.current.y;

      let cx = (startX + endX) / 2;
      let cy = (startY + endY) / 2;
      let w = Math.abs(endX - startX);
      let h = Math.abs(endY - startY);

      if (w < 10 && h < 10) { w = 50; h = 50; cx = startX; cy = startY; }

      const newObj: WorldObject = {
        id: Math.random().toString(36).substr(2, 9),
        type: tool === 'circle' ? 'circle' : tool === 'zone' ? 'zone' : tool === 'circuit' ? 'circuit' : 'rect',
        x: cx, y: cy, width: w, height: h,
        radius: Math.max(w, h) / 2,
        rotation: 0,
        color: tool === 'zone' || tool === 'hide' ? 'rgba(56, 189, 248, 0.2)' : tool === 'wall' ? '#475569' : '#64748b',
        isPhysical: tool !== 'zone' && tool !== 'hide',
        frictionMultiplier: tool === 'zone' ? 0.2 : 1
      };
      if (tool === 'wall') { if (w > h) h = 10; else w = 10; newObj.width = w; newObj.height = h; }
      if (tool === 'hide') { newObj.color = 'rgba(74, 222, 128, 0.3)'; newObj.type = 'hide'; } // Green for Hide

      setWorld(prev => ({ ...prev, objects: [...prev.objects, newObj] }));
      setSelectedId(newObj.id);
      setTool('select');
    }
    isDraggingRef.current = false;
    dragStartRef.current = null;
  };

  const updateSelected = (patch: Partial<WorldObject>) => {
    if (!selectedId) return;
    setWorld(w => ({
      ...w,
      objects: w.objects.map(o => o.id === selectedId ? { ...o, ...patch } : o)
    }));
  };

  const deleteSelected = () => {
    if (!selectedId) return;
    setWorld(w => ({ ...w, objects: w.objects.filter(o => o.id !== selectedId) }));
    setSelectedId(null);
  };

  const selectedObject = world.objects.find(o => o.id === selectedId);

  return (
    <div className="h-screen w-screen bg-slate-950 flex flex-col text-slate-200 font-sans overflow-hidden">

      {/* HEADER */}
      <header className="h-14 bg-slate-900 border-b border-slate-800 flex items-center px-4 justify-between shrink-0 z-20">
        <div className="flex items-center gap-2">
          <Cpu className="w-6 h-6 text-emerald-500" />
          <h1 className="font-bold text-lg tracking-tight">Arduino<span className="text-emerald-500">Lab</span></h1>
        </div>

        <div className="flex items-center gap-2">
          <div className="bg-slate-800 rounded p-1 flex gap-1 mr-4">
            <button onClick={undo} disabled={!canUndo} className={`p-1.5 rounded ${canUndo ? 'hover:bg-slate-700 text-slate-300' : 'text-slate-600'}`}><Undo2 size={16} /></button>
            <button onClick={redo} disabled={!canRedo} className={`p-1.5 rounded ${canRedo ? 'hover:bg-slate-700 text-slate-300' : 'text-slate-600'}`}><Redo2 size={16} /></button>
          </div>

          <div className="bg-slate-800 rounded p-1 flex gap-1 mr-4">
            <button onClick={() => fileInputRef.current?.click()} className="p-1.5 rounded hover:bg-slate-700 text-slate-300" title="Load Project"><FolderUp size={16} /></button>
            <input type="file" ref={fileInputRef} onChange={handleLoadProject} className="hidden" accept=".json" />
            <button onClick={saveProject} className="p-1.5 rounded hover:bg-slate-700 text-slate-300" title="Save Project"><FolderDown size={16} /></button>
            <button onClick={exportArduinoCode} className="p-1.5 rounded hover:bg-slate-700 text-emerald-400" title="Export .ino"><FileCode size={16} /></button>
          </div>


          <button
            onClick={handleTrainAndExport}
            disabled={isTraining || isRunning}
            className={`flex items-center gap-2 px-4 py-1.5 mr-2 rounded-md text-xs font-bold transition-all ${isTraining
              ? 'bg-amber-900/50 text-amber-500 cursor-wait'
              : 'bg-indigo-600 hover:bg-indigo-500 text-white'
              }`}
            title="Save Config, Train RL, and Reload"
          >
            <Brain size={14} className={isTraining ? 'animate-pulse' : ''} />
            {isTraining ? 'TRAINING...' : 'TRAIN & EXPORT'}
          </button>

          {!isRunning ? (
            <button onClick={startSim} className="flex items-center gap-2 px-6 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-md text-sm font-medium transition-all">
              <Play size={16} fill="currentColor" /> Play
            </button>
          ) : (
            <button onClick={stopSim} className="flex items-center gap-2 px-6 py-1.5 bg-red-600 hover:bg-red-500 text-white rounded-md text-sm font-medium transition-all">
              <Square size={16} fill="currentColor" /> Stop
            </button>
          )}
          <button onClick={resetSim} className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-md transition-colors"><RotateCcw size={16} /></button>
        </div>

        <div className="flex items-center bg-slate-800 rounded-lg p-1 border border-slate-700 text-xs font-medium">
          <button onClick={() => setMode('edit')} className={`px-3 py-1 rounded ${mode === 'edit' ? 'bg-slate-700 text-white shadow' : 'text-slate-400 hover:text-white'}`}>Build World</button>
          <button onClick={() => setMode('workshop')} className={`px-3 py-1 rounded ${mode === 'workshop' ? 'bg-slate-700 text-white shadow' : 'text-slate-400 hover:text-white'}`}>Workshop</button>
          <button onClick={() => setMode('training')} className={`px-3 py-1 rounded ${mode === 'training' ? 'bg-slate-700 text-white shadow' : 'text-slate-400 hover:text-white'}`}>RL Training</button>
          <button onClick={() => setMode('play')} className={`px-3 py-1 rounded ${mode === 'play' ? 'bg-slate-700 text-white shadow' : 'text-slate-400 hover:text-white'}`}>Code & Sim</button>
        </div>
      </header >

      {/* BEHAVIOR SELECTOR (Sub-header or Overlay?) */}
      {
        mode === 'play' && (
          <div className="h-10 bg-slate-900 border-b border-slate-800 flex items-center px-4 gap-4 text-xs">
            <span className="font-semibold text-slate-500">BEHAVIOR:</span>
            <div className="flex bg-slate-800 rounded p-0.5">
              {(Object.values(BehaviorType) as BehaviorType[]).map(b => (
                <button
                  key={b}
                  onClick={() => setActiveBehavior(b)}
                  className={`px-3 py-1 rounded ${activeBehavior === b ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
                >
                  {b}
                </button>
              ))}
            </div>

            <div className="h-4 w-px bg-slate-800 mx-2" />

            {/* STATS DISPLAY */}
            <div className="flex items-center gap-4 text-slate-400 font-mono">
              <div className="flex gap-1">
                <span className="text-slate-500">T:</span>
                <span className="text-emerald-400">{(simStats.time).toFixed(1)}s</span>
              </div>
              <div className="flex gap-1">
                <span className="text-slate-500">Dist:</span>
                <span className="text-blue-400">{simStats.distance.toFixed(1)}m</span>
              </div>
              <div className="flex gap-1">
                <span className="text-slate-500">Area:</span>
                <span className="text-purple-400">{simStats.area.toFixed(1)}m²</span>
              </div>
            </div>

            {activeBehavior !== BehaviorType.Program && activeBehavior !== BehaviorType.Manual && (
              <div className="text-slate-400 italic ml-auto pr-4 hidden md:block">
                Running automated behavior logic...
              </div>
            )}
            {(activeBehavior === BehaviorType.Manual || activeBehavior === BehaviorType.Program) && (
              <div className="flex items-center gap-4 ml-auto pr-4">
                {activeBehavior === BehaviorType.Manual && (
                  <div className="text-slate-400 italic text-[10px] hidden md:block">
                    Teleop: Use WASD / Arrows
                  </div>
                )}
                {activeBehavior === BehaviorType.Program && (
                  <div className="text-slate-400 italic text-[10px] hidden md:block">
                    Running User Code
                  </div>
                )}
                <div className="h-4 w-px bg-slate-800" />

                {!isRecording ? (
                  <button onClick={startRecording} className="flex items-center gap-1.5 px-2 py-1 bg-red-900/30 hover:bg-red-900/50 text-red-400 rounded transition-colors">
                    <Disc size={14} /> Rec
                  </button>
                ) : (
                  <button onClick={stopRecording} className="flex items-center gap-1.5 px-2 py-1 bg-red-600 text-white animate-pulse rounded hover:bg-red-700 transition-colors">
                    <Square size={14} fill="currentColor" /> Stop Rec
                  </button>
                )}
              </div>
            )}
          </div>
        )
      }

      {/* MAIN LAYOUT */}
      <div className="flex-1 flex overflow-hidden">

        {/* WORKSHOP MODE */}
        {mode === 'workshop' && (
          <Workshop config={vehicleConfig} onChange={setVehicleConfig} />
        )}

        {/* TRAINING MODE */}
        {mode === 'training' && (
          <RLTrainingConfig
            params={trainingParams}
            onChange={setTrainingParams}
            onTrain={handleTrainAndExport}
            isTraining={isTraining}
            trajectory={lastTrajectory}
          />
        )}

        {/* EDIT MODE TOOLBOX */}
        {mode === 'edit' && (
          <div className="w-14 bg-slate-900 border-r border-slate-800 flex flex-col items-center py-4 gap-4 z-10 shrink-0">
            <ToolBtn active={tool === 'select'} icon={<MousePointer2 />} onClick={() => setTool('select')} label="Select" />
            <div className="w-8 h-px bg-slate-800" />
            <ToolBtn active={tool === 'rect'} icon={<Shield />} onClick={() => setTool('rect')} label="Box" />
            <ToolBtn active={tool === 'wall'} icon={<Square />} onClick={() => setTool('wall')} label="Wall" />
            <ToolBtn active={tool === 'circle'} icon={<Circle />} onClick={() => setTool('circle')} label="Circle" />
            <ToolBtn active={tool === 'circuit'} icon={<Route />} onClick={() => setTool('circuit')} label="Circuit" />
            <ToolBtn active={tool === 'zone'} icon={<Wind />} onClick={() => setTool('zone')} label="Zone" />
            <ToolBtn active={tool === 'hide'} icon={<Tent />} onClick={() => setTool('hide')} label="Hide Zone" />
            <div className="w-8 h-px bg-slate-800" />
            <ToolBtn active={tool === 'start'} icon={<MapPin />} onClick={() => setTool('start')} label="Set Start" />
          </div>
        )}

        {/* PLAY MODE: CODE EDITOR */}
        {mode === 'play' && (
          <>
            <div style={{ width: sidebarWidth }} className="flex flex-col border-r border-slate-800 bg-slate-900 shrink-0">
              <div className="flex border-b border-slate-800">
                <button onClick={() => setActiveTab('sketch')} className={`flex-1 py-2 text-xs font-medium ${activeTab === 'sketch' ? 'text-emerald-400 border-b-2 border-emerald-500' : 'text-slate-500'}`}>sketch.js</button>
                <button onClick={() => setActiveTab('header')} className={`flex-1 py-2 text-xs font-medium ${activeTab === 'header' ? 'text-blue-400 border-b-2 border-blue-500' : 'text-slate-500'}`}>robot_config.h</button>
              </div>

              {activeTab === 'sketch' ? (
                <Editor code={code} onChange={setCode} disabled={isRunning} />
              ) : (
                <div className="flex-1 overflow-auto bg-slate-950 p-4 font-mono text-xs text-blue-300">
                  <pre>{generatedHeader}</pre>
                </div>
              )}

              <div className="h-48 shrink-0">
                <Console logs={logs} onClear={() => setLogs([])} />
              </div>
            </div>
            {/* Resizer */}
            <div
              className="w-1 bg-slate-800 hover:bg-emerald-500 cursor-col-resize z-10 transition-colors"
              onMouseDown={() => isResizingSidebar.current = true}
            />
          </>
        )}

        {/* CENTER: CANVAS (Visible in Edit and Play) */}
        {(mode === 'play' || mode === 'edit') && (
          <div className="flex-1 bg-slate-950 relative flex flex-col min-w-0">
            <div className="absolute top-4 left-4 z-10 pointer-events-none">
              <div className="bg-slate-900/80 backdrop-blur border border-slate-700 px-3 py-2 rounded shadow text-xs font-mono text-slate-400 flex flex-col gap-1">
                <div>MODE: <span className={mode === 'edit' ? 'text-blue-400' : 'text-emerald-400'}>{mode.toUpperCase()}</span></div>
                <div className="text-[10px] text-slate-500 mt-1">Right-click/Shift+Drag to Pan. Scroll to Zoom.</div>
              </div>
            </div>

            <div className="flex-1 overflow-hidden">
              <SimulationCanvas
                robotRef={robotRef}
                robotConfig={vehicleConfig}
                world={world}
                isEditing={mode === 'edit'}
                selectedObjectId={selectedId}
                previewObject={previewObject}
                isValidPlacement={isValidPlacement}
                onMouseDown={handleEditorMouseDown}
                onMouseMove={handleEditorMouseMove}
                onMouseUp={handleEditorMouseUp}
                trajectory={lastTrajectory}
              />
            </div>
          </div>
        )}

        {/* RIGHT: INSPECTOR (Edit Mode Only) */}
        {mode === 'edit' && (
          <>
            <div
              className="w-1 bg-slate-800 hover:bg-emerald-500 cursor-col-resize z-10 transition-colors"
              onMouseDown={() => isResizingInspector.current = true}
            />
            <div style={{ width: inspectorWidth }} className="bg-slate-900 border-l border-slate-800 p-4 overflow-y-auto shrink-0">
              <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-6">World Properties</h2>

              {selectedObject ? (
                <div className="space-y-6">
                  {/* ... Properties ... */}
                  <div className="space-y-3">
                    <label className="text-xs font-semibold text-slate-400">Transform</label>
                    <div className="grid grid-cols-2 gap-2">
                      <NumInput label="X" value={selectedObject.x} onChange={v => updateSelected({ x: v })} />
                      <NumInput label="Y" value={selectedObject.y} onChange={v => updateSelected({ y: v })} />
                      <NumInput label="Rot (deg)" value={(selectedObject.rotation * 180 / Math.PI)} onChange={v => updateSelected({ rotation: v * Math.PI / 180 })} />
                    </div>
                    <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-800">
                      {selectedObject.type === 'circle' ? (
                        <NumInput label="Radius" value={selectedObject.radius || 20} onChange={v => updateSelected({ radius: v })} />
                      ) : (
                        <>
                          <NumInput label="Width" value={selectedObject.width} onChange={v => updateSelected({ width: v })} />
                          <NumInput label="Height" value={selectedObject.height} onChange={v => updateSelected({ height: v })} />
                        </>
                      )}
                    </div>
                  </div>

                  {/* Physics & Appearance (Same as before) */}
                  <div className="space-y-3 pt-4 border-t border-slate-800">
                    <label className="text-xs font-semibold text-slate-400">Physics</label>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-slate-400">Collidable</span>
                      <input type="checkbox" checked={selectedObject.isPhysical} onChange={e => updateSelected({ isPhysical: e.target.checked })} className="accent-emerald-500" />
                    </div>
                    {selectedObject.type === 'zone' && (
                      <div>
                        <div className="flex justify-between text-xs text-slate-400 mb-1">
                          <span>Friction</span>
                          <span>{selectedObject.frictionMultiplier.toFixed(1)}x</span>
                        </div>
                        <input type="range" min="0.1" max="2" step="0.1" value={selectedObject.frictionMultiplier} onChange={e => updateSelected({ frictionMultiplier: parseFloat(e.target.value) })} className="w-full" />
                      </div>
                    )}
                  </div>

                  {/* Movement Properties */}
                  <div className="space-y-3 pt-4 border-t border-slate-800">
                    <label className="text-xs font-semibold text-slate-400">Movement</label>
                    <div className="space-y-2">
                      <div>
                        <label className="text-[10px] text-slate-500 block mb-1">Type</label>
                        <select
                          value={selectedObject.movementType || 'static'}
                          onChange={e => updateSelected({ movementType: e.target.value as any })}
                          className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-300 focus:outline-none focus:border-emerald-500"
                        >
                          <option value="static">Static</option>
                          <option value="random">Random (Bounce)</option>
                          <option value="linear">Linear (Bounce)</option>
                          <option value="chase">Chase Robot</option>
                        </select>
                      </div>
                      {(selectedObject.movementType && selectedObject.movementType !== 'static') && (
                        <NumInput label="Speed" value={selectedObject.speed || 50} onChange={v => updateSelected({ speed: v })} />
                      )}
                    </div>
                  </div>

                  <div className="space-y-3 pt-4 border-t border-slate-800">
                    <label className="text-xs font-semibold text-slate-400">Appearance</label>
                    <div>
                      <label className="text-xs text-slate-500 block mb-1">Color</label>
                      <div className="flex gap-2 flex-wrap">
                        {['#64748b', '#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#000000'].map(c => (
                          <button key={c} onClick={() => updateSelected({ color: c })} className={`w-6 h-6 rounded-full border border-slate-700 ${selectedObject.color === c ? 'ring-2 ring-white' : ''}`} style={{ backgroundColor: c }} />
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="pt-6 border-t border-slate-800">
                    <button onClick={deleteSelected} className="w-full py-2 bg-red-900/50 hover:bg-red-900 text-red-200 border border-red-800 rounded text-xs font-bold uppercase transition-colors">
                      Delete Object
                    </button>
                  </div>

                  <div className="pt-4 border-t border-slate-800">
                    <button
                      onClick={deleteSelected}
                      className="w-full py-2 bg-red-900/30 hover:bg-red-900/50 text-red-500 hover:text-red-400 border border-red-900/50 rounded text-xs transition-colors"
                    >
                      Delete Object
                    </button>
                  </div>

                </div>
              ) : (
                <div className="text-slate-600 text-sm text-center mt-10 italic">
                  Select an object to edit properties.
                </div>
              )}
            </div>
          </>
        )}

      </div>
    </div >
  );
};

const ToolBtn = ({ active, icon, onClick, label }: any) => (
  <button onClick={onClick} title={label} className={`p-2 rounded-xl transition-all ${active ? 'bg-emerald-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800'}`}>
    {React.cloneElement(icon, { size: 20 })}
  </button>
);

const NumInput = ({ label, value, onChange }: any) => (
  <div>
    <label className="text-[10px] text-slate-500 block mb-0.5">{label}</label>
    <input
      type="number"
      value={Math.round(value * 10) / 10}
      onChange={e => onChange(parseFloat(e.target.value))}
      className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 focus:border-emerald-500 focus:outline-none"
    />
  </div>
);

export default App;
