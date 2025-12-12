export const ADVANCED_CPP_CODE = `#include <Arduino.h>
#include <Servo.h>

// =============================================================
//                      CONFIG
// =============================================================

// ---- Pins (Set to 255 if not connected) ----
static constexpr uint8_t PIN_MOTOR_L_PWM = 5;
static constexpr uint8_t PIN_MOTOR_L_DIR = 255;   // 255 => No Reverse (Forward Only)
static constexpr uint8_t PIN_MOTOR_R_PWM = 6;
static constexpr uint8_t PIN_MOTOR_R_DIR = 255;

static constexpr uint8_t PIN_SCAN_SERVO  = 9;

static constexpr uint8_t PIN_FRONT_SENSE = 14;  // A0
static constexpr uint8_t PIN_SCAN_SENSE  = 15;  // A1

// ---- Feature Flags (Dependencies managed in FeatureSet) ----
#define FEATURE_TELEMETRY        1

// ---- Control Params ----
static constexpr uint16_t LOOP_DT_MS            = 10;
static constexpr uint16_t SENSOR_FRONT_PERIOD   = 50;
static constexpr uint16_t SENSOR_SCAN_PERIOD    = 80;
static constexpr uint16_t TELEMETRY_PERIOD      = 200;

static constexpr float    DEFAULT_CRUISE        = 0.45f;
static constexpr uint16_t OBSTACLE_THRESHOLD_MM = 300;
static constexpr uint16_t FAILSAFE_TIMEOUT_MS   = 500;

static constexpr int16_t  SERVO_MIN_DEG = -80;
static constexpr int16_t  SERVO_MAX_DEG = +80;
static constexpr int16_t  SERVO_STEP    = 10;
static constexpr uint16_t SERVO_SETTLE_MS = 50;

static constexpr uint16_t TURN_BASE_MS    = 350;
static constexpr float    TURN_MS_PER_DEG = 5.0f;

// =============================================================
//                      UTILS
// =============================================================
static inline uint32_t nowMs() { return millis(); }

struct Timer {
  uint32_t next = 0;
  bool due(uint32_t t) const { return (int32_t)(t - next) >= 0; }
  void arm(uint32_t t, uint16_t periodMs) { next = t + periodMs; }
};

template<typename T>
static T clampT(T v, T lo, T hi) { return (v < lo) ? lo : (v > hi) ? hi : v; }

struct EmaFilter {
  float alpha = 0.35f;
  bool  inited = false;
  float y = 0;
  float step(float x) {
    if (!inited) { y = x; inited = true; return y; }
    y = alpha * x + (1.0f - alpha) * y;
    return y;
  }
};

// =============================================================
//                 DRIVE CAPS & MOTOR DRIVER
// =============================================================
struct DriveCaps {
  bool canReverse = false;
  bool canPivot   = false;
};

class MotorDriver {
public:
  void begin(uint8_t pwmL, uint8_t dirL, uint8_t pwmR, uint8_t dirR) {
    _pwmL = pwmL; _dirL = dirL; _pwmR = pwmR; _dirR = dirR;
    
    pinMode(_pwmL, OUTPUT); pinMode(_pwmR, OUTPUT);
    if (_dirL != 255) pinMode(_dirL, OUTPUT);
    if (_dirR != 255) pinMode(_dirR, OUTPUT);

    // Discovery capabilities
    _caps.canReverse = (_dirL != 255 && _dirR != 255);
    _caps.canPivot   = _caps.canReverse; // Pivot usually requires reverse

    stop();
  }

  const DriveCaps& caps() const { return _caps; }

  // High level differential drive
  void setDifferential(float v, float w) {
    // If we can't reverse, clamp V to [0, 1]
    if (!_caps.canReverse) {
      if (v < 0) v = 0; 
      // If we can't pivot, we can't do pure rotation (v=0, w!=0).
      // We must add some Forward V to turn (Arc Turn).
      // However, usually V > 0 is enough for Arc.
    }

    float l = v - w;
    float r = v + w;
    setLeft(l);
    setRight(r);
  }

  void stop() { setLeft(0); setRight(0); }

private:
  uint8_t _pwmL=255,_dirL=255,_pwmR=255,_dirR=255;
  DriveCaps _caps;

  void setLeft(float duty)  { setOne(_pwmL, _dirL, duty); }
  void setRight(float duty) { setOne(_pwmR, _dirR, duty); }

  void setOne(uint8_t pwm, uint8_t dir, float duty) {
    // Hardware Safety: Clamp duty
    duty = clampT(duty, -1.0f, 1.0f);
    
    // If no direction pin, we can only go forward (0..1)
    if (dir == 255) {
      if (duty < 0) duty = 0; // Cutoff negative
      uint8_t mag = (uint8_t)roundf(duty * 255.0f);
      analogWrite(pwm, mag);
    } else {
      // Bidirectional
      uint8_t mag = (uint8_t)roundf(fabsf(duty) * 255.0f);
      digitalWrite(dir, (duty >= 0) ? HIGH : LOW);
      analogWrite(pwm, mag);
    }
  }
};

class ScanServo {
public:
  void begin(uint8_t pin) { 
    if (pin == 255) return;
    _servo.attach(pin); 
    _active = true;
    writeDeg(0); 
  }
  
  void writeDeg(int16_t deg) {
    if (!_active) return;
    deg = clampT<int16_t>(deg, SERVO_MIN_DEG, SERVO_MAX_DEG);
    _servo.write((int)deg + 90);
    _lastDeg = deg;
  }
  
  int16_t lastDeg() const { return _lastDeg; }
  bool active() const { return _active; }

private:
  Servo _servo;
  int16_t _lastDeg = 0;
  bool _active = false;
};

// =============================================================
//                       SENSORS
// =============================================================
struct SensorReading {
  uint16_t mm = 0;
  uint32_t stampMs = 0;
  uint8_t  quality = 0; // 0=Invalid, 255=Perfect
  bool     valid() const { return quality > 0; }
};

class ISensor {
public:
  virtual ~ISensor() {}
  virtual void begin() = 0;
  virtual void poll(uint32_t t) = 0;
  virtual const SensorReading& reading() const = 0;
  virtual const char* name() const = 0;
};

class AnalogDistanceSensor : public ISensor {
public:
  AnalogDistanceSensor(const char* n, uint8_t pin) : _name(n), _pin(pin) {}
  
  void begin() override { 
    if (_pin != 255) pinMode(_pin, INPUT); 
  }
  
  void poll(uint32_t t) override {
    if (_pin == 255) return;
    
    int raw = analogRead(_pin);
    // Detection logic: If we consistently read 0 (grounded/floating-low) it might be disconnected.
    // However in sim 0 is possible. We rely on valid range.
    // In real hardware, Sharp IR floating is noisy, Sonar floating is erratic.
    // We'll treat exactly 0 as 'No measurement' for safety in this robust core.
    
    if (raw <= 0) {
      _r.quality = 0;
      return;
    }

    float mm = adcToMm(raw);
    mm = _f.step(mm);
    
    _r.mm = (uint16_t)clampT<float>(mm, 20.0f, 3000.0f);
    _r.stampMs = t;
    _r.quality = 255; // High confidence if raw > 0
  }
  
  const SensorReading& reading() const override { return _r; }
  const char* name() const override { return _name; }

private:
  const char* _name;
  uint8_t _pin;
  SensorReading _r;
  EmaFilter _f;

  static float adcToMm(int adc) {
    // Sim Logic: Linear approximation
    float x = (float)adc / 1023.0f;
    return 80.0f + x * 1200.0f; 
  }
};

// =============================================================
//              BEHAVIOR ARBITRATION
// =============================================================
enum class Priority : uint8_t {
  IDLE     = 0,
  CRUISE   = 10,
  AVOID    = 100,
  MANUAL   = 200,
  FAILSAFE = 255
};

struct DriveCmd {
  float v = 0;
  float w = 0;
  Priority prio = Priority::IDLE;
};

// Base Behavior Class
class Behavior {
public:
  virtual void reset() {}
  virtual void update(uint32_t t, DriveCmd& currentCmd) = 0;
};

// =============================================================
//              CONCRETE BEHAVIORS
// =============================================================

// 1. FAILSAFE: Stops if sensors expire
class FailsafeBehavior : public Behavior {
  ISensor* _s;
  uint32_t _timeout;
public:
  FailsafeBehavior(ISensor* s, uint32_t to) : _s(s), _timeout(to) {}
  void update(uint32_t t, DriveCmd& cmd) override {
    if (cmd.prio >= Priority::FAILSAFE) return;
    
    const auto& r = _s->reading();
    // If sensor has never updated or is stale
    bool stale = (!r.valid()) || (t - r.stampMs > _timeout);
    
    if (stale) {
      // Force Stop
      cmd.v = 0; cmd.w = 0; 
      cmd.prio = Priority::FAILSAFE;
    }
  }
};

// 2. CRUISE: Default forward
class CruiseBehavior : public Behavior {
  float _speed;
public:
  CruiseBehavior(float s) : _speed(s) {}
  void update(uint32_t t, DriveCmd& cmd) override {
    if (cmd.prio >= Priority::CRUISE) return;
    cmd.v = _speed;
    cmd.w = 0;
    cmd.prio = Priority::CRUISE;
  }
};

// 3. AVOIDANCE: Scan & Turn
enum class AvoidState { MONITOR, BRAKE, SCAN, TURN };

class AvoidanceBehavior : public Behavior {
  MotorDriver* _m;  // Inspect caps
  ScanServo* _srv;
  ISensor* _front;
  ISensor* _scan;
  
  AvoidState _state = AvoidState::MONITOR;
  uint32_t _stateT0 = 0;
  
  // Scan State
  int16_t _scanAngle = SERVO_MIN_DEG;
  int16_t _bestAngle = 0;
  uint16_t _bestMm = 0;
  uint32_t _nextServoT = 0;
  int8_t _turnDir = 1;

public:
  AvoidanceBehavior(MotorDriver* m, ScanServo* s, ISensor* f, ISensor* sc)
   : _m(m), _srv(s), _front(f), _scan(sc) {}

  void update(uint32_t t, DriveCmd& cmd) override {
    if (cmd.prio >= Priority::AVOID) return;

    // CAPABILITY CHECK (Degradation)
    // If we don't have a servo, we can't really "SCAN". 
    // Fallback: Just Pivot blindly if blocked? 
    // For now we assume servo is key.
    
    const auto& fr = _front->reading();

    // FSM
    switch (_state) {
      case AvoidState::MONITOR:
        if (fr.valid() && fr.mm < OBSTACLE_THRESHOLD_MM) {
          enter(AvoidState::BRAKE, t);
        }
        break;

      case AvoidState::BRAKE:
        // Immediate stop request
        cmd.v = 0; cmd.w = 0; cmd.prio = Priority::AVOID;
        if (t - _stateT0 > 200) {
          // If we have servo capabilities, go to SCAN, else BLIND TURN
          if (_srv->active()) {
             _scanAngle = SERVO_MIN_DEG;
             _bestMm = 0;
             _bestAngle = 0;
             _srv->writeDeg(_scanAngle);
             _nextServoT = t + SERVO_SETTLE_MS;
             enter(AvoidState::SCAN, t);
          } else {
             // Fallback: Pick a direction
             _bestAngle = 90; // Turn right
             enter(AvoidState::TURN, t);
          }
        }
        break;

      case AvoidState::SCAN:
        cmd.v = 0; cmd.w = 0; cmd.prio = Priority::AVOID;
        
        // Wait for servo settle
        if ((int32_t)(t - _nextServoT) >= 0) {
           // Read Scan
           const auto& sr = _scan->reading();
           // Require fresh sync reading? Ideally yes.
           if (sr.valid() && sr.mm > _bestMm) {
             _bestMm = sr.mm;
             _bestAngle = _scanAngle;
           }

           _scanAngle += SERVO_STEP;
           if (_scanAngle > SERVO_MAX_DEG) {
             enter(AvoidState::TURN, t); // Done
           } else {
             _srv->writeDeg(_scanAngle);
             _nextServoT = t + SERVO_SETTLE_MS;
           }
        }
        break;

      case AvoidState::TURN:
        // Execute Turn
        cmd.prio = Priority::AVOID;
        
        // Check Caps
        bool canPivot = _m->caps().canPivot;
        _turnDir = (_bestAngle >= 0) ? 1 : -1;
        
        if (canPivot) {
          cmd.v = 0;
          cmd.w = 0.6f * _turnDir;
        } else {
          // Arc turn
          cmd.v = 0.35f;
          cmd.w = 0.6f * _turnDir;
        }

        uint32_t turnDur = TURN_BASE_MS + (uint32_t)(fabsf(_bestAngle) * TURN_MS_PER_DEG);
        if (t - _stateT0 > turnDur) {
           // Centering Servo
           if (_srv->active()) _srv->writeDeg(0);
           enter(AvoidState::MONITOR, t);
        }
        break;
    }
  }

  void enter(AvoidState s, uint32_t t) { _state = s; _stateT0 = t; }
};


// =============================================================
//                       MAIN
// =============================================================
MotorDriver motors;
ScanServo   scanServo;

AnalogDistanceSensor frontSensor("front", PIN_FRONT_SENSE);
AnalogDistanceSensor scanSensor ("scan",  PIN_SCAN_SENSE);

// Behaviors
FailsafeBehavior* failsafe = nullptr;
CruiseBehavior*   cruise = nullptr;
AvoidanceBehavior* avoidance = nullptr;

void setup() {
  Serial.begin(115200);
  Serial.println(F("Core: Hybrid Arch Booting..."));

  // 1. Hardware Init
  motors.begin(PIN_MOTOR_L_PWM, PIN_MOTOR_L_DIR, PIN_MOTOR_R_PWM, PIN_MOTOR_R_DIR);
  scanServo.begin(PIN_SCAN_SERVO);
  
  frontSensor.begin();
  scanSensor.begin();

  // 2. Behavior Init
  failsafe  = new FailsafeBehavior(&frontSensor, FAILSAFE_TIMEOUT_MS);
  cruise    = new CruiseBehavior(DEFAULT_CRUISE);
  avoidance = new AvoidanceBehavior(&motors, &scanServo, &frontSensor, &scanSensor);

  Serial.print(F("Caps: Rev=")); Serial.print(motors.caps().canReverse);
  Serial.print(F(" Pivot=")); Serial.println(motors.caps().canPivot);
}

void loop() {
  uint32_t t = nowMs();
  
  // 1. Update Sensors
  static uint32_t tFront=0, tScan=0;
  if (t - tFront > SENSOR_FRONT_PERIOD) { frontSensor.poll(t); tFront = t; }
  if (t - tScan  > SENSOR_SCAN_PERIOD)  { scanSensor.poll(t);  tScan = t; }

  // 2. Arbitrate Behaviors
  DriveCmd cmd; // Default IDLE

  // Layers (Lowest to Highest)
  cruise->update(t, cmd);
  avoidance->update(t, cmd);
  failsafe->update(t, cmd);

  // 3. Actuate
  motors.setDifferential(cmd.v, cmd.w);

  // 4. Telemetry
  static uint32_t tTlm = 0;
  if (t - tTlm > TELEMETRY_PERIOD) {
    tTlm = t;
    // Serial.print("Cmd Prio: "); Serial.println(cmd.prio);
  }
  
  delay(LOOP_DT_MS);
}
`;


export const ADVANCED_JS_CODE = `
// =============================================================
//      ROBUST MODULAR CONTROLLER (JS PORT)
// =============================================================
// Implements: Capabilities, Arbitration, Degradation

// ---- UTILS ----
const clamp = (v, min, max) => Math.min(Math.max(v, min), max);

class EmaFilter {
  constructor(alpha = 0.35) {
    this.alpha = alpha;
    this.y = 0;
    this.inited = false;
  }
  step(x) {
    if (!this.inited) { this.y = x; this.inited = true; }
    else { this.y = this.alpha * x + (1 - this.alpha) * this.y; }
    return this.y;
  }
}

class Timer {
  constructor() { this.next = 0; }
  due(t) { return (t - this.next) >= 0; }
  arm(t, period) { this.next = t + period; }
}

// ---- HARDWARE ABSTRACTIONS ----
class DriveCaps {
  constructor() {
    this.canReverse = false;
    this.canPivot = false;
  }
}

class MotorDriver {
  constructor() {
    this.lPin = 5; this.rPin = 6;
    this._caps = new DriveCaps();
  }
  
  begin(l, lDir, r, rDir) {
    this.lPin = l; this.rPin = r;
    // Logic: In Sim, we treat -1 or 255 as 'Not Connected'
    const hasL = (lDir !== 255 && lDir !== -1);
    const hasR = (rDir !== 255 && rDir !== -1);
    
    this._caps.canReverse = hasL && hasR;
    this._caps.canPivot = this._caps.canReverse;
    
    console.log("Motor Caps Verified. Reverse: " + this._caps.canReverse);
  }

  get caps() { return this._caps; }

  setDifferential(v, w) {
    // Degrade: If no reverse, we clamp or adapt
    if (!this._caps.canReverse) {
      if (v < 0) v = 0;
      // Arc turn fallback logic could go here, 
      // but simplistic sim usually handles pivots okay-ish even with V=0
    }
    
    // Mixing
    this.setLeft(v - w);
    this.setRight(v + w);
  }

  setLeft(duty) {
    duty = clamp(duty, -1, 1);
    // Sim handles sign automatically via motor component but let's emulate hardware
    analogWrite(this.lPin, Math.abs(duty) * 255);
  }
  
  setRight(duty) {
    duty = clamp(duty, -1, 1);
    analogWrite(this.rPin, Math.abs(duty) * 255);
  }
  
  stop() { this.setLeft(0); this.setRight(0); }
}

class ScanServo {
  constructor() { this.pin = -1; this._active = false; this._deg = 0; }
  begin(pin) {
    this.pin = pin;
    this._active = (pin !== 255 && pin !== -1);
    if(this._active) this.writeDeg(0);
  }
  get active() { return this._active; }
  
  writeDeg(deg) {
    if(!this._active) return;
    deg = clamp(deg, -90, 90);
    servoWrite(this.pin, deg);
    this._deg = deg;
  }
}

class Sensor {
  constructor(name, pin) {
    this.name = name; 
    this.pin = pin;
    this.filter = new EmaFilter();
    this.reading = { mm: 0, stamp: 0, quality: 0 };
  }
  
  poll(t) {
    if (this.pin === -1 || this.pin === 255) return;
    
    const raw = analogRead(this.pin);
    // Sim: 0 usually means nothing connected or super close.
    // We treat 0 as disconnected/invalid for safety.
    if (raw <= 0) {
      this.reading.quality = 0;
      return;
    }
    
    // Pass Value
    let mm = this.filter.step(raw);
    this.reading.mm = Math.floor(mm);
    this.reading.stamp = t;
    this.reading.quality = 255;
  }
  
  get valid() { return this.reading.quality > 0; }
}

// ---- BEHAVIORS ----
const PRIO = { IDLE: 0, CRUISE: 10, AVOID: 100, FAILSAFE: 255 };

class Behavior {
  update(t, cmd) {} // Writes to cmd {v, w, prio}
}

class CruiseBehavior extends Behavior {
  constructor(speed) { super(); this.speed = speed; }
  update(t, cmd) {
    if (cmd.prio >= PRIO.CRUISE) return;
    cmd.v = this.speed;
    cmd.w = 0;
    cmd.prio = PRIO.CRUISE;
  }
}

class FailsafeBehavior extends Behavior {
  constructor(sensor, timeout) { super(); this.s = sensor; this.to = timeout; }
  update(t, cmd) {
    if (cmd.prio >= PRIO.FAILSAFE) return;
    // Check staleness
    const stale = !this.s.valid || (t - this.s.reading.stamp > this.to);
    if (stale) {
      cmd.v = 0; cmd.w = 0; cmd.prio = PRIO.FAILSAFE;
      // console.log("FAILSAFE ACTIVE");
    }
  }
}

class AvoidanceBehavior extends Behavior {
  constructor(m, srv, f, sc) {
    super();
    this.m = m; this.srv = srv; 
    this.front = f; this.scan = sc;
    this.state = 0; // 0=MON, 1=BRAKE, 2=SCAN, 3=TURN
    this.t0 = 0;
    
    this.scanAng = -80;
    this.bestMm = 0;
    this.bestAng = 0;
    this.nextT = 0;
  }
  
  enter(s, t) { this.state = s; this.t0 = t; }

  update(t, cmd) {
    if (cmd.prio >= PRIO.AVOID) return;
    
    const fr = this.front.reading;
    
    switch(this.state) {
      case 0: // MON
        if (fr.quality > 0 && fr.mm < 300) {
          this.enter(1, t);
        }
        break;
        
      case 1: // BRAKE
        cmd.v = 0; cmd.w = 0; cmd.prio = PRIO.AVOID;
        if (t - this.t0 > 250) {
           if (this.srv.active) {
             this.scanAng = -80; this.bestMm = 0; this.srv.writeDeg(-80);
             this.nextT = t + 100;
             this.enter(2, t);
           } else {
             this.bestAng = 90; // Fallback right
             this.enter(3, t);
           }
        }
        break;
        
      case 2: // SCAN
        cmd.v = 0; cmd.w = 0; cmd.prio = PRIO.AVOID;
        if (t >= this.nextT) {
          const sr = this.scan.reading;
          if (sr.quality > 0 && sr.mm > this.bestMm) {
             this.bestMm = sr.mm; this.bestAng = this.scanAng;
          }
          this.scanAng += 20;
          if (this.scanAng > 80) {
             this.enter(3, t);
          } else {
             this.srv.writeDeg(this.scanAng);
             this.nextT = t + 50;
          }
        }
        break;
        
      case 3: // TURN
        cmd.v = 0; cmd.w = 0; cmd.prio = PRIO.AVOID;
        const dir = (this.bestAng >= 0) ? 1 : -1;
        
        // Pivot vs Arc
        if (this.m.caps.canPivot) {
           cmd.w = 0.6 * dir;
        } else {
           cmd.v = 0.3; cmd.w = 0.6 * dir;
        }
        
        const dur = 350 + Math.abs(this.bestAng) * 4;
        if (t - this.t0 > dur) {
           if(this.srv.active) this.srv.writeDeg(0);
           this.enter(0, t);
        }
        break;
    }
  }
}

// ---- GLOBALS ----
const motors = new MotorDriver();
const servo = new ScanServo();
const frontSensor = new Sensor("front", 14);
const scanSensor = new Sensor("scan", 15);

// Behaviors
const bCruise = new CruiseBehavior(0.45);
const bFailsafe = new FailsafeBehavior(frontSensor, 500);
const bAvoid = new AvoidanceBehavior(motors, servo, frontSensor, scanSensor);

// Timers
const tmFront = new Timer();
const tmScan = new Timer();

function setup() {
  console.log("Core: JS Hybrid Arch");
  // Configure Pins (255 = Not Connected)
  motors.begin(5, 255, 6, 255); // Default: No Dir Pins -> Forward Only
  servo.begin(9);
  
  const t = millis();
  tmFront.arm(t, 50);
  tmScan.arm(t, 80);
}

function loop() {
  const t = millis();
  
  if (tmFront.due(t)) { frontSensor.poll(t); tmFront.arm(t, 50); }
  if (tmScan.due(t))  { scanSensor.poll(t);  tmScan.arm(t, 80); }
  
  // Arbitration
  const cmd = { v: 0, w: 0, prio: 0 };
  
  bCruise.update(t, cmd);
  bAvoid.update(t, cmd);
  bFailsafe.update(t, cmd);
  
  // Actuate
  motors.setDifferential(cmd.v, cmd.w);
}
`;

import { DEMO_CODE } from '../constants';

export const CODE_TEMPLATES = {
  basic: DEMO_CODE,
  advanced: ADVANCED_JS_CODE
};
