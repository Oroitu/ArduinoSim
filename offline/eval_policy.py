import argparse
import json
import numpy as np
import os
import sys

# Import env
from envs.robot_env import RobotEnv
# Reuse PolicyMLP class from train_rl (or duplicate it for standalone usage)
# Since train_rl is a script, we should probably refactor PolicyMLP out, 
# but for now we'll duplicate the simple inference class to avoid circular imports or refactoring while "planning".
# Actually, let's just do a quick class definition for inference.

class InferencePolicy:
    def __init__(self, json_path):
        with open(json_path, 'r') as f:
            data = json.load(f)
        
        self.weights = [np.array(w) for w in data["weights"]]
        # Check transform: train_policy export does Transpose. JSON is [out, in].
        # MLP usually expects dot(input, W) -> W should be [in, out].
        # So we transpose the weights from JSON.
        self.weights = [w.T for w in self.weights]
        
        self.biases = [np.array(b) for b in data["biases"]]
        
        # Mean/Std for normalization
        self.mean = np.array(data["mean"])
        self.std = np.array(data["std"])
        # Avoid div by zero
        self.std[self.std == 0] = 1.0

    def predict(self, obs):
        # 1. Normalize
        x = (obs - self.mean) / self.std
        
        # 2. Forward
        for i, (w, b) in enumerate(zip(self.weights, self.biases)):
            x = np.dot(x, w) + b
            # Tanh activation for all layers (as per training)
            x = np.tanh(x)
            
        return x

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--behavior", type=str, default="MOVILIDAD")
    parser.add_argument("--policy", type=str, required=True, help="Path to learned_policy_rl_weights.json")
    parser.add_argument("--env_config", type=str, default="offline/envs/movilidad_basic.json")
    parser.add_argument("--vehicle_config", type=str, default="offline/vehicle_config.json")
    parser.add_argument("--episodes", type=int, default=20)
    
    args = parser.parse_args()
    
    # Load Configs
    with open(args.env_config, 'r') as f:
        env_config = json.load(f)
    with open(args.vehicle_config, 'r') as f:
        veh_config = json.load(f)
        
    env_config["behavior"] = args.behavior
    
    # Init Env & Policy
    env = RobotEnv(env_config, veh_config)
    policy = InferencePolicy(args.policy)
    
    # Metrics
    total_rewards = []
    total_dists = []
    collisions = 0
    
    # Advanced metrics
    total_steps_all = 0
    low_v_steps_all = 0
    w_ratio_sum_all = 0.0
    
    print(f"Evaluating Policy: {args.policy}")
    print(f"Episodes: {args.episodes}")
    print("-" * 40)
    
    for ep in range(args.episodes):
        obs = env.reset()
        done = False
        ep_reward = 0
        
        start_x = env.sim.x
        start_y = env.sim.y
        
        ep_steps = 0
        ep_w_ratio_sum = 0
        
        while not done:
            action = policy.predict(obs)
            obs, reward, done, info = env.step(action)
            ep_reward += reward
            
            # Metrics
            v = info.get("v", 0.0)
            w = info.get("w", 0.0)
            
            if abs(v) < 5.0:
                low_v_steps_all += 1
            
            w_ratio = abs(w) / (abs(v) + 1.0)
            ep_w_ratio_sum += w_ratio
            w_ratio_sum_all += w_ratio
            
            total_steps_all += 1
            ep_steps += 1
            
            if done and env.current_step < env.max_steps:
                 # It was a collision if not timeout
                 collisions += 1
        
        # Calculate distance
        dist = np.sqrt((env.sim.x - start_x)**2 + (env.sim.y - start_y)**2)
        
        total_rewards.append(ep_reward)
        total_dists.append(dist)
        
        # print(f"Ep {ep+1}: Reward={ep_reward:.2f}, Dist={dist:.2f}cm")
        
    # Summary
    avg_low_v_pct = (low_v_steps_all / total_steps_all * 100) if total_steps_all > 0 else 0
    avg_w_ratio = (w_ratio_sum_all / total_steps_all) if total_steps_all > 0 else 0

    print("-" * 40)
    print("RESULTS:")
    print(f"Avg Reward:    {np.mean(total_rewards):.2f} +/- {np.std(total_rewards):.2f}")
    print(f"Avg Distance:  {np.mean(total_dists):.2f} cm")
    print(f"Collision Rate: {collisions}/{args.episodes} ({collisions/args.episodes*100:.1f}%)")
    print(f"Stagnation (% steps |v|<5): {avg_low_v_pct:.1f}%")
    print(f"Avg |w|/|v| ratio:         {avg_w_ratio:.2f}")

if __name__ == "__main__":
    main()
