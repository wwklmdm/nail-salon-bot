const fs = require('fs');

let code = fs.readFileSync('app.js', 'utf8');

// 1. Setup Session imports
code = code.replace(
    /const \{ Bot, InlineKeyboard \} = require\("grammy"\);/,
    `const { Bot, InlineKeyboard, session } = require("grammy");\nconst { MongoDBAdapter } = require("@grammyjs/storage-mongodb");`
);

// 2. Remove old variables
code = code.replace(/const adminSessions = \{\};\n?/g, '');
code = code.replace(/const clientSessions = \{\};[^\n]*\n?/g, '');

// 3. Setup bot.use(session) after bot init
code = code.replace(
    /mongoose\.connect\(MONGO_URI\)\n\s*\.then\(async \(\) => \{/,
    `mongoose.connect(MONGO_URI)\n    .then(async () => {\n        bot.use(session({\n            initial: () => ({ client: {}, admin: {} }),\n            storage: new MongoDBAdapter({ collection: mongoose.connection.collection("sessions") })\n        }));`
);

// 4. Update Schema for portfolioPhotoId and socialLinks
code = code.replace(
    /welcomeTextUz: \{ type: String, default: "(.*?)" \}/,
    `welcomeTextUz: { type: String, default: "$1" },\n    portfolioPhotoId: { type: String, default: "" },\n    socialLinks: { type: [{ name: String, url: String }], default: [] }`
);

// 5. Generic replacements for context-bound session vars
code = code.replace(/if \(\!clientSessions\[(userId|ctx\.from\.id)\]\) clientSessions\[\1\] = \{.*?\};\n?/g, '');
code = code.replace(/if \(\!adminSessions\[(userId|ctx\.from\.id)\]\) adminSessions\[\1\] = \{.*?\};\n?/g, '');

code = code.replace(/clientSessions\[(userId|ctx\.from\.id)\]/g, 'ctx.session.client');
code = code.replace(/adminSessions\[(userId|ctx\.from\.id)\]/g, 'ctx.session.admin');

code = code.replace(/delete ctx\.session\.client;/g, 'ctx.session.client = {};');
code = code.replace(/delete ctx\.session\.admin;/g, 'ctx.session.admin = {};');

// 6. Handle cross-user session access (targetUserId)
// For clientSessions[targetUserId]?.lang
code = code.replace(
    /clientSessions\[targetUserId\]\?\.lang/g,
    `(await mongoose.connection.collection("sessions").findOne({ _id: String(targetUserId) }))?.value?.client?.lang`
);

// For clientSessions[MASTER_CHAT_ID] inside refreshAdminMenu
code = code.replace(
    /const session = clientSessions\[MASTER_CHAT_ID\];/,
    `const sessDoc = await mongoose.connection.collection("sessions").findOne({ _id: String(MASTER_CHAT_ID) });\n    const session = sessDoc?.value?.client;`
);

// For `...Object.keys(clientSessions).map(Number)`
code = code.replace(
    /const allUsers = new Set\(\[\.\.\.userIds, \.\.\.Object\.keys\(clientSessions\)\.map\(Number\)\]\);/,
    `const allSessionDocs = await mongoose.connection.collection("sessions").find({}, { projection: { _id: 1 } }).toArray();\n            const sessionIds = allSessionDocs.map(d => Number(d._id));\n            const allUsers = new Set([...userIds, ...sessionIds]);`
);

// 7. Fix /start command
// We replace the start command logic
code = code.replace(
    /bot\.command\("start", async \(ctx\) => \{[\s\S]*?\/\/ ЕСЛИ ЭТО КЛИЕНТ[\s\S]*?await sendClientMenu\(ctx\);\n    \}\n\}\);/,
    `bot.command("start", async (ctx) => {
    const userIdStr = ctx.from.id.toString();
    console.log(\`✅ Нажат /start. ID: \${userIdStr}\`);
    
    ctx.session.client = {};
    ctx.session.admin = {};
    
    userIds.add(ctx.from.id);

    if (userIdStr === String(MASTER_CHAT_ID)) { 
        const res = await ctx.reply("👨‍💻 <b>Панель управления мастером</b>\\n\\nВыберите действие:", {
            parse_mode: "HTML", 
            reply_markup: getAdminKeyboard()
        });
        
        ctx.session.admin.adminMenuMessageId = res.message_id; 
    } else {
        await sendClientMenu(ctx);
    }
});`
);

fs.writeFileSync('app_refactored.js', code);
console.log('Refactoring script finished. Check app_refactored.js');
