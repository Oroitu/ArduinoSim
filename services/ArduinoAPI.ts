import React from 'react';
import { HardwareState, RobotState, VehicleConfig, ArduinoAPI } from '../types';

export const createArduinoAPI = (
    hardwareRef: React.MutableRefObject<HardwareState>,
    robotRef: React.MutableRefObject<RobotState>,
    vehicleConfig: VehicleConfig,
    log: (msg: string, type?: 'info' | 'error' | 'system') => void
): ArduinoAPI => {
    return {
        pinMode: () => { },
        digitalWrite: (pin, level) => {
            hardwareRef.current.pins[pin] = (level === 'HIGH' || level === 1 || level === true) ? 255 : 0;
        },
        analogWrite: (pin, value) => {
            hardwareRef.current.pins[pin] = Math.max(-255, Math.min(255, value));
        },
        servoWrite: (pin, angle) => {
            const servoCfg = vehicleConfig.servos.find(s => s.pin === pin);
            if (servoCfg) {
                const state = robotRef.current.servos.find(s => s.id === servoCfg.id);
                if (state) state.targetAngle = Math.max(servoCfg.minAngle, Math.min(servoCfg.maxAngle, angle));
            }
        },
        digitalRead: (pin) => (robotRef.current.sensorReadings[pin] || 0) > 500 ? 1 : 0,
        analogRead: (pin) => robotRef.current.sensorReadings[pin] || 0,
        millis: () => hardwareRef.current.millis,
        delay: (ms: number) => new Promise(resolve => setTimeout(resolve, ms)),
        console: { log: (...args: any[]) => log(args.join(' '), 'info') }
    };
};
