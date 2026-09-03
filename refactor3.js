const fs = require('fs');

let code = fs.readFileSync('app.js', 'utf8');

const oldContactsLogic = `    const kb = new InlineKeyboard().text(LANG[lang]?.back || "🔙 Назад", "back_to_start");
    
    const settings = await Settings.findOne() || await Settings.create({});
    
    const textRu = \`📞 **Контакты**\\n\\n📱 Телефон: \${settings.phone}\\n\\n⏰ График: \${settings.schedule}\\n📍 Адрес: \${settings.address}\\n\\n💬 Написать мастеру: @\${settings.masterUsername}\`;
    const textUz = \`📞 **Kontaktlar**\\n\\n📱 Телефон: \${settings.phone}\\n\\n⏰ Ish vaqti: \${settings.schedule}\\n📍 Manzil: \${settings.address}\\n\\n💬 Ustaga yozish: @\${settings.masterUsername}\`;
    
    const text = lang === "ru" ? textRu : textUz;

    // Удаляем старое сообщение с фото
    try { if (ctx.callbackQuery.message) await ctx.deleteMessage(); } catch(e){}

    // Отправляем только текст
    await ctx.reply(text, { parse_mode: "Markdown", reply_markup: kb });`;

const newContactsLogic = `    const settings = await Settings.findOne() || await Settings.create({});
    
    const textRu = \`📞 **Контакты**\\n\\n📱 Телефон: \${settings.phone}\\n\\n⏰ График: \${settings.schedule}\\n📍 Адрес: \${settings.address}\\n\\n💬 Написать мастеру: @\${settings.masterUsername}\`;
    const textUz = \`📞 **Kontaktlar**\\n\\n📱 Телефон: \${settings.phone}\\n\\n⏰ Ish vaqti: \${settings.schedule}\\n📍 Manzil: \${settings.address}\\n\\n💬 Ustaga yozish: @\${settings.masterUsername}\`;
    
    const text = lang === "ru" ? textRu : textUz;

    const kb = new InlineKeyboard();
    
    if (settings.socialLinks && settings.socialLinks.length > 0) {
        for (const link of settings.socialLinks) {
            kb.url(link.name, link.url).row();
        }
    }
    
    kb.text(LANG[lang]?.back || "🔙 Назад", "back_to_start");

    // Удаляем старое сообщение с фото
    try { if (ctx.callbackQuery.message) await ctx.deleteMessage(); } catch(e){}

    // Отправляем только текст
    await ctx.reply(text, { parse_mode: "Markdown", reply_markup: kb, disable_web_page_preview: true });`;

code = code.replace(oldContactsLogic, newContactsLogic);

fs.writeFileSync('app.js', code);
console.log('Refactoring 3 finished.');
