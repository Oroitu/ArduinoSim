const fs = require('fs');
const path = require('path');

// ============================================================================
// SYNC VEHICLE CONFIG UTILITY
// ============================================================================
// Official way to update the offline trainer configuration.
// Usage: 
//   npm run sync-vehicle-config <path_to_exported_json>
//   node offline/sync_vehicle_config.js <path_to_exported_json>
// 
// This copies the provided JSON to 'offline/vehicle_config.json' which is used by train_rl.py.

const targetPath = path.join(__dirname, 'vehicle_config.json');

const args = process.argv.slice(2);
if (args.length < 1) {
    console.log("Usage: node offline/sync_vehicle_config.js <path_to_exported_json>");
    console.log("Example: node offline/sync_vehicle_config.js C:/Downloads/my_robot_config.json");
    process.exit(1);
}

const sourcePath = args[0];

try {
    const data = fs.readFileSync(sourcePath, 'utf8');
    const json = JSON.parse(data);

    // Validate simple fields
    if (!json.chassis || !json.sensors) {
        console.error("Invalid vehicle config format. Missing chassis or sensors.");
        process.exit(1);
    }

    // Write
    fs.writeFileSync(targetPath, JSON.stringify(json, null, 2));
    console.log(`Successfully updated ${targetPath}`);
    console.log(`Sensors found: ${json.sensors.length}`);

} catch (e) {
    console.error("Error reading/parsing source config:", e.message);
    process.exit(1);
}
