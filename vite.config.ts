import path from 'path';
import fs from 'fs';
import { exec } from 'child_process';
import { defineConfig, loadEnv, Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const customServerPlugin = (): Plugin => ({
  name: 'custom-server-middleware',
  configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      if (req.url === '/api/save-config' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', () => {
          try {
            const configPath = path.resolve(__dirname, 'offline/vehicle_config.json');
            // Ensure format is nice
            const json = JSON.parse(body);
            fs.writeFileSync(configPath, JSON.stringify(json, null, 2));
            res.statusCode = 200;
            res.end(JSON.stringify({ success: true }));
            console.log(`[Server] Saved vehicle config to ${configPath}`);
          } catch (err) {
            console.error(err);
            res.statusCode = 500;
            res.end(JSON.stringify({ error: 'Failed to write config' }));
          }
        });
        return;
      }

      if (req.url === '/api/save-demo' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', () => {
          try {
            const data = JSON.parse(body);
            // Ensure directory exists
            const dataDir = path.resolve(__dirname, 'offline/data');
            if (!fs.existsSync(dataDir)) {
              fs.mkdirSync(dataDir, { recursive: true });
            }

            // Use provided ID or timestamp
            const filename = data.id ? `${data.id}.json` : `demo_${Date.now()}.json`;
            const filePath = path.join(dataDir, filename);

            fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
            res.statusCode = 200;
            res.end(JSON.stringify({ success: true, path: filePath }));
            console.log(`[Server] Saved demo to ${filePath}`);
          } catch (err) {
            console.error(err);
            res.statusCode = 500;
            res.end(JSON.stringify({ error: 'Failed to write demo', details: err.message }));
          }
        });
        return;
      }

      // (Old /api/train-rl handler removed to avoid conflict with trainingMiddleware)

      next();
    });
  }
});

// Middleware with proper async handling for the training route
const trainingMiddleware = (): Plugin => ({
  name: 'training-middleware',
  configureServer(server) {
    server.middlewares.use('/api/train-rl', (req, res, next) => {
      if (req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', () => {
          console.log('[Server] Starting RL Training...');
          let params = { generations: 20, pop_size: 16, alpha: 0.05, lambda_rot: 0.05, world: null };
          try {
            const p = JSON.parse(body);
            params = { ...params, ...p };
          } catch (e) { console.log('Using default params'); }

          // 1. Save World if present
          let envConfigArg = "";
          if (params.world) {
            const worldPath = path.resolve(__dirname, 'offline/envs/active_world.json');
            try {
              // We might need to wrap it in a structure compatible with simple_sim or just pass raw
              // simple_sim expects: { obstacles: [], width, height, ... }
              // WorldState is: { objects, width, height... }
              // We'll translate minimally here or in Python. 
              // Let's dump the whole object and let Python handle the mapping.
              fs.writeFileSync(worldPath, JSON.stringify(params.world, null, 2));
              envConfigArg = `--env_config "${worldPath}"`;
              console.log(`[Server] Saved active world to ${worldPath}`);
            } catch (e) {
              console.error("Failed to save active world", e);
            }
          }

          const scriptPath = path.resolve(__dirname, 'offline/train_rl.py');
          // Add env_config arg if we saved a world
          const command = `python "${scriptPath}" --generations ${params.generations} --pop_size ${params.pop_size} --alpha ${params.alpha} --lambda_rot ${params.lambda_rot} ${envConfigArg}`;

          exec(command, { cwd: __dirname }, (error, stdout, stderr) => {
            // Log output to server console
            if (stdout) console.log(stdout);
            if (stderr) console.error(stderr);

            if (error) {
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ success: false, error: error.message, stderr }));
            } else {
              // Try to parse the result line
              let result = {};
              const match = stdout.match(/__TRAIN_RESULT__:(.*)/);
              if (match && match[1]) {
                try {
                  result = JSON.parse(match[1]);
                } catch (e) {
                  console.error("Failed to parse train result JSON", e);
                }
              }

              res.statusCode = 200;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ success: true, message: "Training Complete", ...result }));
            }
          });
        });
        return;
      } else {
        next();
      }
    });
  }
});

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    server: {
      port: 3000,
      host: '0.0.0.0',
    },
    plugins: [
      react(),
      customServerPlugin(),
      trainingMiddleware()
    ],
    define: {
      'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      }
    }
  };
});
