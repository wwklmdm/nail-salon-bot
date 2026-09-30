process.env.TZ = "Asia/Tashkent";
const { Bot, InlineKeyboard } = require("grammy");
const cron = require("node-cron");
const mongoose = require("mongoose");

// ==========================================
// 1. МОДЕЛИ И СХЕМЫ БАЗЫ ДАННЫХ MONGODB
// ==========================================

const bookingSchema = new mongoose.Schema({
    userId: { type: Number, required: true },
    clientName: { type: String, required: true },
    username: { type: String, default: "" },

    serviceKey: { type: String, required: true },
    serviceNameRu: { type: String, default: "" },
    serviceNameUz: { type: String, default: "" },
    price: { type: String, default: "" },

    date: { type: String },
    dateText: { type: String, required: true },
    time: { type: String, required: true },

    
    status: { type: String, default: "pending" },

// Информация об отмене
reason: { type: String, default: "" },
cancelledBy: { type: String, default: "" },
cancelledAt: { type: Date },

reminderSent: { type: Boolean, default: false },
pendingMessageId: { type: Number },
adminMessageId: { type: Number }
});

const Booking = mongoose.model("Booking", bookingSchema);
const settingsSchema = new mongoose.Schema({
    masterUsername: { type: String, default: "wwkmldm" },
    phone: { type: String, default: "+998 90 123 45 67" },
    schedule: { type: String, default: "10:00 - 20:00 (Без выходных)" },
    instagram: { type: String, default: "https://instagram.com/" },
    address: { type: String, default: "г. Ташкент, ул. Амира Темура, 1" },
    addressPhoto: { type: String, default: "" },
    aboutText: { type: String, default: "Добро пожаловать в наш салон! Мы делаем лучший маникюр." },
    portfolioText: { type: String, default: "📸 Наши работы\nДля просмотра переходите в Instagram! ✨" },
    
    // 👇 ВОТ ТРИ НОВЫЕ СТРОЧКИ ДЛЯ ГЛАВНОГО МЕНЮ 👇
    mainMenuPhoto: { type: String, default: "" }, 
    welcomeTextRu: { type: String, default: "Привет, {name}! 👋\nДобро пожаловать в нашу студию.\nВыберите нужный раздел:" },
    welcomeTextUz: { type: String, default: "Salom, {name}! 👋\nBizning studiyamizga xush kelibsiz.\nKerakli bo'limni tanlang:" }
}); 
const Settings = mongoose.model("Settings", settingsSchema);
const serviceSchema = new mongoose.Schema({
    key: { type: String, required: true, unique: true },
    name: {
        ru: { type: String, required: true },
        uz: { type: String, required: true }
    },
    price: { type: String, required: true },
    description: {
        ru: { type: String, default: "" },
        uz: { type: String, default: "" }
    },
    image: { type: String, default: "" },
    isActive: { type: Boolean, default: true }
});
const Service = mongoose.model("Service", serviceSchema);

// ==========================================
// 2. ИНИЦИАЛИЗАЦИЯ И ПОДКЛЮЧЕНИЕ К БАЗЕ
// ==========================================

async function initDatabase() {
    try {
        const settingsCount = await Settings.countDocuments();
        if (settingsCount === 0) {
            await Settings.create({
                masterUsername: "wwkmldm",
                phone: "+998 90 123 45 67",
                schedule: "10:00 - 20:00 (Без выходных)",
                instagram: "https://instagram.com/",
                address: "г. Ташкент, ул. Амира Темура, 1"
            });
            console.log("ℹ️ Начальные настройки салона успешно созданы в MongoDB.");
        }
        // Перенос из старого хардкода удален, чтобы избежать крашей
    } catch (err) {
        console.error("❌ Ошибка при инициализации базы данных:", err);
    }
}

const DB_USER = "baxtiyorovusmon30_db_user";
const DB_PASS = encodeURIComponent("7MSV5O9ttCpiZCHL");
const MONGO_URI = `mongodb+srv://${encodeURIComponent(DB_USER)}:${encodeURIComponent(DB_PASS)}@cluster0.wdiu32k.mongodb.net/salon_db?retryWrites=true&w=majority&appName=Cluster0`;
const BOT_TOKEN = "8944042117:AAHnkgvHQrggD-6-JeQmt6RQN2zwyhAMFIA";
const MASTER_CHAT_ID = "1459629617";
const bot = new Bot(BOT_TOKEN);

mongoose.connect(MONGO_URI)
    .then(async () => {
        console.log("✅ Успешно подключено к облачной базе MongoDB Atlas!");
        await initDatabase();
        bot.start({
            onStart: (botInfo) => {
                console.log(`🤖 Бот @${botInfo.username} успешно запущен и слушает Telegram!`);
            }
        });
    })
    .catch(err => {
        console.error("❌ Ошибка подключения к MongoDB Atlas:", err.message);
    });

// ==========================================
// 3. ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ (СЕССИИ)
// ==========================================
const adminSessions = {};
const clientSessions = {}; // Заранее объявляем для клиентской части
// ==========================================
// КОМАНДА /start 
// ==========================================
bot.command("start", async (ctx) => {
    const userIdStr = ctx.from.id.toString();
    console.log(`✅ Нажат /start. ID: ${userIdStr}`);
    
    userIds.add(ctx.from.id);

    // ЕСЛИ ЭТО МАСТЕР
    if (userIdStr === String(MASTER_CHAT_ID)) { 
        // Мы убрали ctx.deleteMessage() отсюда
        
        const res = await ctx.reply("👨‍💻 <b>Панель управления Мастера</b>\n\nВыберите действие:", {
            parse_mode: "HTML", 
            reply_markup: getAdminKeyboard()
        });
        
        if (!clientSessions[ctx.from.id]) clientSessions[ctx.from.id] = {};
        clientSessions[ctx.from.id].adminMenuMessageId = res.message_id; 
    } 
    // ЕСЛИ ЭТО КЛИЕНТ
    else {
        // Мы убрали ctx.deleteMessage() и отсюда
        await sendClientMenu(ctx);
    }
});
// ==========================================
// ЕДИНЫЙ ОБРАБОТЧИК ТЕКСТОВЫХ СООБЩЕНИЙ 
// (Клиенты + Админ + Настройки + Рассылка)
// ==========================================
bot.on("message:text", async (ctx, next) => {
    // 1. Игнорируем команды (например, /start), чтобы они не дублировались
if (ctx.message?.text?.startsWith("/")) return await next();
    const userId = ctx.from.id;
    const text = ctx.message.text;
    
    // Получаем обе сессии
    const clientSession = clientSessions[userId];
    const adminSession = adminSessions[userId];

    // =========================================================
    // ЧАСТЬ 1: ЛОГИКА CLIENT SESSION (Настройки, Имя, Рассылка)
    // =========================================================
    if (clientSession) {
        
        // --- 1.1 ВВОД НОВЫХ НАСТРОЕК МАСТЕРОМ ---
        if (clientSession.awaitingSettingUpdate) {
            const settingKey = clientSession.awaitingSettingUpdate;
            let newValue = text;

            if (settingKey === "masterUsername" && newValue.startsWith("@")) {
                newValue = newValue.substring(1);
            }

            try {
                await Settings.updateOne({}, { [settingKey]: newValue });

                if (clientSession.settingPromptMessageId) {
                    try { await bot.api.deleteMessage(ctx.chat.id, clientSession.settingPromptMessageId); } catch(e){}
                }
                try { await ctx.deleteMessage(); } catch(e){}

                delete clientSession.awaitingSettingUpdate;
                delete clientSession.settingPromptMessageId;

                // Если у тебя есть функция getSettingsMenuTextAndKeyboard, раскомментируй следующие строки:
                /* 
                const { text: menuText, kb } = await getSettingsMenuTextAndKeyboard();
                await ctx.reply(`✅ <b>Успешно обновлено!</b>\n\n${menuText}`, { 
                    parse_mode: "HTML", 
                    reply_markup: kb 
                });
                */
                // Временно ставим базовый ответ на случай отсутствия функции:
                await ctx.reply("✅ <b>Настройка успешно обновлена!</b>", { parse_mode: "HTML", reply_markup: getAdminKeyboard() });

            } catch (err) {
                console.error("Ошибка при обновлении настройки:", err);
                await ctx.reply("❌ Ошибка при сохранении. Попробуйте еще раз.", { reply_markup: getAdminKeyboard() });
            }
            return; 
        }
        
        // --- 1.2 ОТПРАВКА СООБЩЕНИЯ ОТ МАСТЕРА КЛИЕНТУ ---
        if (clientSession.awaitingMasterMessage) {
            const bId = clientSession.awaitingMasterMessage;
            let booking = null;
            try {
                booking = await Booking.findById(bId);
            } catch (err) { console.error("Ошибка при поиске записи:", err); }
            
            if (booking) {
                const targetUserId = booking.userId;
                try {
                    const userLang = clientSessions[targetUserId]?.lang || "ru";
                    const notification = userLang === "ru" 
                        ? `📩 **Сообщение от мастера!**\n\n💬 ${text}`
                        : `📩 **Ustadan xabar!**\n\n💬 ${text}`;
                    
                    const settings = await Settings.findOne();
                    const masterUsername = settings ? settings.masterUsername : "wwkmldm"; 
                    
                    const kbClientReply = new InlineKeyboard().url(
                        userLang === "ru" ? "✍️ Написать мастеру" : "✍️ Ustaga yozish", 
                        `https://t.me/${masterUsername}`
                    );
                        
                    await bot.api.sendMessage(targetUserId, notification, { parse_mode: "Markdown", reply_markup: kbClientReply });
                    
                    const successMsg = await ctx.reply(`✅ Сообщение успешно доставлено клиенту **${booking.clientName}**!`);
                    setTimeout(async () => {
                        try { await bot.api.deleteMessage(ctx.chat.id, successMsg.message_id); } catch(e){}
                    }, 30000);
                    
                } catch (e) {
                    await ctx.reply("❌ Ошибка при отправке. Возможно, клиент заблокировал бота.");
                }
            } else {
                const errorMsg = await ctx.reply("❌ Запись не найдена в базе данных, отправка отменена.");
                setTimeout(async () => {
                    try { await bot.api.deleteMessage(ctx.chat.id, errorMsg.message_id); } catch(e){}
                }, 5000);
            }
            
            if (clientSession.msgPromptId) {
                try { await bot.api.deleteMessage(ctx.chat.id, clientSession.msgPromptId); } catch(e){}
            }
            try { await ctx.deleteMessage(); } catch(e){} 
            
            delete clientSession.awaitingMasterMessage;
            delete clientSession.msgPromptId;
            return; 
        }

        // --- 1.3 ОБРАБОТКА РАССЫЛКИ МАСТЕРА ---
        if (userId.toString() === String(MASTER_CHAT_ID) && clientSession.awaitingBroadcast) {
            clientSession.awaitingBroadcast = false; 
            
            try { await ctx.deleteMessage(); } catch(e){}
            
            if (clientSession.adminMenuMessageId) {
                try { await bot.api.deleteMessage(MASTER_CHAT_ID, clientSession.adminMenuMessageId); } catch(e){}
            }
            
           const now = getTashkentNow();
const dateStr = `${now.dateText} ${String(now.hours).padStart(2, "0")}:${String(now.minutes).padStart(2, "0")}`;
            broadcastHistory.unshift({ text: text, date: dateStr });
            if (broadcastHistory.length > 10) broadcastHistory.pop(); 

            const allUsers = new Set([...userIds, ...Object.keys(clientSessions).map(Number)]);

            let successCount = 0; let failCount = 0;
            for (const uId of allUsers) {
                if (!uId || isNaN(uId) || uId.toString() === String(MASTER_CHAT_ID)) continue; 
                try {
                    await bot.api.sendMessage(uId, `📢 **Сообщение от мастера:**\n\n${text}`, { parse_mode: "Markdown" });
                    successCount++;
                } catch (e) { failCount++; }
            }
            
            const reportMsg = `✅ **Вы успешно сделали рассылку!**\n\nДоставлено клиентам: ${successCount}\nЗаблокировали бота: ${failCount}\n\n_Все рассылки находятся в истории рассылок._`;
            const res = await ctx.reply(reportMsg, { parse_mode: "Markdown", reply_markup: getAdminKeyboard() });
            clientSession.adminMenuMessageId = res.message_id; 
            return;
        }

        // --- 1.4 ОБРАБОТКА ВВОДА ИМЕНИ КЛИЕНТА (ЗАПИСЬ) ---
        if (clientSession.awaitingName) {
            clientSession.awaitingName = false;
            const lang = clientSession.lang || "ru";
            try { await ctx.deleteMessage(); } catch(e){} 

     let serviceNameClient = lang === "ru" ? "Услуга" : "Xizmat";
let serviceNameAdmin = "Услуга";
let servicePrice = "";

try {
    const service = await Service.findOne({ key: clientSession.serviceKey });

    if (service) {
        serviceNameClient = service.name?.[lang] || service.name?.ru || serviceNameClient;
        serviceNameAdmin = service.name?.ru || serviceNameAdmin;
        servicePrice = service.price || "";
    }
} catch (err) {
    console.error("Ошибка при поиске услуги:", err);
}
const newBooking = new Booking({
    userId: userId,
    clientName: text,
    username: ctx.from.username ? `@${ctx.from.username}` : "Скрыт",

    serviceKey: clientSession.serviceKey,
    serviceNameRu: serviceNameAdmin,
    serviceNameUz: serviceNameClient,
    price: servicePrice,

    date: clientSession.date,
    dateText: clientSession.dateText,
    time: clientSession.time,

    status: "pending",
    reminderSent: false
});        await newBooking.save();
            const bookingId = newBooking._id.toString();

            if (clientSession.menuMessageId) {
                try { await bot.api.deleteMessage(userId, clientSession.menuMessageId); } catch(e){}
            }

            const minimalKb = new InlineKeyboard()
                .text(lang === "ru" ? "🏠 В главное меню" : "🏠 Asosiy menyuga", "back_to_start").row()
                .text(lang === "ru" ? "Забронировать еще" : " Yana band qilish", "view_all_services").row()
               // .text(lang === "ru" ? "📅 Мои записи" : "📅 Mening yozuvlarim", "view_my_bookings");
                
            const textMenu = lang === "ru" ? "✨ Что делать дальше?" : "✨ Keyin nima qilamiz?";
            const sentMenu = await bot.api.sendMessage(userId, textMenu, {
                parse_mode: "Markdown", 
                reply_markup: minimalKb
            });
            
            clientSession.menuMessageId = sentMenu.message_id;
            clientSession.currentImage = imgSuccess;

            if (clientSession.cancellationMessageId) {
                try { 
                    await bot.api.deleteMessage(userId, clientSession.cancellationMessageId); 
                    delete clientSession.cancellationMessageId; 
                } catch(e) {}
            }

            const successMsg = lang === "ru"
                ? `⏳ **Ваша заявка отправлена мастеру!**\n\n👤 Имя: ${text}\n💅 Услуга: ${serviceNameClient}\n📅 Дата: ${clientSession.dateText}\n⏰ Время: ${clientSession.time}\n\nОжидайте подтверждения!`
                : `⏳ **Sizning arizangiz ustaga yuborildi!**\n\n👤 Ism: ${text}\n💅 Xizmat: ${serviceNameClient}\n📅 Sana: ${clientSession.dateText}\n⏰ Vaqt: ${clientSession.time}\n\nTasdiqlashni kuting!`;

            const pendingMsg = await bot.api.sendMessage(userId, successMsg, { parse_mode: "Markdown" });
            newBooking.pendingMessageId = pendingMsg.message_id;

            try {
                const masterKb = new InlineKeyboard()
                    .text("✅ Подтвердить", `admin_conf_${bookingId}`).row()
                    .text("❌ Отклонить", `admin_rej_${bookingId}`);
                    
                const adminMsg = `🔔 **НОВАЯ ЗАЯВКА!**\n\n👤 Имя: **${text}**\n🔗 ТГ: ${ctx.from.first_name} (${newBooking.username})\n💅 Услуга: ${serviceNameAdmin}\n📅 Дата: ${clientSession.dateText}\n🕐 Время: ${clientSession.time}`;
                
                const sentToAdmin = await bot.api.sendMessage(MASTER_CHAT_ID, adminMsg, { parse_mode: "Markdown", reply_markup: masterKb });
                
                newBooking.adminMessageId = sentToAdmin.message_id; 
                await newBooking.save();
            } catch (e) {}
            
            return;
        }
    }

    // =========================================================
    // ЧАСТЬ 2: ЛОГИКА ADMIN SESSION (Добавление/редакт услуг)
    // =========================================================
    if (adminSession) {
        const kbCancel = new InlineKeyboard().text("❌ Отмена", "cancel_admin_action");

        // --- БЛОК 2.1: РЕДАКТИРОВАНИЕ СУЩЕСТВУЮЩЕЙ УСЛУГИ ---
        if (adminSession.action === "editing_price") {
            try {
                await Service.findByIdAndUpdate(adminSession.serviceId, { price: text });
                const savedId = adminSession.serviceId;
                delete adminSessions[userId];
                const kb = new InlineKeyboard().text("🔙 Вернуться к услуге", `edit_srv_${savedId}`);
                return ctx.reply("✅ <b>Цена успешно обновлена!</b>", { parse_mode: "HTML", reply_markup: kb });
            } catch (e) { return ctx.reply("❌ Произошла ошибка при обновлении цены."); }
        }

        if (adminSession.action === "editing_name_ru") {
            adminSession.tempNameRu = text;
            adminSession.action = "editing_name_uz";
            return ctx.reply("📝 Отлично! Теперь введите новое <b>НАЗВАНИЕ</b> на <b>УЗБЕКСКОМ</b> языке:", { parse_mode: "HTML", reply_markup: kbCancel });
        }
        
        if (adminSession.action === "editing_name_uz") {
            try {
                await Service.findByIdAndUpdate(adminSession.serviceId, { "name.ru": adminSession.tempNameRu, "name.uz": text });
                const savedId = adminSession.serviceId;
                delete adminSessions[userId];
                const kb = new InlineKeyboard().text("🔙 Вернуться к услуге", `edit_srv_${savedId}`);
                return ctx.reply("✅ <b>Название успешно обновлено!</b>", { parse_mode: "HTML", reply_markup: kb });
            } catch (e) { return ctx.reply("❌ Ошибка при обновлении названия."); }
        }

        if (adminSession.action === "editing_desc_ru") {
            adminSession.tempDescRu = text;
            adminSession.action = "editing_desc_uz";
            return ctx.reply("📝 Отлично! Теперь введите новое <b>ОПИСАНИЕ</b> на <b>УЗБЕКСКОМ</b> языке:", { parse_mode: "HTML", reply_markup: kbCancel });
        }
        
        if (adminSession.action === "editing_desc_uz") {
            try {
                await Service.findByIdAndUpdate(adminSession.serviceId, { "description.ru": adminSession.tempDescRu, "description.uz": text });
                const savedId = adminSession.serviceId;
                delete adminSessions[userId];
                const kb = new InlineKeyboard().text("🔙 Вернуться к услуге", `edit_srv_${savedId}`);
                return ctx.reply("✅ <b>Описание успешно обновлено!</b>", { parse_mode: "HTML", reply_markup: kb });
            } catch (e) { return ctx.reply("❌ Ошибка при обновлении описания."); }
        }

        // --- БЛОК 2.2: ДОБАВЛЕНИЕ НОВОЙ УСЛУГИ ---
        if (adminSession.step === "waiting_name_ru") {
            adminSession.newData.name_ru = text;
            adminSession.step = "waiting_name_uz";
            return ctx.reply(`Шаг 2 из 6\n\nВведите <b>название услуги на УЗБЕКСКОМ языке</b>:`, { parse_mode: "HTML", reply_markup: kbCancel });
        }
        if (adminSession.step === "waiting_name_uz") {
            adminSession.newData.name_uz = text;
            adminSession.step = "waiting_price";
            return ctx.reply(`Шаг 3 из 6\n\nВведите <b>стоимость услуги</b>:`, { parse_mode: "HTML", reply_markup: kbCancel });
        }
        if (adminSession.step === "waiting_price") {
            adminSession.newData.price = text;
            adminSession.step = "waiting_desc_ru";
            return ctx.reply(`Шаг 4 из 6\n\nВведите <b>описание услуги на РУССКОМ языке</b>:`, { parse_mode: "HTML", reply_markup: kbCancel });
        }
        if (adminSession.step === "waiting_desc_ru") {
            adminSession.newData.desc_ru = text;
            adminSession.step = "waiting_desc_uz";
            return ctx.reply(`Шаг 5 из 6\n\nВведите <b>описание услуги на УЗБЕКСКОМ языке</b>:`, { parse_mode: "HTML", reply_markup: kbCancel });
        }
        if (adminSession.step === "waiting_desc_uz") {
            adminSession.newData.desc_uz = text;
            adminSession.step = "waiting_photo";
            return ctx.reply(`Шаг 6 из 6\n\nОтправьте <b>красивую фотографию</b> для этой услуги.`, { parse_mode: "HTML", reply_markup: kbCancel });
        }
        if (adminSession.step === "waiting_photo") {
            return ctx.reply("Пожалуйста, отправьте именно ФОТО (картинку), а не текст. Или нажмите «Отмена».", { reply_markup: kbCancel });
        }

        // --- БЛОК 2.3: РЕДАКТИРОВАНИЕ ТЕКСТА ГЛАВНОГО МЕНЮ ---
        if (adminSession.action === "editing_main_text_ru") {
            try {
                let settings = await Settings.findOne();
                if (!settings) settings = await Settings.create({});
                
                settings.welcomeTextRu = text;
                await settings.save();
                delete adminSessions[userId];
                return ctx.reply("✅ <b>Текст приветствия (RU) успешно обновлен!</b>", { parse_mode: "HTML" });
            } catch (e) { return ctx.reply("❌ Ошибка при обновлении текста."); }
        }

        if (adminSession.action === "editing_main_text_uz") {
            try {
                let settings = await Settings.findOne();
                if (!settings) settings = await Settings.create({});
                
                settings.welcomeTextUz = text;
                await settings.save();
                delete adminSessions[userId];
                return ctx.reply("✅ <b>Текст приветствия (UZ) успешно обновлен!</b>", { parse_mode: "HTML" });
            } catch (e) { return ctx.reply("❌ Ошибка при обновлении текста."); }
        }
    }

    // Если ни одно из условий не подошло, передаем сообщение дальше
    return next(); 
});

// ==========================================
// 5. ОБРАБОТЧИК ФОТОГРАФИЙ АДМИНА
// ==========================================
bot.on("message:photo", async (ctx, next) => {
    const userId = ctx.from.id;
    const adminSession = adminSessions[userId];
    const clientSession = clientSessions[userId];

    if (!adminSession && !clientSession) return next(); 

    const photoId = ctx.message.photo[ctx.message.photo.length - 1].file_id;

    // СЦЕНАРИЙ: Обновление фотографии главного меню (проверяем обе сессии)
    if (
        (adminSession && adminSession.action === "editing_main_photo") || 
        (clientSession && clientSession.awaitingSettingUpdate === "mainMenuPhoto")
    ) {
        try {
            let settings = await Settings.findOne();
            if (!settings) settings = await Settings.create({});
            
            settings.mainMenuPhoto = photoId;
            await settings.save();

            // Очищаем состояния
            if (adminSession) delete adminSessions[userId].action;
            if (clientSession) {
                delete clientSession.awaitingSettingUpdate;
                if (clientSession.settingPromptMessageId) {
                    try { await bot.api.deleteMessage(ctx.chat.id, clientSession.settingPromptMessageId); } catch(e){}
                }
            }
            
            const kb = new InlineKeyboard().text("🔙 Вернуться к предпросмотру", "edit_main_menu_preview");
            return await ctx.reply("✅ <b>Фотография главного меню успешно обновлена!</b>", { parse_mode: "HTML", reply_markup: kb });
        } catch (e) {
            console.error(e);
            return await ctx.reply("❌ Произошла ошибка при обновлении фотографии главного меню.");
        }
    }

// СЦЕНАРИЙ: Обновление фотографии адреса
if (clientSession && clientSession.awaitingAddressPhoto) {
    try {
        let settings = await Settings.findOne();
        if (!settings) settings = await Settings.create({});

        settings.addressPhoto = photoId;
        await settings.save();

        delete clientSession.awaitingAddressPhoto;

        const kb = new InlineKeyboard()
            .text("🔙 Вернуться к управлению адресом", "manage_address");

        return await ctx.reply(
            "✅ <b>Фотография адреса успешно обновлена!</b>",
            {
                parse_mode: "HTML",
                reply_markup: kb
            }
        );
    } catch (e) {
        console.error("Ошибка при обновлении фотографии адреса:", e);
        return await ctx.reply(
            "❌ Произошла ошибка при обновлении фотографии адреса."
        );
    }
}
    

    // СЦЕНАРИЙ 1: Редактирование фото у существующей услуги
    if (adminSession && adminSession.action === "editing_photo") {
        try {
            await Service.findByIdAndUpdate(adminSession.serviceId, { image: photoId });
            const savedId = adminSession.serviceId;
            delete adminSessions[userId];
            const kb = new InlineKeyboard().text("🔙 Вернуться к услуге", `edit_srv_${savedId}`);
            return await ctx.reply("✅ <b>Фотография услуги успешно обновлена!</b>", { parse_mode: "HTML", reply_markup: kb });
        } catch (e) {
            return await ctx.reply("❌ Произошла ошибка при обновлении фотографии.");
        }
    }

    // СЦЕНАРИЙ 2: Финал добавления новой услуги
    if (adminSession && adminSession.action === "adding_service" && adminSession.step === "waiting_photo") {
        try {
            const uniqueKey = "srv_" + Date.now(); 
            await Service.create({
                key: uniqueKey,
                name: { ru: adminSession.newData.name_ru, uz: adminSession.newData.name_uz },
                price: adminSession.newData.price,
                description: { ru: adminSession.newData.desc_ru, uz: adminSession.newData.desc_uz },
                image: photoId,
                isActive: true
            });
            delete adminSessions[userId]; 
            const kb = new InlineKeyboard().text("🔙 Вернуться к услугам", "manage_services");
            return await ctx.reply("✅ <b>Услуга успешно добавлена в базу!</b>", { parse_mode: "HTML", reply_markup: kb });
        } catch (e) {
            return await ctx.reply("❌ Произошла ошибка при сохранении.");
        }
    }

    return next();
});
// ==========================================
// 6. ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ И СЛОВАРИ
// ==========================================
const userIds = new Set(); 
const broadcastHistory = []; 
const cancelledBookings = [];

const TIME_SLOTS = [
    "10:00",
    "11:00",
    "12:00",
    "13:00",
    "14:00",
    "15:00",
    "16:00",
    "17:00",
    "18:00",
    "19:00",
    "20:00"
];
const CANCEL_REASONS = [
    "Изменились планы", 
    "Не получается по времени", 
    "Заболел(а)", 
    "Другая причина"
];

const MASTER_CANCEL_REASONS = [
    "Нет свободных мест",
    "Мастер заболел/не работает",
    "Технические причины",
    "Свяжитесь со мной для уточнения"
];

const LANG = {
    ru: {
        welcome: "Привет, {name}! 👋\nДобро пожаловать в нашу студию. Выберите нужный раздел:",
        main_menu_title: "✨ **Главное меню:**",
    services: "📅 Записаться",
        portfolio: "📸 Наши работы",
        my_bookings: "📋 Мои записи",
        contacts: "📞 Связаться",
        address: "📍 Адрес",
        instagram: "🌐 Социальные сети",
        back: "⬅️ В главное меню",
        back_services: "⬅️ Назад к услугам",
        choose_lang: "🇷🇺 Выберите язык / 🇺🇿 Tilni tanlang:",
        no_bookings: "У вас пока нет активных записей 🤷‍♂️",
        book_time: "📅 Выбрать время",
        cancel_btn: "❌ Отменить"
    },
    uz: {
        welcome: "Salom, {name}! 👋\nStudiyamizga xush kelibsiz. Kerakli bo'limni tanlang:",
        main_menu_title: "✨ **Asosiy menyu:**",
        services: "📅 Band qilish",
        portfolio: "📸 Bizning ishlar",
        my_bookings: "📋 Mening yozuvlarim",
        contacts: "📞 Aloqa",
        address: "📍 Manzil",
        instagram: "🌐 Ijtimoiy tarmoqlar",
        back: "⬅️ Asosiy menyuga",
        back_services: "⬅️ Xizmatlarga qaytish",
        choose_lang: "🇷🇺 Выберите язык / 🇺🇿 Tilni tanlang:",
        no_bookings: "Sizda hozircha faol yozuvlar yo'q 🤷‍♂️",
        book_time: "📅 Vaqtni tanlash",
        cancel_btn: "❌ Bekor qilish"
    }
};

const imgWelcome = "https://img.freepik.com/free-photo/top-view-manicure-tools-with-copy-space_23-2148766579.jpg"; 
const imgCalendar = "https://img.freepik.com/free-photo/calendar-page-close-up_169016-25039.jpg"; 
const imgSuccess = "https://img.freepik.com/free-photo/nail-artist-doing-manicure-client_23-2148766627.jpg"; 
const imgPortfolio = "https://img.freepik.com/free-photo/female-hands-with-beautiful-manicure_169016-16053.jpg"; 

const MONTH_NAMES = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];

// ==========================================
// 7. ПЛАНИРОВЩИК И УТИЛИТЫ
// ==========================================

cron.schedule("*/30 * * * *", async () => {
    const tashkentNow = getTashkentNow();
    try {
        const bookings = await Booking.find({ status: "confirmed", reminderSent: false });
        
        for (const booking of bookings) {
           const [day, month, year] = booking.dateText.split('.').map(Number);
const [hours, minutes] = booking.time.split(':').map(Number);

const bookingTotalMinutes =
    (((year * 12 + month) * 31 + day) * 24 + hours) * 60 + minutes;

const nowTotalMinutes =
    (((tashkentNow.year * 12 + tashkentNow.month) * 31 + tashkentNow.day) * 24 + tashkentNow.hours) * 60 + tashkentNow.minutes;

const diffInMinutes = bookingTotalMinutes - nowTotalMinutes;

            if (diffInMinutes > 120 && diffInMinutes <= 150) {
                try {
                    const targetUserId = booking.userId;
                    const userLang = clientSessions[targetUserId]?.lang || "ru";
                    
                    // ДОСТАЕМ УСЛУГУ ИЗ БД
                    const serviceInfo = await Service.findOne({ key: booking.serviceKey });
                    const serviceName = serviceInfo ? serviceInfo.name[userLang] : "Услуга";
                    
                    const reminderMsg = userLang === "ru"
                        ? `⏰ **Напоминание о записи!**\n\nЗдравствуйте! Напоминаем, что сегодня в **${booking.time}** у вас запись на **${serviceName}**. Ждем вас! ✨`
                        : `⏰ **Yozuv bo'yicha eslatma!**\n\nSalom! Eslatib o'tamiz, bugun soat **${booking.time}** da sizning **${serviceName}** xizmatiga yozuvingiz bor. Sizni kutamiz! ✨`;

                    await bot.api.sendMessage(targetUserId, reminderMsg, { parse_mode: "Markdown" });
                    
                    booking.reminderSent = true;
                    await booking.save();
                } catch (e) { console.error("Ошибка отправки напоминания:", e) }
            }
        }
      } catch (err) {
        console.error("Ошибка в cron:", err);
    }

}, {
    timezone: "Asia/Tashkent"
});

function sortBookings(bookingsArray) {
    return bookingsArray.sort((a, b) => {
        const [dayA, monthA, yearA] = a.dateText.split('.').map(Number);
        const [hourA, minA] = a.time.split(':').map(Number);

        const [dayB, monthB, yearB] = b.dateText.split('.').map(Number);
        const [hourB, minB] = b.time.split(':').map(Number);

        const totalA =
            (((yearA * 12 + monthA) * 31 + dayA) * 24 + hourA) * 60 + minA;

        const totalB =
            (((yearB * 12 + monthB) * 31 + dayB) * 24 + hourB) * 60 + minB;

        return totalA - totalB;
    });
}

function getBookingDateTime(booking) {
    if (!booking.dateText || !booking.time) return null;

    const dateParts = booking.dateText.split(".");
    const timeParts = booking.time.split(":");

    if (dateParts.length !== 3 || timeParts.length < 2) return null;

    const day = Number(dateParts[0]);
    const month = Number(dateParts[1]);
    const year = Number(dateParts[2]);

    const hours = Number(timeParts[0]);
    const minutes = Number(timeParts[1]);

    if (
        !Number.isFinite(day) ||
        !Number.isFinite(month) ||
        !Number.isFinite(year) ||
        !Number.isFinite(hours) ||
        !Number.isFinite(minutes)
    ) {
        return null;
    }

    return (
        (((year * 12 + month) * 31 + day) * 24 + hours) * 60 + minutes
    );
}

async function refreshAdminMenu() {
    const session = clientSessions[MASTER_CHAT_ID];
    if (!session || !session.adminMenuMessageId) return;

    try {
        // Подгружаем все услуги для отображения названий
        const allServices = await Service.find();
        const serviceMap = {};
        allServices.forEach(s => serviceMap[s.key] = s.name.ru);

        if (session.currentAdminView === 'today') {
            const tashkentNow = getTashkentNow();
const todayStr = tashkentNow.dateText;
                

            // Получаем только активные записи на сегодня
            const bookingsRaw = await Booking.find({
                dateText: todayStr,
                status: { $in: ["pending", "confirmed"] }
            });

            // Оставляем только записи, которые ещё не прошли
           const nowTotalMinutes =
    (((tashkentNow.year * 12 + tashkentNow.month) * 31 + tashkentNow.day) * 24 + tashkentNow.hours) * 60 + tashkentNow.minutes;

const futureBookings = bookingsRaw.filter(b => {
    const bookingDate = getBookingDateTime(b);

    if (bookingDate === null) return false;

    return bookingDate > nowTotalMinutes;
});

            // Ближайшая запись сверху
            const sorted = futureBookings.sort((a, b) => {
                return getBookingDateTime(a) - getBookingDateTime(b);
            });

            const kb = new InlineKeyboard();

            if (sorted.length === 0) {
                kb.text("⬅️ Назад", "back_to_admin");

                await bot.api.editMessageText(
                    MASTER_CHAT_ID,
                    session.adminMenuMessageId,
                    `📅 **Расписание на сегодня (${todayStr}):**\n\n` +
                    `Будущих записей больше нет. ☕️`,
                    {
                        parse_mode: "Markdown",
                        reply_markup: kb
                    }
                );

                return;
            }

            let text =
                `📅 **Расписание на сегодня (${todayStr}) - ${sorted.length} шт.:**\n\n`;

            sorted.forEach((b, index) => {
                const status =
                    b.status === "pending" ? "⏳" : "✅";

                const sName =
                    serviceMap[b.serviceKey] ||
                    b.serviceNameRu ||
                    "Удаленная услуга";

                text +=
                    `${index + 1}. ${status} **${b.clientName}** | ${sName}\n` +
                    `⏰ Время: ${b.time} (${b.username})\n\n`;

                // Кнопки сразу под конкретной записью
               

                kb.text(
                    `❌ Отменить №${index + 1}`,
                    `admin_rej_${b._id}`
                ).row();
            });

            kb.text("⬅️ Назад", "back_to_admin");

            await bot.api.editMessageText(
                MASTER_CHAT_ID,
                session.adminMenuMessageId,
                text,
                {
                    parse_mode: "Markdown",
                    reply_markup: kb
                }
            );

        } else if (
            session.currentAdminView &&
            session.currentAdminView.startsWith('all_')
        ) {

            const page =
                parseInt(session.currentAdminView.split('_')[1]) || 0;

            // Получаем только активные записи
            const bookingsRaw = await Booking.find({
                status: { $in: ["pending", "confirmed"] }
            });

            const tashkentNow = getTashkentNow();

const nowTotalMinutes =
    (((tashkentNow.year * 12 + tashkentNow.month) * 31 + tashkentNow.day) * 24 + tashkentNow.hours) * 60 + tashkentNow.minutes;

// Оставляем только будущие записи
const futureBookings = bookingsRaw.filter(b => {
    const bookingDate = getBookingDateTime(b);

    if (bookingDate === null) return false;

    return bookingDate > nowTotalMinutes;
});

            // Сортируем: ближайшая запись сверху
            futureBookings.sort((a, b) => {
                return getBookingDateTime(a) - getBookingDateTime(b);
            });

            const kb = new InlineKeyboard();

            if (futureBookings.length === 0) {
                kb.text("⬅️ Назад", "back_to_admin");

                await bot.api.editMessageText(
                    MASTER_CHAT_ID,
                    session.adminMenuMessageId,
                    "📋 **Ближайшие записи:**\n\nПока будущих записей нет.",
                    {
                        parse_mode: "Markdown",
                        reply_markup: kb
                    }
                );

                return;
            }

            const ITEMS_PER_PAGE = 10;
            const totalPages = Math.ceil(
                futureBookings.length / ITEMS_PER_PAGE
            );

            const p = Math.min(
                Math.max(page, 0),
                totalPages - 1
            );

            const currentItems = futureBookings.slice(
                p * ITEMS_PER_PAGE,
                (p + 1) * ITEMS_PER_PAGE
            );

            let text =
                `📋 **Ближайшие записи (${futureBookings.length}):**\n` +
                `Страница ${p + 1} из ${totalPages}\n\n`;

            currentItems.forEach((b, index) => {
                const globalIndex =
                    p * ITEMS_PER_PAGE + index + 1;

                const status =
                    b.status === "pending" ? "⏳" : "✅";

                const sName =
                    serviceMap[b.serviceKey] ||
                    b.serviceNameRu ||
                    "Удаленная услуга";

                text +=
                    `${globalIndex}. ${status} **${b.clientName}**\n` +
                    ` ${sName}\n` +
                    `📅 ${b.dateText}\n` +
                    `⏰ ${b.time}\n` +
                    `👤 ${b.username}\n\n`;

                // Кнопки сразу под конкретной записью
             

                kb.text(
                    "❌ Отменить",
                    `admin_rej_${b._id}`
                ).row();
            });

            // Навигация по страницам
            if (p > 0) {
                kb.text(
                    "⬅️ Пред",
                    `admin_all_bookings_${p - 1}`
                );
            }

            if (p < totalPages - 1) {
                kb.text(
                    "След ➡️",
                    `admin_all_bookings_${p + 1}`
                );
            }

            if (p > 0 || p < totalPages - 1) {
                kb.row();
            }

            kb.text("⬅️ Назад", "back_to_admin");

            await bot.api.editMessageText(
                MASTER_CHAT_ID,
                session.adminMenuMessageId,
                text,
                {
                    parse_mode: "Markdown",
                    reply_markup: kb
                }
            );

        } else {
            session.currentAdminView = 'menu';

            await bot.api.editMessageText(
                MASTER_CHAT_ID,
                session.adminMenuMessageId,
                "👨‍💻 Панель управления Мастера\n\n" +
                "Здесь вы можете управлять своими записями.\n" +
                "Выберите действие:",
                {
                    parse_mode: "Markdown",
                    reply_markup: getAdminKeyboard()
                }
            );
        }

    } catch (e) {
        console.error("Error in refreshAdminMenu:", e);
    }
}


async function renderNewRequests(ctx) {
    const bookings = await Booking.find({
        status: "pending"
    }).sort({ _id: 1 });

    const kb = new InlineKeyboard();

    if (bookings.length === 0) {
        kb.text("⬅️ Назад", "back_to_admin");

        return await ctx.editMessageText(
            "🔔 **Новые заявки**\n\n" +
            "Новых заявок нет. ✨",
            {
                parse_mode: "Markdown",
                reply_markup: kb
            }
        );
    }

    let text = `🔔 **НОВЫЕ ЗАЯВКИ (${bookings.length})**\n\n`;

    bookings.forEach((b) => {
        text +=
            `🔔 **НОВАЯ ЗАЯВКА!**\n\n` +
            `👤 Имя: ${b.clientName}\n` +
            `🔗 ТГ: ${b.username || "Скрыт"}\n` +
            `💅 Услуга: ${b.serviceNameRu || "Услуга"}\n` +
            `📅 Дата: ${b.dateText}\n` +
            `🕐 Время: ${b.time}\n\n` +
            `━━━━━━━━━━━━━━\n\n`;

        kb.text(
            "✅ Подтвердить",
            `admin_conf_${b._id}`
        ).row();

        kb.text(
            "❌ Отклонить",
            `admin_rej_${b._id}`
        ).row();
    });

    kb.text("⬅️ Назад", "back_to_admin");

    return await ctx.editMessageText(text, {
        parse_mode: "Markdown",
        reply_markup: kb
    });
}

async function smartUpdate(ctx, newImageUrl, newCaption, newKeyboard) {
    const userId = ctx.from.id;
    if (!clientSessions[userId]) clientSessions[userId] = { lang: 'ru' };
    
    try {
        if (clientSessions[userId].currentImage === newImageUrl) {
            await ctx.editMessageCaption({ caption: newCaption, parse_mode: "Markdown", reply_markup: newKeyboard });
        } else {
            await ctx.editMessageMedia(
                { type: "photo", media: newImageUrl, caption: newCaption, parse_mode: "Markdown" },
                { reply_markup: newKeyboard }
            );
            clientSessions[userId].currentImage = newImageUrl;
        }
    } catch (e) {}
}

// ==========================================
// 8. ГЕНЕРАЦИЯ КЛАВИАТУР
// ==========================================

function getLanguageKeyboard() {
    return new InlineKeyboard().text("🇷🇺 Русский", "set_lang_ru").row().text("🇺🇿 O'zbekcha", "set_lang_uz");
}

async function getMainMenuKeyboard(lang) {
    const t = LANG[lang];

    const settings = await Settings.findOne() || await Settings.create({});
    const instagramUrl = settings.instagram || "https://instagram.com/";

    const keyboard = new InlineKeyboard()
        .text(t.services, "view_all_services").row()
        //.text(t.my_bookings, "view_my_bookings").row()
        .text(t.contacts, "view_contacts").row()
        .text(t.address, "view_address").row()

        .text("_", "ignore").row()

        .url("📸 Instagram", instagramUrl).row();

    if (lang === "ru") {
        keyboard.text("🇺🇿 O'zbekcha", "set_lang_uz");
    } else {
        keyboard.text("🇷🇺 Русский", "set_lang_ru");
    }

    return keyboard;
}

bot.callbackQuery("ignore", async (ctx) => {
    await ctx.answerCallbackQuery();
});

function getAdminKeyboard() {
    return new InlineKeyboard()
        .text("🔔 Новые заявки", "admin_new_requests").row()
        .text("⏳ Ожидаемые записи", "admin_all_bookings").row()
        .text("📅 На сегодня", "admin_today_bookings").row()
        .text("_", "ignore").row()
        .text("📊 Статистика", "admin_statistics").row()
        .text("⚙️ Настройки", "admin_settings").row() 
        .text("📢 Сделать рассылку", "admin_broadcast_init").row()
        .text("📜 История рассылок", "admin_broadcast_history");
}

// ТЕПЕРЬ ФУНКЦИЯ АСИНХРОННАЯ, ТАК КАК БЕРЕТ ДАННЫЕ ИЗ БД!
async function getServicesKeyboard(lang) {
    const t = LANG[lang];
    const kb = new InlineKeyboard();
    
    // Получаем все активные услуги из базы данных
    const services = await Service.find({ isActive: true });
    
    for (const data of services) {
        kb.text(` ${data.name[lang]}`, `view_service_${data.key}`).row();
    }
    kb.text(t.back, "back_to_start");
    return kb;
}

// ==========================================
// 9. ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ КАЛЕНДАРЕЙ
// ==========================================

// КАЛЕНДАРЬ ДЛЯ КЛИЕНТА (ПЕРВИЧНАЯ ЗАПИСЬ)
function createCalendarKeyboard(year, month, serviceKey, lang) {
    // Корректировка переполнения месяцев
    if (month < 0) { month = 11; year -= 1; }
    if (month > 11) { month = 0; year += 1; }

const t = LANG[lang] || LANG.ru;    const keyboard = new InlineKeyboard();
    keyboard.text(`🗓 ${MONTH_NAMES[month]} ${year}`, "ignore").row();

    const daysOfWeek = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
    daysOfWeek.forEach(day => keyboard.text(day, "ignore"));
    keyboard.row();

    const firstDayIndex = new Date(year, month, 1).getDay();
    const startDay = firstDayIndex === 0 ? 6 : firstDayIndex - 1; 
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const tashkentNow = getTashkentNow();
const todayTotal =
    (((tashkentNow.year * 12 + tashkentNow.month) * 31 + tashkentNow.day));

    for (let i = 0; i < startDay; i++) { keyboard.text(" ", "ignore"); }
    let currentColumn = startDay;
    for (let day = 1; day <= daysInMonth; day++) {
        const cellTotal =
    (((year * 12 + (month + 1)) * 31 + day));

if (cellTotal < todayTotal) {
            keyboard.text(`🔒`, "ignore");
        } else {
            keyboard.text(`${day}`, `date_${year}_${month}_${day}`);
        }
        currentColumn++;
        if (currentColumn === 7) { keyboard.row(); currentColumn = 0; }
    }
    if (currentColumn !== 0) {
        for (let i = currentColumn; i < 7; i++) { keyboard.text(" ", "ignore"); }
        keyboard.row();
    }
    keyboard.text("◀️", `m_${year}_${month - 1}`);
    keyboard.text(t.back_services, `view_all_services`);
    keyboard.text("▶️", `m_${year}_${month + 1}`);

    return keyboard;
}

// КАЛЕНДАРЬ ДЛЯ МАСТЕРА (ПЕРЕНОС ЗАПИСИ)
function createAdminCalendarKeyboard(year, month, bookingId) {
    if (month < 0) { month = 11; year -= 1; }
    if (month > 11) { month = 0; year += 1; }

    const keyboard = new InlineKeyboard();
    keyboard.text(`🗓 ${MONTH_NAMES[month]} ${year}`, "ignore").row();

    const daysOfWeek = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
    daysOfWeek.forEach(day => keyboard.text(day, "ignore"));
    keyboard.row();

    const firstDayIndex = new Date(year, month, 1).getDay();
    const startDay = firstDayIndex === 0 ? 6 : firstDayIndex - 1; 
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const today = new Date();
    today.setHours(0,0,0,0);

    for (let i = 0; i < startDay; i++) { keyboard.text(" ", "ignore"); }
    let currentColumn = startDay;
    for (let day = 1; day <= daysInMonth; day++) {
        const cellDate = new Date(year, month, day);
        if (cellDate < today) {
            keyboard.text(`🔒`, "ignore");
        } else {
            keyboard.text(`${day}`, `admindate_${bookingId}_${year}_${month}_${day}`);
        }
        currentColumn++;
        if (currentColumn === 7) { keyboard.row(); currentColumn = 0; }
    }
    if (currentColumn !== 0) {
        for (let i = currentColumn; i < 7; i++) { keyboard.text(" ", "ignore"); }
        keyboard.row();
    }
    keyboard.text("◀️", `am_${bookingId}_${year}_${month - 1}`);
    keyboard.text("❌ Отмена", `back_to_admin`);
    keyboard.text("▶️", `am_${bookingId}_${year}_${month + 1}`);

    return keyboard;
}

// КАЛЕНДАРЬ ДЛЯ МАСТЕРА И КЛИЕНТА (ОБЩИЙ ПЕРЕНОС)
function createRescheduleCalendarKeyboard(year, month, bookingId, role, lang) {
    if (month < 0) { month = 11; year -= 1; }
    if (month > 11) { month = 0; year += 1; }

    const keyboard = new InlineKeyboard();
    keyboard.text(`🗓 ${MONTH_NAMES[month]} ${year}`, "ignore").row();

    const daysOfWeek = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
    daysOfWeek.forEach(day => keyboard.text(day, "ignore"));
    keyboard.row();

    const firstDayIndex = new Date(year, month, 1).getDay();
    const startDay = firstDayIndex === 0 ? 6 : firstDayIndex - 1; 
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const today = new Date();
    today.setHours(0,0,0,0);

    for (let i = 0; i < startDay; i++) { keyboard.text(" ", "ignore"); }
    let currentColumn = startDay;
    for (let day = 1; day <= daysInMonth; day++) {
        const cellDate = new Date(year, month, day);
        if (cellDate < today) {
            keyboard.text(`🔒`, "ignore");
        } else {
            keyboard.text(`${day}`, `reschdate_${role}_${bookingId}_${year}_${month}_${day}`);
        }
        currentColumn++;
        if (currentColumn === 7) { keyboard.row(); currentColumn = 0; }
    }
    if (currentColumn !== 0) {
        for (let i = currentColumn; i < 7; i++) { keyboard.text(" ", "ignore"); }
        keyboard.row();
    }
    keyboard.text("◀️", `reschm_${role}_${bookingId}_${year}_${month - 1}`);
    const backBtnText = role === "admin" ? "❌ Отмена" : (lang === "ru" ? "⬅️ Назад" : "⬅️ Orqaga");
    const backBtnCb = role === "admin" ? "back_to_admin" : "view_my_bookings";
    keyboard.text(backBtnText, backBtnCb);
    keyboard.text("▶️", `reschm_${role}_${bookingId}_${year}_${month + 1}`);

    return keyboard;
}

// ==========================================
// 10. ЛОГИКА СТАРТА И ГЛАВНОГО МЕНЮ
// ==========================================
async function sendClientMenu(ctx) {
    try {
        const userId = ctx.from.id;
        
        if (!clientSessions[userId]) clientSessions[userId] = {};
        clientSessions[userId].awaitingName = false; 
        
        // 1. Получаем настройки из базы (без краша, если базы нет)
        const settings = await Settings.findOne().catch(() => null);

        // 2. Выбираем фото
        const photoToSend = (settings && settings.mainMenuPhoto) ? settings.mainMenuPhoto : imgWelcome;

        // 3. Формируем текст (только русский)
       const lang = clientSessions[userId]?.lang || "ru";

let welcomeText;

if (lang === "uz") {
    welcomeText = (settings && settings.welcomeTextUz)
        ? settings.welcomeTextUz
        : "Salom, {name}! 👋 Xush kelibsiz.";
} else {
    welcomeText = (settings && settings.welcomeTextRu)
        ? settings.welcomeTextRu
        : "Привет, {name}! 👋 Добро пожаловать.";
}

welcomeText = welcomeText.replace("{name}", ctx.from.first_name || "Гость");

        // 4. Удаляем старое меню, чтобы не засорять чат
        if (clientSessions[userId].menuMessageId) {
            try { await bot.api.deleteMessage(userId, clientSessions[userId].menuMessageId); } catch(e) {}
        }

        clientSessions[userId].currentImage = photoToSend; 

        // 5. Отправляем меню
// 5. Отправляем меню
// 5. Отправляем меню
const res = await ctx.replyWithPhoto(photoToSend, {
    caption: welcomeText,
    parse_mode: "HTML",
    reply_markup: await getMainMenuKeyboard(lang)
});

clientSessions[userId].menuMessageId = res.message_id;
    } catch (error) {
        console.error("❌ Ошибка отправки меню клиенту:", error);
        await ctx.reply("❌ Ошибка при загрузке меню. Напишите мастеру напрямую.");
    }
}



// ОБРАБОТЧИК ВЫБОРА РУССКОГО ЯЗЫКА
bot.callbackQuery("set_lang_ru", async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => {});
    const userId = ctx.from.id;
    if (!clientSessions[userId]) clientSessions[userId] = {};
    
    clientSessions[userId].lang = "ru";
    
    try { await ctx.deleteMessage(); } catch(e){}
    await sendClientMenu(ctx);
});

// ОБРАБОТЧИК ВЫБОРА УЗБЕКСКОГО ЯЗЫКА
bot.callbackQuery("set_lang_uz", async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => {});
    const userId = ctx.from.id;
    if (!clientSessions[userId]) clientSessions[userId] = {};
    
    clientSessions[userId].lang = "uz";
    
    try { await ctx.deleteMessage(); } catch(e){}
    await sendClientMenu(ctx);
});


/// ==========================================
// 12. АДМИН-ПАНЕЛЬ: РАССЫЛКИ И НАСТРОЙКИ
// ==========================================


// Меню редактирования Главного экрана
bot.callbackQuery("admin_edit_main_menu", async (ctx) => {
    await ctx.answerCallbackQuery().catch(()=>{});
    
    const kb = new InlineKeyboard()
        .text("📸 Изменить фото", "admin_edit_main_photo").row()
        .text("📝 Изменить текст (RU)", "admin_edit_main_text_ru").row()
        .text("📝 Изменить текст (UZ)", "admin_edit_main_text_uz").row()
        .text("🔙 Назад в админку", "admin_menu"); // Замени "admin_menu" на свой коллбек возврата
        
    await ctx.editMessageText("🛠 **Настройки Главного меню**\n\nЧто именно вы хотите изменить?", {
        parse_mode: "Markdown",
        reply_markup: kb
    });
});

bot.callbackQuery("admin_new_requests", async (ctx) => {
    await ctx.answerCallbackQuery();

    try {
        await renderNewRequests(ctx);
    } catch (err) {
        console.error("Ошибка admin_new_requests:", err);
    }
});

// Админ нажал "Изменить фото"
bot.callbackQuery("admin_edit_main_photo", async (ctx) => {
    await ctx.answerCallbackQuery().catch(()=>{});
    if (!adminSessions[ctx.from.id]) adminSessions[ctx.from.id] = {};
    adminSessions[ctx.from.id].step = "awaiting_main_photo";
    await ctx.reply("📸 Отправьте мне новую фотографию для главного меню:");
});

// Админ нажал "Изменить текст RU"
bot.callbackQuery("admin_edit_main_text_ru", async (ctx) => {
    await ctx.answerCallbackQuery().catch(()=>{});
    if (!adminSessions[ctx.from.id]) adminSessions[ctx.from.id] = {};
    adminSessions[ctx.from.id].step = "awaiting_main_text_ru";
    await ctx.reply("📝 Отправьте новый текст приветствия на русском.\n\n*Подсказка:* используйте `{name}`, чтобы бот сам подставлял имя клиента.", { parse_mode: "Markdown" });
});

bot.callbackQuery("admin_broadcast_init", async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!clientSessions[ctx.from.id]) clientSessions[ctx.from.id] = {};
    clientSessions[ctx.from.id].awaitingBroadcast = true;
    clientSessions[ctx.from.id].adminMenuMessageId = ctx.callbackQuery.message.message_id;
    await ctx.editMessageText("✍ *Отправьте текст сообщения для рассылки:*", { parse_mode: "Markdown", reply_markup: new InlineKeyboard().text("❌ Отмена", "back_to_admin") });
});

bot.callbackQuery(/^edit_srv_/, async (ctx) => {
    await ctx.answerCallbackQuery().catch(()=>{});
    const serviceId = ctx.callbackQuery.data.replace("edit_srv_", "");
    
    if (adminSessions[ctx.from.id]) {
        delete adminSessions[ctx.from.id];
    }

    try {
        const service = await Service.findById(serviceId);
        if (!service) return;

        const text = ` <b>Управление услугой:</b> ${service.name.ru}\n\n` +
                     `💰 <b>Цена:</b> ${service.price}\n\n` +
                     `📝 <b>Описание (RU):</b>\n${service.description.ru}\n\n` +
                     `<i>Что именно вы хотите изменить?</i>`;

        const kb = new InlineKeyboard()
            .text("✏️ Изменить название", `edit_name_${serviceId}`).row()
            .text("💰 Изменить цену", `edit_price_${serviceId}`).row()
            .text("📝 Изменить описание", `edit_desc_${serviceId}`).row()
            .text("🖼 Изменить фото", `edit_photo_${serviceId}`).row()
            .text("❌ Удалить услугу", `delete_srv_${serviceId}`).row()
            .text("🔙 Назад к списку", "manage_services");

        try { await ctx.deleteMessage(); } catch(e){}
        await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb });

    } catch (err) {
        console.error(err);
    }
});

bot.callbackQuery("admin_statistics", async (ctx) => {
    await ctx.answerCallbackQuery();

    try {
        // Все заявки, кроме отменённых
        const allRecordsCount = await Booking.countDocuments({
            status: { $ne: "cancelled" }
        });

        // Отменённые заявки
        const cancelledCount = await Booking.countDocuments({
            status: "cancelled"
        });

        // Общее количество всех заявок
        const totalCount = allRecordsCount + cancelledCount;

        const text =
            `📊 **Статистика бота:**\n\n` +
            `📈 Всего заявок: **${totalCount}**\n` +
            `📋 Все записи: **${allRecordsCount}**\n` +
            `❌ Отменённые: **${cancelledCount}**`;

        const kb = new InlineKeyboard()
            .text("📋 Все записи", "admin_not_cancelled_list")
            .row()
            .text("❌ История отмен", "admin_cancelled_list")
            .row()
            .text("⬅️ Назад", "back_to_admin");

        await ctx.editMessageText(text, {
            parse_mode: "Markdown",
            reply_markup: kb
        });

    } catch (err) {
        console.error("Ошибка статистики:", err);

        await ctx.editMessageText(
            "❌ Ошибка загрузки статистики.",
            {
                reply_markup: new InlineKeyboard()
                    .text("⬅️ Назад", "back_to_admin")
            }
        );
    }
});

// ==========================================
// 13. НАСТРОЙКИ БОТА И САЛОНА
// ==========================================

async function getSettingsMenuTextAndKeyboard() {
    let settings = await Settings.findOne();
    if (!settings) settings = await Settings.create({});

    const text = `⚙️ <b>НАСТРОЙКИ БОТА И САЛОНА</b>\n\n` +
                 `📞 <b>Телефон:</b> ${settings.phone}\n` +
                 `🕒 <b>График:</b> ${settings.schedule}\n` +
                 `📍 <b>Адрес:</b> ${settings.address}\n` +
                 `🔗 <b>Instagram:</b> ${settings.instagram}\n` +
                 `👤 <b>Юзернейм мастера:</b> @${settings.masterUsername}\n\n` +
                 `Выберите, какой пункт вы хотите изменить:`;

    const kb = new InlineKeyboard()
        .text("🏠 Изменить Главное меню", "edit_main_menu_preview").row() // <--- ДОБАВИЛИ СЮДА
        .text("📞 Изменить телефон", "edit_phone").row()
        .text("🕒 Изменить график", "edit_schedule").row()
        .text("📍 Управление адресом", "manage_address").row()
        .text("🔗 Изменить Instagram", "edit_instagram").row()
        .text("👤 Изменить Юзернейм", "edit_masterUsername").row()
        .text("🖥️ Управление услугами", "manage_services").row()
        .text("🔙 Назад в меню", "back_to_admin_main");
        
    return { text, kb };
}

bot.callbackQuery("edit_main_menu_preview", async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => {});
    
    const settings = await Settings.findOne() || {};
    const photoToSend = settings.mainMenuPhoto || (typeof imgWelcome !== 'undefined' ? imgWelcome : null);
    const textRu = settings.welcomeTextRu || "Привет, {name}! 👋\nДобро пожаловать в нашу студию.";
    
    const previewText = `👁 <b>Предпросмотр главного меню:</b>\n\n${textRu}`;
    
    const kb = new InlineKeyboard()
        .text("📸 Изменить фото", "set_main_photo").row()
        .text("📝 Изменить описание (RU)", "set_main_text_ru").row()
        .text("📝 Изменить описание (UZ)", "set_main_text_uz").row()
        .text("🔙 Назад к настройкам", "back_to_settings_menu");
        
    try { await ctx.deleteMessage(); } catch(e){}
    
    if (photoToSend) {
        await ctx.replyWithPhoto(photoToSend, { caption: previewText, parse_mode: "HTML", reply_markup: kb });
    } else {
        await ctx.reply(previewText, { parse_mode: "HTML", reply_markup: kb });
    }
});


// 2. Нажатие на "Изменить фото" (пишем в обе сессии для надежности)
bot.callbackQuery("set_main_photo", async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => {});
    const userId = ctx.from.id;
    
    if (!adminSessions[userId]) adminSessions[userId] = {};
    adminSessions[userId].action = "editing_main_photo";
    
    if (!clientSessions[userId]) clientSessions[userId] = {};
    clientSessions[userId].awaitingSettingUpdate = "mainMenuPhoto";
    
    try { await ctx.deleteMessage(); } catch(e){}
    const msg = await ctx.reply("📸 Отправьте мне <b>новую фотографию</b> для Главного меню (просто пришлите картинку в чат):", { parse_mode: "HTML" });
    clientSessions[userId].settingPromptMessageId = msg.message_id;
});
// Нажатие на "Изменить описание (RU)"
bot.callbackQuery("set_main_text_ru", async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => {});
    const userId = ctx.from.id;
    if (!clientSessions[userId]) clientSessions[userId] = {};
    
    clientSessions[userId].awaitingSettingUpdate = "welcomeTextRu";
    
    try { await ctx.deleteMessage(); } catch(e){}
    const msg = await ctx.reply("📝 Отправьте новый <b>текст приветствия (RU)</b>:\n\n<i>Подсказка: используйте <code>{name}</code>, чтобы бот автоматически подставлял имя клиента.</i>", { parse_mode: "HTML" });
    clientSessions[userId].settingPromptMessageId = msg.message_id;
});

// Нажатие на "Изменить описание (UZ)"
bot.callbackQuery("set_main_text_uz", async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => {});
    const userId = ctx.from.id;
    if (!clientSessions[userId]) clientSessions[userId] = {};
    
    clientSessions[userId].awaitingSettingUpdate = "welcomeTextUz";
    
    try { await ctx.deleteMessage(); } catch(e){}
    const msg = await ctx.reply("📝 Отправьте новый <b>текст приветствия (UZ)</b>:\n\n<i>Подсказка: используйте <code>{name}</code>, чтобы бот подставлял имя клиента.</i>", { parse_mode: "HTML" });
    clientSessions[userId].settingPromptMessageId = msg.message_id;
});

bot.callbackQuery("admin_settings", async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => {});
    const { text, kb } = await getSettingsMenuTextAndKeyboard();

    try {
        // 1. Пробуем отредактировать текст (если прошлым сообщением был текст)
        await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: kb });
    } catch (e) {
        // 2. Если прошлым сообщением было ФОТО, editMessageText выдаст ошибку.
        // Перехватываем ее: удаляем сообщение с фото и отправляем чистое текстовое меню!
        try { await ctx.deleteMessage(); } catch (_) {}
        await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb });
    }
});

bot.callbackQuery("back_to_admin_main", async (ctx) => {
    await ctx.answerCallbackQuery().catch(()=>{});
    try {
        await ctx.editMessageText("👨‍💻 Панель управления Мастера\n\nВыберите действие:",  {
            reply_markup: getAdminKeyboard()
        });
    } catch (e) {}
});

bot.callbackQuery("back_to_settings_menu", async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => {});
    
    // Удаляем предыдущее сообщение с ФОТО
    try { await ctx.deleteMessage(); } catch(e){}
    
    // Получаем и отправляем обычное меню настроек
    const { text, kb } = await getSettingsMenuTextAndKeyboard();
    await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb });
});

bot.callbackQuery(["edit_phone", "edit_schedule", "edit_address", "edit_instagram", "edit_masterUsername", "edit_portfolioText"], async (ctx) => {
    await ctx.answerCallbackQuery().catch(()=>{});
    const userId = ctx.from.id;
    if (!clientSessions[userId]) clientSessions[userId] = {};

    const settingKey = ctx.callbackQuery.data.replace("edit_", "");
    clientSessions[userId].awaitingSettingUpdate = settingKey;

    const prompts = {
        phone: "📞 Отправьте новый номер телефона:",
        schedule: "🕒 Отправьте новый график работы:",
        address: "📍 Отправьте новый адрес салона:",
        instagram: "🔗 Отправьте новую ссылку на Instagram:",
        masterUsername: "👤 Отправьте ваш новый юзернейм в Telegram (без @):",
        portfolioText: "📸 Отправьте новый текст для раздела «Наши работы»:"
    };

    const kb = new InlineKeyboard().text("🔙 Отмена", "cancel_setting_update");

    try {
        await ctx.editMessageText(prompts[settingKey], { parse_mode: "HTML", reply_markup: kb });
        clientSessions[userId].settingPromptMessageId = ctx.callbackQuery.message.message_id;
    } catch(e) {}
});

// ==========================================
// УПРАВЛЕНИЕ АДРЕСОМ
// ==========================================
bot.callbackQuery("manage_address", async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => {});

    try {
        const settings = await Settings.findOne() || await Settings.create({});

        const text =
            `📍 <b>УПРАВЛЕНИЕ АДРЕСОМ</b>\n\n` +
            `Текущий адрес:\n<b>${settings.address || "Не указан"}</b>\n\n` +
            `Выберите, что хотите изменить:`;

        const kb = new InlineKeyboard()
            .text("📝 Изменить адрес", "edit_address")
            .row()
            .text("🖼 Изменить фото", "edit_address_photo")
            .row()
            .text("🔙 Назад", "back_to_settings_menu");

        await ctx.editMessageText(text, {
            parse_mode: "HTML",
            reply_markup: kb
        });

    } catch (error) {
        console.error("Ошибка управления адресом:", error);
    }
});

// ==========================================
// ИЗМЕНЕНИЕ ФОТО АДРЕСА
// ==========================================
bot.callbackQuery("edit_address_photo", async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => {});

    const userId = ctx.from.id;

    if (!clientSessions[userId]) {
        clientSessions[userId] = {};
    }

    clientSessions[userId].awaitingAddressPhoto = true;

    const kb = new InlineKeyboard()
        .text("🔙 Отмена", "manage_address");

    try {
        await ctx.editMessageText(
            "🖼 <b>Изменение фото адреса</b>\n\nОтправьте новое фото здания:",
            {
                parse_mode: "HTML",
                reply_markup: kb
            }
        );
    } catch (e) {}
});

bot.callbackQuery("cancel_setting_update", async (ctx) => {
    await ctx.answerCallbackQuery().catch(()=>{});
    const userId = ctx.from.id;
    if (clientSessions[userId]) {
        delete clientSessions[userId].awaitingSettingUpdate;
        delete clientSessions[userId].settingPromptMessageId;
    }
    
    try {
        const { text, kb } = await getSettingsMenuTextAndKeyboard();
        await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: kb });
    } catch (e) {
        if (!e.message.includes("message is not modified")) console.error(e);
    }
});

bot.callbackQuery("admin_cancelled_list", async (ctx) => {
    await ctx.answerCallbackQuery();
    const kb = new InlineKeyboard().text("⬅️ Назад", "admin_statistics"); 

    try {
        const cancelledBookings = await Booking.find({ status: "cancelled" }).sort({ _id: -1 }).limit(20);

        if (cancelledBookings.length === 0) {
            return await ctx.editMessageText("❌ **История отмен пуста**", { parse_mode: "Markdown", reply_markup: kb });
        }

        let text = "❌ **Последние 20 отмененных заказов:**\n\n";
        cancelledBookings.forEach((b, i) => {
            const whoCancelled = b.cancelledBy === "master" ? "Мастер" : "Клиент";
            text += `${i + 1}. ${b.clientName} (${b.dateText})\nПричина: ${b.reason || "Без причины"}\nОтменил: ${whoCancelled}\n\n`;
        });

        await ctx.editMessageText(text, { parse_mode: "Markdown", reply_markup: kb });
    } catch (err) {
        console.error("Ошибка истории отмен:", err);
    }
});

bot.callbackQuery("admin_not_cancelled_list", async (ctx) => {
    await ctx.answerCallbackQuery();

    const kb = new InlineKeyboard()
        .text("⬅️ Назад", "admin_statistics");

    try {
        // Все записи, кроме отменённых
        const bookings = await Booking.find({
            status: { $ne: "cancelled" }
        }).sort({ _id: -1 }).limit(20);

        if (bookings.length === 0) {
            return await ctx.editMessageText(
                "📋 **Записей пока нет**",
                {
                    parse_mode: "Markdown",
                    reply_markup: kb
                }
            );
        }

        // Загружаем названия услуг
        const allServices = await Service.find();
        const serviceMap = {};

        allServices.forEach(s => {
            serviceMap[s.key] = s.name.ru;
        });

        let text = "📋 **Последние 20 записей:**\n\n";

        bookings.forEach((b, i) => {
            const status =
                b.status === "pending" ? "⏳" :
                b.status === "confirmed" ? "✅" :
                "📌";

            const serviceName =
                serviceMap[b.serviceKey] ||
                b.serviceNameRu ||
                "Удаленная услуга";

            text +=
                `${i + 1}. ${status} **${b.clientName}**\n` +
                ` ${serviceName}\n` +
                `📅 ${b.dateText}\n` +
                `⏰ ${b.time}\n` +
                `👤 ${b.username || "без username"}\n\n`;
        });

        await ctx.editMessageText(text, {
            parse_mode: "Markdown",
            reply_markup: kb
        });

    } catch (err) {
        console.error("Ошибка списка всех записей:", err);

        await ctx.editMessageText(
            "❌ **Ошибка загрузки записей.**",
            {
                parse_mode: "Markdown",
                reply_markup: kb
            }
        );
    }
});
bot.callbackQuery("admin_broadcast_history", async (ctx) => {
    await ctx.answerCallbackQuery();
    const kb = new InlineKeyboard().text("⬅️ Назад", "back_to_admin");
    if (broadcastHistory.length === 0) return await ctx.editMessageText("📜 **История рассылок пуста.**", { parse_mode: "Markdown", reply_markup: kb });
    let text = "📜 **Последние рассылки:**\n\n";
    broadcastHistory.forEach((item) => { text += `🗓 **${item.date}**\n💬 _${item.text}_\n\n`; });
    await ctx.editMessageText(text, { parse_mode: "Markdown", reply_markup: kb });
});

// ==========================================
// 14. ПРОСМОТР ЗАПИСЕЙ МАСТЕРОМ
// ==========================================

bot.callbackQuery("admin_all_bookings", async (ctx) => {
    await ctx.answerCallbackQuery();

    try {
        // Подгружаем названия услуг
        const allServices = await Service.find();
        const serviceMap = {};
        allServices.forEach(s => {
            serviceMap[s.key] = s.name.ru;
        });

        // Берём только активные записи
        const bookings = await Booking.find({
            status: { $in: ["pending", "confirmed"] }
        });

const tashkentNow = getTashkentNow();

const nowTotalMinutes =
    (((tashkentNow.year * 12 + tashkentNow.month) * 31 + tashkentNow.day) * 24 + tashkentNow.hours) * 60 + tashkentNow.minutes;

// Используем общую функцию даты записи
function getBookingDate(b) {
    return getBookingDateTime(b);
};
        // Превращаем дату + время записи в Date
      
        

        // Только БУДУЩИЕ записи
      const futureBookings = bookings.filter(b => {
    const bookingDate = getBookingDate(b);

    if (bookingDate === null) return false;

    return bookingDate > nowTotalMinutes;
});

        // Сначала ближайшие
        futureBookings.sort((a, b) => {
            return getBookingDate(a) - getBookingDate(b);
        });

        const kb = new InlineKeyboard();

        // Если будущих записей нет
        if (futureBookings.length === 0) {
            kb.text("⬅️ Назад", "back_to_admin");

            return await ctx.editMessageText(
                "📋 **Ближайшие записи:**\n\nПока будущих записей нет.",
                {
                    parse_mode: "Markdown",
                    reply_markup: kb
                }
            );
        }

        // Показываем максимум 10
        const ITEMS_PER_PAGE = 10;

        let text = `📋 **Ближайшие записи (${futureBookings.length}):**\n\n`;

futureBookings
    .slice(0, ITEMS_PER_PAGE)
    .forEach((b, index) => {

        const status =
            b.status === "pending" ? "⏳" : "✅";

        const serviceName =
            serviceMap[b.serviceKey] ||
            b.serviceNameRu ||
            "Удаленная услуга";

        text +=
            `${index + 1}. ${status} **${b.clientName}**\n` +
            ` ${serviceName}\n` +
            `📅 ${b.dateText}\n` +
            `⏰ ${b.time}\n` +
            `👤 ${b.username}\n\n`;

        // Кнопки в одну строку:
        // 🔄 Перенести | 💬 Сообщение | ❌ Отменить
        // Кнопки в одной строке


kb.text(
    `❌ Отменить №${index + 1}`,
    `admin_rej_${b._id}`
).row();
    });

        kb.text("⬅️ Назад", "back_to_admin");

        await ctx.editMessageText(
            text,
            {
                parse_mode: "Markdown",
                reply_markup: kb
            }
        );

    } catch (err) {
        console.error("Ошибка при загрузке записей:", err);
    }
});
bot.callbackQuery("admin_today_bookings", async (ctx) => {
    await ctx.answerCallbackQuery();

    const tashkentNow = getTashkentNow();
    const todayStr = tashkentNow.dateText;

    try {
        // Подгружаем названия услуг
        const allServices = await Service.find();
        const serviceMap = {};

        allServices.forEach(s => {
            serviceMap[s.key] = s.name.ru;
        });

        const bookings = await Booking.find({
            dateText: todayStr,
            status: { $in: ["pending", "confirmed"] }
        });
// Убираем записи, время которых уже прошло
const currentMinutes =
    tashkentNow.hours * 60 + tashkentNow.minutes;

const activeBookings = bookings.filter((b) => {
    const [hours, minutes] = b.time.split(":").map(Number);
    const bookingMinutes = hours * 60 + minutes;

    return bookingMinutes > currentMinutes;
});

        const kb = new InlineKeyboard();

if (activeBookings.length === 0) {
        kb.text("⬅️ Назад", "back_to_admin");

            return await ctx.editMessageText(
                `📅 **Расписание на сегодня (${todayStr}):**\n\n` +
                `Записей нет. Можно отдыхать! ☕️`,
                {
                    parse_mode: "Markdown",
                    reply_markup: kb
                }
            );
        }

        // Сортируем по времени
   // Сортируем по времени
activeBookings.sort((a, b) => {
    const [hoursA, minutesA] = a.time.split(":").map(Number);
    const [hoursB, minutesB] = b.time.split(":").map(Number);

    return (hoursA * 60 + minutesA) - (hoursB * 60 + minutesB);
});

        let text =
            `📅 **Расписание на сегодня (${todayStr}) - ${activeBookings.length} шт.:**\n\n`;

        activeBookings.forEach((b, index) => {
            const serviceName =
                serviceMap[b.serviceKey] ||
                b.serviceNameRu ||
                "Удаленная услуга";

           

 const status =
    b.status === "pending" ? "⏳" : "✅";

text +=
    `${index + 1}. ${status} **${b.clientName}** | ${serviceName}\n` +
    `⏰ ${b.time} (${b.username})\n\n`;

kb.text(
    `❌ Отменить №${index + 1}`,
    `admin_rej_${b._id}`
).row();
        });

        kb.text("⬅️ Назад", "back_to_admin");

        await ctx.editMessageText(
            text,
            {
                parse_mode: "Markdown",
                reply_markup: kb
            }
        );

    } catch (err) {
        console.error("Ошибка admin_today_bookings:", err);
    }
});
// ==========================================
// 15. ОБРАБОТКА ДЕЙСТВИЙ С ЗАПИСЯМИ (НАПИСАТЬ / ПЕРЕНЕСТИ)
// ==========================================

// === ОБРАБОТЧИК КНОПКИ "НАПИСАТЬ" ===
bot.callbackQuery(/^admin_msg_/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const bId = ctx.callbackQuery.data.replace("admin_msg_", "");
    
    try {
        const booking = await Booking.findById(bId);
        if (!booking) return ctx.reply("❌ Запись не найдена. Возможно, она была удалена.");

        if (!clientSessions[ctx.from.id]) clientSessions[ctx.from.id] = {};
        clientSessions[ctx.from.id].awaitingMasterMessage = bId;

        const promptMsg = await ctx.reply(`✍️ **Введите сообщение для клиента ${booking.clientName}:**\n\n_(Текст будет отправлен клиенту от имени мастера. Можно использовать эмодзи)_`, { parse_mode: "Markdown" });
        clientSessions[ctx.from.id].msgPromptId = promptMsg.message_id;
    } catch (err) { console.error(err); }
});

bot.callbackQuery("back_to_admin", async (ctx) => {
    await ctx.answerCallbackQuery();
    if (clientSessions[ctx.from.id]) clientSessions[ctx.from.id].awaitingBroadcast = false;
    await ctx.editMessageText("👨‍💻 Панель управления Мастера\n\nВыберите действие:", { parse_mode: "Markdown", reply_markup: getAdminKeyboard() });
});

// ====== ЛОГИКА ПЕРЕНОСА (МАСТЕР) ======
bot.callbackQuery(/^admin_resch_/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const bId = ctx.callbackQuery.data.replace("admin_resch_", "");
    
    try {
        const booking = await Booking.findById(bId);
        if (!booking) return ctx.answerCallbackQuery({ text: "Запись не найдена!", show_alert: true });

        const now = new Date();
        const kb = createAdminCalendarKeyboard(now.getFullYear(), now.getMonth(), bId);
        await ctx.editMessageText(`🔄 **Перенос записи**\nКлиент: ${booking.clientName}\nТекущая дата: ${booking.dateText} ${booking.time}\n\nВыберите **новую дату** для переноса:`, { parse_mode: "Markdown", reply_markup: kb });
    } catch (err) { console.error(err); }
});

bot.callbackQuery(/^am_/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const parts = ctx.callbackQuery.data.replace("am_", "").split("_");
    const bId = parts[0];
    let year = parseInt(parts[1]), month = parseInt(parts[2]);
    if (month > 11) { month = 0; year++; }
    if (month < 0) { month = 11; year--; }
    const kb = createAdminCalendarKeyboard(year, month, bId);
    await ctx.editMessageReplyMarkup({ reply_markup: kb });
});

bot.callbackQuery(/^admindate_/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const parts = ctx.callbackQuery.data.replace("admindate_", "").split("_");
    const bId = parts[0];
    const mString = String(parseInt(parts[2]) + 1).padStart(2, '0');
    const dString = String(parts[3]).padStart(2, '0');
    
    const newDate = `${parts[1]}-${mString}-${dString}`;
    const newDateText = `${dString}.${mString}.${parts[1]}`;

    try {
        const booking = await Booking.findById(bId);
        if (!booking) return ctx.answerCallbackQuery({ text: "Запись не найдена!", show_alert: true });

        const kb = new InlineKeyboard();
        
        // Проверяем занятость каждого слота через базу данных асинхронно
        for (let i = 0; i < TIME_SLOTS.length; i++) {
            const time = TIME_SLOTS[i];
            const isBooked = await Booking.exists({ 
                date: newDate, 
                time: time, 
                status: { $in: ["pending", "confirmed"] },
                _id: { $ne: bId } // Исключаем саму эту запись
            });

            if (isBooked) {
                kb.text(`❌ ${time}`, `slot_already_booked`);
            } else {
                kb.text(time, `admintime_${bId}_${newDate}_${newDateText}_${time}`);
            }
            if ((i + 1) % 2 === 0) kb.row();
        }
        kb.row().text("❌ Отмена переноса", "back_to_admin");

        await ctx.editMessageText(`🔄 Перенос записи для **${booking.clientName}**\nНовая дата: ${newDateText}\n\nВыберите **новое время**:`, { parse_mode: "Markdown", reply_markup: kb });
    } catch (err) { console.error(err); }
});



// Нажатие на "Изменить фото"
bot.callbackQuery("admin_edit_main_photo", async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => {});
    const adminId = ctx.from.id;
    if (!adminSessions[adminId]) adminSessions[adminId] = {};
    adminSessions[adminId].action = "editing_main_photo";
    
    const kbCancel = new InlineKeyboard().text("❌ Отмена", "cancel_admin_action");
    await ctx.reply("📸 Отправьте новую <b>фотографию</b> для главного меню:", { parse_mode: "HTML", reply_markup: kbCancel });
});

// Нажатие на "Изменить текст RU"
bot.callbackQuery("admin_edit_main_text_ru", async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => {});
    const adminId = ctx.from.id;
    if (!adminSessions[adminId]) adminSessions[adminId] = {};
    adminSessions[adminId].action = "editing_main_text_ru";
    
    const kbCancel = new InlineKeyboard().text("❌ Отмена", "cancel_admin_action");
    await ctx.reply("📝 Введите новый <b>текст приветствия (RU)</b>:\n\n<i>Подсказка: используйте <code>{name}</code>, чтобы бот автоматически подставлял имя клиента.</i>", { parse_mode: "HTML", reply_markup: kbCancel });
});

// Нажатие на "Изменить текст UZ"
bot.callbackQuery("admin_edit_main_text_uz", async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => {});
    const adminId = ctx.from.id;
    if (!adminSessions[adminId]) adminSessions[adminId] = {};
    adminSessions[adminId].action = "editing_main_text_uz";
    
    const kbCancel = new InlineKeyboard().text("❌ Отмена", "cancel_admin_action");
    await ctx.reply("📝 Введите новый <b>текст приветствия (UZ)</b>:\n\n<i>Подсказка: используйте <code>{name}</code>, чтобы бот подставлял имя клиента.</i>", { parse_mode: "HTML", reply_markup: kbCancel });
});

// ==========================================
// 1. ВЫБОР ДАТЫ ПРИ ПЕРЕНОСЕ (сохраняем дату в callback короче)
// ==========================================
bot.callbackQuery(/^admindate_/, async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => {});
    const parts = ctx.callbackQuery.data.replace("admindate_", "").split("_");
    const bId = parts[0];
    const mString = String(parseInt(parts[2]) + 1).padStart(2, '0');
    const dString = String(parts[3]).padStart(2, '0');
    
    const newDate = `${parts[1]}-${mString}-${dString}`;
    const newDateText = `${dString}.${mString}.${parts[1]}`;

    try {
        const booking = await Booking.findById(bId);
        if (!booking) return ctx.answerCallbackQuery({ text: "Запись не найдена!", show_alert: true });

        const kb = new InlineKeyboard();
        
        for (let i = 0; i < TIME_SLOTS.length; i++) {
            const time = TIME_SLOTS[i];
            const isBooked = await Booking.exists({ 
                date: newDate, 
                time: time, 
                status: { $in: ["pending", "confirmed"] },
                _id: { $ne: bId } 
            });

            if (isBooked) {
                kb.text(`❌ ${time}`, `slot_already_booked`);
            } else {
                // ПРАВКА: Передаем только id, дату и время. 
                // Вместо передачи полной строки newDateText, мы передадим дату в коротком формате newDate, а текст соберем на следующем шаге.
                kb.text(time, `admintime_${bId}_${newDate}_${time}`);
            }
            if ((i + 1) % 2 === 0) kb.row();
        }
        kb.row().text("❌ Отмена переноса", "back_to_admin");

        await ctx.editMessageText(`🔄 Перенос записи для **${booking.clientName}**\nНовая дата: ${newDateText}\n\nВыберите **новое время**:`, { parse_mode: "Markdown", reply_markup: kb });
    } catch (err) { 
        console.error("Ошибка при генерации слотов для переноса:", err); 
    }
});

// ==========================================
// 2. ОБРАБОТКА ВЫБОРА ВРЕМЕНИ ДЛЯ ПЕРЕНОСА
// ==========================================
bot.callbackQuery(/^admintime_/, async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => {});

    // Ожидаемый формат: admintime_bId_YYYY-MM-DD_HH:MM
    const parts = ctx.callbackQuery.data.replace("admintime_", "").split("_");
    const bId = parts[0];
    const newDate = parts[1]; // YYYY-MM-DD
    const newTime = parts[2]; // HH:MM
    
    // Красиво собираем дату обратно в формат DD.MM.YYYY для клиента
    const dateParts = newDate.split("-");
    const newDateText = `${dateParts[2]}.${dateParts[1]}.${dateParts[0]}`;

    try {
        const booking = await Booking.findById(bId);
        if (!booking) {
            return await ctx.answerCallbackQuery({ text: "Запись не найдена!", show_alert: true });
        }

        const targetUserId = booking.userId;
        const lang = clientSessions[targetUserId]?.lang || "ru";
        
        if (booking.pendingMessageId) {
            try { await bot.api.deleteMessage(targetUserId, booking.pendingMessageId); } catch(e){}
        }

        let serviceNameRu = "Услуга";
        let serviceNameUz = "Xizmat";
        try {
            const service = await Service.findOne({ key: booking.serviceKey });
            if (service) {
                serviceNameRu = service.name.ru;
                serviceNameUz = service.name.uz || service.name.ru;
            }
        } catch (e) {
            console.error("Ошибка при получении услуги:", e);
        }

        const msg = lang === "ru" 
            ? `🔄 **Внимание! Мастер предлагает перенести вашу запись.**\n\n💅 Услуга: ${serviceNameRu}\nПредлагаемая дата: **${newDateText}**\nПредлагаемое время: **${newTime}**\n\nВы согласны?`
            : `🔄 **Diqqat! Master yozuvingizni boshqa vaqtga ko'chirishni taklif qilmoqda.**\n\n💅 Xizmat: ${serviceNameUz}\nTaklif qilinayotgan sana: **${newDateText}**\nTaklif qilinayotgan vaqt: **${newTime}**\n\nRozimisiz?`;

        // В кнопки согласия передаем короткие данные (дата в формате YYYY-MM-DD и время)
        const kb = new InlineKeyboard()
            .text(lang === "ru" ? "✅ Согласиться" : "✅ Rozi bo'lish", `client_acc_resch_${bId}_${newDate}_${newTime}`).row()
            .text(lang === "ru" ? "❌ Отказаться (отменить запись)" : "❌ Rad etish (bekor qilish)", `client_rej_resch_${bId}`);

        await bot.api.sendMessage(targetUserId, msg, { parse_mode: "Markdown", reply_markup: kb });
        
        await ctx.editMessageText(`✅ **Предложение о переносе отправлено клиенту!**\n\nНовое время: ${newDateText} в ${newTime}. Ожидаем ответа...`, { parse_mode: "Markdown" });
        
        setTimeout(async () => {
            try { await bot.api.deleteMessage(MASTER_CHAT_ID, ctx.callbackQuery.message.message_id); } catch(e){}
        }, 10000);
        
    } catch (e) {
        console.error("❌ ОШИБКА ПРИ ПЕРЕНОСЕ ЗАПИСИ (admintime_):", e);
        await ctx.answerCallbackQuery({ text: "Ошибка при отправке клиенту.", show_alert: true }).catch(()=>{});
    }
});

// ==========================================
// ОТВЕТ КЛИЕНТА НА ПЕРЕНОС (СОГЛАСИЕ)

bot.callbackQuery(/^client_acc_resch_/, async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => {});

    const parts = ctx.callbackQuery.data
        .replace("client_acc_resch_", "")
        .split("_");

    const bId = parts[0];
    const newDate = parts[1]; // YYYY-MM-DD
    const newTime = parts[2]; // HH:MM

    const dateParts = newDate.split("-");
    const newDateText = `${dateParts[2]}.${dateParts[1]}.${dateParts[0]}`;

    try {
        const booking = await Booking.findById(bId);

        if (!booking) {
            return ctx.answerCallbackQuery({
                text: "❌ Запись не найдена или уже удалена!",
                show_alert: true
            });
        }

        // Проверяем, что именно этот клиент принимает перенос
        if (String(booking.userId) !== String(ctx.from.id)) {
            return ctx.answerCallbackQuery({
                text: "❌ Эта запись принадлежит другому клиенту.",
                show_alert: true
            });
        }

        // ВАЖНО:
        // ещё раз проверяем, не занял ли кто-то новое время,
        // пока клиент думал над предложением мастера.
        const conflict = await Booking.exists({
            date: newDate,
            time: newTime,
            status: { $in: ["pending", "confirmed"] },
            _id: { $ne: bId }
        });

        if (conflict) {
            return ctx.answerCallbackQuery({
                text: "❌ Это время уже заняли. Выберите другое время.",
                show_alert: true
            });
        }

        // ==========================================
        // ПЕРЕНОСИМ СУЩЕСТВУЮЩУЮ ЗАПИСЬ
        // ==========================================

        booking.date = newDate;
        booking.dateText = newDateText;
        booking.time = newTime;
        booking.status = "confirmed";

        // Чтобы напоминание отправилось заново
        booking.reminderSent = false;

        await booking.save();

        // Удаляем сообщение с кнопками только ПОСЛЕ успешного сохранения
        try {
            await ctx.deleteMessage();
        } catch (e) {}

        // Получаем название услуги
        let serviceNameRu = booking.serviceNameRu;
        let serviceNameUz = booking.serviceNameUz;

        try {
            const service = await Service.findOne({
                key: booking.serviceKey
            });

            if (service) {
                serviceNameRu = service.nameRu || serviceNameRu;
                serviceNameUz = service.nameUz || serviceNameUz;
            }
        } catch (e) {
            console.error("Ошибка получения услуги:", e);
        }

        const lang = clientSessions[ctx.from.id]?.lang || "ru";

        // Сообщение клиенту
        const msgClient = lang === "ru"
            ? `✅ **Запись перенесена!**\n\n` +
              `💅 Услуга: ${serviceNameRu}\n` +
              `📅 Дата: **${newDateText}**\n` +
              `🕐 Время: **${newTime}**\n\n` +
              `Мастер подтвердил новое время. Ждём вас!`
            : `✅ **Yozuvingiz ko'chirildi!**\n\n` +
              `💅 Xizmat: ${serviceNameUz}\n` +
              `📅 Sana: **${newDateText}**\n` +
              `🕐 Vaqt: **${newTime}**\n\n` +
              `Usta yangi vaqtni tasdiqladi. Sizni kutamiz!`;

        await ctx.reply(msgClient, {
            parse_mode: "Markdown"
        });

        // Сообщение мастеру
        await bot.api.sendMessage(
            MASTER_CHAT_ID,
            `✅ **Клиент согласился на перенос**\n\n` +
            `👤 Клиент: ${booking.clientName}\n` +
            `💅 Услуга: ${serviceNameRu}\n` +
            `📅 Новая дата: **${newDateText}**\n` +
            `🕐 Новое время: **${newTime}**`,
            {
                parse_mode: "Markdown"
            }
        );

    } catch (e) {
        console.error(
            "❌ ОШИБКА ПРИ ПОДТВЕРЖДЕНИИ ПЕРЕНОСА КЛИЕНТОМ:",
            e
        );

        await ctx.reply(
            "Произошла ошибка при сохранении. Обратитесь к администратору."
        ).catch(() => {});
    }
});








// ==========================================
// 16. КЛИЕНТСКИЙ ИНТЕРФЕЙС И ВЫБОР
// ==========================================

// --- ВЫБОР ЯЗЫКА ---
bot.callbackQuery(/^set_lang_/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const lang = ctx.callbackQuery.data.replace("set_lang_", "");
    
    if (!clientSessions[ctx.from.id]) clientSessions[ctx.from.id] = {};
    clientSessions[ctx.from.id].lang = lang;
    
    const welcomeText = LANG[lang].welcome.replace("{name}", ctx.from.first_name);
    try { await ctx.deleteMessage(); } catch(e) {}
    
   const res = await ctx.replyWithPhoto(imgWelcome, { 
    caption: welcomeText, 
    parse_mode: "Markdown", 
    reply_markup: await getMainMenuKeyboard(lang) 
});
    
    clientSessions[ctx.from.id].menuMessageId = res.message_id;
    clientSessions[ctx.from.id].currentImage = imgWelcome;
});

bot.callbackQuery("view_portfolio", async (ctx) => {
    await ctx.answerCallbackQuery().catch(()=>{});
    const lang = clientSessions[ctx.from.id]?.lang || "ru";
    const kb = new InlineKeyboard().text(LANG[lang].back, "back_to_start");
    
    const settings = await Settings.findOne() || await Settings.create({});
    const defaultText = lang === "ru" 
        ? "📸 **Наши работы**\n\nДля просмотра переходите в Instagram! ✨" 
        : "📸 **Bizning ishlar**\n\nKo'rish uchun Instagram sahifamizga o'ting! ✨";
    
    await smartUpdate(ctx, imgPortfolio, settings.portfolioText || defaultText, kb);
});

bot.callbackQuery("view_all_services", async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => {});
    const lang = clientSessions[ctx.from.id]?.lang || "ru";
    
    try {
        const services = await Service.find({ isActive: true });
        const kb = new InlineKeyboard();
        
        if (!services || services.length === 0) {
            const emptyText = lang === "ru" 
                ? "❌ На данный момент доступных услуг нет." 
                : "❌ Hozircha xizmatlar mavjud emas.";
            kb.text(lang === "ru" ? "🔙 В главное меню" : "🔙 Asosiy menyuga", "back_to_start");
            
            try { await ctx.deleteMessage(); } catch (e) {}
            return await ctx.reply(emptyText, { parse_mode: "HTML", reply_markup: kb });
        }

        services.forEach(srv => {
            if (!srv) return;
            const srvName = srv.name?.[lang] || srv.name?.ru || srv.name?.uz || "Услуга";
            kb.text(` ${srvName}`, `view_service_${srv._id}`).row();
        });

        kb.text(lang === "ru" ? "🔙 В главное меню" : "🔙 Asosiy menyuga", "back_to_start");
        const text = lang === "ru" 
            ? "✨ <b>Наши услуги</b>\n\nВыберите, что вас интересует:" 
            : "✨ <b>Bizning xizmatlar</b>\n\nSizni nima qiziqtirayotganini tanlang:";

        try { await ctx.deleteMessage(); } catch (e) {}
        await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb });
        
    } catch (e) {
        console.error("Ошибка при выводе списка услуг:", e);
    }
});

bot.callbackQuery("view_contacts", async (ctx) => {
    await ctx.answerCallbackQuery().catch(()=>{});
    const lang = clientSessions[ctx.from.id]?.lang || "ru";
    const kb = new InlineKeyboard().text(LANG[lang]?.back || "🔙 Назад", "back_to_start");
    
    const settings = await Settings.findOne() || await Settings.create({});
    
    const textRu = `📞 **Контакты**\n\n📱 Телефон: ${settings.phone}\n\n⏰ График: ${settings.schedule}\n📍 Адрес: ${settings.address}\n\n💬 Написать мастеру: @${settings.masterUsername}`;
    const textUz = `📞 **Kontaktlar**\n\n📱 Telefon: ${settings.phone}\n\n⏰ Ish vaqti: ${settings.schedule}\n📍 Manzil: ${settings.address}\n\n💬 Masterga yozish: @${settings.masterUsername}`;
    
    const text = lang === "ru" ? textRu : textUz;

    // Удаляем старое сообщение с фото
    try { if (ctx.callbackQuery.message) await ctx.deleteMessage(); } catch(e){}

    // Отправляем только текст
    await ctx.reply(text, { parse_mode: "Markdown", reply_markup: kb });
});

// ==========================================
// 17. АДМИНКА: МЕНЮ УПРАВЛЕНИЯ УСЛУГАМИ
// ==========================================

bot.callbackQuery("manage_services", async (ctx) => {
    await ctx.answerCallbackQuery().catch(()=>{});
    
    try {
        const services = await Service.find();
        let text = "🖥️ <b>Управление услугами</b>\n\n";
        const kb = new InlineKeyboard();

        if (services.length === 0) {
            text += "<i>У вас пока нет добавленных услуг. Нажмите «Добавить», чтобы создать первую!</i>";
        } else {
            text += "Выберите услугу для редактирования:\n";
            services.forEach((s) => {
                const serviceName = (s.name && s.name.ru) ? s.name.ru : (s.title_ru || "Без названия");
                kb.text(`✏️ ${serviceName} (${s.price})`, `edit_srv_${s._id}`).row();
            });
        }

        kb.text("➕ Добавить новую услугу", "add_new_service").row();
        kb.text("🔙 Назад в настройки", "admin_panel"); 

        await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: kb });
    } catch (err) {
        console.error("Ошибка в меню услуг:", err);
    }
});

// --- ПЛАВНЫЙ ВОЗВРАТ В ОСНОВНОЕ МЕНЮ НАСТРОЕК ---
bot.callbackQuery("admin_panel", async (ctx) => {
    await ctx.answerCallbackQuery().catch(()=>{});
    
    try {
        let settings = await Settings.findOne();
        if (!settings) {
            settings = await Settings.create({});
        }

        const text = `⚙️ <b>НАСТРОЙКИ БОТА И САЛОНА</b>\n\n` +
                     `📞 <b>Телефон:</b> ${settings.phone}\n` +
                     `🕒 <b>График:</b> ${settings.schedule}\n` +
                     `📍 <b>Адрес:</b> ${settings.address}\n` +
                     `🔗 <b>Instagram:</b> ${settings.instagram}\n` +
                     `👤 <b>Юзернейм мастера:</b> @${settings.masterUsername.replace('@', '')}\n\n` +
                     `Выберите, какой пункт вы хотите изменить:`;

        const kb = new InlineKeyboard()
            .text("📞 Изменить телефон", "edit_phone").row()
            .text("🕒 Изменить график", "edit_schedule").row()
            .text("📍 Изменить адрес", "edit_address").row()
            .text("🔗 Изменить Instagram", "edit_instagram").row()
            .text("👤 Изменить Юзернейм", "edit_masterUsername").row() 
            .text("🖥️ Управление услугами", "manage_services").row()
            .text("🔙 Назад в меню", "back_to_admin_main");
            
        await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: kb });

    } catch (err) {
        console.error("Ошибка при загрузке главного меню настроек:", err);
        await ctx.reply("❌ Не удалось загрузить настройки салона.");
    }
});

// --- НАЧАЛО ДОБАВЛЕНИЯ НОВОЙ УСЛУГИ ---
bot.callbackQuery("add_new_service", async (ctx) => {
    await ctx.answerCallbackQuery().catch(()=>{});
    const adminId = ctx.from.id;
    
    adminSessions[adminId] = {
        action: "adding_service",
        step: "waiting_name_ru", 
        newData: {}              
    };

    const text = `➕ <b>Добавление новой услуги</b> (Шаг 1 из 6)\n\nВведите <b>название услуги на РУССКОМ языке</b> (например, <i> Премиальный Маникюр</i>):`;
    const kb = new InlineKeyboard().text("❌ Отмена", "cancel_admin_action");
    
    await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb });
});





// ==========================================
// 18. АДМИНКА: УПРАВЛЕНИЕ И РЕДАКТИРОВАНИЕ УСЛУГ
// ==========================================

bot.callbackQuery("cancel_admin_action", async (ctx) => {
    await ctx.answerCallbackQuery("Действие отменено").catch(()=>{});
    const adminId = ctx.from.id;
    
    if (adminSessions[adminId]) {
        delete adminSessions[adminId]; 
    }

    try {
        const services = await Service.find();
        const kb = new InlineKeyboard();
        
        services.forEach(srv => {
            const btnName = srv.name?.ru || srv.name?.uz || srv.key;
            kb.text(` ${btnName}`, `edit_srv_${srv._id}`).row();
        });
        
        kb.text("➕ Добавить услугу", "add_new_service").row(); 
        kb.text("🔙 Назад в настройки", "admin_panel");

        const text = "🖥️ <b>Управление услугами</b>\n\nВыберите услугу для редактирования:";

        if (ctx.callbackQuery.message && !ctx.callbackQuery.message.photo) {
            await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: kb });
        } else {
            try { await ctx.deleteMessage(); } catch (e) {}
            await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb });
        }
    } catch (e) {
        console.error("Ошибка при возврате в меню услуг:", e);
        await ctx.reply("❌ Произошла ошибка при загрузке списка услуг.");
    }
});

// УДАЛЕНИЕ УСЛУГИ
bot.callbackQuery(/^delete_srv_/, async (ctx) => {
    const serviceId = ctx.callbackQuery.data.replace("delete_srv_", "");
    
    try {
        await Service.findByIdAndDelete(serviceId); 
        
        await ctx.answerCallbackQuery({ 
            text: "🗑 Услуга успешно удалена!", 
            show_alert: true 
        }).catch(() => {});
        
        const services = await Service.find();
        const kb = new InlineKeyboard();
        
        services.forEach(srv => {
            const btnName = srv.name?.ru || srv.name?.uz || srv.key;
            kb.text(` ${btnName}`, `edit_srv_${srv._id}`).row();
        });
        
        kb.text("➕ Добавить услугу", "add_new_service").row(); 
        kb.text("🔙 Назад в настройки", "admin_panel");

        const text = "🖥️ <b>Управление услугами</b>\n\nВыберите услугу для редактирования:";

        if (ctx.callbackQuery.message && !ctx.callbackQuery.message.photo) {
            await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: kb });
        } else {
            try { await ctx.deleteMessage(); } catch (e) {}
            await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb });
        }

    } catch (e) {
        console.error("Ошибка при удалении услуги:", e);
        await ctx.answerCallbackQuery({ text: "❌ Ошибка при удалении", show_alert: true }).catch(() => {});
    }
});

// ИЗМЕНИТЬ ЦЕНУ
bot.callbackQuery(/^edit_price_/, async (ctx) => {
    await ctx.answerCallbackQuery().catch(()=>{});
    const serviceId = ctx.callbackQuery.data.replace("edit_price_", "");
    
    adminSessions[ctx.from.id] = {
        action: "editing_price",
        serviceId: serviceId
    };
    
    const kb = new InlineKeyboard().text("❌ Отмена", `edit_srv_${serviceId}`);
    await ctx.editMessageText("💰 <b>Введите новую цену</b> (например: <i>180.000 сум</i>):", { parse_mode: "HTML", reply_markup: kb });
});

// ИЗМЕНИТЬ НАЗВАНИЕ
bot.callbackQuery(/^edit_name_/, async (ctx) => {
    await ctx.answerCallbackQuery().catch(()=>{});
    const serviceId = ctx.callbackQuery.data.replace("edit_name_", "");
    
    adminSessions[ctx.from.id] = {
        action: "editing_name_ru",
        serviceId: serviceId
    };
    
    const kb = new InlineKeyboard().text("❌ Отмена", `edit_srv_${serviceId}`);
    await ctx.editMessageText("📝 <b>Введите новое НАЗВАНИЕ услуги на РУССКОМ языке:</b>", { parse_mode: "HTML", reply_markup: kb });
});

// ИЗМЕНИТЬ ОПИСАНИЕ
bot.callbackQuery(/^edit_desc_/, async (ctx) => {
    await ctx.answerCallbackQuery().catch(()=>{});
    const serviceId = ctx.callbackQuery.data.replace("edit_desc_", "");
    
    adminSessions[ctx.from.id] = {
        action: "editing_desc_ru",
        serviceId: serviceId
    };
    
    const kb = new InlineKeyboard().text("❌ Отмена", `edit_srv_${serviceId}`);
    await ctx.editMessageText("📝 <b>Введите новое ОПИСАНИЕ услуги на РУССКОМ языке:</b>", { parse_mode: "HTML", reply_markup: kb });
});

// ИЗМЕНИТЬ ФОТО
bot.callbackQuery(/^edit_photo_/, async (ctx) => {
    await ctx.answerCallbackQuery().catch(()=>{});
    const serviceId = ctx.callbackQuery.data.replace("edit_photo_", "");
    
    adminSessions[ctx.from.id] = {
        action: "editing_photo",
        serviceId: serviceId
    };
    
    try {
        const service = await Service.findById(serviceId);
        const kb = new InlineKeyboard().text("❌ Отмена", `edit_srv_${serviceId}`);

        try { if (ctx.callbackQuery.message) await ctx.deleteMessage(); } catch (e) {}

        if (service && service.image) {
            await ctx.replyWithPhoto(service.image, {
                caption: "🖼 <b>Текущее фото услуги.</b>\n\nОтправьте <b>НОВУЮ фотографию</b>, чтобы заменить её, или нажмите «Отмена»:",
                parse_mode: "HTML",
                reply_markup: kb
            });
        } else {
            await ctx.reply("🖼 <b>У этой услуги пока нет фото.</b>\n\nОтправьте фотографию для услуги:", {
                parse_mode: "HTML",
                reply_markup: kb
            });
        }
    } catch (e) {
        console.error("Ошибка при получении фото:", e);
        await ctx.reply("❌ Произошла ошибка. Попробуйте еще раз.");
    }
});
bot.callbackQuery("view_instagram", async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => {});

    try {
        const settings = await Settings.findOne() || await Settings.create({});

        if (settings.instagram) {
            await ctx.replyWithChatAction("typing").catch(() => {});
            
            // Открываем Instagram через URL-кнопку
            const kb = new InlineKeyboard()
                .url("📸 Instagram", settings.instagram);

            await ctx.reply("📸 <b>Instagram</b>", {
                parse_mode: "HTML",
                reply_markup: kb
            });
        }
    } catch (e) {
        console.error("Ошибка при открытии Instagram:", e);
    }
});








// ==========================================
// КЛИЕНТСКАЯ ЧАСТЬ: СПИСОК И ПРОСМОТР УСЛУГ
// ==========================================

// 1. ПОКАЗ КАТАЛОГА УСЛУГ
bot.callbackQuery("client_services", async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => {});
    
    try {
        // Определяем язык пользователя из сессии (по умолчанию 'ru')
        const userLang = ctx.session?.lang || "ru"; 
        
        // Достаем из базы только активные услуги
        const services = await Service.find({ isActive: true });

        // Если услуг пока нет в базе
        if (services.length === 0) {
            const emptyText = userLang === "uz" 
                ? "❌ Hozircha xizmatlar mavjud emas." 
                : "❌ На данный момент доступных услуг нет.";
                
            return ctx.editMessageText(emptyText, {
                reply_markup: new InlineKeyboard().text(
                    userLang === "uz" ? "🔙 Orqaga" : "🔙 Назад", 
                    "back_to_start"
                )
            });
        }

        const kb = new InlineKeyboard();
        
        // Подтягиваем название на языке клиента (ru или uz)
        services.forEach(srv => {
            const srvName = srv.name[userLang] || srv.name.ru;
            kb.text(` ${srvName}`, `view_srv_${srv._id}`).row();
        });

        kb.text(userLang === "uz" ? "🔙 Bosh menyu" : "🔙 Главное меню", "back_to_start");

        const titleText = userLang === "uz"
            ? " <b>Bizning xizmatlarimiz:</b>\n\nTafsilotlarni ko'rish va yozilish uchun xizmatni tanlang:"
            : " <b>Наши услуги:</b>\n\nВыберите услугу, чтобы узнать подробности и записаться:";

        // Умный переход: если вышли из карточки с фото — удаляем и шлем текст
        if (ctx.callbackQuery.message && ctx.callbackQuery.message.photo) {
            try { await ctx.deleteMessage(); } catch (e) {}
            await ctx.reply(titleText, { parse_mode: "HTML", reply_markup: kb });
        } else {
            await ctx.editMessageText(titleText, { parse_mode: "HTML", reply_markup: kb });
        }

    } catch (e) {
        console.error("Ошибка при выводе услуг клиенту:", e);
    }
});


// 2. КАРТОЧКА КОНКРЕТНОЙ УСЛУГИ (С ФОТО)
// ==========================================
// КАРТОЧКА КОНКРЕТНОЙ УСЛУГИ (С ПЛАВНОЙ АНИМАЦИЕЙ)
// ==========================================
bot.callbackQuery(/^view_srv_/, async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => {});
    const serviceId = ctx.callbackQuery.data.replace("view_srv_", "");
    const lang = clientSessions[ctx.from.id]?.lang || "ru"; // Используем твою логику сессий

    try {
        const service = await Service.findById(serviceId);
        
        if (!service) {
            const notFound = lang === "uz" ? "❌ Xizmat topilmadi." : "❌ Услуга не найдена.";
            return ctx.answerCallbackQuery({ text: notFound, show_alert: true }).catch(() => {});
        }

        const name = service.name[lang] || service.name.ru;
        const description = service.description[lang] || service.description.ru;

        const captionText = lang === "uz"
            ? ` <b>${name}</b>\n\n📝 <b>Tavsif:</b>\n${description}\n\n💰 <b>Narxi:</b> ${service.price}`
            : ` <b>${name}</b>\n\n📝 <b>Описание:</b>\n${description}\n\n💰 <b>Цена:</b> ${service.price}`;

        const kb = new InlineKeyboard()
            .text(lang === "uz" ? "📅 Yozilish" : "📅 Записаться", `book_srv_${serviceId}`).row()
            // ИСПРАВЛЕНИЕ: Теперь кнопка ведет в правильное меню
            .text(lang === "uz" ? "🔙 Xizmatlarga qaytish" : "🔙 Назад к услугам", "view_all_services");

        // ИСПРАВЛЕНИЕ: Плавная замена картинки (imgWelcome) на фото услуги (service.image)
        if (service.image) {
            await ctx.editMessageMedia(
                { type: "photo", media: service.image, caption: captionText, parse_mode: "HTML" },
                { reply_markup: kb }
            ).catch(e => console.log("Ошибка плавной замены фото:", e.message));
        } else {
            await ctx.editMessageCaption({ caption: captionText, parse_mode: "HTML", reply_markup: kb })
                     .catch(e => console.log("Ошибка плавной замены текста:", e.message));
        }

    } catch (e) {
        console.error("Ошибка при просмотре услуги клиентом:", e);
    }
});




// ПРОСМОТР АДРЕСА
bot.callbackQuery("view_address", async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => {});

    const lang = clientSessions[ctx.from.id]?.lang || "ru";

    const kb = new InlineKeyboard()
        .text(LANG[lang]?.back || "🔙 Назад", "back_to_start");

    // Достаем адрес и фото из базы
    const settings = await Settings.findOne() || await Settings.create({});

  const textRu = `📍 **Наш адрес**\n\n${settings.address || "Адрес не указан"}`;
const textUz = `📍 **Bizning manzil**\n\n${settings.address || "Manzil ko'rsatilmagan"}`;

const text = lang === "ru" ? textRu : textUz;

    // Используем фото адреса, если оно уже загружено
    const photoToSend = settings.addressPhoto || imgWelcome;

    await smartUpdate(ctx, photoToSend, text, kb);
});

bot.callbackQuery(/^view_service_/, async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => {});
    const serviceId = ctx.callbackQuery.data.replace("view_service_", "");
    
    if (!clientSessions[ctx.from.id]) clientSessions[ctx.from.id] = { lang: 'ru' };
    clientSessions[ctx.from.id].serviceKey = serviceId;
    const lang = clientSessions[ctx.from.id].lang;

    try {
        const service = await Service.findById(serviceId);
        
        // Защита: проверяем, нашлась ли услуга и есть ли у нее поле name
        if (!service || !service.name) {
            const notFound = lang === "ru" ? "❌ Услуга не найдена" : "❌ Xizmat topilmadi";
            return ctx.answerCallbackQuery({ text: notFound, show_alert: true }).catch(() => {});
        }

        // Безопасный доступ к свойствам через ?.
        const name = service.name?.[lang] || service.name?.ru || "Без названия";
        const description = service.description?.[lang] || service.description?.ru || "";
        const price = service.price || "0";
        const priceText = lang === "ru" ? "💰 <b>Цена:</b>" : "💰 <b>Narxi:</b>";

        const captionText = ` <b>${name}</b>\n\n📝 ${description}\n\n${priceText} ${price}`;

        const kb = new InlineKeyboard()
            .text(LANG[lang]?.book_time || "📅 Записаться", `open_calendar_${serviceId}`).row()
            .text(LANG[lang]?.back_services || "🔙 Назад", "view_all_services");

        try { await ctx.deleteMessage(); } catch (e) {}

        if (service.image) {
            await ctx.replyWithPhoto(service.image, {
                caption: captionText,
                parse_mode: "HTML",
                reply_markup: kb
            });
        } else {
            await ctx.reply(captionText, {
                parse_mode: "HTML",
                reply_markup: kb
            });
        }

    } catch (e) {
        console.error("Ошибка при просмотре услуги:", e);
    }
});
// ==========================================
// ОТКРЫТИЕ КАЛЕНДАРЯ ДЛЯ ВЫБОРА ДАТЫ
// ==========================================


bot.callbackQuery(/^m_/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const parts = ctx.callbackQuery.data.replace("m_", "").split("_");
    let year = parseInt(parts[0]), month = parseInt(parts[1]);
    if (month > 11) { month = 0; year++; }
    if (month < 0) { month = 11; year--; }
    const session = clientSessions[ctx.from.id];
    if (!session) return;
    const lang = session.lang || "ru";
    const kb = createCalendarKeyboard(year, month, session.serviceKey, lang);
    await ctx.editMessageReplyMarkup({ reply_markup: kb });
});



// ==========================================
// 19. КЛИЕНТСКАЯ ЧАСТЬ: СПИСОК И ПРОСМОТР УСЛУГ
// ==========================================

bot.callbackQuery(["client_services", "view_all_services"], async (ctx) => {
    // ВЫВОДИМ В ТЕРМИНАЛ ЛОГ ПРИ НАЖАТИИ
    console.log("👉 Кликнули на каталог услуг или кнопку назад!");

    await ctx.answerCallbackQuery().catch(() => {});
    
    const userId = ctx.from.id;
    if (!clientSessions[userId]) clientSessions[userId] = { lang: 'ru' };
    const userLang = clientSessions[userId].lang;
    
    try {
        const services = await Service.find({ isActive: true });

        if (services.length === 0) {
            const emptyText = userLang === "uz" 
                ? "❌ Hozircha xizmatlar mavjud emas." 
                : "❌ На данный момент доступных услуг нет.";
                
            const kb = new InlineKeyboard().text(
                userLang === "uz" ? "🔙 Asosiy menyuga" : "🔙 В главное меню", 
                "back_to_start"
            );

            if (ctx.callbackQuery.message && ctx.callbackQuery.message.photo) {
                try { await ctx.deleteMessage(); } catch (e) {}
                return await ctx.reply(emptyText, { parse_mode: "HTML", reply_markup: kb });
            } else {
                return await ctx.editMessageText(emptyText, { parse_mode: "HTML", reply_markup: kb });
            }
        }

        const kb = new InlineKeyboard();
        services.forEach(srv => {
            if (!srv) return;
            const srvName = srv.name?.[userLang] || srv.name?.ru || "Услуга";
            kb.text(` ${srvName}`, `view_service_${srv._id}`).row();
        });

        kb.text(userLang === "uz" ? "🔙 Bosh menyu" : "🔙 Главное меню", "back_to_start");

        const titleText = userLang === "uz"
            ? " <b>Bizning xizmatlarimiz:</b>\n\nTafsilotlarni ko'rish va yozilish uchun xizmatni tanlang:"
            : " <b>Наши услуги:</b>\n\nВыберите услугу, чтобы узнать подробности и записаться:";

        if (ctx.callbackQuery.message && ctx.callbackQuery.message.photo) {
            try { await ctx.deleteMessage(); } catch (e) {}
            await ctx.reply(titleText, { parse_mode: "HTML", reply_markup: kb });
        } else {
            await ctx.editMessageText(titleText, { parse_mode: "HTML", reply_markup: kb });
        }

    } catch (e) {
        console.error("Ошибка при выводе услуг клиенту:", e);
    }
});

// --- УНИВЕРСАЛЬНАЯ ЗАГЛУШКА ДЛЯ ВОЗВРАТА В МЕНЮ ---

// 1. Если это вдруг оказалась текстовая кнопка
bot.hears(["🔙 В главное меню", "🔙 Bosh menyu"], async (ctx) => {
    const lang = clientSessions[ctx.from.id]?.lang || "ru";
    try { await ctx.deleteMessage(); } catch(e) {}

    await ctx.replyWithPhoto(imgWelcome, { 
        caption: LANG[lang]?.welcome.replace("{name}", ctx.from.first_name) || "Добро пожаловать!", 
        parse_mode: "Markdown", 
        reply_markup: await getMainMenuKeyboard(lang) 
    });
});

// 2. Если это Inline-кнопка (перехватываем ВСЕ возможные названия)
bot.callbackQuery(["main_menu", "back", "back_to_start"], async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => {});

    await sendClientMenu(ctx);
});
// КАРТОЧКА КОНКРЕТНОЙ УСЛУГИ (С ФОТО)
bot.callbackQuery(/^view_service_|^view_srv_/, async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => {});
    const serviceId = ctx.callbackQuery.data.replace(/view_service_|view_srv_/, "");
    
    const userId = ctx.from.id;
    if (!clientSessions[userId]) clientSessions[userId] = { lang: 'ru' };
    clientSessions[userId].serviceKey = serviceId;
    const lang = clientSessions[userId].lang;

    try {
        const service = await Service.findById(serviceId);
        
        if (!service || !service.name) {
            const notFound = lang === "uz" ? "❌ Xizmat topilmadi." : "❌ Услуга не найдена.";
            return ctx.answerCallbackQuery({ text: notFound, show_alert: true }).catch(() => {});
        }

        const name = service.name?.[lang] || service.name?.ru || "Без названия";
        const description = service.description?.[lang] || service.description?.ru || "";
        const price = service.price || "0";
        const priceText = lang === "ru" ? "💰 <b>Цена:</b>" : "💰 <b>Narxi:</b>";

        const captionText = ` <b>${name}</b>\n\n📝 <b>${lang === "ru" ? "Описание" : "Tavsif"}:</b>\n${description}\n\n${priceText} ${price}`;

        const kb = new InlineKeyboard()
            .text(LANG[lang]?.book_time || (lang === "ru" ? "📅 Записаться" : "📅 Yozilish"), `open_calendar_${serviceId}`).row()
            .text(LANG[lang]?.back_services || (lang === "ru" ? "🔙 Назад" : "🔙 Orqaga"), "view_all_services");

        // Удаляем предыдущее меню (текст или фото), чтобы отправить красивую карточку
        try { await ctx.deleteMessage(); } catch (e) {}

        if (service.image) {
            await ctx.replyWithPhoto(service.image, {
                caption: captionText,
                parse_mode: "HTML",
                reply_markup: kb
            });
        } else {
            await ctx.reply(captionText, {
                parse_mode: "HTML",
                reply_markup: kb
            });
        }

    } catch (e) {
        console.error("Ошибка при просмотре услуги:", e);
    }
});



// ==========================================
// 20. ОТКРЫТИЕ КАЛЕНДАРЯ ДЛЯ ВЫБОРА ДАТЫ
// ==========================================
bot.callbackQuery(/^open_calendar_/, async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => {});
    
    const serviceId = ctx.callbackQuery.data.replace("open_calendar_", "");
    const userId = ctx.from.id;
    
    if (!clientSessions[userId]) {
        clientSessions[userId] = { lang: 'ru' };
    }
    const lang = clientSessions[userId].lang;
    clientSessions[userId].serviceKey = serviceId; // Сохраняем выбранную услугу

    const tashkentNow = getTashkentNow();
const year = tashkentNow.year;
const month = tashkentNow.month - 1;

    const kb = createCalendarKeyboard(year, month, serviceId, lang);

    const text = lang === "ru" 
        ? "📅 <b>Выберите удобную дату:</b>" 
        : "📅 <b>Qulay sanani tanlang:</b>";

    try { if (ctx.callbackQuery.message) await ctx.deleteMessage(); } catch (e) {}
    await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb });
});

// НАВИГАЦИЯ ПО КАЛЕНДАРЮ (МЕСЯЦЫ)
bot.callbackQuery(/^m_/, async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => {});
    const parts = ctx.callbackQuery.data.replace("m_", "").split("_");
    let year = parseInt(parts[0]), month = parseInt(parts[1]);
    
    // Переход между годами (декабрь -> январь и наоборот)
    if (month > 11) { month = 0; year++; }
    if (month < 0) { month = 11; year--; }
    
    const session = clientSessions[ctx.from.id];
    if (!session) return;
    const lang = session.lang || "ru";
    
    const kb = createCalendarKeyboard(year, month, session.serviceKey, lang);
    await ctx.editMessageReplyMarkup({ reply_markup: kb }).catch(() => {});
});



function getTashkentNow() {
    const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Tashkent",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false
    }).formatToParts(new Date());

    const get = (type) =>
        parts.find(p => p.type === type)?.value;

    return {
        year: Number(get("year")),
        month: Number(get("month")),
        day: Number(get("day")),
        hours: Number(get("hour")),
        minutes: Number(get("minute")),
        seconds: Number(get("second")),

        dateText: `${get("day")}.${get("month")}.${get("year")}`,

        totalMinutes:
            Number(get("hour")) * 60 +
            Number(get("minute"))
    };
}




// ==========================================
// 21. ВЫБОР ВРЕМЕНИ (ГЕНЕРАЦИЯ СЛОТОВ)
// ==========================================
bot.callbackQuery(/^date_/, async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => {});
    const parts = ctx.callbackQuery.data.replace("date_", "").split("_");
    
    let session = clientSessions[ctx.from.id];
    
    if (!session) {
        const text = "⏳ Время сессии истекло из-за обновления бота. Пожалуйста, начните заново: /start";
        return ctx.reply(text).catch(() => {});
    }

    const lang = session.lang || "ru";

    const mString = String(parseInt(parts[1]) + 1).padStart(2, '0');
    const dString = String(parts[2]).padStart(2, '0');
    
    session.date = `${parts[0]}-${mString}-${dString}`;
    session.dateText = `${dString}.${mString}.${parts[0]}`;

try { 
    const activeBookings = await Booking.find({  
        date: session.date,  
        status: { $in: ["pending", "confirmed"] }  
    }); 

    const bookedTimes = activeBookings.map(b => b.time); 

    const kb = new InlineKeyboard();

    // Текущее время именно по Ташкенту
    const tashkentNow = getTashkentNow();

    TIME_SLOTS.forEach((time, index) => { 
        const isBooked = bookedTimes.includes(time);

        // Переводим время слота в минуты
        const [hours, minutes] = time.split(":").map(Number);
        const slotMinutes = hours * 60 + minutes;

        // Закрываем прошедшие слоты только для сегодняшней даты
        const todayIso =
    `${tashkentNow.year}-${String(tashkentNow.month).padStart(2, "0")}-${String(tashkentNow.day).padStart(2, "0")}`;

const nowMinutes =
    tashkentNow.hours * 60 + tashkentNow.minutes;

const isPast =
    session.date === todayIso &&
    slotMinutes <= nowMinutes;

        if (isBooked) { 
            kb.text(`❌ ${time}`, `slot_already_booked`); 
        } else if (isPast) {
            kb.text(`🔒 ${time}`, `slot_already_past`);
        } else { 
            kb.text(time, `book_time_${time}`); 
        }

        if ((index + 1) % 2 === 0) kb.row(); 
    });
        kb.row().text(LANG[lang].back, `open_calendar_${session.serviceKey}`);

        const service = await Service.findById(session.serviceKey);
        const serviceName = service ? (service.name[lang] || service.name.ru) : (lang === "ru" ? "Услуга" : "Xizmat");

        const dateLabel = lang === "ru" ? "📅 Дата:" : "📅 Sana:";
        const serviceLabel = lang === "ru" ? " Услуга:" : " Xizmat:";
        const chooseLabel = lang === "ru" ? "Выберите свободное время:" : "Bo'sh vaqtni tanlang:";
        
        const text = `${dateLabel} <b>${session.dateText}</b>\n${serviceLabel} <b>${serviceName}</b>\n\n${chooseLabel}`;
        
        try { if (ctx.callbackQuery.message) await ctx.deleteMessage(); } catch (e) {}
        await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb });

    } catch (err) {
        console.error("Ошибка при генерации слотов времени:", err);
    }
});

bot.callbackQuery("slot_already_past", async (ctx) => {
    const lang = clientSessions[ctx.from.id]?.lang || "ru";

    await ctx.answerCallbackQuery({
        text: lang === "ru"
            ? "🔒 Это время уже прошло!"
            : "🔒 Bu vaqt allaqachon o'tib ketgan!",
        show_alert: true
    });
});

// ==========================================
// 22. БРОНИРОВАНИЕ ВРЕМЕНИ И ЗАПРОС ИМЕНИ
// ==========================================
bot.callbackQuery(/^book_time_/, async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => {});
    
    const time = ctx.callbackQuery.data.replace("book_time_", "");
    const session = clientSessions[ctx.from.id];
    
    if (!session || !session.date) {
        return ctx.answerCallbackQuery({ 
            text: "⏳ Сессия устарела! Пожалуйста, пройдите запись заново через главное меню.", 
            show_alert: true 
        }).catch(() => {});
    }
    
    const lang = session.lang || "ru";

    const tashkentNow = getTashkentNow();

const [hours, minutes] = time.split(":").map(Number);
const slotMinutes = hours * 60 + minutes;

const isPast = session.date === tashkentNow.date &&
               slotMinutes <= tashkentNow.minutes;

if (isPast) {
    return ctx.answerCallbackQuery({
        text: lang === "ru"
            ? "🔒 Это время уже прошло! Выберите другое."
            : "🔒 Bu vaqt allaqachon o'tib ketgan! Boshqa vaqtni tanlang.",
        show_alert: true
    }).catch(() => {});
}

    try {
        const isBooked = await Booking.exists({ 
            date: session.date, 
            time: time, 
            status: { $in: ["pending", "confirmed"] } 
        });

        if (isBooked) {
            const errText = lang === "ru" ? "❌ Это время успели занять! Выберите другое." : "❌ Bu vaqtni olib qo'yishdi! Boshqasini tanlang.";
            return ctx.answerCallbackQuery({ text: errText, show_alert: true }).catch(() => {});
        }
        
        session.time = time;
        session.awaitingName = true;
        
        const askNameText = lang === "ru" 
            ? "✍️ <b>На какое имя вас записать?</b>\n\nОтправьте ваше имя ответным сообщением:" 
            : "✍️ <b>Sizni qaysi ismga yozib qo'yaylik?</b>\n\nIsmingizni xabar qilib yuboring:";
        
        try { if (ctx.callbackQuery.message) await ctx.deleteMessage(); } catch(e){}
        await ctx.reply(askNameText, { parse_mode: "HTML" });

    } catch (err) {
        console.error("Ошибка при бронировании времени:", err);
    }
});

async function showMasterResultAndMenu(ctx, resultText) {
    try {
        // Показываем результат на месте заявки
        await ctx.editMessageText(resultText, {
            parse_mode: "Markdown"
        });

        // Сразу отправляем главное меню отдельным сообщением
        const menuMsg = await bot.api.sendMessage(
            MASTER_CHAT_ID,
            "👨‍💻 **Панель управления мастером**\n\nВыберите действие:",
            {
                parse_mode: "Markdown",
                reply_markup: getAdminKeyboard()
            }
        );

        // Через 10 секунд удаляем сообщение с результатом
        setTimeout(async () => {
            try {
                await bot.api.deleteMessage(
                    MASTER_CHAT_ID,
                    ctx.callbackQuery.message.message_id
                );
            } catch (e) {}
        }, 10000);

    } catch (err) {
        console.error("Ошибка показа результата мастеру:", err);
    }
}

// ==========================================
// 23. ПРИНЯТИЕ / ОТКЛОНЕНИЕ ЗАЯВКИ МАСТЕРОМ
// ==========================================
bot.callbackQuery(/^admin_conf_/, async (ctx) => {
    const bId = ctx.callbackQuery.data.replace("admin_conf_", "");
    
    try {
        const booking = await Booking.findById(bId);
        if (!booking || booking.status === "cancelled") return ctx.answerCallbackQuery({ text: "Запись не найдена или уже отменена!", show_alert: true });
       
        booking.status = "confirmed";
        await booking.save(); 

        const targetUserId = booking.userId;
       
        if (booking.pendingMessageId) {
            try { await bot.api.deleteMessage(targetUserId, booking.pendingMessageId); } catch(e){}
        }
        
        await ctx.answerCallbackQuery({
    text: "Подтверждено!",
    show_alert: false
});

await showMasterResultAndMenu(
    ctx,
    `✅ **ВЫ ПОДТВЕРДИЛИ ЗАПИСЬ**\n\n` +
    `Клиент: ${booking.clientName}\n` +
    `Дата: ${booking.dateText} в ${booking.time}`
);
       
        try {
            const userLang = clientSessions[targetUserId]?.lang || "ru";
            
            // Подтягиваем название услуги из базы
            let serviceNameRu = "Услуга";
            let serviceNameUz = "Xizmat";
            try {
                const service = await Service.findOne({ key: booking.serviceKey });
                if (service) {
                    serviceNameRu = service.name.ru;
                    serviceNameUz = service.name.uz || service.name.ru;
                }
            } catch (e) { console.error("Ошибка при поиске услуги для подтверждения:", e); }

            const notifyMsg = userLang === "ru"
                ? `🎉 **Отличные новости!**\nМастер подтвердил вашу запись!\n\nИмя: ${booking.clientName}\n💅 Услуга: **${serviceNameRu}**\n📅 Дата: **${booking.dateText}**\n🕐 Время: **${booking.time}**\n\nЖдем вас! ✨`
                : `🎉 **Ajoyib yangilik!**\nUsta yozuvingizni tasdiqladi!\n\nIsm: ${booking.clientName}\n💅 Xizmat: **${serviceNameUz}**\n📅 Sana: **${booking.dateText}**\n🕐 Vaqt: **${booking.time}**\n\nSizni kutamiz! ✨`;
            
            await bot.api.sendMessage(targetUserId, notifyMsg, { parse_mode: "Markdown" });
        } catch (e) {}
    } catch (err) { console.error(err); }
});

bot.callbackQuery(/^admin_rej_/, async (ctx) => {
    const bId = ctx.callbackQuery.data.replace("admin_rej_", "");
    
    try {
        const booking = await Booking.findById(bId);
        if (!booking || booking.status === "cancelled") return ctx.answerCallbackQuery({ text: "Запись не существует!", show_alert: true });
       
        const kb = new InlineKeyboard();
        MASTER_CANCEL_REASONS.forEach((reason, index) => { kb.text(reason, `master_reason_${bId}_${index}`).row(); });
        kb.text("⬅️ Назад в меню", "back_to_admin");
        
        await ctx.editMessageText(`Укажите причину отмены для клиента **${booking.clientName}**:`, { reply_markup: kb, parse_mode: "Markdown" });
    } catch (err) { console.error(err); }
});

bot.callbackQuery(/^master_reason_/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const parts = ctx.callbackQuery.data.split("_");
    const bId = parts[2], reasonIndex = parts[3];
    
    try {
        const booking = await Booking.findById(bId);
        if (!booking || booking.status === "cancelled") return ctx.answerCallbackQuery({ text: "Запись уже удалена!", show_alert: true });
        
        const reason = MASTER_CANCEL_REASONS[reasonIndex];
        const userIdToNotify = booking.userId;
        const userLang = clientSessions[userIdToNotify]?.lang || "ru";
        
        if (booking.pendingMessageId) {
            try { await bot.api.deleteMessage(userIdToNotify, booking.pendingMessageId); } catch(e){}
        }
        
        booking.status = "cancelled";
        booking.reason = reason;
        booking.cancelledBy = "master";
        await booking.save();
        
await showMasterResultAndMenu(
    ctx,
    `❌ **ЗАПИСЬ ОТМЕНЕНА**\n\n` +
    `Клиент: ${booking.clientName}\n` +
    `Дата: ${booking.dateText} в ${booking.time}\n\n` +
    `Причина: ${reason}`
);        
        try {
            const notifyMsg = userLang === "ru"
                ? `❌ **К сожалению, мастер отменил вашу запись.**\n\n💬 **Причина:** ${reason}\n\nПожалуйста, выберите другое время.`
                : `❌ **Afsuski, master yozuvingizni bekor qildi.**\n\n💬 **Sabab:** ${reason}\n\nIltimos, boshqa vaqtni tanlang.`;
            
            const kb = new InlineKeyboard()
                .text(userLang === "ru" ? "📅 Выбрать другое время" : "📅 Boshqa vaqtni tanlash", `open_calendar_${booking.serviceKey}`);

            const sentMsg = await bot.api.sendMessage(userIdToNotify, notifyMsg, { parse_mode: "Markdown", reply_markup: kb });
            
            if (!clientSessions[userIdToNotify]) clientSessions[userIdToNotify] = { lang: userLang };
            clientSessions[userIdToNotify].cancellationMessageId = sentMsg.message_id;

        } catch (e) {
            console.error("Ошибка при отправке уведомления клиенту:", e);
        }
    } catch (err) { console.error(err); }
});
// ==========================================
// 24. МОИ ЗАПИСИ (КЛИЕНТ) - БЕЗ ФОТО
// ==========================================
bot.callbackQuery("view_my_bookings", async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => {});

    const lang = clientSessions[ctx.from.id]?.lang || "ru";

    try {
        // Получаем только неотменённые записи пользователя
        const bookingsRaw = await Booking.find({
            userId: ctx.from.id,
            status: { $in: ["pending", "confirmed"] }
        });

      const tashkentNow = getTashkentNow();

const nowTotalMinutes =
    (((tashkentNow.year * 12 + tashkentNow.month) * 31 + tashkentNow.day) * 24 +
        tashkentNow.hours) * 60 +
    tashkentNow.minutes;

// Оставляем только будущие записи
const futureBookings = bookingsRaw.filter(b => {
    const bookingDate = getBookingDateTime(b);

    if (bookingDate === null) return false;

    return bookingDate > nowTotalMinutes;
});

        // Удаляем старое сообщение с фотографией
        try {
            if (ctx.callbackQuery.message) {
                await ctx.deleteMessage();
            }
        } catch (e) {}

        // Если будущих записей нет
        if (futureBookings.length === 0) {
            const kb = new InlineKeyboard()
                .text(
                    LANG[lang]?.back || "🔙 Назад",
                    "back_to_start"
                );

            return await ctx.reply(
                lang === "ru"
                    ? "📅 У вас нет текущих записей."
                    : "📅 Sizda hozircha faol yozuvlar yo'q.",
                {
                    reply_markup: kb
                }
            );
        }

        // Сортируем: ближайшая запись сверху
       // Сортируем: ближайшая запись сверху
futureBookings.sort((a, b) => {
    return getBookingDateTime(a) - getBookingDateTime(b);
});

        // Получаем услуги
        const services = await Service.find();

        const serviceMap = {};

        services.forEach(s => {
            serviceMap[s._id.toString()] = s;

            if (s.key) {
                serviceMap[s.key] = s;
            }
        });

        let text =
            lang === "ru"
                ? "📅 **Ваши текущие записи:**\n\n"
                : "📅 **Sizning joriy yozuvlaringiz:**\n\n";

        const kb = new InlineKeyboard();

        futureBookings.forEach((b, index) => {
            const statusTxt =
                lang === "ru"
                    ? (
                        b.status === "pending"
                            ? "⏳ На рассмотрении"
                            : "✅ Подтверждена"
                    )
                    : (
                        b.status === "pending"
                            ? "⏳ Ko'rib chiqilmoqda"
                            : "✅ Tasdiqlangan"
                    );

            const service = serviceMap[b.serviceKey];

            const serviceName = service
                ? (service.name[lang] || service.name.ru)
                : (
                    b.serviceNameRu ||
                    (lang === "ru"
                        ? "Услуга удалена"
                        : "Xizmat o'chirilgan")
                );

            text +=
                `${index + 1}. ${b.status === "pending" ? "⏳" : "✅"} **${serviceName}**\n` +
                `👤 ${b.clientName}\n` +
                `📅 ${b.dateText}\n` +
                `⏰ ${b.time}\n` +
                `${statusTxt}\n\n`;

            kb.text(
                `${LANG[lang]?.cancel_btn || "❌ Отменить"} №${index + 1}`,
                `user_cancel_${b._id}`
            ).row();
        });

        kb.text(
            LANG[lang]?.back || "🔙 Назад",
            "back_to_start"
        );

        await ctx.reply(text, {
            parse_mode: "Markdown",
            reply_markup: kb
        });

    } catch (err) {
        console.error(
            "Ошибка при просмотре записей:",
            err
        );
    }
});

bot.callbackQuery(/^user_cancel_/, async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => {});
    const bId = ctx.callbackQuery.data.replace("user_cancel_", "");
    
    try {
        const bookingExists = await Booking.exists({ _id: bId, status: { $in: ["pending", "confirmed"] } });
        if (!bookingExists) return ctx.answerCallbackQuery({ text: "Запись не найдена!", show_alert: true });
       
        const lang = clientSessions[ctx.from.id]?.lang || "ru";
        const kb = new InlineKeyboard();
        CANCEL_REASONS.forEach((reason, index) => { kb.text(reason, `user_reason_${bId}_${index}`).row(); });
        kb.text(lang === "ru" ? "⬅️ Назад" : "⬅️ Orqaga", "view_my_bookings");
        
        const text = lang === "ru" ? "Выберите причину отмены записи:" : "Yozuvni bekor qilish sababini tanlang:";
        
        // УДАЛЯЕМ ФОТОГРАФИЮ И ОТПРАВЛЯЕМ ТЕКСТ
        try { if (ctx.callbackQuery.message) await ctx.deleteMessage(); } catch(e){}
        await ctx.reply(text, { reply_markup: kb });
    } catch (err) { 
        console.error("Ошибка при подготовке отмены записи:", err); 
    }
});

bot.callbackQuery(/^user_reason_/, async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => {});
    const parts = ctx.callbackQuery.data.split("_");
    const bId = parts[2], reasonIndex = parts[3];
    const lang = clientSessions[ctx.from.id]?.lang || "ru";
    
    try {
        const booking = await Booking.findById(bId);
        
        // УДАЛЯЕМ ФОТОГРАФИЮ (если она была)
        try { if (ctx.callbackQuery.message) await ctx.deleteMessage(); } catch(e){}

        if (!booking || booking.status === "cancelled") {
            const kb = new InlineKeyboard().text(LANG[lang]?.back || "🔙 Назад", "back_to_start");
            return await ctx.reply("Запись не найдена.", { reply_markup: kb });
        }
        
        const reason = CANCEL_REASONS[reasonIndex];
        
        let serviceNameRu = "Услуга";
        try {
            const service = await Service.findById(booking.serviceKey) || await Service.findOne({ key: booking.serviceKey });
            if (service) serviceNameRu = service.name.ru;
        } catch (e) {}

        try {
            const masterMsg = await bot.api.sendMessage(
                MASTER_CHAT_ID, 
                `⚠️ **ОТМЕНА ЗАПИСИ (Клиент)**\n\n👤 Имя: ${booking.clientName}\n💅 Услуга: ${serviceNameRu}\n📅 Дата: ${booking.dateText} в ${booking.time}\n❌ Причина: ${reason}`, 
                { parse_mode: "Markdown" }
            );
            
            setTimeout(async () => {
                try { await bot.api.deleteMessage(MASTER_CHAT_ID, masterMsg.message_id); } catch (e) {} 
            }, 30000);
        } catch (e) {}

        if (booking.adminMessageId) {
            try { await bot.api.deleteMessage(MASTER_CHAT_ID, booking.adminMessageId); } catch(e) {}
        }

        booking.status = "cancelled";
        booking.reason = reason;
        booking.cancelledBy = "client";
        booking.cancelledAt = new Date();
        await booking.save();

        const kb = new InlineKeyboard().text(LANG[lang]?.back || "🔙 Назад", "back_to_start");
        const successText = lang === "ru" 
            ? `✅ Ваша запись успешно отменена.\nБудем рады видеть вас в другой раз! ✨` 
            : `✅ Sizning yozuvingiz bekor qilindi.\nSizni boshqa safar kutamiz! ✨`;
            
        // ОТПРАВЛЯЕМ ТЕКСТ
        await ctx.reply(successText, { reply_markup: kb });
    } catch (err) { 
        console.error("Ошибка при отмене записи клиентом:", err); 
    }
});
bot.callbackQuery("back_to_start", async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => {});
    const userId = ctx.from.id;
    
    // Сбрасываем флаг ожидания имени
    if (!clientSessions[userId]) clientSessions[userId] = {};
    clientSessions[userId].awaitingName = false;
    
    const lang = clientSessions[userId].lang || "ru";
    
    // 1. Получаем свежие настройки из базы
    const settings = await Settings.findOne() || {};

    // 2. Берем фото из базы (или стандартное)
    const photoToSend = settings.mainMenuPhoto || (typeof imgWelcome !== 'undefined' ? imgWelcome : null);

    // 3. Берем нужный текст из базы с учетом языка
    let templateText;
    if (lang === "uz") {
        templateText = settings.welcomeTextUz || (LANG.uz?.welcome || "Salom, {name}! 👋");
    } else {
        templateText = settings.welcomeTextRu || (LANG.ru?.welcome || "Привет, {name}! 👋");
    }
    const welcomeText = templateText.replace("{name}", ctx.from.first_name || "Гость");

    // 4. Отрисовка меню (с сохранением твоей логики плавного обновления)
    // 4. Отрисовка меню (с сохранением твоей логики плавного обновления)
if (ctx.callbackQuery.message && !ctx.callbackQuery.message.photo) {
    // Если возвращаемся из текстового раздела — удаляем текст и присылаем новое фото
    try { await ctx.deleteMessage(); } catch(e) {}
    
    let res;
    if (photoToSend) {
        res = await ctx.replyWithPhoto(photoToSend, { 
            caption: welcomeText, 
            parse_mode: "HTML",
            reply_markup: await getMainMenuKeyboard(lang) 
        });
    } else {
        res = await ctx.reply(welcomeText, {
            parse_mode: "HTML",
            reply_markup: await getMainMenuKeyboard(lang) 
        });
    }

    clientSessions[userId].menuMessageId = res.message_id;
    clientSessions[userId].currentImage = photoToSend;
    
} else {
    // Если фотография уже висит — плавно обновляем ее через твой smartUpdate
    await smartUpdate(
        ctx,
        photoToSend,
        welcomeText,
        await getMainMenuKeyboard(lang)
    );

    clientSessions[userId].currentImage = photoToSend;
}
});

bot.callbackQuery("ignore", async (ctx) => { 
    await ctx.answerCallbackQuery().catch(() => {}); 
});

bot.catch((err) => {
    console.error("🛑 ГЛОБАЛЬНАЯ ОШИБКА БОТА:");
    console.error(err); 
});

// ЗАПУСК
bot.start();
console.log("🚀 БОТ УСПЕШНО ОБНОВЛЕН И ЗАПУЩЕН! MongoDB полностью интегрирована.");