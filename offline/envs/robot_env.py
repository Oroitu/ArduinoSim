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
    def __init__(self, env_config, vehicle_config):
        self.env_config = env_config
        self.vehicle_config = vehicle_config
        
        self.sim = SimpleSim(vehicle_config, env_config)
        
        # Dimensions for Obs
        # N sensors + v + w
        self.n_sensors = len(vehicle_config.get("sensors", []))
        self.obs_dim = self.n_sensors + 2 
        
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
        # Normalize? Using raw for now to match current pipeline,
        # but scaler will handle it in training script.
        
        # Add velocity state (normalized or raw? match buildObservationVector in TS)
        # In TS: buildObservationVector(..., v, w) adds raw v, w.
        # We should match that.
        
        obs = readings + [self.sim.v, self.sim.w]
        return np.array(obs, dtype=np.float32)

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
