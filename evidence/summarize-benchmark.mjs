import fs from 'node:fs';

const raw = fs.readFileSync('C:\\Projects\\pxpipe\\evidence\\benchmark-results.json', 'utf8');
const data = JSON.parse(raw);

console.log('Total evaluations:', data.evaluations.length);
data.evaluations.sort((a, b) => b.score - a.score);

console.log('Name'.padEnd(38) + 'Score'.padStart(7) + 'Imgs'.padStart(6) + 'Bytes (KB)'.padStart(12) + 'Latency (ms)'.padStart(14) + 'Dropped'.padStart(9));
console.log('-'.repeat(86));

for (const e of data.evaluations) {
  const name = e.config.name.padEnd(38);
  const score = e.score.toFixed(1).padStart(7);
  const imgs = String(e.totalImages).padStart(6);
  const kb = (e.totalBytes / 1024).toFixed(1).padStart(12);
  const lat = e.totalLatencyMs.toFixed(1).padStart(14);
  const dropped = String(e.totalDroppedChars).padStart(9);
  console.log(`${name}${score}${imgs}${kb}${lat}${dropped}`);
}
