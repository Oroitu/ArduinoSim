import React from 'react';
import { Brain, Play, Save } from 'lucide-react';

export interface TrainingParams {
    generations: number;
    pop_size: number;
    alpha: number;
    lambda_rot: number;
}

export const DEFAULT_TRAINING_PARAMS: TrainingParams = {
    generations: 20,
    pop_size: 16,
    alpha: 0.05,
    lambda_rot: 0.05
};

interface Props {
    params: TrainingParams;
    onChange: (p: TrainingParams) => void;
    onTrain: () => void;
    isTraining: boolean;
    trajectory?: { x: number, y: number }[];
}

const RLTrainingConfig: React.FC<Props> = ({ params, onChange, onTrain, isTraining, trajectory }) => {

    const handleChange = (key: keyof TrainingParams, val: string) => {
        const num = parseFloat(val);
        if (!isNaN(num)) {
            onChange({ ...params, [key]: num });
        }
    };

    // --- Visualization Logic ---
    const canvasRef = React.useRef<HTMLCanvasElement>(null);

    React.useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || !trajectory || trajectory.length === 0) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const w = canvas.width;
        const h = canvas.height;

        // Clear
        ctx.fillStyle = '#1e293b'; // slate-800
        ctx.fillRect(0, 0, w, h);

        // Find Bounds
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        trajectory.forEach(p => {
            if (p.x < minX) minX = p.x;
            if (p.x > maxX) maxX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.y > maxY) maxY = p.y;
        });

        // Add padding
        const pad = 20; // units
        minX -= pad; maxX += pad;
        minY -= pad; maxY += pad;

        const rangeX = maxX - minX;
        const rangeY = maxY - minY;

        // Scale to fit canvas (maintain aspect ratio?)
        // Let's stretch to fill for visibility first, or simple fit.
        // Simple fit logic:
        const scaleX = w / rangeX;
        const scaleY = h / rangeY;
        const scale = Math.min(scaleX, scaleY);

        // Center it
        const offsetX = (w - rangeX * scale) / 2;
        const offsetY = (h - rangeY * scale) / 2;

        const toCanvas = (wx: number, wy: number) => {
            return {
                x: offsetX + (wx - minX) * scale,
                y: h - (offsetY + (wy - minY) * scale) // Flip Y for canvas up-is-sim-up? 
                // Wait, Sim coordinates: Y is up? 
                // Usually in 2D Sim: Y is often down (screen) or Up (Cartesian). 
                // In this App, Y seems to be Down in canvas usually? 
                // Let's assume standard graphics Y-down for simplicity unless verified otherwise.
                // Actually, let's just plot it.
            };
        };

        // Grid / Origin
        ctx.strokeStyle = '#334155';
        ctx.lineWidth = 1;
        ctx.beginPath();
        // Zero lines if visible
        if (minX < 0 && maxX > 0) {
            const p0 = toCanvas(0, minY);
            const p1 = toCanvas(0, maxY);
            // ctx.moveTo(p0.x, 0); ctx.lineTo(p0.x, h); // Draw vertical line at X=0
        }
        ctx.stroke();

        // Draw Path
        ctx.strokeStyle = '#34d399'; // emerald-400
        ctx.lineWidth = 2;
        ctx.beginPath();
        trajectory.forEach((p, i) => {
            // Need to invert Y if sim is Cartesian? 
            // In App.tsx: robot pos x,y. Canvas logic usually Y is down.
            // Let's just map min->max to 0->h.
            const cx = offsetX + (p.x - minX) * scale;
            const cy = h - (offsetY + (p.y - minY) * scale); // Invert Y visually so 'up' is 'up'

            if (i === 0) ctx.moveTo(cx, cy);
            else ctx.lineTo(cx, cy);
        });
        ctx.stroke();

        // Draw Start/End
        const start = trajectory[0];
        const end = trajectory[trajectory.length - 1];

        const sC = { x: offsetX + (start.x - minX) * scale, y: h - (offsetY + (start.y - minY) * scale) };
        const eC = { x: offsetX + (end.x - minX) * scale, y: h - (offsetY + (end.y - minY) * scale) };

        ctx.fillStyle = '#3b82f6'; // blue start
        ctx.beginPath(); ctx.arc(sC.x, sC.y, 3, 0, Math.PI * 2); ctx.fill();

        ctx.fillStyle = '#ef4444'; // red end
        ctx.beginPath(); ctx.arc(eC.x, eC.y, 3, 0, Math.PI * 2); ctx.fill();

    }, [trajectory]);


    return (
        <div className="flex flex-col h-full bg-slate-900 text-slate-200 p-6 overflow-auto">
            <div className="max-w-4xl mx-auto w-full">
                <div className="mb-8 flex items-center gap-3 border-b border-slate-700 pb-4">
                    <Brain className="w-8 h-8 text-emerald-500" />
                    <div>
                        <h1 className="text-2xl font-bold">RL Training Configuration</h1>
                        <p className="text-slate-400 text-sm">Configure hyperparameters for the Evolutionary Strategy algorithm.</p>
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
                    {/* Left Col: Config */}
                    <div className="lg:col-span-1 space-y-6">
                        <div className="bg-slate-800 p-4 rounded-lg border border-slate-700">
                            <h2 className="font-semibold text-emerald-400 mb-4 uppercase text-xs tracking-wider">Evolution Strategy</h2>
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-xs font-medium text-slate-400 mb-1">Generations</label>
                                    <input
                                        type="number"
                                        value={params.generations}
                                        onChange={e => handleChange('generations', e.target.value)}
                                        className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm focus:border-emerald-500 outline-none"
                                    />
                                    <p className="text-[10px] text-slate-500 mt-1">Number of iterations to evolve the population.</p>
                                </div>

                                <div>
                                    <label className="block text-xs font-medium text-slate-400 mb-1">Population Size</label>
                                    <input
                                        type="number"
                                        value={params.pop_size}
                                        onChange={e => handleChange('pop_size', e.target.value)}
                                        className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm focus:border-emerald-500 outline-none"
                                    />
                                    <p className="text-[10px] text-slate-500 mt-1">Number of policies evaluated per generation (Parallelized).</p>
                                </div>

                                <div>
                                    <label className="block text-xs font-medium text-slate-400 mb-1">Learning Rate (Alpha)</label>
                                    <input
                                        type="number" step="0.01"
                                        value={params.alpha}
                                        onChange={e => handleChange('alpha', e.target.value)}
                                        className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm focus:border-emerald-500 outline-none"
                                    />
                                    <p className="text-[10px] text-slate-500 mt-1">Step size for parameter updates.</p>
                                </div>
                            </div>
                        </div>

                        <div className="bg-slate-800 p-4 rounded-lg border border-slate-700">
                            <h2 className="font-semibold text-purple-400 mb-4 uppercase text-xs tracking-wider">Reward Function</h2>
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-xs font-medium text-slate-400 mb-1">Spin Penalty (Lambda Rot)</label>
                                    <input
                                        type="number" step="0.01"
                                        value={params.lambda_rot}
                                        onChange={e => handleChange('lambda_rot', e.target.value)}
                                        className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm focus:border-purple-500 outline-none"
                                    />
                                    <p className="text-[10px] text-slate-500 mt-1">Penalty factor for spinning in place. Higher = prefers straight lines.</p>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Right Col: Visualization */}
                    <div className="lg:col-span-2 flex flex-col gap-4">
                        <div className="bg-slate-800 p-4 rounded-lg border border-slate-700 flex-1 flex flex-col min-h-[300px]">
                            <h2 className="font-semibold text-blue-400 mb-2 uppercase text-xs tracking-wider flex justify-between">
                                <span>Preview Rollout</span>
                                {trajectory && <span className="text-slate-500 normal-case">{trajectory.length} steps</span>}
                            </h2>
                            <div className="flex-1 bg-slate-900 rounded border border-slate-700 relative overflow-hidden flex items-center justify-center">
                                {trajectory ? (
                                    <canvas
                                        ref={canvasRef}
                                        width={500}
                                        height={300}
                                        className="w-full h-full object-contain"
                                    />
                                ) : (
                                    <div className="text-slate-600 italic text-sm p-8 text-center">
                                        No training data yet. <br />
                                        Click "Start Training" to see the result.
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="flex items-center justify-end gap-4 p-4 bg-slate-800 rounded-lg border border-slate-700 mt-auto">
                            <div className="text-right mr-auto">
                                <div className="text-xs text-slate-400">Ready to train?</div>
                                <div className="text-[10px] text-slate-500">This will save config and run python script.</div>
                            </div>

                            <button
                                onClick={onTrain}
                                disabled={isTraining}
                                className={`flex items-center gap-2 px-6 py-3 rounded-md font-bold text-sm transition-all shadow-lg ${isTraining
                                    ? 'bg-slate-700 text-slate-400 cursor-not-allowed'
                                    : 'bg-emerald-600 hover:bg-emerald-500 text-white hover:scale-105'
                                    }`}
                            >
                                {isTraining ? (
                                    <>TRAINING IN PROGRESS...</>
                                ) : (
                                    <><Play size={18} fill="currentColor" /> START TRAINING</>
                                )}
                            </button>
                        </div>
                    </div>
                </div>

            </div>
        </div>
    );
};

export default RLTrainingConfig;
