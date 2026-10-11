const fs = require('fs');
const readline = require('readline');
const path = 'C:/Users/gaura/.gemini/antigravity-ide/brain/d71436fc-6981-4bb8-a59c-e9f960f4e11a/.system_generated/logs/transcript.jsonl';
const rl = readline.createInterface({ input: fs.createReadStream(path), crlfDelay: Infinity });

let lineNum = 0;
rl.on('line', (line) => {
  lineNum++;
  if (lineNum >= 7890 && lineNum <= 7905) {
    console.log(`--- Line ${lineNum} ---`);
    try {
      const obj = JSON.parse(line);
      console.log('type:', obj.type, 'source:', obj.source);
      if (obj.tool_calls) console.log('tool_calls:', JSON.stringify(obj.tool_calls).substring(0, 300));
      if (obj.content) console.log('content snippet:', obj.content.substring(0, 300));
    } catch (e) {
      console.log(line.substring(0, 200));
    }
  }
});
