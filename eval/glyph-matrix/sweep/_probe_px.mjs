import { createCanvas, loadImage } from '@napi-rs/canvas';
const img = await loadImage('C:/tmp/sweep/s0_0.png');
const cv = createCanvas(img.width, img.height); const cx = cv.getContext('2d');
cx.drawImage(img,0,0);
const d = cx.getImageData(0,0,img.width,img.height).data;
console.log(`  image ${img.width}x${img.height}`);
const hist = new Map();
for (let i=0;i<d.length;i+=4){ const v=d[i]; hist.set(v,(hist.get(v)||0)+1); }
console.log('  most common R:', [...hist.entries()].sort((a,b)=>b[1]-a[1]).slice(0,5).map(([v,n])=>`${v}(${n})`).join(' '));
console.log(`  corner px = ${d[0]}  => text is ${d[0]<128?'LIGHT on DARK':'DARK on LIGHT'}`);
for (const [ox,oy,lbl] of [[4,4,'PAD 4,4'],[0,0,'0,0']]) {
  let s=`  cell at ${lbl} (ink = value<128):\n`;
  for(let y=0;y<8;y++){ let r='    '; for(let x=0;x<5;x++){ const o=((oy+y)*img.width+(ox+x))*4; r += d[o]<128?'#':'.'; } s+=r+'\n'; }
  console.log(s);
}
