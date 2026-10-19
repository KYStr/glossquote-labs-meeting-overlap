import { verifyProductionBuild, validateProduction } from './lib/production.mjs';
try { console.log(JSON.stringify(validateProduction(await verifyProductionBuild()), null, 2)); }
catch (error) { console.error(`FAIL production check: ${error.message}`); process.exitCode = 1; }
