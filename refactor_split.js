const fs = require('fs');
const path = require('path');

const serverFile = path.join(__dirname, 'server.js');
let serverContent = fs.readFileSync(serverFile, 'utf8');

// The regions we want to extract
const regions = [
  {
    name: 'orderController',
    markers: ['// == Stripe Checkout Route ==', '// == Chatbot Route (Gemini AI) ==']
  },
  {
    name: 'orderAdminController', // We can combine into order later
    markers: ['// == Order Routes ==', '// == User Management Routes (Admin Only) ==']
  },
  {
    name: 'chatbotController',
    markers: ['// == Chatbot Route (Gemini AI) ==', '// == Order Routes ==']
  },
  {
    name: 'userController',
    markers: ['// == User Management Routes (Admin Only) ==', '// == Analytics Routes ==']
  },
  {
    name: 'analyticsController',
    markers: ['// == Analytics Routes ==', '// == Notification Routes ==']
  },
  {
    name: 'notificationController',
    markers: ['// == Notification Routes ==', '// =========================================================\r\n\r\n// == Discount Routes']
  },
  {
    name: 'discountController',
    markers: ['// == Discount Routes (Admin only) ==', '// =========================================================\r\n\r\n// --- Global Error']
  }
];

// Verify we can find everything
for (const region of regions) {
  const startIdx = serverContent.indexOf(region.markers[0]);
  let endIdx = -1;
  
  if (region.markers[1]) {
    endIdx = serverContent.indexOf(region.markers[1]);
  }
  
  if (startIdx === -1) {
    console.log(`❌ Could not find start marker for ${region.name}: ${region.markers[0].substring(0, 30)}...`);
  } else if (endIdx === -1 && region.markers[1]) {
    console.log(`❌ Could not find end marker for ${region.name}: ${region.markers[1].substring(0, 30)}...`);
  } else {
    // Write out the raw code block just to verify format
    const content = serverContent.substring(startIdx, endIdx !== -1 ? endIdx : undefined);
    fs.writeFileSync(path.join(__dirname, `src/scripts/raw_${region.name}.js`), content);
    console.log(`✅ Extracted ${region.name} (${content.length} chars)`);
  }
}

console.log("Done checking markers.");
