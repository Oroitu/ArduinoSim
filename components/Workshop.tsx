
import React, { useState } from 'react';
import { VehicleConfig, MotorConfig, SensorConfig, ServoConfig } from '../types';
import { Settings, Plus, Trash2, Cpu, Zap, Radio, Move } from 'lucide-react';

interface WorkshopProps {
    config: VehicleConfig;
    onChange: (c: VehicleConfig) => void;
}

const Workshop: React.FC<WorkshopProps> = ({ config, onChange }) => {
    const [selectedType, setSelectedType] = useState<'chassis' | 'motor' | 'sensor' | 'servo'>('chassis');
    const [selectedId, setSelectedId] = useState<string | null>(null);

    const handleChassisChange = (patch: any) => {
        onChange({ ...config, chassis: { ...config.chassis, ...patch } });
    };

    const addMotor = () => {
        const newMotor: MotorConfig = {
            id: Math.random().toString(36).substr(2, 5),
            name: 'New Motor',
            role: 'custom',
            pwmPin: 3,
            dirPin: -1,
            maxSpeed: 100,
            mount: { x: 0, y: 0, rotation: 0 }
        };
        onChange({ ...config, motors: [...config.motors, newMotor] });
        setSelectedType('motor');
        setSelectedId(newMotor.id);
    };

    const addSensor = () => {
        const newSensor: SensorConfig = {
            id: Math.random().toString(36).substr(2, 5),
            name: 'New Sensor',
            type: 'ultrasonic',
            channel: 'DIST_NEW',
            mount: { x: 20, y: 0, rotation: 0 },
            params: { range: 200, fov: 0.2 },
            pins: { trigger: 14, echo: 14 }
        };
        onChange({ ...config, sensors: [...config.sensors, newSensor] });
        setSelectedType('sensor');
        setSelectedId(newSensor.id);
    };

    const updateItem = (list: 'motors' | 'sensors' | 'servos', id: string, patch: any) => {
        // @ts-ignore
        const newList = config[list].map((item: any) => item.id === id ? { ...item, ...patch } : item);
        onChange({ ...config, [list]: newList });
    };

    const deleteItem = (list: 'motors' | 'sensors' | 'servos', id: string) => {
        // @ts-ignore
        const newList = config[list].filter((item: any) => item.id !== id);
        onChange({ ...config, [list]: newList });
        setSelectedId(null);
    };

    // Rendering Helper for the Mini-Visualizer
    const renderVisualizer = () => {
        const scale = 3;
        const cx = 150;
        const cy = 150;

        return (
            <svg width="300" height="300" className="border border-slate-700 bg-slate-900 rounded mx-auto">
                <g transform={`translate(${cx}, ${cy}) scale(${scale})`}>
                    {/* Grid */}
                    <line x1="-50" y1="0" x2="50" y2="0" stroke="#334155" strokeWidth="0.5" />
                    <line x1="0" y1="-50" x2="0" y2="50" stroke="#334155" strokeWidth="0.5" />

                    {/* Chassis */}
                    {config.chassis.shape === 'rect' ? (
                        <rect
                            x={-config.chassis.length / 2} y={-config.chassis.width / 2}
                            width={config.chassis.length} height={config.chassis.width}
                            fill="#1e293b" stroke="#3b82f6" strokeWidth="1"
                            onClick={() => { setSelectedType('chassis'); setSelectedId(null); }}
                            className="cursor-pointer hover:fill-slate-800"
                        />
                    ) : (
                        <circle
                            r={config.chassis.radius || 20}
                            fill="#1e293b" stroke="#3b82f6" strokeWidth="1"
                            onClick={() => { setSelectedType('chassis'); setSelectedId(null); }}
                            className="cursor-pointer hover:fill-slate-800"
                        />
                    )}

                    {/* Front Arrow */}
                    <path d="M 0 0 L 10 0" stroke="#3b82f6" strokeWidth="0.5" markerEnd="url(#arrow)" />

                    {/* Motors */}
                    {config.motors.map(m => (
                        <g key={m.id} transform={`translate(${m.mount.x}, ${m.mount.y}) rotate(${m.mount.rotation * 180 / Math.PI})`}
                            onClick={() => { setSelectedType('motor'); setSelectedId(m.id); }}
                            className="cursor-pointer hover:opacity-80"
                        >
                            <rect x="-6" y="-3" width="12" height="6" fill={selectedId === m.id ? '#fbbf24' : '#94a3b8'} />
                        </g>
                    ))}

                    {/* Sensors */}
                    {config.sensors.map(s => (
                        <g key={s.id} transform={`translate(${s.mount.x}, ${s.mount.y}) rotate(${s.mount.rotation * 180 / Math.PI})`}
                            onClick={() => { setSelectedType('sensor'); setSelectedId(s.id); }}
                            className="cursor-pointer hover:opacity-80"
                        >
                            <circle r="3" fill={selectedId === s.id ? '#fbbf24' : '#10b981'} />
                            <line x1="0" y1="0" x2="5" y2="0" stroke="white" strokeWidth="0.5" />
                        </g>
                    ))}
                </g>
            </svg>
        );
    };

    const getSelectedItem = () => {
        if (selectedType === 'motor') return config.motors.find(m => m.id === selectedId);
        if (selectedType === 'sensor') return config.sensors.find(s => s.id === selectedId);
        return null;
    };

    const selectedItem = getSelectedItem();

    const checkPinConflicts = () => {
        const usage = new Map<number, string>();
        const conflicts: string[] = [];

        config.motors.forEach(m => {
            if (usage.has(m.pwmPin)) conflicts.push(`Pin ${m.pwmPin} used by ${usage.get(m.pwmPin)} and ${m.name}`);
            usage.set(m.pwmPin, m.name);
            if (m.dirPin !== -1) {
                if (usage.has(m.dirPin!)) conflicts.push(`Pin ${m.dirPin} used by ${usage.get(m.dirPin!)} and ${m.name}`);
                usage.set(m.dirPin!, m.name);
            }
        });

        config.sensors.forEach(s => {
            const pins = [s.pins.trigger, s.pins.echo, s.pins.analog].filter(p => p !== undefined && p !== null) as number[];
            pins.forEach(p => {
                if (usage.has(p)) conflicts.push(`Pin ${p} used by ${usage.get(p)} and ${s.name}`);
                usage.set(p, s.name);
            });
        });

        // Servos
        config.servos.forEach(s => {
            if (usage.has(s.pin)) conflicts.push(`Pin ${s.pin} used by ${usage.get(s.pin)} and ${s.name}`);
            usage.set(s.pin, s.name);
        });

        return conflicts;
    };

    const conflicts = checkPinConflicts();

    return (
        <div className="flex h-full bg-slate-950 text-slate-200">

            {/* Left List */}
            <div className="w-64 border-r border-slate-800 flex flex-col">
                {/* ... (existing content) ... */}
            </div>

            {/* Center Visualizer */}
            <div className="flex-1 flex flex-col bg-slate-900">
                <div className="flex-1 flex items-center justify-center p-8 relative">
                    {renderVisualizer()}
                </div>
                <div className="h-32 p-4 bg-slate-950 border-t border-slate-800 text-slate-500 text-xs font-mono overflow-y-auto">
                    <p className="font-bold mb-2">System Status:</p>
                    {conflicts.length === 0 ? (
                        <p className="text-emerald-500 flex items-center gap-2"><Zap size={12} /> All Systems Nominal. No pin conflicts detected.</p>
                    ) : (
                        <div className="space-y-1">
                            {conflicts.map((c, i) => (
                                <p key={i} className="text-red-400 flex items-center gap-2"><Radio size={12} /> {c}</p>
                            ))}
                        </div>
                    )}
                    <p className="mt-4 text-slate-600">Use the properties panel to assign unique pins to each component.</p>
                </div>
            </div>


            <div className="w-80 border-l border-slate-800 bg-slate-950 p-4 overflow-y-auto">
                <h3 className="text-xs font-bold text-slate-500 uppercase mb-4">Properties</h3>

                {selectedType === 'chassis' && (
                    <div className="space-y-4">
                        <InputGroup label="Shape">
                            <select
                                value={config.chassis.shape}
                                onChange={e => handleChassisChange({ shape: e.target.value })}
                                className="w-full bg-slate-800 border border-slate-700 rounded p-1 text-sm"
                            >
                                <option value="rect">Rectangle</option>
                                <option value="circle">Circle</option>
                            </select>
                        </InputGroup>
                        {config.chassis.shape === 'rect' && (
                            <>
                                <NumInput label="Length (X)" value={config.chassis.length} onChange={v => handleChassisChange({ length: v })} />
                                <NumInput label="Width (Y)" value={config.chassis.width} onChange={v => handleChassisChange({ width: v })} />
                            </>
                        )}
                        {config.chassis.shape === 'circle' && (
                            <NumInput label="Radius" value={config.chassis.radius} onChange={v => handleChassisChange({ radius: v })} />
                        )}
                    </div>
                )}

                {selectedType === 'motor' && selectedItem && (
                    <div className="space-y-4">
                        <TextInput label="Name" value={selectedItem.name} onChange={v => updateItem('motors', selectedItem.id, { name: v })} />
                        <InputGroup label="Role">
                            <select
                                value={(selectedItem as MotorConfig).role}
                                onChange={e => updateItem('motors', selectedItem.id, { role: e.target.value })}
                                className="w-full bg-slate-800 border border-slate-700 rounded p-1 text-sm"
                            >
                                <option value="left">Left Wheel</option>
                                <option value="right">Right Wheel</option>
                                <option value="custom">Custom</option>
                            </select>
                        </InputGroup>
                        <NumInput label="PWM Pin" value={(selectedItem as MotorConfig).pwmPin} onChange={v => updateItem('motors', selectedItem.id, { pwmPin: v })} />
                        <NumInput label="Max Speed" value={(selectedItem as MotorConfig).maxSpeed} onChange={v => updateItem('motors', selectedItem.id, { maxSpeed: v })} />

                        <div className="pt-2 border-t border-slate-800">
                            <p className="text-xs font-bold text-slate-500 mb-2">Mounting</p>
                            <div className="grid grid-cols-2 gap-2">
                                <NumInput label="Pos X" value={selectedItem.mount.x} onChange={v => updateItem('motors', selectedItem.id, { mount: { ...selectedItem.mount, x: v } })} />
                                <NumInput label="Pos Y" value={selectedItem.mount.y} onChange={v => updateItem('motors', selectedItem.id, { mount: { ...selectedItem.mount, y: v } })} />
                            </div>
                        </div>
                    </div>
                )}

                {selectedType === 'sensor' && selectedItem && (
                    <div className="space-y-4">
                        <TextInput label="Name" value={selectedItem.name} onChange={v => updateItem('sensors', selectedItem.id, { name: v })} />
                        <TextInput label="Channel Code" value={(selectedItem as SensorConfig).channel} onChange={v => updateItem('sensors', selectedItem.id, { channel: v })} />

                        <InputGroup label="Type">
                            <select
                                value={(selectedItem as SensorConfig).type}
                                onChange={e => updateItem('sensors', selectedItem.id, { type: e.target.value })}
                                className="w-full bg-slate-800 border border-slate-700 rounded p-1 text-sm"
                            >
                                <option value="ultrasonic">Ultrasonic</option>
                                <option value="line">Line / IR</option>
                            </select>
                        </InputGroup>

                        <div className="p-2 bg-slate-900 rounded border border-slate-800">
                            <p className="text-[10px] text-slate-500 mb-2 uppercase font-bold">Pin Mapping</p>
                            {(selectedItem as SensorConfig).type === 'ultrasonic' ? (
                                <>
                                    <NumInput label="Trig / Analog Pin" value={(selectedItem as SensorConfig).pins.trigger || 0} onChange={v => updateItem('sensors', selectedItem.id, { pins: { ...(selectedItem as SensorConfig).pins, trigger: v, analog: v } })} />
                                    <NumInput label="Echo Pin" value={(selectedItem as SensorConfig).pins.echo || 0} onChange={v => updateItem('sensors', selectedItem.id, { pins: { ...(selectedItem as SensorConfig).pins, echo: v } })} />
                                </>
                            ) : (
                                <NumInput label="Analog Pin" value={(selectedItem as SensorConfig).pins.analog || 0} onChange={v => updateItem('sensors', selectedItem.id, { pins: { ...(selectedItem as SensorConfig).pins, analog: v } })} />
                            )}
                        </div>

                        <div className="pt-2 border-t border-slate-800">
                            <p className="text-xs font-bold text-slate-500 mb-2">Mounting</p>
                            <div className="grid grid-cols-2 gap-2">
                                <NumInput label="Pos X" value={selectedItem.mount.x} onChange={v => updateItem('sensors', selectedItem.id, { mount: { ...selectedItem.mount, x: v } })} />
                                <NumInput label="Pos Y" value={selectedItem.mount.y} onChange={v => updateItem('sensors', selectedItem.id, { mount: { ...selectedItem.mount, y: v } })} />
                                <NumInput label="Rotation (Deg)" value={selectedItem.mount.rotation * 180 / Math.PI} onChange={v => updateItem('sensors', selectedItem.id, { mount: { ...selectedItem.mount, rotation: v * Math.PI / 180 } })} />
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div >
    );
};

const InputGroup = ({ label, children }: any) => (
    <div>
        <label className="text-[10px] text-slate-500 block mb-1">{label}</label>
        {children}
    </div>
);

const TextInput = ({ label, value, onChange }: any) => (
    <InputGroup label={label}>
        <input
            type="text"
            value={value}
            onChange={e => onChange(e.target.value)}
            className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
        />
    </InputGroup>
);

const NumInput = ({ label, value, onChange }: any) => (
    <InputGroup label={label}>
        <input
            type="number"
            value={value}
            onChange={e => onChange(parseFloat(e.target.value))}
            className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
        />
    </InputGroup>
);

export default Workshop;
