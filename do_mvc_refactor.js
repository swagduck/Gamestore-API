const fs = require('fs');
const path = require('path');

const serverPath = path.join(__dirname, 'server.js');
let serverContent = fs.readFileSync(serverPath, 'utf8');

const rawOrder = fs.readFileSync(path.join(__dirname, 'src/scripts/raw_orderController.js'), 'utf8');
const rawChat = fs.readFileSync(path.join(__dirname, 'src/scripts/raw_chatbotController.js'), 'utf8');
const rawOrderAdmin = fs.readFileSync(path.join(__dirname, 'src/scripts/raw_orderAdminController.js'), 'utf8');

// The original script didn't account for some overlapping markers or trailing code
// Instead of risky regex blocks, let's confidently remove exact blocks.

const cleanServer = () => {
    // Inject at the top safely where routes are defined
    const injectPoint = "const authRoutes = require('./src/routes/authRoutes');";
    if (!serverContent.includes("const orderRoutes = require('./src/routes/orderRoutes');")) {
        serverContent = serverContent.replace(
            injectPoint, 
            `${injectPoint}\nconst orderRoutes = require('./src/routes/orderRoutes');\nconst chatRoutes = require('./src/routes/chatRoutes');`
        );
    }

    const usePoint = "app.use(\"/api/auth\", authRoutes);";
    if (!serverContent.includes("app.use(\"/api\", orderRoutes);")) {
        serverContent = serverContent.replace(
            usePoint,
            `${usePoint}\napp.use("/api", orderRoutes);\napp.use("/api/chat", chatRoutes);`
        );
    }

    // Now remove the exact blocks based on what we see in the raw files
    console.log("Original Server Length:", serverContent.length);

    serverContent = serverContent.replace(rawOrder, "");
    serverContent = serverContent.replace(rawChat, "");
    serverContent = serverContent.replace(rawOrderAdmin, "");
    
    // We also need to strip out `// == Order Routes ==` to `// == User Management Routes (Admin Only) ==` which is in `raw_orderAdminController`

    fs.writeFileSync(serverPath, serverContent);
    console.log("New Server Length:", serverContent.length);
};

cleanServer();
