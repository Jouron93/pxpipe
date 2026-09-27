import fs from 'node:fs';

const raw = fs.readFileSync('C:\\Projects\\pxpipe\\evidence\\benchmark-results.json', 'utf8');
const data = JSON.parse(raw);

const keyConfigs = [
  'Anthropic-Default-Spleen-312x728',
  'Anthropic-Precise-JB14-172x728',
  'OpenAI-Astra-JB14-84x1954',
  'xAI-Grok-Spleen-152x512',
  'Sweep-Cols-152-spleen-5x8',
  'Sweep-Cols-84-spleen-5x8',
];

for (const name of keyConfigs) {
  const evalItem = data.evaluations.find((e) => e.config.name === name);
  if (!evalItem) continue;
  console.log(`\n=== Config: ${name} ===`);
  console.log(`Cols: ${evalItem.config.cols}, MaxH: ${evalItem.config.maxHeightPx}, Font: ${evalItem.config.font}, AA: ${evalItem.config.aa}`);
  console.log(`Total Images: ${evalItem.totalImages}, Total Bytes: ${(evalItem.totalBytes / 1024).toFixed(1)} KB, Latency: ${evalItem.totalLatencyMs.toFixed(1)} ms`);
  console.log('Fixture'.padEnd(25) + 'Imgs'.padStart(6) + 'Bytes (KB)'.padStart(12) + 'Latency (ms)'.padStart(14) + 'Dimensions'.padStart(15));
  console.log('-'.repeat(72));
  for (const f of evalItem.fixtureResults) {
    const dim = `${f.maxImageWidth}x${f.maxImageHeight}`;
    console.log(f.fixtureId.padEnd(25) + String(f.imageCount).padStart(6) + (f.totalBytes / 1024).toFixed(1).padStart(12) + f.latencyMs.toFixed(1).padStart(14) + dim.padStart(15));
  }
}
