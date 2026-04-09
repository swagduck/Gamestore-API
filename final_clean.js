const fs = require('fs');
const path = require('path');

const serverPath = path.join(__dirname, 'server.js');
let content = fs.readFileSync(serverPath, 'utf8');

const startMarker = '// == Recommendation Route ==';
const endMarker = '// == Authentication Routes ==';

const startIdx = content.indexOf(startMarker);
const endIdx = content.indexOf(endMarker);

if (startIdx !== -1 && endIdx !== -1) {
    console.log("Found both markers!");
    const before = content.substring(0, startIdx);
    const after = content.substring(endIdx);
    content = before + after;
    fs.writeFileSync(serverPath, content);
    console.log("Successfully cleaned!");
} else {
    console.log("Failed to find markers.");
}
