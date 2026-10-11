const fs = require('fs');
const readline = require('readline');
const path = 'C:/Users/gaura/.gemini/antigravity-ide/brain/d71436fc-6981-4bb8-a59c-e9f960f4e11a/.system_generated/logs/transcript_full.jsonl';
const rl = readline.createInterface({ input: fs.createReadStream(path), crlfDelay: Infinity });
const chunks = {};

rl.on('line', (line) => {
  if (line.includes('coin-wallet-store/src/store.html') && line.includes('VIEW_FILE')) {
    try {
      const obj = JSON.parse(line);
      if (obj.content && obj.content.includes('Total Lines: 2022')) {
        const lines = obj.content.split('\n');
        for (const l of lines) {
          const lm = l.match(/^(\d+):(.*)$/);
          if (lm) {
            let val = lm[2];
            if (val.startsWith(' ')) val = val.substring(1);
            chunks[parseInt(lm[1])] = val.replace(/\r$/, '');
          }
        }
      }
    } catch(e) {}
  }
});

rl.on('close', () => {
  let cssText = '';
  for (let i = 12; i <= 700; i++) if (chunks[i]) cssText += chunks[i] + '\n';
  for (let i = 1050; i <= 1104; i++) if (chunks[i]) cssText += chunks[i] + '\n';
  
  let htmlText = '';
  for (let i = 1107; i <= 1845; i++) if (chunks[i]) htmlText += chunks[i] + '\n';

  const classRegex = /class=["']([^"']+)["']/g;
  const classes = new Set();
  let m;
  while ((m = classRegex.exec(htmlText)) !== null) {
    m[1].split(/\s+/).forEach(c => c && classes.add(c));
  }

  const unstyled = [];
  classes.forEach(c => {
    if (!cssText.includes('.' + c)) {
      unstyled.push(c);
    }
  });
  console.log('Total classes in HTML:', classes.size);
  console.log('Unstyled classes count:', unstyled.length);
  console.log('Unstyled classes:', unstyled);
});
