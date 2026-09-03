const fs = require('fs');

let code = fs.readFileSync('app.js', 'utf8'); // Wait, we should read from app_refactored.js since it has the DB sessions! No, we read app_refactored.js

// But actually, let's use app_refactored.js
code = fs.readFileSync('app.js', 'utf8');

// 1. Add buttons for Portfolio Photo and Social Links in getSettingsMenuTextAndKeyboard
code = code.replace(
    /\.text\("📸 Изменить 'Наши работы'", "edit_portfolioText"\)\.row\(\)/,
    `.text("📸 Изменить 'Наши работы' (текст)", "edit_portfolioText").row()\n        .text("🖼 Фото портфолио", "edit_portfolioPhoto").row()\n        .text("🌐 Социальные сети", "manage_socials").row()`
);

// 2. Add handlers for edit_portfolioPhoto and manage_socials
// Add these to the end of the callback handlers or replace a chunk.
const additionalAdminHandlers = `
bot.callbackQuery("edit_portfolioPhoto", async (ctx) => {
    await ctx.answerCallbackQuery().catch(()=>{});
    ctx.session.client.awaitingSettingUpdate = "portfolioPhotoId";
    const kb = new InlineKeyboard().text("🔙 Отмена", "cancel_setting_update");
    try { await ctx.deleteMessage(); } catch(e){}
    await ctx.reply("🖼 Отправьте новую фотографию для раздела «Наши работы»:", { reply_markup: kb });
});

bot.callbackQuery("manage_socials", async (ctx) => {
    await ctx.answerCallbackQuery().catch(()=>{});
    const settings = await Settings.findOne() || {};
    const links = settings.socialLinks || [];
    
    let text = "🌐 <b>Управление социальными сетями</b>\\n\\n";
    if (links.length === 0) text += "Нет добавленных ссылок.";
    else {
        links.forEach((l, i) => {
            text += \`\${i+1}. \${l.name} - \${l.url}\\n\`;
        });
    }
    
    const kb = new InlineKeyboard();
    if (links.length < 5) {
        kb.text("➕ Добавить ссылку", "add_social_link").row();
    }
    if (links.length > 0) {
        kb.text("➖ Удалить ссылку", "del_social_link").row();
    }
    kb.text("🔙 Назад к настройкам", "back_to_settings_menu");
    
    try { await ctx.deleteMessage(); } catch(e){}
    await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb, disable_web_page_preview: true });
});

bot.callbackQuery("add_social_link", async (ctx) => {
    await ctx.answerCallbackQuery().catch(()=>{});
    ctx.session.client.awaitingSettingUpdate = "newSocialLink";
    const kb = new InlineKeyboard().text("🔙 Отмена", "manage_socials");
    try { await ctx.editMessageText("Отправьте название и ссылку через пробел (например: Instagram https://instagram.com/myacc)", { reply_markup: kb }); } catch(e){}
});

bot.callbackQuery("del_social_link", async (ctx) => {
    await ctx.answerCallbackQuery().catch(()=>{});
    ctx.session.client.awaitingSettingUpdate = "deleteSocialLink";
    const kb = new InlineKeyboard().text("🔙 Отмена", "manage_socials");
    try { await ctx.editMessageText("Отправьте номер ссылки из списка для удаления:", { reply_markup: kb }); } catch(e){}
});
`;

code = code.replace(
    /bot\.callbackQuery\(\["edit_phone", "edit_schedule"[\s\S]*?cancel_setting_update"\);/,
    match => additionalAdminHandlers + "\n" + match
);

// 3. Update the message:text handler for portfolioPhotoId and newSocialLink
// In the text handler, we need to handle photo uploads for portfolioPhotoId.
// Wait, bot.on("message:text") doesn't trigger on photos! We need to handle photos in bot.on("message:photo")
const photoHandlerLogic = `
bot.on("message:photo", async (ctx) => {
    const userId = ctx.from.id;
    if (ctx.session?.client?.awaitingSettingUpdate === "portfolioPhotoId") {
        const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
        await Settings.updateOne({}, { portfolioPhotoId: fileId }, { upsert: true });
        delete ctx.session.client.awaitingSettingUpdate;
        await ctx.reply("✅ Фото для портфолио успешно обновлено!", { reply_markup: getAdminKeyboard() });
    }
    if (ctx.session?.client?.awaitingSettingUpdate === "mainMenuPhoto") {
        const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
        await Settings.updateOne({}, { mainMenuPhoto: fileId }, { upsert: true });
        delete ctx.session.client.awaitingSettingUpdate;
        await ctx.reply("✅ Фото главного меню обновлено!", { reply_markup: getAdminKeyboard() });
    }
});
`;

code = code.replace(
    /bot\.on\("message:text", async \(ctx, next\) => \{/,
    match => photoHandlerLogic + "\n" + match
);

// 4. In text handler, handle newSocialLink and deleteSocialLink
const socialLogic = `
        if (clientSession.awaitingSettingUpdate === "newSocialLink") {
            const parts = text.split(" ");
            if (parts.length < 2) {
                return await ctx.reply("❌ Отправьте название и ссылку через пробел!");
            }
            const name = parts[0];
            const url = parts.slice(1).join(" ");
            const settings = await Settings.findOne() || {};
            if ((settings.socialLinks || []).length >= 5) {
                delete clientSession.awaitingSettingUpdate;
                return await ctx.reply("❌ Максимум 5 ссылок!", { reply_markup: getAdminKeyboard() });
            }
            await Settings.updateOne({}, { $push: { socialLinks: { name, url } } }, { upsert: true });
            delete clientSession.awaitingSettingUpdate;
            return await ctx.reply("✅ Ссылка добавлена!", { reply_markup: getAdminKeyboard() });
        }
        if (clientSession.awaitingSettingUpdate === "deleteSocialLink") {
            const index = parseInt(text) - 1;
            const settings = await Settings.findOne() || {};
            const links = settings.socialLinks || [];
            if (isNaN(index) || index < 0 || index >= links.length) {
                return await ctx.reply("❌ Неверный номер!");
            }
            links.splice(index, 1);
            await Settings.updateOne({}, { socialLinks: links }, { upsert: true });
            delete clientSession.awaitingSettingUpdate;
            return await ctx.reply("✅ Ссылка удалена!", { reply_markup: getAdminKeyboard() });
        }
`;

code = code.replace(
    /if \(clientSession\.awaitingSettingUpdate\) \{/,
    match => "if (clientSession.awaitingSettingUpdate) {\n" + socialLogic
);


fs.writeFileSync('app_refactored_2.js', code);
console.log('Refactoring 2 finished.');
