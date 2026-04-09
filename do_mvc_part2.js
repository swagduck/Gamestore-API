const fs = require('fs');
const path = require('path');

const serverPath = path.join(__dirname, 'server.js');
let serverContent = fs.readFileSync(serverPath, 'utf8');

const rawUser = fs.readFileSync(path.join(__dirname, 'src/scripts/raw_userController.js'), 'utf8');
const rawAnalytics = fs.readFileSync(path.join(__dirname, 'src/scripts/raw_analyticsController.js'), 'utf8');
const rawNotification = fs.readFileSync(path.join(__dirname, 'src/scripts/raw_notificationController.js'), 'utf8');
const rawDiscount = fs.readFileSync(path.join(__dirname, 'src/scripts/raw_discountController.js'), 'utf8');

const injectPoint = "const chatRoutes = require('./src/routes/chatRoutes');";
if (!serverContent.includes("const userRoutes = require('./src/routes/userRoutes');")) {
    serverContent = serverContent.replace(
        injectPoint, 
        `${injectPoint}
const userRoutes = require('./src/routes/userRoutes');
const analyticsRoutes = require('./src/routes/analyticsRoutes');
const notificationRoutes = require('./src/routes/notificationRoutes');
const discountRoutes = require('./src/routes/discountRoutes');`
    );
}

const usePoint = "app.use(\"/api/chat\", chatRoutes);";
if (!serverContent.includes("app.use(\"/api/users\", userRoutes);")) {
    // Note: authRoutes is mounted at /api/auth in raw_userController, we might need to handle it properly.
    // In server.js, app.use("/api/auth", authRoutes) is around line 1250 maybe.
    
    serverContent = serverContent.replace(
        usePoint,
        `${usePoint}
app.use("/api/users", userRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/discounts", discountRoutes);`
    );
}

console.log("Original Server Length:", serverContent.length);

serverContent = serverContent.replace(rawUser, "");
serverContent = serverContent.replace(rawAnalytics, "");
serverContent = serverContent.replace(rawNotification, "");
serverContent = serverContent.replace(rawDiscount, "");

fs.writeFileSync(serverPath, serverContent);
console.log("New Server Length:", serverContent.length);
