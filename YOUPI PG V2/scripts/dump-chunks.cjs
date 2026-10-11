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
  fs.writeFileSync('scripts/recovered-chunks.json', JSON.stringify(chunks, null, 2), 'utf8');
  console.log('Saved recovered chunks. Total keys:', Object.keys(chunks).length);
});
