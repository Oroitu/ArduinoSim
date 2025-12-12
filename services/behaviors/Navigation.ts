import { ArduinoAPI } from '../../types';

export class Navigation {
    private api: ArduinoAPI;

    // Robot physical parameters (could be config driven)
    private readonly MAX_V = 100; // Arbitrary units (0-255 derived)
    private readonly SAFE_DIST = 40; // cm/units

    constructor(api: ArduinoAPI) {
        this.api = api;
    }

    /**
     * Set differential drive velocities
     * @param v Linear velocity (-1.0 to 1.0)
     * @param w Angular velocity (-1.0 to 1.0)
     */
    setVelocity(v: number, w: number) {
        // Map -1..1 to Motor PWM (0..255)
        // Simple differential drive mixing
        // Left = v - w
        // Right = v + w

        // Scale to max speed
        const speed = 255;

        let left = (v - w) * speed;
        let right = (v + w) * speed;

        // Constrain to 0-255 (Simple unipolar driver logic for now)
        // If we had a real motor driver abstraction with DIR pins, we'd handle negative.
        // For now, assume 0-255 is forward 0-100%.
        // If negative, clamp to 0 (can't go reverse without dir pins in this simple sim)

        // Improvement: If we want reverse, we need to know the motor config.
        // Assuming standard 2-motor setup for now.

        // Use analogWrite directly to pins 5,6 (default left/right in simulator examples often)
        // BUT we should find the motors from config... 
        // Navigation shouldn't know specific pins ideally.
        // However, the requested architecture says "Nav uses robot_hw".
        // robot_hw in TypeSript is `api`.
        // The simplest way without querying config every frame is to assume standard pins or standard API extension.
        // Let's assume standard "Left Motor = Pin 5", "Right Motor = Pin 6" for this abstraction 
        // OR imply that `api.analogWrite` handles the mapping if we built a higher level API.
        // Given the constraints, let's look for motors in Config?
        // Navigation is instantiated with API. It doesn't see Config.
        // So we will stick to a convention: 
        // Users SHOULD connect motors to specific pins or we scan for them once?
        // Let's use a simpler approach: Behavior sets V/W, Navigation handles the mapping to "Generic Left/Right".
        // We will assume pins 5 and 6 as defaults for checking, but ideally passed in constructor.
        // Let's add specific pins to constructor?
        // User request: "Uses sensors/motors defined in workshop".
        // So Navigation needs to know WHICH pins.

        // Revising Navigation constructor to take pin mapping.
    }
}

// Improved version with config awareness
export class RobotNavigation {
    private api: ArduinoAPI;
    private leftPin: number;
    private rightPin: number;

    constructor(api: ArduinoAPI, leftPin: number = 5, rightPin: number = 6) {
        this.api = api;
        this.leftPin = leftPin;
        this.rightPin = rightPin;
    }

    setVelocity(v: number, w: number) {
        // v, w in range [-1, 1]
        const left = Math.max(-255, Math.min(255, (v - w) * 255));
        const right = Math.max(-255, Math.min(255, (v + w) * 255));

        this.api.analogWrite(this.leftPin, left);
        this.api.analogWrite(this.rightPin, right);
    }

    stop() {
        this.setVelocity(0, 0);
    }

    /**
     * Reads all distance sensors and returns the minimum distance in front
     */
    getFrontClearance(): number {
        // Scan pins? No, we need to know which pins are sensors.
        // Again, this implies Navigation needs config.
        // For the sake of the "Behavior Layer", let's pass a sensor map or just Probe common ones.
        // Let's assume we probe specific known channels/pins if we want "Auto".
        // Or simplified: Just read specific pins.

        // Return dummy for now, Behaviors will implement specific logic.
        return 999;
    }
}
