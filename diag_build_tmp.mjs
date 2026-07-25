import { build } from 'vite';

async function main() {
  try {
    await build({ configFile: './vite.config.js' });
    console.log("BUILD SUCCEEDED");
  } catch (e) {
    console.log("CAUGHT ERROR:");
    console.log("message:", e && e.message);
    console.log("plugin:", e && e.plugin);
    console.log("id:", e && e.id);
    console.log("loc:", e && JSON.stringify(e.loc));
    console.log("frame:", e && e.frame);
    console.log("stack:", e && e.stack);
  }
  process.exit(0);
}

setTimeout(() => {
  console.log("DIAG TIMEOUT HIT - forcing exit");
  process.exit(2);
}, 32000);

main();
