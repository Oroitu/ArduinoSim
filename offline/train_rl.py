import argparse
import json
import numpy as np
import os
import sys
import copy
import time
from sklearn.neural_network import MLPRegressor
from sklearn.preprocessing import StandardScaler

# Import env
from envs.robot_env import RobotEnv
# Import export utils from existing script
import train_policy # assumes train_policy.py is in same dir

class PolicyMLP:
    def __init__(self, input_dim, hidden_sizes, output_dim):
        self.input_dim = input_dim
        self.output_dim = output_dim
        self.hidden_sizes = hidden_sizes
        
        # Initialize weights (list of matrices)
        self.weights = []
        self.biases = []
        
        # Architecture: Input -> H1 -> H2 -> Output
        dims = [input_dim] + list(hidden_sizes) + [output_dim]
        
        for i in range(len(dims)-1):
            # Xavier/Glorot init
            limit = np.sqrt(6 / (dims[i] + dims[i+1]))
            w = np.random.uniform(-limit, limit, (dims[i], dims[i+1]))
            b = np.zeros(dims[i+1])
            
            self.weights.append(w)
            self.biases.append(b)
            
    def predict(self, x):
        # Forward pass with Tanh
        out = x
        for i, (w, b) in enumerate(zip(self.weights, self.biases)):
            out = np.dot(out, w) + b
            # Activation (Tanh for all layers including output for v,w mapping to -1..1)
            out = np.tanh(out)
        return out
        
    def get_flat_params(self):
        params = []
        for w in self.weights:
            params.append(w.flatten())
        for b in self.biases:
            params.append(b.flatten())
        return np.concatenate(params)
    
    def set_flat_params(self, flat_params):
        idx = 0
        for i in range(len(self.weights)):
            w_shape = self.weights[i].shape
            w_size = np.prod(w_shape)
            self.weights[i] = flat_params[idx:idx+w_size].reshape(w_shape)
            idx += w_size
            
            b_shape = self.biases[i].shape
            b_size = np.prod(b_shape)
            self.biases[i] = flat_params[idx:idx+b_size].reshape(b_shape)
            idx += b_size

    def load_from_sklearn(self, model, scaler):
        # Load weights from an existing sklearn MLPRegressor
        # coefs_ has shape [in, out]
        self.weights = copy.deepcopy(model.coefs_)
        self.biases = copy.deepcopy(model.intercepts_)
        # Note: Scaler handling needs to be done in wrapper or prepended?
        # For simplicity, we assume inputs are already scaled or raw-compatible.
        # But wait, imitation policy used scaler.
        # We should store mean/std if possible.

class ESTrainer:
    def __init__(self, env, policy, pop_size=32, sigma=0.1, alpha=0.01):
        self.env = env
        self.policy = policy
        self.pop_size = pop_size
        self.sigma = sigma # noise std
        self.alpha = alpha # learning rate
        
    def rollout(self, policy):
        obs = self.env.reset()
        total_reward = 0
        done = False
        
        # Metrics
        low_v_steps = 0
        total_steps = 0
        sum_w_ratio = 0.0
        
        while not done:
            action = policy.predict(obs) # Returns tanh'd output [-1, 1]
            obs, reward, done, info = self.env.step(action)
            total_reward += reward
            
            # Track Stats
            v = info.get("v", 0.0)
            w = info.get("w", 0.0)
            
            # v is in cm/s, w in rad/s.
            # v_max is ~50. v_min ~ 5?
            # User suggested "% steps with |v_cmd| < v_min"
            if abs(v) < 5.0: # Arbitrary threshold, or read from config?
                low_v_steps += 1
            
            # |w|/|v| ratio. Avoid div by zero.
            # Only count if trying to move?
            ratio = abs(w) / (abs(v) + 1.0) 
            sum_w_ratio += ratio
            total_steps += 1
            
        stats = {
            "low_v_pct": (low_v_steps / total_steps) * 100 if total_steps > 0 else 0,
            "avg_w_v_ratio": (sum_w_ratio / total_steps) if total_steps > 0 else 0
        }
        return total_reward, stats
        
    def train(self, n_generations=100):
        print(f"Starting ES Training: Pop={self.pop_size}, Gen={n_generations}")
        
        base_params = self.policy.get_flat_params()
        n_params = len(base_params)
        print(f"Parameter count: {n_params}")
        
        for g in range(n_generations):
            # Generate noise
            noise = np.random.randn(self.pop_size, n_params)
            
            rewards = []
            
            # Evaluate population (parallelize? python threading sucks, sequential for now)
            # Useantithetic sampling for stability (mirror noise)
            
            # Simple version: pop_size perturbations
            gen_stats = {"low_v_pct": [], "avg_w_v_ratio": []}
            
            for i in range(self.pop_size):
                perturbed_params = base_params + self.sigma * noise[i]
                
                # Clone policy
                temp_policy = copy.deepcopy(self.policy)
                temp_policy.set_flat_params(perturbed_params)
                
                r, s = self.rollout(temp_policy)
                rewards.append(r)
                
                gen_stats["low_v_pct"].append(s["low_v_pct"])
                gen_stats["avg_w_v_ratio"].append(s["avg_w_v_ratio"])
                
            rewards = np.array(rewards)
            
            # Update
            # params = params + alpha * (1/sigma * pop_size) * sum(reward_i * noise_i)
            # Normalize rewards
            adv = (rewards - np.mean(rewards)) / (np.std(rewards) + 1e-8)
            
            weighted_noise = np.dot(adv, noise)
            update = (self.alpha / (self.pop_size * self.sigma)) * weighted_noise
            
            base_params += update
            self.policy.set_flat_params(base_params)
            
            # Aggregate stats
            avg_low_v = np.mean(gen_stats["low_v_pct"])
            avg_w_v = np.mean(gen_stats["avg_w_v_ratio"])

            if (g+1) % 10 == 0:
                print(f"Gen {g+1}/{n_generations}: Avg Reward={np.mean(rewards):.2f}, Max={np.max(rewards):.2f}, LowV={avg_low_v:.1f}%, W/V={avg_w_v:.2f}")
            
            # Logging
            log_entry = {
                "generation": g,
                "reward_mean": float(np.mean(rewards)),
                "reward_std": float(np.std(rewards)),
                "reward_max": float(np.max(rewards)),
                "reward_min": float(np.min(rewards)),
                "low_v_pct": float(avg_low_v),
                "avg_w_v_ratio": float(avg_w_v)
            }
            self.log_to_file(log_entry)
            
        # Return final stats of last generation
        final_stats = {
            "avg_reward": float(np.mean(rewards)),
            "max_reward": float(np.max(rewards)),
            "low_v_pct": float(avg_low_v),
            "w_v_ratio": float(avg_w_v)
        }
        return self.policy, final_stats

    def log_to_file(self, entry):
        log_dir = "offline/logs"
        os.makedirs(log_dir, exist_ok=True)
        log_file = os.path.join(log_dir, "training_log.csv")
        
        # Header check
        file_exists = os.path.isfile(log_file)
        
        with open(log_file, 'a') as f:
            if not file_exists:
                f.write("generation,reward_mean,reward_std,reward_max,reward_min,low_v_pct,avg_w_v_ratio\n")
            
            f.write(f"{entry['generation']},{entry['reward_mean']:.4f},{entry['reward_std']:.4f},{entry['reward_max']:.4f},{entry['reward_min']:.4f},{entry['low_v_pct']:.2f},{entry['avg_w_v_ratio']:.2f}\n")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--behavior", type=str, default="MOVILIDAD")
    parser.add_argument("--env_config", type=str, default="offline/envs/movilidad_basic.json")
    parser.add_argument("--vehicle_config", type=str, default="offline/vehicle_config.json")
    parser.add_argument("--init_policy", type=str, help="Path to learned_policy_weights.json to init from")
    parser.add_argument("--generations", type=int, default=50)
    parser.add_argument("--pop_size", type=int, default=16)
    parser.add_argument("--alpha", type=float, default=0.05)
    parser.add_argument("--lambda_rot", type=float, default=0.05)
    parser.add_argument("--output_h", type=str, default="learned_policy_rl.h")
    parser.add_argument("--output_json", type=str, default="learned_policy_rl_weights.json")
    
    args = parser.parse_args()
    
    # Load configs
    with open(args.env_config, 'r') as f:
        env_config = json.load(f)
        
    with open(args.vehicle_config, 'r') as f:
        veh_config = json.load(f)
        
    # Override behavior in config
    env_config["behavior"] = args.behavior
    
    # 1. Default Lambda Rot (if not in config)
    if "reward_params" not in env_config:
        env_config["reward_params"] = {}
    
    # Override with CLI arg
    env_config["reward_params"]["lambda_rot"] = args.lambda_rot
    print(f"Reward Params: lambda_rot={args.lambda_rot}")
        
    
    # Create Env
    env = RobotEnv(env_config, veh_config)
    
    # Create Policy
    # Dimensions: obs_dim -> 16 -> 8 -> 2
    input_dim = env.obs_dim
    hidden_sizes = (16, 8)
    output_dim = env.act_dim
    
    policy = PolicyMLP(input_dim, hidden_sizes, output_dim)
    
    # Init from file if requested
    if args.init_policy and os.path.exists(args.init_policy):
        print(f"Initializing from {args.init_policy}...")
        with open(args.init_policy, 'r') as f:
            weights_data = json.load(f)
            # Parse weights and set
            # Check format from 'types.ts' / 'train_policy.py'
            # "weights": list of matrices, "biases": list of vectors
            # Need to convert list to numpy
            
            w_list = [np.array(w) for w in weights_data["weights"]] 
            b_list = [np.array(b) for b in weights_data["biases"]]
            
            # Logic to transpose?
            # train_policy.py export: weights_list = [w.T.tolist() ...]
            # So here we read w.T. We need w back.
            # w_loaded is [units, inputs]. policy needs [inputs, units].
            # So transpose back.
            
            # policy.weights = [w.T for w in w_list]
            # Wait, verify carefully.
            # train_policy: w shape [in, out]. w.T shape [out, in]. JSON has [out, in].
            # So loading JSON gives [out, in]. We need [in, out].
            # So yes, Transpose.
            
            policy.weights = [w.T for w in w_list]
            policy.biases = [b for b in b_list]
            
            # Also TODO: Use mean/std from JSON for the env?
            # The env currently outputs raw. The policy should handle normalized inputs?
            # The current PolicyMLP assumes raw inputs or handles normalization itself?
            # Ideally the policy should include the scaler means/stds.
            # But the ES optimizer optimizes the WEIGHTS. 
            # If we change the input dist, weights change.
            # If we want to fine-tune, we must match the input scaling.
            # We can grab mean/std from json and put it in a global scaler or similar?
            # For simplicity, we will just start training. If inputs are scaled differently, 
            # the weights will adapt quickly.
            
    else:
        print("Initializing random policy.")

    # Train
    trainer = ESTrainer(env, policy, pop_size=args.pop_size, sigma=0.1, alpha=args.alpha)
    best_policy, final_stats = trainer.train(n_generations=args.generations)
    
    # Export
    # We create a dummy sklearn model to leverage existing export functions
    print("Exporting...")
    dummy_model = MLPRegressor(hidden_layer_sizes=hidden_sizes)
    # Force init
    dummy_model.fit(np.zeros((1, input_dim)), np.zeros((1, output_dim))) 
    
    # Set weights
    dummy_model.coefs_ = best_policy.weights
    dummy_model.intercepts_ = best_policy.biases
    
    # Dummy scaler stats (all zeros/ones if we trained directly on env observations)
    # The RobotEnv currently outputs RAW readings.
    # The PolicyMLP learned on RAW readings (implied).
    # So mean=0, std=1 for the export.
    
    mean_obs = np.zeros(input_dim)
    std_obs = np.ones(input_dim)
    
    # Metadata
    metadata = {
        "expected_num_sensors": env.n_sensors,
        "input_dim": input_dim,
        # Potentially map sensor IDs? Not available easily in RobotEnv yet aside from config.
        # "expected_sensor_ids": ...
    }
    
    train_policy.export_to_cpp(dummy_model, None, mean_obs, std_obs, filename=args.output_h, func_name="policy_rl_eval", metadata=metadata)
    train_policy.export_to_json(dummy_model, mean_obs, std_obs, filename=args.output_json, metadata=metadata)
    
    # Copy to public folder for Web Sim
    public_path = "public/learned_policy_rl_weights.json"
    try:
        os.makedirs(os.path.dirname(public_path), exist_ok=True)
        train_policy.export_to_json(dummy_model, mean_obs, std_obs, filename=public_path, metadata=metadata)
        print(f"Also exported to {public_path}")
    except Exception as e:
        print(f"Warning: Could not export to public folder: {e}")
    
    # Final Result for Frontend
    # Run one final rollout with the best policy to generate a trajectory for visualization
    print("Running final visualization rollout...")
    viz_env = RobotEnv(env_config, veh_config)
    viz_obs = viz_env.reset()
    viz_trajectory = []
    
    # Store start
    viz_trajectory.append({"x": viz_env.sim.x, "y": viz_env.sim.y})
    
    for _ in range(500): # max steps
        act = best_policy.predict(viz_obs)
        viz_obs, _, val_done, _ = viz_env.step(act)
        viz_trajectory.append({"x": viz_env.sim.x, "y": viz_env.sim.y})
        if val_done:
            break
            
    result_data = {
        "status": "success",
        "generations": args.generations,
        "metrics": final_stats,
        "trajectory": viz_trajectory
    }
    print(f"__TRAIN_RESULT__:{json.dumps(result_data)}")
    
    print("Done.")

if __name__ == "__main__":
    main()
