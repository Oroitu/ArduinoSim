import math
import numpy as np

class SimpleSim:
    def __init__(self, config, env_config):
        self.config = config
        self.env_config = env_config
        self.dt = 0.1  # 10Hz simulation step
        # If 'world' is passed via separate key (from vite middleware logic)
        # currently we pass the whole JSON as env_config. so env_config might contain "objects" directly now.
        
        self.reset()

        # Dimensions for Obs
        # N sensors + (servo_angles if any) + v + w
        # Calculate dynamic input dim
        obs_size = 0
        sorted_sensors = sorted(self.config.get("sensors", []), key=lambda s: s["id"])
        for s in sorted_sensors:
             obs_size += 1 # Distance
             if s.get("servoId"):
                 obs_size += 1 # Angle
                 
        self.n_sensors = obs_size # This naming is loose now
        self.obs_dim = obs_size + 2 # For v and w

    def reset(self):
        # 1. World Bounds
        self.width = self.env_config.get("width", 1200)
        self.height = self.env_config.get("height", 800)

        # 2. Start Position
        # Support "startPosition" from web export or legacy "start_position"
        start_pos = self.env_config.get("startPosition", self.env_config.get("start_position", {"x": 100, "y": 400}))
        start_rot = self.env_config.get("startRotation", self.env_config.get("start_theta", 0))

        self.x = start_pos["x"]
        self.y = start_pos["y"]
        self.theta = start_rot
        
        # 3. Randomization
        rand_r = self.env_config.get("random_start_radius", 0)
        if rand_r > 0:
            self.x += np.random.uniform(-rand_r, rand_r)
            self.y += np.random.uniform(-rand_r, rand_r)
            self.x = np.clip(self.x, 20, self.width-20)
            self.y = np.clip(self.y, 20, self.height-20)
            
        rand_theta = self.env_config.get("random_start_theta", 0)
        if rand_theta > 0:
            self.theta += np.random.uniform(-rand_theta, rand_theta)

        self.v = 0.0
        self.w = 0.0
        
        # 4. Obstacles
        # Legacy: "obstacles" list of dicts
        # New: "objects" list of WordObjects
        self.obstacles = self.env_config.get("objects", self.env_config.get("obstacles", []))
        # Filter non-physical or zones if needed? Web sends all.
        # We only care about isPhysical=True
        self.obstacles = [o for o in self.obstacles if o.get("isPhysical", True)] # Default true for legacy

    def step(self, v_target, w_target):
        # Kinematics
        max_v = float(self.env_config.get("max_v", 150.0)) 
        max_w = float(self.env_config.get("max_w", 5.0))
        
        self.v = max(min(v_target, max_v), -max_v)
        self.w = max(min(w_target, max_w), -max_w)
        
        self.x += self.v * math.cos(self.theta) * self.dt
        self.y += self.v * math.sin(self.theta) * self.dt
        self.theta += self.w * self.dt
        self.theta = math.atan2(math.sin(self.theta), math.cos(self.theta))
        
        return self._check_collision()

    def _rotate_point(self, x, y, cx, cy, angle):
        dx = x - cx
        dy = y - cy
        c = math.cos(angle)
        s = math.sin(angle)
        return cx + (dx * c - dy * s), cy + (dx * s + dy * c)

    def _check_collision(self):
        # Circle-Rect Collision matches PhysicsEngine.ts logic
        robot_radius = 20 # approx
        
        # 1. Bounds
        if self.x < robot_radius or self.x > self.width - robot_radius: return True
        if self.y < robot_radius or self.y > self.height - robot_radius: return True

        # 2. Objects
        for obj in self.obstacles:
            if obj.get("type") == "rect":
                # Inverse transform robot to rect local space
                # Rect center
                ox = obj["x"]
                oy = obj["y"]
                rot = obj.get("rotation", 0)
                
                # Rotate robot point relative to rect center by -rot
                local_x, local_y = self._rotate_point(self.x, self.y, ox, oy, -rot)
                
                half_w = obj["width"] / 2
                half_h = obj["height"] / 2
                
                # Closest point on rect (AABB in local space)
                closest_x = max(ox - half_w, min(local_x, ox + half_w))
                closest_y = max(oy - half_h, min(local_y, oy + half_h))
                
                dx = local_x - closest_x
                dy = local_y - closest_y
                
                if (dx*dx + dy*dy) < (robot_radius * robot_radius):
                    return True
                    
            elif obj.get("type") == "circle":
                ox = obj["x"]
                oy = obj["y"]
                r = obj.get("radius", 20)
                dist_sq = (self.x - ox)**2 + (self.y - oy)**2
                if dist_sq < (r + robot_radius)**2:
                    return True

            # TODO: Circuit collision support? 
            # For now circuit is ignored or treated as its bounding rect if type=rect?
            # If type=circuit, we are skipping it (safe fallback).

        return False

    def get_sensor_readings(self):
        readings = []
        # Sort sensors by ID to ensure deterministic order
        sorted_sensors = sorted(self.config.get("sensors", []), key=lambda s: s["id"])
        
        for sensor in sorted_sensors:
            mount = sensor.get("mount", {"x": 0, "y": 0, "rotation": 0})
            
            # Global Pos
            sx = self.x + mount["x"] * math.cos(self.theta) - mount["y"] * math.sin(self.theta)
            sy = self.y + mount["x"] * math.sin(self.theta) + mount["y"] * math.cos(self.theta)
            
            stheta = self.theta + mount["rotation"]
            
            # Simple Servo logic (snapshot) - we assume scanner is at 0 for basic training
            # or randomized? The policy must output command to move servo if it wants?
            # The current environment is simple, it doesn't simulate servo dynamics fully 
            # unless we add 'servo_angle' to state. 
            # For now, assume fixed sensors or centered scanner.
            
            rg = sensor["params"].get("range", 300)
            readings.append(self._raycast(sx, sy, stheta, rg))

            # --- SERVO ANGLE SLOT ---
            # If sensor has servoId, we must append the servo angle to match JS buildObservationVector
            if "servoId" in sensor and sensor["servoId"]:
                readings.append(0.0) # Placeholder 0 for now
            
        return readings

    def _raycast(self, start_x, start_y, angle, max_dist):
        # Ray dir
        dx = math.cos(angle)
        dy = math.sin(angle)
        if abs(dx) < 1e-6: dx = 1e-6
        if abs(dy) < 1e-6: dy = 1e-6

        min_t = max_dist

        # 1. Bounds Intersection
        # x = 0
        t = (0 - start_x) / dx
        if t > 0 and t < min_t: min_t = t
        # x = W
        t = (self.width - start_x) / dx
        if t > 0 and t < min_t: min_t = t
        # y = 0
        t = (0 - start_y) / dy
        if t > 0 and t < min_t: min_t = t
        # y = H
        t = (self.height - start_y) / dy
        if t > 0 and t < min_t: min_t = t

        # 2. Objects Intersection
        # Simplified: Check against bounding circles of objects for speed? 
        # Or do precise line-rect?
        # Let's do a robust Ray-Rect intersection.
        
        for obj in self.obstacles:
            t_hit = None
            
            if obj.get("type") == "rect":
                # Transform Ray to Box Local Space
                ox = obj["x"]
                oy = obj["y"]
                rot = obj.get("rotation", 0)
                
                # Rotate Ray Origin relative to box center
                lx, ly = self._rotate_point(start_x, start_y, ox, oy, -rot)
                
                # Rotate Ray Dir (just angle subtraction)
                # l_angle = angle - rot
                # ldx = math.cos(l_angle) ...
                # Actually simpler: rotate (dx, dy) vector
                ldx = dx * math.cos(-rot) - dy * math.sin(-rot)
                ldy = dx * math.sin(-rot) + dy * math.cos(-rot)
                
                if abs(ldx) < 1e-9: ldx = 1e-9
                if abs(ldy) < 1e-9: ldy = 1e-9

                # AABB check in local space
                # Box extents
                half_w = obj["width"] / 2
                half_h = obj["height"] / 2
                
                # Slab method
                t1 = (ox - half_w - lx) / ldx
                t2 = (ox + half_w - lx) / ldx
                t3 = (oy - half_h - ly) / ldy
                t4 = (oy + half_h - ly) / ldy

                tmin = max(min(t1, t2), min(t3, t4))
                tmax = min(max(t1, t2), max(t3, t4))

                if tmax >= tmin and tmax > 0:
                    # hit
                    # if tmin < 0, origin is inside, t = 0? Or exit?
                    dist = tmin if tmin > 0 else 0
                    t_hit = dist
                    
            elif obj.get("type") == "circle":
                # Ray-Circle
                ox = obj["x"]
                oy = obj["y"]
                r = obj.get("radius", 20)
                
                fx = start_x - ox
                fy = start_y - oy
                a = dx*dx + dy*dy
                b = 2*(fx*dx + fy*dy)
                c = (fx*fx + fy*fy) - r*r
                disc = b*b - 4*a*c
                if disc >= 0:
                    disc = math.sqrt(disc)
                    t1 = (-b - disc) / (2*a)
                    t2 = (-b + disc) / (2*a)
                    if t1 > 0 and t1 < max_dist: t_hit = t1
                    # ignore t2 (exit point) usually
            
            if t_hit is not None and t_hit < min_t:
                min_t = t_hit
                
        return min_t

