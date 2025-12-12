import numpy as np
import math
from .simple_sim import SimpleSim

class RobotEnv:
    """
    RL Environment for Robot Mobility.
    Scope: 
    - Task: MOBILITY (navigate, avoid obstacles).
    - Sensors: Distance sensors (lidar/ultrasonic) + abstract state (v, w).
    - Note: This spec assumes distance-based sensing. Other sensors (line, IMU) require spec extensions.
    """
    def __init__(self, env_config, vehicle_config, scaler=None):
        self.env_config = env_config
        self.vehicle_config = vehicle_config
        self.scaler = scaler # Expects { "mean": [], "std": [] }
        
        self.sim = SimpleSim(vehicle_config, env_config)
        
        # Dimensions for Obs
        # N sensors + (servo_angles if any) + v + w
        # Calculate dynamic input dim
        obs_size = 0
        sorted_sensors = sorted(self.vehicle_config.get("sensors", []), key=lambda s: s["id"])
        for s in sorted_sensors:
             obs_size += 1 # Distance
             if s.get("servoId"):
                 obs_size += 1 # Angle
                 
        self.n_sensors = obs_size # This naming is loose now
        self.obs_dim = obs_size + 2 
        
        # Action dim: v_norm, w_norm
        self.act_dim = 2
        
        # Reward Config
        self.behavior = env_config.get("behavior", "MOVILIDAD")
        self.rewards = env_config.get("reward_params", {})
        
        self.max_steps = env_config.get("max_steps", 500)
        self.current_step = 0
        
        # History for reward calc
        self.last_pos = None

    def reset(self):
        self.sim.reset()
        self.current_step = 0
        self.last_pos = (self.sim.x, self.sim.y)
        return self._get_obs()

    def step(self, action):
        # Action is [v_norm, w_norm] in [-1, 1] usually (tanh)
        v_norm, w_norm = action
        
        # Map to physical values
        max_v = float(self.env_config.get("max_v", 50.0))
        max_w = float(self.env_config.get("max_w", 2.0))
        
        v = v_norm * max_v
        w = w_norm * max_w
        
        # Sim step
        collision = self.sim.step(v, w)
        self.current_step += 1
        
        # Obs
        obs = self._get_obs()
        
        # Calc Reward
        reward = self._calculate_reward(v, w, collision)
        
        # Done condition
        done = False
        if collision:
            done = True
        if self.current_step >= self.max_steps:
            done = True
            
        return obs, reward, done, self._get_info(v, w)

    def _get_obs(self):
        readings = self.sim.get_sensor_readings()
        
        # Add velocity state (normalized or raw? match buildObservationVector in TS)
        # In TS: buildObservationVector(..., v, w) adds raw v, w.
        
        obs_list = readings + [self.sim.v, self.sim.w]
        obs = np.array(obs_list, dtype=np.float32)
        
        # Apply Normalization if scaler is present
        if self.scaler:
            mean = np.array(self.scaler["mean"], dtype=np.float32)
            std = np.array(self.scaler["std"], dtype=np.float32)
            # Clip std to avoid div/0
            std = np.where(std < 1e-6, 1.0, std)
            
            # Ensure dimensions match
            if obs.shape[0] == mean.shape[0]:
                 obs = (obs - mean) / std
        
        return obs

    def _calculate_reward(self, v, w, collision):
        # Base implementation for MOVILIDAD
        
        # Params
        alpha = self.rewards.get("alpha_dist", 1.0)
        beta  = self.rewards.get("beta_time", 0.01)
        gamma = self.rewards.get("gamma_coll", 100.0)
        
        # 1. Distance Progress
        dx = self.sim.x - self.last_pos[0]
        dy = self.sim.y - self.last_pos[1]
        dist_traveled = math.sqrt(dx*dx + dy*dy)
        self.last_pos = (self.sim.x, self.sim.y)
        
        # 2. Collision
        coll_penalty = gamma if collision else 0.0
        
        # 3. Time penalty (encourage speed)
        time_penalty = beta
        
        reward = (alpha * dist_traveled) - time_penalty - coll_penalty
        
        # 4. Rotation Penalty (discourage spinning in place)
        # Check if we have a lambda for this
        lambda_rot = self.rewards.get("lambda_rot", 0.0) 
        if lambda_rot > 0:
            reward -= lambda_rot * abs(w)

        # Extra: Encourage forward motion?
        if v < 0:
            reward -= 0.1 # Penalize moving backwards slightly
            
        return reward

    def _get_info(self, v, w):
        return {
            "v": v,
            "w": w
        }
