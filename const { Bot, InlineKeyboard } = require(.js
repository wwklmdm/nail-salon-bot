const { Bot, InlineKeyboard } = require("grammy");
const cron = require("node-cron"); 

const mongoose = require("mongoose");

// --- ФУНКЦИЯ ДЛЯ АВТОМАТИЧЕСКОГО ПЕРЕНОСА ДАННЫХ В БД ---
async function initDatabase() {
    try {
        // 1. Создаем начальные настройки, если база пустая
        const settingsCount = await Settings.countDocuments();
        if (settingsCount === 0) {
            await Settings.create({
                masterUsername: "wwkmldm", // Твой юзернейм по умолчанию
                phone: "+998 90 123 45 67",
                schedule: "10:00 - 20:00 (Без выходных)",
                instagram: "https://instagram.com/",
                address: "г. Ташкент, ул. Амира Темура, 1"
            });
            console.log("ℹ️ Начальные настройки салона успешно созданы в MongoDB.");
        }

        // 2. Переносим услуги из твоего SERVICES_DATA в базу данных
        const servicesCount = await Service.countDocuments();
        if (servicesCount === 0) {
            for (const [key, data] of Object.entries(SERVICES_DATA)) {
                await Service.create({
                    key: key,
                    name: {
                        ru: data.name.ru,
                        uz: data.name.uz
                    },
                    price: data.price || "150 000 сум",
                    description: {
                        ru: data.desc?.ru || data.description?.ru || "",
                        uz: data.desc?.uz || data.description?.uz || ""
                    },
                    image: data.image || ""
                });
            }
            console.log("ℹ️ Услуги из SERVICES_DATA успешно перенесены в MongoDB!");
        }
    } catch (err) {
        console.error("❌ Ошибка при инициализации базы данных:", err);
    }
}

// Подключаемся к локальной базе данных MongoDB (назовем базу salon_db)
// ==========================================
// ПОДКЛЮЧЕНИЕ К ОБЛАЧНОЙ MONGODB ATLAS
// ==========================================
const DB_USER = "baxtiyorovusmon30_db_user";
const DB_PASS = encodeURIComponent("7MSV5O9ttCpiZCHL");

const MONGO_URI = `mongodb+srv://${DB_USER}:${DB_PASS}@cluster0.wdiu32k.mongodb.net/salon_db?retryWrites=true&w=majority`;

mongoose.connect(MONGO_URI)
    .then(async () => {
        console.log("✅ Успешно подключено к облачной базе MongoDB Atlas!");
        
        if (typeof initDatabase === "function") {
            await initDatabase();
        }
        
        bot.start({
            onStart: (botInfo) => {
                console.log(`🤖 Бот @${botInfo.username} успешно запущен и слушает Telegram!`);
            }
        });
    })
    .catch(err => {
        console.error("❌ Ошибка подключения к MongoDB Atlas:");
        console.error(err.message);
    });
// Создаем структуру нашей записи для базы данных
const bookingSchema = new mongoose.Schema({
    userId: { type: Number, required: true },
    clientName: { type: String, required: true },
    username: { type: String, default: "" },
    serviceKey: { type: String, required: true },
    date: { type: String }, // Внутренний формат даты
    dateText: { type: String, required: true },
    time: { type: String, required: true },
    status: { type: String, default: "pending" },
    reminderSent: { type: Boolean, default: false },
    pendingMessageId: { type: Number },
    adminMessageId: { type: Number }
});

// Создаем модель
const Booking = mongoose.model("Booking", bookingSchema);

// --- ДОБАВЛЕННЫЕ СХЕМЫ ДЛЯ НАСТРОЕК И УСЛУГ ---

// --- СХЕМА НАСТРОЕК ---
const settingsSchema = new mongoose.Schema({
    masterUsername: { type: String, default: "wwkmldm" },
    phone: { type: String, default: "+998 90 123 45 67" },
    schedule: { type: String, default: "10:00 - 20:00 (Без выходных)" },
    instagram: { type: String, default: "https://instagram.com/" },
    address: { type: String, default: "г. Ташкент, ул. Амира Темура, 1" },
    aboutText: { type: String, default: "Добро пожаловать в наш салон! Мы делаем лучший маникюр." },
    portfolioText: { type: String, default: "📸 Наши работы\nДля просмотра переходите в Instagram! ✨" }
}); 
const Settings = mongoose.model("Settings", settingsSchema);

// ====== ЕДИНСТВЕННАЯ ПРАВИЛЬНАЯ СХЕМА ДЛЯ УСЛУГ ======
const serviceSchema = new mongoose.Schema({
    key: { type: String, required: true, unique: true }, // Уникальный ключ
    name: {
        ru: { type: String, required: true },
        uz: { type: String, required: true }
    },
    price: { type: String, required: true },
    description: {
        ru: { type: String, default: "" },
        uz: { type: String, default: "" }
    },
    image: { type: String, default: "" }, // Сюда будем сохранять картинку
    isActive: { type: Boolean, default: true }
});
const Service = mongoose.model("Service", serviceSchema);

// ----------------------------------------------

// НАСТРОЙКА БОТА
const BOT_TOKEN = "8913984681:AAGkZFjBP6bnisOkhyin3Ujtuov3xuPKxvM";
const MASTER_CHAT_ID = "1459629617";

const bot = new Bot(BOT_TOKEN);

// ГЛОБАЛЬНАЯ БАЗА ЗАПИСЕЙ И ПОЛЬЗОВАТЕЛЕЙ
// Временное хранилище для состояний админа (добавление/редактирование)
const adminSessions = {};

// --- ОБРАБОТЧИК ТЕКСТОВЫХ ОТВЕТОВ АДМИНА ---
// --- ОСНОВНОЙ ПЕРЕХВАТЧИК ТЕКСТА (ДОБАВЛЕНИЕ И РЕДАКТИРОВАНИЕ) ---
bot.on("message:text", async (ctx, next) => {
    const adminId = ctx.from.id;
    const session = adminSessions[adminId];

    if (!session) {
        return next(); 
    }
    
    const text = ctx.message.text;
    const kbCancel = new InlineKeyboard().text("❌ Отмена", "cancel_admin_action");

    // ==========================================
    // БЛОК 1: РЕДАКТИРОВАНИЕ СУЩЕСТВУЮЩЕЙ УСЛУГИ
    // ==========================================

    if (session.action === "editing_price") {
        try {
            await Service.findByIdAndUpdate(session.serviceId, { price: text });
            const savedId = session.serviceId;
            delete adminSessions[adminId];
            const kb = new InlineKeyboard().text("🔙 Вернуться к услуге", `edit_srv_${savedId}`);
            return ctx.reply("✅ <b>Цена успешно обновлена!</b>", { parse_mode: "HTML", reply_markup: kb });
        } catch (e) {
            return ctx.reply("❌ Произошла ошибка при обновлении цены.");
        }
    }

    if (session.action === "editing_name_ru") {
        session.tempNameRu = text;
        session.action = "editing_name_uz";
        return ctx.reply("📝 Отлично! Теперь введите новое <b>НАЗВАНИЕ</b> на <b>УЗБЕКСКОМ</b> языке:", { parse_mode: "HTML", reply_markup: kbCancel });
    }
    
    if (session.action === "editing_name_uz") {
        try {
            await Service.findByIdAndUpdate(session.serviceId, { "name.ru": session.tempNameRu, "name.uz": text });
            const savedId = session.serviceId;
            delete adminSessions[adminId];
            const kb = new InlineKeyboard().text("🔙 Вернуться к услуге", `edit_srv_${savedId}`);
            return ctx.reply("✅ <b>Название успешно обновлено!</b>", { parse_mode: "HTML", reply_markup: kb });
        } catch (e) { return ctx.reply("❌ Ошибка при обновлении названия."); }
    }

    if (session.action === "editing_desc_ru") {
        session.tempDescRu = text;
        session.action = "editing_desc_uz";
        return ctx.reply("📝 Отлично! Теперь введите новое <b>ОПИСАНИЕ</b> на <b>УЗБЕКСКОМ</b> языке:", { parse_mode: "HTML", reply_markup: kbCancel });
    }
    
    if (session.action === "editing_desc_uz") {
        try {
            await Service.findByIdAndUpdate(session.serviceId, { "description.ru": session.tempDescRu, "description.uz": text });
            const savedId = session.serviceId;
            delete adminSessions[adminId];
            const kb = new InlineKeyboard().text("🔙 Вернуться к услуге", `edit_srv_${savedId}`);
            return ctx.reply("✅ <b>Описание успешно обновлено!</b>", { parse_mode: "HTML", reply_markup: kb });
        } catch (e) { return ctx.reply("❌ Ошибка при обновлении описания."); }
    }

    // ==========================================
    // БЛОК 2: ДОБАВЛЕНИЕ НОВОЙ УСЛУГИ (Твой старый код)
    // ==========================================

    if (session.step === "waiting_name_ru") {
        session.newData.name_ru = text;
        session.step = "waiting_name_uz";
        return ctx.reply(`Шаг 2 из 6\n\nВведите <b>название услуги на УЗБЕКСКОМ языке</b>:`, { parse_mode: "HTML", reply_markup: kbCancel });
    }
    if (session.step === "waiting_name_uz") {
        session.newData.name_uz = text;
        session.step = "waiting_price";
        return ctx.reply(`Шаг 3 из 6\n\nВведите <b>стоимость услуги</b>:`, { parse_mode: "HTML", reply_markup: kbCancel });
    }
    if (session.step === "waiting_price") {
        session.newData.price = text;
        session.step = "waiting_desc_ru";
        return ctx.reply(`Шаг 4 из 6\n\nВведите <b>описание услуги на РУССКОМ языке</b>:`, { parse_mode: "HTML", reply_markup: kbCancel });
    }
    if (session.step === "waiting_desc_ru") {
        session.newData.desc_ru = text;
        session.step = "waiting_desc_uz";
        return ctx.reply(`Шаг 5 из 6\n\nВведите <b>описание услуги на УЗБЕКСКОМ языке</b>:`, { parse_mode: "HTML", reply_markup: kbCancel });
    }
    if (session.step === "waiting_desc_uz") {
        session.newData.desc_uz = text;
        session.step = "waiting_photo";
        return ctx.reply(`Шаг 6 из 6\n\nОтправьте <b>красивую фотографию</b> для этой услуги.`, { parse_mode: "HTML", reply_markup: kbCancel });
    }
    if (session.step === "waiting_photo") {
        return ctx.reply("Пожалуйста, отправьте именно ФОТО (картинку), а не текст. Или нажмите «Отмена».", { reply_markup: kbCancel });
    }
});


// --- ОБРАБОТЧИК ФОТОГРАФИЙ (ДОБАВЛЕНИЕ И РЕДАКТИРОВАНИЕ) ---
bot.on("message:photo", async (ctx, next) => {
    const adminId = ctx.from.id;
    const session = adminSessions[adminId];

    if (!session) return next(); 

    const photoId = ctx.message.photo[ctx.message.photo.length - 1].file_id;

    // СЦЕНАРИЙ 1: Редактирование фото у существующей услуги
    if (session.action === "editing_photo") {
        try {
            await Service.findByIdAndUpdate(session.serviceId, { image: photoId });
            const savedId = session.serviceId;
            delete adminSessions[adminId];
            const kb = new InlineKeyboard().text("🔙 Вернуться к услуге", `edit_srv_${savedId}`);
            return ctx.reply("✅ <b>Фотография услуги успешно обновлена!</b>", { parse_mode: "HTML", reply_markup: kb });
        } catch (e) {
            return ctx.reply("❌ Произошла ошибка при обновлении фотографии.");
        }
    }

    // СЦЕНАРИЙ 2: Финал добавления новой услуги (твой код)
    if (session.action === "adding_service" && session.step === "waiting_photo") {
        try {
            const uniqueKey = "srv_" + Date.now(); 
            await Service.create({
                key: uniqueKey,
                name: { ru: session.newData.name_ru, uz: session.newData.name_uz },
                price: session.newData.price,
                description: { ru: session.newData.desc_ru, uz: session.newData.desc_uz },
                image: photoId,
                isActive: true
            });
            delete adminSessions[adminId]; 
            const kb = new InlineKeyboard().text("🔙 Вернуться к услугам", "manage_services");
            return ctx.reply("✅ <b>Услуга успешно добавлена в базу!</b>", { parse_mode: "HTML", reply_markup: kb });
        } catch (e) {
            return ctx.reply("❌ Произошла ошибка при сохранении.");
        }
    }

    return next();
});
const globalBookings = {}; // Оставляем пока как заглушку, чтобы не сломать код ниже, потом уберем
const clientSessions = {};
const userIds = new Set(); 
const broadcastHistory = []; 
const cancelledBookings = [];

const TIME_SLOTS = ["10:00", "12:00", "14:00", "16:00", "18:00"];

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

// ====== СЛОВАРЬ ПЕРЕВОДОВ (Интерфейс) ======
const LANG = {
    ru: {
        welcome: "Привет, {name}! 👋\nДобро пожаловать в нашу студию. Выберите нужный раздел:",
        main_menu_title: "✨ **Главное меню:**",
        services: "✨ Посмотреть услуги",
        portfolio: "📸 Наши работы",
        my_bookings: "📅 Мои записи",
        contacts: "📞 Контакты",
        instagram: "📷 Instagram",
        address: "📍 Адрес",
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
        services: "✨ Xizmatlarni ko'rish",
        portfolio: "📸 Bizning ishlar",
        my_bookings: "📅 Mening yozuvlarim",
        contacts: "📞 Kontaktlar",
        instagram: "📷 Instagram",
        address: "Manzil",
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

const SERVICES_DATA = {
    "manicure": {
        price: "150.000 сум",
        image: "https://img.freepik.com/free-photo/beautiful-woman-hands-with-french-manicure_169016-4131.jpg",
        name: { ru: "Маникюр", uz: "Manikyur" },
        description: {
            ru: "💅 **Премиальный Маникюр**\n\nВ стоимость входит:\n• Снятие старого покрытия\n• Аппаратный/комбинированный маникюр\n• Выравнивание ногтевой пластины\n• Покрытие гель-лаком\n• Легкий массаж ✨",
            uz: "💅 **Premium Manikyur**\n\nNarxiga quyidagilar kiradi:\n• Eski qoplamani olib tashlash\n• Apparat/kombinatsiyalangan manikyur\n• Tirnoq plastinasini tekislash\n• Gel-lak bilan qoplash\n• Yengil massaj ✨"
        }
    },
    "pedicure": {
        price: "180.000 сум",
        image: "https://img.freepik.com/free-photo/pedicure-process-in-salon_23-2148766624.jpg", 
        name: { ru: "Педикюр", uz: "Pedikyur" },
        description: {
            ru: "🦶 **Профессиональный Педикюр**\n\nВ стоимость входит:\n• Обработка стоп и пальцев\n• Устранение натоптышей\n• Формирование ногтевой пластины\n• Покрытие гель-лаком\n• SPA-уход 🌿",
            uz: "🦶 **Professional Pedikyur**\n\nNarxiga quyidagilar kiradi:\n• Tovoq va barmoqlarga ishlov berish\n• Qadoqlarni yo'qotish\n• Tirnoq shaklini to'g'irlash\n• Gel-lak bilan qoplash\n• SPA-parvarish 🌿"
        }
    }
};

const MONTH_NAMES = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];

// --- ПЛАНИРОВЩИК НАПОМИНАНИЙ (ТЕПЕРЬ РАБОТАЕТ С БАЗОЙ) ---
cron.schedule("*/30 * * * *", async () => {
    const now = new Date();
    try {
        // Ищем в БД все подтвержденные записи, по которым еще не отправляли напоминание
        const bookings = await Booking.find({ status: "confirmed", reminderSent: false });
        
        for (const booking of bookings) {
            const [day, month, year] = booking.dateText.split('.').map(Number);
            const [hours, minutes] = booking.time.split(':').map(Number);
            const bookingDate = new Date(year, month - 1, day, hours, minutes);
            const diffInMinutes = (bookingDate - now) / 60000;

            if (diffInMinutes > 120 && diffInMinutes <= 150) {
                try {
                    const targetUserId = booking.userId;
                    const userLang = clientSessions[targetUserId]?.lang || "ru";
                    const serviceName = SERVICES_DATA[booking.serviceKey].name[userLang];
                    
                    const reminderMsg = userLang === "ru"
                        ? `⏰ **Напоминание о записи!**\n\nЗдравствуйте! Напоминаем, что сегодня в **${booking.time}** у вас запись на **${serviceName}**. Ждем вас! ✨`
                        : `⏰ **Yozuv bo'yicha eslatma!**\n\nSalom! Eslatib o'tamiz, bugun soat **${booking.time}** da sizning **${serviceName}** xizmatiga yozuvingiz bor. Sizni kutamiz! ✨`;

                    await bot.api.sendMessage(targetUserId, reminderMsg, { parse_mode: "Markdown" });
                    
                    // Обновляем статус в базе данных
                    booking.reminderSent = true;
                    await booking.save();
                } catch (e) { console.error("Ошибка отправки напоминания:", e) }
            }
        }
    } catch (err) { console.error("Ошибка в cron:", err) }
});

// Обновленная функция сортировки для работы с объектами из базы
function sortBookings(bookingsArray) {
    return bookingsArray.sort((a, b) => {
        const [dayA, monthA, yearA] = a.dateText.split('.').map(Number);
        const [hourA, minA] = a.time.split(':').map(Number);
        const dateA = new Date(yearA, monthA - 1, dayA, hourA, minA);

        const [dayB, monthB, yearB] = b.dateText.split('.').map(Number);
        const [hourB, minB] = b.time.split(':').map(Number);
        const dateB = new Date(yearB, monthB - 1, dayB, hourB, minB);

        return dateA - dateB;
    });
}

// ОБНОВЛЕННОЕ АДМИНСКОЕ МЕНЮ (РАБОТАЕТ С БАЗОЙ ДАННЫХ)
async function refreshAdminMenu() {
    const session = clientSessions[MASTER_CHAT_ID];
    if (!session || !session.adminMenuMessageId) return;

    try {
        if (session.currentAdminView === 'today') {
            const today = new Date();
            const todayStr = `${String(today.getDate()).padStart(2, '0')}.${String(today.getMonth() + 1).padStart(2, '0')}.${today.getFullYear()}`;
            
            // Ищем записи на сегодня в базе
            const bookingsRaw = await Booking.find({ dateText: todayStr });
            const sorted = sortBookings(bookingsRaw);
            
            const kb = new InlineKeyboard();
            if (sorted.length === 0) {
                kb.text("⬅️ Назад", "back_to_admin");
                await bot.api.editMessageText(MASTER_CHAT_ID, session.adminMenuMessageId, `📅 **Расписание на сегодня (${todayStr}):**\n\nЗаписей нет. Можно отдыхать! ☕️`, { parse_mode: "Markdown", reply_markup: kb });
                return;
            }
            let text = `📅 **Расписание на сегодня (${todayStr}) - ${sorted.length} шт.:**\n\n`;
            sorted.forEach((b, index) => {
                const status = b.status === "pending" ? "⏳" : "✅";
                text += `${index + 1}. ${status} **${b.clientName}** | ${SERVICES_DATA[b.serviceKey]?.name.ru}\n⏰ Время: ${b.time} (${b.username})\n\n`;
                kb.text(`🔄 Перенести №${index + 1}`, `admin_resch_${b._id}`);
                kb.text(`❌ Отменить №${index + 1}`, `admin_rej_${b._id}`).row();
            });
            kb.text("⬅️ Назад", "back_to_admin");
            await bot.api.editMessageText(MASTER_CHAT_ID, session.adminMenuMessageId, text, { parse_mode: "Markdown", reply_markup: kb });
        } else if (session.currentAdminView && session.currentAdminView.startsWith('all_')) {
            const page = parseInt(session.currentAdminView.split('_')[1]) || 0;
            
            // Ищем ВСЕ записи в базе
            const bookingsRaw = await Booking.find({});
            const sorted = sortBookings(bookingsRaw);
            
            const kb = new InlineKeyboard();
            if (sorted.length === 0) {
                kb.text("⬅️ Назад", "back_to_admin");
                await bot.api.editMessageText(MASTER_CHAT_ID, session.adminMenuMessageId, "📋 **Все записи:**\n\nПока пусто.", { parse_mode: "Markdown", reply_markup: kb });
                return;
            }
            const ITEMS_PER_PAGE = 10;
            const totalPages = Math.ceil(sorted.length / ITEMS_PER_PAGE);
            const p = Math.min(Math.max(page, 0), totalPages - 1);
            const currentItems = sorted.slice(p * ITEMS_PER_PAGE, (p + 1) * ITEMS_PER_PAGE);
            let text = `📋 **Все активные записи (${sorted.length}):**\nСтраница ${p + 1} из ${totalPages}\n\n`;
            currentItems.forEach((b, index) => {
                const globalIndex = p * ITEMS_PER_PAGE + index + 1;
                const status = b.status === "pending" ? "⏳" : "✅";
                text += `${globalIndex}. ${status} **${b.clientName}** | ${SERVICES_DATA[b.serviceKey]?.name.ru}\n📅 ${b.dateText} в ${b.time} (${b.username})\n\n`;
                kb.text(`🔄 Перенести №${globalIndex}`, `admin_resch_${b._id}`);
                kb.text(`❌ Отменить №${globalIndex}`, `admin_rej_${b._id}`).row();
            });
            if (p > 0) kb.text("⬅️ Пред", `admin_all_bookings_${p - 1}`);
            if (p < totalPages - 1) kb.text("След ➡️", `admin_all_bookings_${p + 1}`);
            if (p > 0 || p < totalPages - 1) kb.row();
            kb.text("⬅️ Назад", "back_to_admin");
            await bot.api.editMessageText(MASTER_CHAT_ID, session.adminMenuMessageId, text, { parse_mode: "Markdown", reply_markup: kb });
        } else {
            session.currentAdminView = 'menu';
            await bot.api.editMessageText(MASTER_CHAT_ID, session.adminMenuMessageId, "👨‍💻 **Панель управления мастером**\n\nЗдесь вы можете управлять своими записями.\nВыберите действие:", { parse_mode: "Markdown", reply_markup: getAdminKeyboard() });
        }
    } catch (e) { console.error("Error in refreshAdminMenu:", e); }
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

// ====== КЛАВИАТУРЫ ======
function getLanguageKeyboard() {
    return new InlineKeyboard().text("🇷🇺 Русский", "set_lang_ru").row().text("🇺🇿 O'zbekcha", "set_lang_uz");
}

function getMainMenuKeyboard(lang) {
    const t = LANG[lang];
    return new InlineKeyboard()
        .text(t.services, "view_all_services").row()
        .text(t.portfolio, "view_portfolio").row()
        .text(t.my_bookings, "view_my_bookings").row()
        .text(t.contacts, "view_contacts").row()
        .text(t.instagram, "view_instagram").row()
        .text(t.address, "view_address");
}

function getAdminKeyboard() {
    return new InlineKeyboard()
        .text("📊 Статистика", "admin_statistics").row()
        .text("📋 Все записи", "admin_all_bookings").row()
        .text("📅 На сегодня", "admin_today_bookings").row()
        .text("📢 Сделать рассылку", "admin_broadcast_init").row()
        .text("📜 История рассылок", "admin_broadcast_history").row()
        .text("⚙️ Настройки", "admin_settings"); // <- ДОБАВИЛИ ЭТУ КНОПКУ
}

function getServicesKeyboard(lang) {
    const t = LANG[lang];
    const kb = new InlineKeyboard();
    for (const [key, data] of Object.entries(SERVICES_DATA)) {
        kb.text(`💅 ${data.name[lang]}`, `view_service_${key}`).row();
    }
    kb.text(t.back, "back_to_start");
    return kb;
}

// КАЛЕНДАРЬ ДЛЯ КЛИЕНТА
function createCalendarKeyboard(year, month, serviceKey, lang) {
    const t = LANG[lang];
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

// КАЛЕНДАРЬ ДЛЯ МАСТЕРА (ПЕРЕНОС)
function createAdminCalendarKeyboard(year, month, bookingId) {
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


// КАЛЕНДАРЬ ДЛЯ МАСТЕРА И КЛИЕНТА (ПЕРЕНОС)
function createRescheduleCalendarKeyboard(year, month, bookingId, role, lang) {
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

// ====== ЛОГИКА СТАРТА ======
async function sendClientMenu(ctx) {
    const userId = ctx.from.id;
    if (!clientSessions[userId]) clientSessions[userId] = {};
    clientSessions[userId].awaitingName = false; 
    
    if (!clientSessions[userId].lang) {
        await ctx.reply(LANG.ru.choose_lang, { reply_markup: getLanguageKeyboard() });
        return;
    }

    const lang = clientSessions[userId].lang;
    const welcomeText = LANG[lang].welcome.replace("{name}", ctx.from.first_name);
    
    if (clientSessions[userId].menuMessageId) {
        try { await bot.api.deleteMessage(userId, clientSessions[userId].menuMessageId); } catch(e){}
    }

    clientSessions[userId].currentImage = imgWelcome; 
    const res = await ctx.replyWithPhoto(imgWelcome, {
        caption: welcomeText,
        parse_mode: "Markdown",
        reply_markup: getMainMenuKeyboard(lang)
    });
    clientSessions[userId].menuMessageId = res.message_id;
}

bot.command("start", async (ctx) => {
    const userId = ctx.from.id.toString();
    userIds.add(ctx.from.id);

    if (userId === MASTER_CHAT_ID) {
        try { await ctx.deleteMessage(); } catch(e){} 
        const res = await ctx.reply("👨‍💻 **Панель управления мастером**\n\nЗдесь вы можете управлять своими записями.\nВыберите действие:", {
            parse_mode: "Markdown",
            reply_markup: getAdminKeyboard()
        });
        if (!clientSessions[ctx.from.id]) clientSessions[ctx.from.id] = {};
        clientSessions[ctx.from.id].adminMenuMessageId = res.message_id; 
    } else {
        if (clientSessions[ctx.from.id]?.menuMessageId) {
            try { await bot.api.deleteMessage(ctx.from.id, clientSessions[ctx.from.id].menuMessageId); } catch(e){}
        }
        try { await ctx.deleteMessage(); } catch(e){}
        await sendClientMenu(ctx);
    }
});

// ====== ОБРАБОТКА ТЕКСТА ======
bot.on("message:text", async (ctx) => {
    const userId = ctx.from.id;
    const session = clientSessions[userId];

    // --- ОБРАБОТКА ВВОДА НОВЫХ НАСТРОЕК МАСТЕРОМ ---
   // --- 4. ОБРАБОТКА ВВОДА НОВЫХ НАСТРОЕК МАСТЕРОМ ---
    if (session && session.awaitingSettingUpdate) {
        const settingKey = session.awaitingSettingUpdate;
        let newValue = ctx.message.text;

        // Если мастер ввел @ перед юзернеймом - убираем его, чтобы не сломать ссылку
        if (settingKey === "masterUsername" && newValue.startsWith("@")) {
            newValue = newValue.substring(1);
        }

        try {
            // Обновляем данные в базе MongoDB
            await Settings.updateOne({}, { [settingKey]: newValue });

            // Удаляем сообщение-запрос от бота
            if (session.settingPromptMessageId) {
                try { await bot.api.deleteMessage(ctx.chat.id, session.settingPromptMessageId); } catch(e){}
            }
            // Удаляем текст, который только что написал мастер, чтобы чат был чистым
            try { await ctx.deleteMessage(); } catch(e){}

            // Очищаем сессию
            delete session.awaitingSettingUpdate;
            delete session.settingPromptMessageId;

            // Генерируем свежее меню и отправляем его с сообщением об успехе
            const { text, kb } = await getSettingsMenuTextAndKeyboard();
            await ctx.reply(`✅ <b>Успешно обновлено!</b>\n\n${text}`, { 
                parse_mode: "HTML", 
                reply_markup: kb 
            });

        } catch (err) {
            console.error("Ошибка при обновлении настройки:", err);
            await ctx.reply("❌ Ошибка при сохранении. Попробуйте еще раз.", { reply_markup: getAdminKeyboard() });
        }
        return; // Прерываем код, чтобы бот не пошел дальше
    }
    
    // === 1. ЛОГИКА ОТПРАВКИ СООБЩЕНИЯ ОТ МАСТЕРА КЛИЕНТУ (ТЕПЕРЬ С MongoDB) ===
    if (session && session.awaitingMasterMessage) {
        const bId = session.awaitingMasterMessage;
        
        // Ищем запись в MongoDB по её уникальному ID
        let booking = null;
        try {
            booking = await Booking.findById(bId);
        } catch (err) {
            console.error("Ошибка при поиске записи для отправки ответа:", err);
        }
        
        if (booking) {
            const targetUserId = booking.userId;
            const textToSend = ctx.message.text;
            
            try {
                const userLang = clientSessions[targetUserId]?.lang || "ru";
                
                // Текст сообщения (жирный шрифт и смайлик)
                const notification = userLang === "ru" 
                    ? `📩 **Сообщение от мастера!**\n\n💬 ${textToSend}`
                    : `📩 **Ustadan xabar!**\n\n💬 ${textToSend}`;
                
                // Кнопка-ссылка для прямого перехода в личку
                const masterUsername = "wwkmldm"; 
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
                console.error(e);
                await ctx.reply("❌ Ошибка при отправке. Возможно, клиент заблокировал бота.");
            }
        } else {
            const errorMsg = await ctx.reply("❌ Запись не найдена в базе данных, отправка отменена.");
            setTimeout(async () => {
                try { await bot.api.deleteMessage(ctx.chat.id, errorMsg.message_id); } catch(e){}
            }, 5000);
        }
        
        // Очищаем чат от лишних сообщений
        if (session.msgPromptId) {
            try { await bot.api.deleteMessage(ctx.chat.id, session.msgPromptId); } catch(e){}
        }
        try { await ctx.deleteMessage(); } catch(e){} 
        
        // Сбрасываем состояние сессии
        delete session.awaitingMasterMessage;
        delete session.msgPromptId;
        
        return; // Прерываем выполнение
    }


    // --- 2. ОБРАБОТКА РАССЫЛКИ ---
    if (userId.toString() === MASTER_CHAT_ID && session?.awaitingBroadcast) {
        session.awaitingBroadcast = false; 
        const broadcastText = ctx.message.text;
        
        // Удаляем отправленный мастером текст, чтобы не засорять чат
        try { await ctx.deleteMessage(); } catch(e){}
        
        // Удаляем старое меню админа
        if (session.adminMenuMessageId) {
            try { await bot.api.deleteMessage(MASTER_CHAT_ID, session.adminMenuMessageId); } catch(e){}
        }
        
        const now = new Date();
        const dateStr = `${String(now.getDate()).padStart(2, '0')}.${String(now.getMonth()+1).padStart(2, '0')}.${now.getFullYear()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        broadcastHistory.unshift({ text: broadcastText, date: dateStr });
        if (broadcastHistory.length > 10) broadcastHistory.pop(); 

        const allUsers = new Set([...userIds, ...Object.keys(clientSessions).map(Number)]);

        let successCount = 0; let failCount = 0;
        for (const uId of allUsers) {
            if (!uId || isNaN(uId) || uId.toString() === MASTER_CHAT_ID) continue; 
            try {
                await bot.api.sendMessage(uId, `📢 **Сообщение от мастера:**\n\n${broadcastText}`, { parse_mode: "Markdown" });
                successCount++;
            } catch (e) { failCount++; }
        }
        
        const reportMsg = `✅ **Вы успешно сделали рассылку!**\n\nДоставлено клиентам: ${successCount}\nЗаблокировали бота: ${failCount}\n\n_Все рассылки находятся в истории рассылок._`;
        
        const res = await ctx.reply(reportMsg, { parse_mode: "Markdown", reply_markup: getAdminKeyboard() });
        session.adminMenuMessageId = res.message_id; 
        
        return;
    }

// --- 3. ОБРАБОТКА ИМЕНИ КЛИЕНТА ---
    if (session && session.awaitingName) {
        session.awaitingName = false;
        const clientNameInput = ctx.message.text;
        const lang = session.lang || "ru";
        try { await ctx.deleteMessage(); } catch(e){} 

        // ИСПРАВЛЕНИЕ: Достаем названия услуги из MongoDB
        let serviceNameClient = lang === "ru" ? "Услуга" : "Xizmat";
        let serviceNameAdmin = "Услуга";
        try {
            const service = await Service.findById(session.serviceKey);
            if (service) {
                serviceNameClient = service.name[lang] || service.name.ru;
                serviceNameAdmin = service.name.ru;
            }
        } catch (err) {
            console.error("Ошибка при поиске названия услуги:", err);
        }
        
        // СОЗДАЕМ ЗАПИСЬ В MONGODB
        const newBooking = new Booking({
            userId: userId,
            clientName: clientNameInput, 
            username: ctx.from.username ? `@${ctx.from.username}` : "Скрыт",
            serviceKey: session.serviceKey, 
            date: session.date,
            dateText: session.dateText,
            time: session.time,
            status: "pending",
            reminderSent: false
        });

        // Сохраняем в базу, чтобы MongoDB выдала уникальный _id
        await newBooking.save();
        
        const bookingId = newBooking._id.toString();

        if (session.menuMessageId) {
            try { await bot.api.deleteMessage(userId, session.menuMessageId); } catch(e){}
        }

        const minimalKb = new InlineKeyboard()
            .text(lang === "ru" ? "🏠 В главное меню" : "🏠 Asosiy menyuga", "back_to_start").row()
            .text(lang === "ru" ? "💅 Заказать еще услугу" : "💅 Yana xizmat buyurtma qilish", "view_all_services").row()
            .text(lang === "ru" ? "📅 Мои записи" : "📅 Mening yozuvlarim", "view_my_bookings");
            
        const sentMenu = await bot.api.sendPhoto(userId, imgSuccess, {
            caption: lang === "ru" ? "✨ Что делать дальше?" : "✨ Keyin nima qilamiz?", 
            parse_mode: "Markdown", reply_markup: minimalKb
        });
        session.menuMessageId = sentMenu.message_id;
        session.currentImage = imgSuccess;

        if (session.cancellationMessageId) {
            try { 
                await bot.api.deleteMessage(userId, session.cancellationMessageId); 
                delete session.cancellationMessageId; 
            } catch(e) {}
        }

        const successMsg = lang === "ru"
            ? `⏳ **Ваша заявка отправлена мастеру!**\n\n👤 Имя: ${clientNameInput}\n💅 Услуга: ${serviceNameClient}\n📅 Дата: ${session.dateText}\n⏰ Время: ${session.time}\n\nОжидайте подтверждения!`
            : `⏳ **Sizning arizangiz ustaga yuborildi!**\n\n👤 Ism: ${clientNameInput}\n💅 Xizmat: ${serviceNameClient}\n📅 Sana: ${session.dateText}\n⏰ Vaqt: ${session.time}\n\nTasdiqlashni kuting!`;

        const pendingMsg = await bot.api.sendMessage(userId, successMsg, { parse_mode: "Markdown" });
        
        newBooking.pendingMessageId = pendingMsg.message_id;

        try {
            const masterKb = new InlineKeyboard()
                .text("✅ Подтвердить", `admin_conf_${bookingId}`).row()
                .text("🔄 Перенести", `admin_resch_${bookingId}`).row()
                .text("❌ Отклонить", `admin_rej_${bookingId}`);
                
            const adminMsg = `🔔 **НОВАЯ ЗАЯВКА!**\n\n👤 Имя: **${clientNameInput}**\n🔗 ТГ: ${ctx.from.first_name} (${newBooking.username})\n💅 Услуга: ${serviceNameAdmin}\n📅 Дата: ${session.dateText}\n🕐 Время: ${session.time}`;
            
            const sentToAdmin = await bot.api.sendMessage(MASTER_CHAT_ID, adminMsg, { parse_mode: "Markdown", reply_markup: masterKb });
            
            newBooking.adminMessageId = sentToAdmin.message_id; 
            await newBooking.save();
        } catch (e) {
            console.error(e);
        }
    }

});

// ====== АДМИН ПАНЕЛЬ ======
bot.callbackQuery("admin_broadcast_init", async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!clientSessions[ctx.from.id]) clientSessions[ctx.from.id] = {};
    clientSessions[ctx.from.id].awaitingBroadcast = true;
    clientSessions[ctx.from.id].adminMenuMessageId = ctx.callbackQuery.message.message_id;
    await ctx.editMessageText("✍ *Отправьте текст сообщения для рассылки:*", { parse_mode: "Markdown", reply_markup: new InlineKeyboard().text("❌ Отмена", "back_to_admin") });
});

// В обработчике edit_srv_ убедись, что перед открытием текста удаляется предыдущее сообщение (если это была фотка)
bot.callbackQuery(/^edit_srv_/, async (ctx) => {
    await ctx.answerCallbackQuery().catch(()=>{});
    const serviceId = ctx.callbackQuery.data.replace("edit_srv_", "");
    
    // Очищаем сессию, если она была активна
    if (adminSessions[ctx.from.id]) {
        delete adminSessions[ctx.from.id];
    }

    try {
        const service = await Service.findById(serviceId);
        if (!service) return;

        const text = `💅 <b>Управление услугой:</b> ${service.name.ru}\n\n` +
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

        // УДАЛЯЕМ предыдущее сообщение (будь то фотка или старый текст) и присылаем чистое меню
        try { await ctx.deleteMessage(); } catch(e){}
        await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb });

    } catch (err) {
        console.error(err);
    }
});

bot.callbackQuery("admin_statistics", async (ctx) => {
    await ctx.answerCallbackQuery();
    
    try {
        // Считаем показатели напрямую из базы данных
        const activeCount = await Booking.countDocuments({ status: { $in: ["pending", "confirmed"] } });
        const cancelledCount = await Booking.countDocuments({ status: "cancelled" });
        const totalCount = activeCount + cancelledCount; 

        const text = `📊 **Статистика бота:**\n\n` +
                     `📈 Всего заявок: **${totalCount}**\n` +
                     `✅ Активные: **${activeCount}**\n` +
                     `❌ Отмененные: **${cancelledCount}**`;

        const kb = new InlineKeyboard()
            .text("❌ Посмотреть историю отмен", "admin_cancelled_list").row()
            .text("⬅️ Назад", "back_to_admin");

        await ctx.editMessageText(text, { parse_mode: "Markdown", reply_markup: kb });
    } catch (err) {
        console.error("Ошибка статистики:", err);
        await ctx.editMessageText("❌ Ошибка загрузки статистики.", { reply_markup: new InlineKeyboard().text("⬅️ Назад", "back_to_admin") });
    }
});

// --- ОБРАБОТКА НАЖАТИЯ НА "⚙️ НАСТРОЙКИ" В АДМИНКЕ ---
// Вспомогательная функция для генерации меню настроек
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
        .text("📞 Изменить телефон", "edit_phone").row()
        .text("🕒 Изменить график", "edit_schedule").row()
        .text("📍 Изменить адрес", "edit_address").row()
        .text("🔗 Изменить Instagram", "edit_instagram").row()
        .text("👤 Изменить Юзернейм", "edit_masterUsername").row()
        .text("📸 Изменить 'Наши работы'", "edit_portfolioText").row() // Оставили только это!
        .text("💅 Управление услугами", "manage_services").row()
        .text("🔙 Назад в меню", "back_to_admin_main");
        
    return { text, kb };
}

// Открытие настроек
bot.callbackQuery("admin_settings", async (ctx) => {
    await ctx.answerCallbackQuery().catch(()=>{}); // Убираем часики загрузки
    try {
        const { text, kb } = await getSettingsMenuTextAndKeyboard();
        await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: kb });
    } catch (e) {
        // Игнорируем ошибку, если текст не изменился
        if (!e.message.includes("message is not modified")) console.error(e);
    }
});

// Назад в главное меню
bot.callbackQuery("back_to_admin_main", async (ctx) => {
    await ctx.answerCallbackQuery().catch(()=>{});
    try {
        await ctx.editMessageText("👋 Добро пожаловать в панель управления, Мастер!", {
            reply_markup: getAdminKeyboard()
        });
    } catch (e) {}
});

// Нажатие на кнопки "Изменить ..."
// Нажатие на кнопки "Изменить ..."
// Нажатие на кнопки "Изменить ..."
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
// Кнопка "Отмена" - просто возвращаем меню настроек
bot.callbackQuery("cancel_setting_update", async (ctx) => {
    await ctx.answerCallbackQuery().catch(()=>{});
    const userId = ctx.from.id;
    if (clientSessions[userId]) {
        delete clientSessions[userId].awaitingSettingUpdate;
        delete clientSessions[userId].settingPromptMessageId;
    }
    
    try {
        // Получаем свежее меню и возвращаем его на экран
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
        // Ищем последние 20 отмененных записей в базе данных
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

bot.callbackQuery("admin_broadcast_history", async (ctx) => {
    await ctx.answerCallbackQuery();
    const kb = new InlineKeyboard().text("⬅️ Назад", "back_to_admin");
    if (broadcastHistory.length === 0) return await ctx.editMessageText("📜 **История рассылок пуста.**", { parse_mode: "Markdown", reply_markup: kb });
    let text = "📜 **Последние рассылки:**\n\n";
    broadcastHistory.forEach((item) => { text += `🗓 **${item.date}**\n💬 _${item.text}_\n\n`; });
    await ctx.editMessageText(text, { parse_mode: "Markdown", reply_markup: kb });
});

bot.callbackQuery("admin_all_bookings", async (ctx) => {
    await ctx.answerCallbackQuery();
    
    try {
        // Достаем все активные (не отмененные) записи из базы
        const bookings = await Booking.find({ status: { $in: ["pending", "confirmed"] } });
        const kb = new InlineKeyboard();
        
        if (bookings.length === 0) {
            kb.text("⬅️ Назад", "back_to_admin");
            return await ctx.editMessageText("📋 **Все записи:**\n\nПока пусто.", { parse_mode: "Markdown", reply_markup: kb });
        }
        
        let text = `📋 **Все активные записи (${bookings.length}):**\n\n`;
        bookings.forEach((b, index) => {
            const status = b.status === "pending" ? "⏳" : "✅";
            text += `${index + 1}. ${status} **${b.clientName}** | ${SERVICES_DATA[b.serviceKey]?.name.ru}\n📅 ${b.dateText} в ${b.time} (${b.username})\n\n`;
            kb.text(`🔄 Перенести №${index + 1}`, `admin_resch_${b._id}`);
            kb.text(`❌ Отменить №${index + 1}`, `admin_rej_${b._id}`).row();
        });
        kb.text("⬅️ Назад", "back_to_admin");
        
        await ctx.editMessageText(text, { parse_mode: "Markdown", reply_markup: kb });
    } catch (err) { console.error(err); }
});

bot.callbackQuery("admin_today_bookings", async (ctx) => {
    await ctx.answerCallbackQuery();
    const today = new Date();
    const todayStr = `${String(today.getDate()).padStart(2, '0')}.${String(today.getMonth() + 1).padStart(2, '0')}.${today.getFullYear()}`;
    
    try {
        // Ищем активные записи на сегодня в базе
        const bookings = await Booking.find({ dateText: todayStr, status: { $in: ["pending", "confirmed"] } });
        const kb = new InlineKeyboard();

        if (bookings.length === 0) {
            kb.text("⬅️ Назад", "back_to_admin");
            return await ctx.editMessageText(`📅 **Расписание на сегодня (${todayStr}):**\n\nЗаписей нет. Можно отдыхать! ☕️`, { parse_mode: "Markdown", reply_markup: kb });
        }
        
        let text = `📅 **Расписание на сегодня (${todayStr}) - ${bookings.length} шт.:**\n\n`;
        bookings.forEach((b, index) => {
            const status = b.status === "pending" ? "⏳" : "✅";
            text += `${index + 1}. ${status} **${b.clientName}** | ${SERVICES_DATA[b.serviceKey]?.name.ru}\n⏰ Время: ${b.time} (${b.username})\n\n`;
            
            kb.text(`🔄 Перенести №${index + 1}`, `admin_resch_${b._id}`);
            kb.text(`❌ Отменить №${index + 1}`, `admin_rej_${b._id}`).row();
            kb.text(`💬 Написать №${index + 1}`, `admin_msg_${b._id}`).row(); 
        });
        kb.text("⬅️ Назад", "back_to_admin");
        
        await ctx.editMessageText(text, { parse_mode: "Markdown", reply_markup: kb });
    } catch (err) { console.error(err); }
});

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
    await ctx.editMessageText("👨‍💻 **Панель управления мастером**\n\nВыберите действие:", { parse_mode: "Markdown", reply_markup: getAdminKeyboard() });
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

bot.callbackQuery(/^admintime_/, async (ctx) => {
    const parts = ctx.callbackQuery.data.replace("admintime_", "").split("_");
    const bId = parts[0];
    const newDate = parts[1];
    const newDateText = parts[2];
    const newTime = parts[3];
    
    try {
        const booking = await Booking.findById(bId);
        if (!booking) return ctx.answerCallbackQuery({ text: "Запись не найдена!", show_alert: true });

        const targetUserId = booking.userId;
        const lang = clientSessions[targetUserId]?.lang || "ru";
        
        if (booking.pendingMessageId) {
            try { await bot.api.deleteMessage(targetUserId, booking.pendingMessageId); } catch(e){}
        }

        const msg = lang === "ru" 
            ? `🔄 **Внимание! Мастер предлагает перенести вашу запись.**\n\n💅 Услуга: ${SERVICES_DATA[booking.serviceKey].name.ru}\nПредлагаемая дата: **${newDateText}**\nПредлагаемое время: **${newTime}**\n\nВы согласны?`
            : `🔄 **Diqqat! Usta yozuvingizni boshqa vaqtga ko'chirishni taklif qilmoqda.**\n\n💅 Xizmat: ${SERVICES_DATA[booking.serviceKey].name.uz}\nTaklif qilinayotgan sana: **${newDateText}**\nTaklif qilinayotgan vaqt: **${newTime}**\n\nRozimisiz?`;

        const kb = new InlineKeyboard()
            .text(lang === "ru" ? "✅ Согласиться" : "✅ Rozi bo'lish", `client_acc_resch_${bId}_${newDate}_${newDateText}_${newTime}`).row()
            .text(lang === "ru" ? "❌ Отказаться (отменить запись)" : "❌ Rad etish (bekor qilish)", `client_rej_resch_${bId}`);

        await bot.api.sendMessage(targetUserId, msg, { parse_mode: "Markdown", reply_markup: kb });
        
        await ctx.editMessageText(`✅ **Предложение о переносе отправлено клиенту!**\n\nНовое время: ${newDateText} в ${newTime}. Ожидаем ответа...`);
        setTimeout(async () => {
            try { await bot.api.deleteMessage(MASTER_CHAT_ID, ctx.callbackQuery.message.message_id); } catch(e){}
        }, 10000);
        
        ctx.answerCallbackQuery();
    } catch (e) {
        ctx.answerCallbackQuery({ text: "Ошибка при отправке клиенту.", show_alert: true });
    }
});

// ====== ОТВЕТ КЛИЕНТА НА ПЕРЕНОС ======
bot.callbackQuery(/^client_acc_resch_/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const parts = ctx.callbackQuery.data.replace("client_acc_resch_", "").split("_");
    const bId = parts[0];
    const newDate = parts[1];
    const newDateText = parts[2];
    const newTime = parts[3];

    try {
        const booking = await Booking.findById(bId);
        if (!booking || booking.status === "cancelled") return await ctx.editMessageText("Запись больше не актуальна.");

        booking.date = newDate;
        booking.dateText = newDateText;
        booking.time = newTime;
        booking.status = "confirmed";
        booking.pendingMessageId = null;
        await booking.save(); // Сохраняем обновленные данные в БД

        const lang = clientSessions[ctx.from.id]?.lang || "ru";
        const msg = lang === "ru"
            ? `✅ **Запись успешно перенесена!**\n\nЖдем вас **${newDateText}** в **${newTime}**! ✨`
            : `✅ **Yozuv muvaffaqiyatli ko'chirildi!**\n\nSizni **${newDateText}** soat **${newTime}** da kutamiz! ✨`;

        await ctx.editMessageText(msg, { parse_mode: "Markdown" });

        try {
            await bot.api.sendMessage(MASTER_CHAT_ID, `✅ **КЛИЕНТ ПОДТВЕРДИЛ ПЕРЕНОС**\n\nИмя: ${booking.clientName}\nНовое время: ${newDateText} в ${newTime}`, { parse_mode: "Markdown" });
        } catch (e) {}
    } catch (err) { console.error(err); }
});

bot.callbackQuery(/^client_rej_resch_/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const bId = ctx.callbackQuery.data.replace("client_rej_resch_", "");
    
    try {
        const booking = await Booking.findById(bId);
        if (!booking || booking.status === "cancelled") return await ctx.editMessageText("Запись больше не актуальна.");

        const clientName = booking.clientName;
        
        // Меняем статус на отмененный вместо полного удаления из базы
        booking.status = "cancelled";
        booking.reason = "Отказ от переноса";
        booking.cancelledBy = "client";
        await booking.save();

        const lang = clientSessions[ctx.from.id]?.lang || "ru";
        const msg = lang === "ru" ? `❌ **Вы отказались от переноса. Запись отменена.**` : `❌ **Siz ko'chirishni rad etdingiz. Yozuv bekor qilindi.**`;
        await ctx.editMessageText(msg, { parse_mode: "Markdown" });

        try {
            await bot.api.sendMessage(MASTER_CHAT_ID, `❌ **КЛИЕНТ ОТКАЗАЛСЯ ОТ ПЕРЕНОСА**\n\nИмя: ${clientName}. Запись была отменена.`, { parse_mode: "Markdown" });
        } catch (e) {}
    } catch (err) { console.error(err); }
});

// ====== КЛИЕНТСКИЙ ИНТЕРФЕЙС И ВЫБОР ======

// ВЫБОР ЯЗЫКА
bot.callbackQuery(/^set_lang_/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const lang = ctx.callbackQuery.data.replace("set_lang_", "");
    if (!clientSessions[ctx.from.id]) clientSessions[ctx.from.id] = {};
    clientSessions[ctx.from.id].lang = lang;
    const welcomeText = LANG[lang].welcome.replace("{name}", ctx.from.first_name);
    try { await ctx.deleteMessage(); } catch(e) {}
    const res = await ctx.replyWithPhoto(imgWelcome, { caption: welcomeText, parse_mode: "Markdown", reply_markup: getMainMenuKeyboard(lang) });
    clientSessions[ctx.from.id].menuMessageId = res.message_id;
    clientSessions[ctx.from.id].currentImage = imgWelcome;
});

bot.callbackQuery("view_portfolio", async (ctx) => {
    await ctx.answerCallbackQuery().catch(()=>{});
    const lang = clientSessions[ctx.from.id]?.lang || "ru";
    const kb = new InlineKeyboard().text(LANG[lang].back, "back_to_start");
    
    // Достаем текст из базы
    const settings = await Settings.findOne() || await Settings.create({});
    const defaultText = lang === "ru" ? "📸 **Наши работы**\n\nДля просмотра переходите в Instagram! ✨" : "📸 **Bizning ishlar**\n\nKo'rish uchun Instagram sahifamizga o'ting! ✨";
    
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
            kb.text(lang === "ru" ? "🔙 В главное меню" : "🔙 Asosiy menyuga", "main_menu");
            
            try { await ctx.deleteMessage(); } catch (e) {}
            return await ctx.reply(emptyText, { parse_mode: "HTML", reply_markup: kb });
        }

        services.forEach(srv => {
            // Защита: проверяем наличие названия
            if (!srv) return;
            const srvName = srv.name?.[lang] || srv.name?.ru || srv.name?.uz || "Услуга";
            kb.text(`💅 ${srvName}`, `view_service_${srv._id}`).row();
        });

        kb.text(lang === "ru" ? "🔙 В главное меню" : "🔙 Asosiy menyuga", "main_menu");

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
    const kb = new InlineKeyboard().text(LANG[lang].back, "back_to_start");
    
    // Достаем данные из базы
    const settings = await Settings.findOne() || await Settings.create({});
    
    // Собираем текст для двух языков с данными из базы
    const textRu = `📞 **Контакты**\n\n📱 Телефон: ${settings.phone}\n\n⏰ График: ${settings.schedule}\n📍 Адрес: ${settings.address}\n\n💬 Написать мастеру: @${settings.masterUsername}`;
    const textUz = `📞 **Kontaktlar**\n\n📱 Telefon: ${settings.phone}\n\n⏰ Ish vaqti: ${settings.schedule}\n📍 Manzil: ${settings.address}\n\n💬 Ustaga yozish: @${settings.masterUsername}`;
    
    const text = lang === "ru" ? textRu : textUz;
    await smartUpdate(ctx, imgWelcome, text, kb);
});

// --- АДМИНКА: МЕНЮ УПРАВЛЕНИЯ УСЛУГАМИ ---
// --- АДМИНКА: МЕНЮ УПРАВЛЕНИЯ УСЛУГАМИ ---
bot.callbackQuery("manage_services", async (ctx) => {
    await ctx.answerCallbackQuery().catch(()=>{});
    
    try {
        const services = await Service.find();
        let text = "💅 <b>Управление услугами</b>\n\n";
        const kb = new InlineKeyboard();

        if (services.length === 0) {
            text += "<i>У вас пока нет добавленных услуг. Нажмите «Добавить», чтобы создать первую!</i>";
        } else {
            text += "Выберите услугу для редактирования:\n";
            services.forEach((s) => {
                // ИСПРАВЛЕНИЕ ЗДЕСЬ: берем s.name.ru (или s.title_ru для старых тестовых записей)
                const serviceName = (s.name && s.name.ru) ? s.name.ru : (s.title_ru || "Без названия");
                kb.text(`✏️ ${serviceName} (${s.price})`, `edit_srv_${s._id}`).row();
            });
        }

        kb.text("➕ Добавить новую услугу", "add_new_service").row();
        kb.text("🔙 Назад в настройки", "admin_panel"); // Возврат в главное меню админки

        await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: kb });
    } catch (err) {
        console.error("Ошибка в меню услуг:", err);
    }
});

// Заглушка для кнопки "Назад в настройки"
// --- ВОЗВРАТ В ГЛАВНОЕ МЕНЮ АДМИНКИ ---
// --- ПЛАВНЫЙ ВОЗВРАТ В ОСНОВНОЕ МЕНЮ НАСТРОЕК (ФОТО 2) ---
bot.callbackQuery("admin_panel", async (ctx) => {
    await ctx.answerCallbackQuery().catch(()=>{});
    
    try {
        // Достаем актуальные настройки из базы данных
        let settings = await Settings.findOne();
        
        // Если настроек почему-то еще нет в базе, создаем дефолтные
        if (!settings) {
            settings = await Settings.create({});
        }

        // Формируем текст один в один как на твоем втором фото
        const text = `⚙️ <b>НАСТРОЙКИ БОТА И САЛОНА</b>\n\n` +
                     `📞 <b>Телефон:</b> ${settings.phone}\n` +
                     `🕒 <b>График:</b> ${settings.schedule}\n` +
                     `📍 <b>Адрес:</b> ${settings.address}\n` +
                     `🔗 <b>Instagram:</b> ${settings.instagram}\n` +
                     `👤 <b>Юзернейм мастера:</b> @${settings.masterUsername.replace('@', '')}\n\n` +
                     `Выберите, какой пункт вы хотите изменить:`;

        // Собираем клавиатуру в точности как на фото 2
        const kb = new InlineKeyboard()
            .text("📞 Изменить телефон", "edit_phone").row()
            .text("🕒 Изменить график", "edit_schedule").row()
            .text("📍 Изменить адрес", "edit_address").row()
            .text("🔗 Изменить Instagram", "edit_instagram").row()
            .text("👤 Изменить Юзернейм", "edit_master_username").row()
            .text("📸 Изменить 'Наши работы'", "edit_portfolio_text").row()
            .text("💅 Управление услугами", "manage_services").row()
.text("🔙 Назад в меню", "back_to_admin_main");
        // Самая главная фишка: Используем editMessageText для ПЛАВНОЙ замены экрана!
        await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: kb });

    } catch (err) {
        console.error("Ошибка при загрузке главного меню настроек:", err);
        await ctx.reply("❌ Не удалось загрузить настройки салона.");
    }
});





// Заглушка для кнопки "Добавить новую услугу"
// --- НАЧАЛО ДОБАВЛЕНИЯ НОВОЙ УСЛУГИ ---
bot.callbackQuery("add_new_service", async (ctx) => {
    await ctx.answerCallbackQuery().catch(()=>{});
    const adminId = ctx.from.id;
    
    // Очищаем предыдущую сессию, если она была, и начинаем новую
    adminSessions[adminId] = {
        action: "adding_service", // Чем сейчас занят админ
        step: "waiting_name_ru",  // Какой шаг он сейчас проходит
        newData: {}               // Сюда будем складывать ответы
    };

    const text = `➕ <b>Добавление новой услуги</b> (Шаг 1 из 6)\n\nВведите <b>название услуги на РУССКОМ языке</b> (например, <i>💅 Премиальный Маникюр</i>):`;
    
    // Кнопка отмены на случай, если админ передумал
    const kb = new InlineKeyboard().text("❌ Отмена", "cancel_admin_action");
    
    await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb });
});



// Обработчик кнопки "Отмена"
bot.callbackQuery("cancel_admin_action", async (ctx) => {
    await ctx.answerCallbackQuery("Действие отменено").catch(()=>{});
    const adminId = ctx.from.id;
    
    // 1. Очищаем сессию (забываем, что админ что-то вводил)
    if (adminSessions[adminId]) {
        delete adminSessions[adminId]; 
    }

    try {
        // 2. Достаем все услуги из базы данных, чтобы построить меню
        const services = await Service.find();
        const kb = new InlineKeyboard();
        
        // 3. Создаем кнопки для каждой существующей услуги
        services.forEach(srv => {
            const btnName = srv.name?.ru || srv.name?.uz || srv.key;
            kb.text(`💅 ${btnName}`, `edit_srv_${srv._id}`).row();
        });
        
        // Добавляем кнопки управления (если у тебя есть функция добавления, кнопка пригодится)
        kb.text("➕ Добавить услугу", "add_service").row(); 
        kb.text("🔙 Назад в настройки", "admin_settings");

        const text = "💅 <b>Управление услугами</b>\n\nВыберите услугу для редактирования:";

        // 4. Плавно меняем текст сообщения, не спамя новыми сообщениями в чат
        if (ctx.callbackQuery.message && !ctx.callbackQuery.message.photo) {
            await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: kb });
        } else {
            // Если предыдущее сообщение было с картинкой, удаляем его и шлем новое текстовое
            try { await ctx.deleteMessage(); } catch (e) {}
            await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb });
        }
    } catch (e) {
        console.error("Ошибка при возврате в меню услуг:", e);
        await ctx.reply("❌ Произошла ошибка при загрузке списка услуг.");
    }
});



// ====== ОБРАБОТЧИКИ КНОПОК УПРАВЛЕНИЯ КОНКРЕТНОЙ УСЛУГОЙ ======

// 1. УДАЛЕНИЕ УСЛУГИ
// ==========================================
// УДАЛЕНИЕ УСЛУГИ С АВТОМАТИЧЕСКИМ ВОЗВРАТОМ В МЕНЮ
// ==========================================
bot.callbackQuery(/^delete_srv_/, async (ctx) => {
    const serviceId = ctx.callbackQuery.data.replace("delete_srv_", "");
    
    try {
        // 1. Удаляем услугу из базы данных
        await Service.findByIdAndDelete(serviceId); 
        
        // 2. Всплывающее уведомление (ПРАВИЛЬНЫЙ СИНТАКСИС для grammY)
        await ctx.answerCallbackQuery({ 
            text: "🗑 Услуга успешно удалена!", 
            show_alert: true 
        }).catch(() => {});
        
        // 3. Достаем ОБНОВЛЕННЫЙ список услуг из базы
        const services = await Service.find();
        const kb = new InlineKeyboard();
        
        services.forEach(srv => {
            const btnName = srv.name?.ru || srv.name?.uz || srv.key;
            kb.text(`💅 ${btnName}`, `edit_srv_${srv._id}`).row();
        });
        
        kb.text("➕ Добавить услугу", "add_service").row(); 
        kb.text("🔙 Назад в настройки", "admin_settings");

        const text = "💅 <b>Управление услугами</b>\n\nВыберите услугу для редактирования:";

        // 4. Плавно обновляем меню (удаленной услуги там уже не будет)
        if (ctx.callbackQuery.message && !ctx.callbackQuery.message.photo) {
            await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: kb });
        } else {
            // Если предыдущее сообщение содержало фото, удаляем его и отправляем чистый список
            try { await ctx.deleteMessage(); } catch (e) {}
            await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb });
        }

    } catch (e) {
        console.error("Ошибка при удалении услуги:", e);
        await ctx.answerCallbackQuery({ text: "❌ Ошибка при удалении", show_alert: true }).catch(() => {});
    }
});

// 2. НАЖАТИЕ НА "ИЗМЕНИТЬ ЦЕНУ"
bot.callbackQuery(/^edit_price_/, async (ctx) => {
    await ctx.answerCallbackQuery().catch(()=>{});
    const serviceId = ctx.callbackQuery.data.replace("edit_price_", "");
    
    // Записываем в сессию, что мастер сейчас меняет именно цену
    adminSessions[ctx.from.id] = {
        action: "editing_price",
        serviceId: serviceId
    };
    
    const kb = new InlineKeyboard().text("❌ Отмена", `edit_srv_${serviceId}`);
    await ctx.editMessageText("💰 <b>Введите новую цену</b> (например: <i>180.000 сум</i>):", { parse_mode: "HTML", reply_markup: kb });
});


// 3. НАЖАТИЕ НА "ИЗМЕНИТЬ НАЗВАНИЕ"
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

// 4. НАЖАТИЕ НА "ИЗМЕНИТЬ ОПИСАНИЕ"
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

// 5. НАЖАТИЕ НА "ИЗМЕНИТЬ ФОТО"
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

        // 1. Удаляем текстовое меню, чтобы чат был чистым
        try { if (ctx.callbackQuery.message) await ctx.deleteMessage(); } catch (e) {}

        // 2. Если фото есть в базе — присылаем его как текущее
        if (service && service.image) {
            await ctx.replyWithPhoto(service.image, {
                caption: "🖼 <b>Текущее фото услуги.</b>\n\nОтправьте <b>НОВУЮ фотографию</b>, чтобы заменить её, или нажмите «Отмена»:",
                parse_mode: "HTML",
                reply_markup: kb
            });
        } else {
            // Если фото пока нет — просто запрашиваем текстом
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
    await ctx.answerCallbackQuery().catch(()=>{});
    const lang = clientSessions[ctx.from.id]?.lang || "ru";
    
    // Достаем инсту из базы
    const settings = await Settings.findOne() || await Settings.create({});
    
    const btnText = lang === "ru" ? "Перейти в Instagram" : "Instagram'ga o'tish";
    // Вставляем ссылку из базы прямо в саму кнопку (url)!
    const kb = new InlineKeyboard().url(btnText, settings.instagram).row().text(LANG[lang].back, "back_to_start");
    const text = lang === "ru" ? "📷 **Наш Instagram**" : "📷 **Bizning Instagram**";
    
    await smartUpdate(ctx, imgWelcome, text, kb);
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
                    "main_menu"
                )
            });
        }

        const kb = new InlineKeyboard();
        
        // Подтягиваем название на языке клиента (ru или uz)
        services.forEach(srv => {
            const srvName = srv.name[userLang] || srv.name.ru;
            kb.text(`💅 ${srvName}`, `view_srv_${srv._id}`).row();
        });

        kb.text(userLang === "uz" ? "🔙 Bosh menyu" : "🔙 Главное меню", "main_menu");

        const titleText = userLang === "uz"
            ? "💅 <b>Bizning xizmatlarimiz:</b>\n\nTafsilotlarni ko'rish va yozilish uchun xizmatni tanlang:"
            : "💅 <b>Наши услуги:</b>\n\nВыберите услугу, чтобы узнать подробности и записаться:";

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
            ? `💅 <b>${name}</b>\n\n📝 <b>Tavsif:</b>\n${description}\n\n💰 <b>Narxi:</b> ${service.price}`
            : `💅 <b>${name}</b>\n\n📝 <b>Описание:</b>\n${description}\n\n💰 <b>Цена:</b> ${service.price}`;

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




bot.callbackQuery("view_address", async (ctx) => {
    await ctx.answerCallbackQuery().catch(()=>{});
    const lang = clientSessions[ctx.from.id]?.lang || "ru";
    const kb = new InlineKeyboard().text(LANG[lang].back, "back_to_start");
    
    // Достаем адрес из базы
    const settings = await Settings.findOne() || await Settings.create({});
    
    const textRu = `📍 **Наш адрес**\n\n${settings.address}`;
    const textUz = `📍 **Bizning manzil**\n\n${settings.address}`;
    
    const text = lang === "ru" ? textRu : textUz;
    await smartUpdate(ctx, imgWelcome, text, kb);
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

        const captionText = `💅 <b>${name}</b>\n\n📝 ${description}\n\n${priceText} ${price}`;

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
bot.callbackQuery(/^open_calendar_/, async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => {});
    
    // Получаем ID услуги из базы MongoDB
    const serviceId = ctx.callbackQuery.data.replace("open_calendar_", "");
    const lang = clientSessions[ctx.from.id]?.lang || "ru";

    // Сохраняем ID выбранной услуги в сессию клиента
    if (!clientSessions[ctx.from.id]) {
        clientSessions[ctx.from.id] = { lang: lang };
    }
    clientSessions[ctx.from.id].serviceKey = serviceId;

    // Определяем текущий месяц и год для календаря
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();

    // Вызываем твою готовую функцию генерации календаря
    const kb = createCalendarKeyboard(year, month, serviceId, lang);

    const text = lang === "ru" 
        ? "📅 <b>Выберите удобную дату:</b>" 
        : "📅 <b>Qulay sanani tanlang:</b>";

    // Убираем карточку с фото и показываем календарь
    try { if (ctx.callbackQuery.message) await ctx.deleteMessage(); } catch (e) {}
    await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb });
});

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
// ВЫБОР ВРЕМЕНИ (ГЕНЕРАЦИЯ СЛОТОВ)
// ==========================================
bot.callbackQuery(/^date_/, async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => {});
    const parts = ctx.callbackQuery.data.replace("date_", "").split("_");
    
    // Пробуем достать сессию
    let session = clientSessions[ctx.from.id];
    
    // Если сессия пропала (например, из-за перезагрузки бота)
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
        TIME_SLOTS.forEach((time, index) => {
            const isBooked = bookedTimes.includes(time);
            if (isBooked) {
                kb.text(`❌ ${time}`, `slot_already_booked`);
            } else {
                kb.text(time, `book_time_${time}`);
            }
            if ((index + 1) % 2 === 0) kb.row();
        });
        kb.row().text(LANG[lang].back, `open_calendar_${session.serviceKey}`);

        // ИСПРАВЛЕНИЕ: Достаем услугу из MongoDB
        const service = await Service.findById(session.serviceKey);
        
        // Надежно берем название (с защитой, если услугу вдруг удалили)
        const serviceName = service ? (service.name[lang] || service.name.ru) : (lang === "ru" ? "Услуга" : "Xizmat");

        const dateLabel = lang === "ru" ? "📅 Дата:" : "📅 Sana:";
        const serviceLabel = lang === "ru" ? "💅 Услуга:" : "💅 Xizmat:";
        const chooseLabel = lang === "ru" ? "Выберите свободное время:" : "Bo'sh vaqtni tanlang:";
        
        const text = `${dateLabel} <b>${session.dateText}</b>\n${serviceLabel} <b>${serviceName}</b>\n\n${chooseLabel}`;
        
        // Очищаем экран от календаря и выводим чистое текстовое меню слотов
        try { if (ctx.callbackQuery.message) await ctx.deleteMessage(); } catch (e) {}
        await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb });

    } catch (err) {
        console.error("Ошибка при генерации слотов времени:", err);
    }
});

bot.callbackQuery("slot_already_booked", async (ctx) => {
    const lang = clientSessions[ctx.from.id]?.lang || "ru";
    await ctx.answerCallbackQuery({ text: lang === "ru" ? "⚠️ Это время уже занято!" : "⚠️ Bu vaqt allaqochon band qilingan!", show_alert: true });
});

// БРОНИРОВАНИЕ ВРЕМЕНИ И ЗАПРОС ИМЕНИ
// ==========================================
bot.callbackQuery(/^book_time_/, async (ctx) => {
    // Убираем часики загрузки на кнопке
    await ctx.answerCallbackQuery().catch(() => {});
    
    const time = ctx.callbackQuery.data.replace("book_time_", "");
    const session = clientSessions[ctx.from.id];
    
    // ЗАЩИТА: Если дата не выбрана (сессия сбросилась), выдаем понятную ошибку
    if (!session || !session.date) {
        return ctx.answerCallbackQuery({ 
            text: "⏳ Сессия устарела! Пожалуйста, пройдите запись заново через главное меню.", 
            show_alert: true 
        }).catch(() => {});
    }
    
    const lang = session.lang || "ru";

    try {
        // Проверяем реальную занятость в базе данных прямо в момент клика
        const isBooked = await Booking.exists({ 
            date: session.date, 
            time: time, 
            status: { $in: ["pending", "confirmed"] } 
        });

        if (isBooked) {
            const errText = lang === "ru" ? "❌ Это время успели занять! Выберите другое." : "❌ Bu vaqtni olib qo'yishdi! Boshqasini tanlang.";
            return ctx.answerCallbackQuery({ text: errText, show_alert: true }).catch(() => {});
        }
        
        // Сохраняем время и переводим бота в режим ожидания имени
        session.time = time;
        session.awaitingName = true;
        
        // Используем <b> вместо ** для HTML-разметки
        const askNameText = lang === "ru" 
            ? "✍️ <b>На какое имя вас записать?</b>\n\nОтправьте ваше имя ответным сообщением:" 
            : "✍️ <b>Sizni qaysi ismga yozib qo'yaylik?</b>\n\nIsmingizni xabar qilib yuboring:";
        
        // Удаляем старое меню с календарем/временем, чтобы чат был чистым
        try { if (ctx.callbackQuery.message) await ctx.deleteMessage(); } catch(e){}
        
        // Отправляем запрос просто текстом, без smartUpdate и картинок
        await ctx.reply(askNameText, { parse_mode: "HTML" });

    } catch (err) {
        console.error("Ошибка при бронировании времени:", err);
    }
});


// ПРИНЯТИЕ / ОТКЛОНЕНИЕ ЗАЯВКИ

bot.callbackQuery(/^admin_conf_/, async (ctx) => {
    const bId = ctx.callbackQuery.data.replace("admin_conf_", "");
    
    try {
        const booking = await Booking.findById(bId);
        if (!booking || booking.status === "cancelled") return ctx.answerCallbackQuery({ text: "Запись не найдена или уже отменена!", show_alert: true });
       
        booking.status = "confirmed";
        await booking.save(); // Сохраняем изменение статуса в БД

        const targetUserId = booking.userId;
       
        if (booking.pendingMessageId) {
            try { await bot.api.deleteMessage(targetUserId, booking.pendingMessageId); } catch(e){}
        }
        
        // Меняем сообщение с кнопками на текст подтверждения
        await ctx.editMessageText(`✅ **ВЫ ПОДТВЕРДИЛИ ЗАПИСЬ**\n\nКлиент: ${booking.clientName}\nДата: ${booking.dateText} в ${booking.time}`);
        await ctx.answerCallbackQuery({ text: "Подтверждено!", show_alert: false });
       
        setTimeout(async () => { 
            try { await bot.api.deleteMessage(MASTER_CHAT_ID, ctx.callbackQuery.message.message_id); } catch(e){} 
        }, 30000);
       
        try {
            const userLang = clientSessions[targetUserId]?.lang || "ru";
            const notifyMsg = userLang === "ru"
                ? `🎉 **Отличные новости!**\nМастер подтвердил вашу запись!\n\nИмя: ${booking.clientName}\n💅 Услуга: **${SERVICES_DATA[booking.serviceKey].name.ru}**\n📅 Дата: **${booking.dateText}**\n🕐 Время: **${booking.time}**\n\nЖдем вас! ✨`
                : `🎉 **Ajoyib yangilik!**\nUsta yozuvingizni tasdiqladi!\n\nIsm: ${booking.clientName}\n💅 Xizmat: **${SERVICES_DATA[booking.serviceKey].name.uz}**\n📅 Sana: **${booking.dateText}**\n🕐 Vaqt: **${booking.time}**\n\nSizni kutamiz! ✨`;
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
        
        await ctx.editMessageText(`Укажите причину отмены для клиента **${booking.clientName}**:`, { reply_markup: kb });
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
        
        // ПРАВКА: Меняем статус в БД на отмененный
        booking.status = "cancelled";
        booking.reason = reason;
        booking.cancelledBy = "master";
        await booking.save();
        
        await ctx.editMessageText(`❌ **Запись отменена**\n\nПричина отправлена клиенту: ${reason}`);
        setTimeout(async () => { try { await bot.api.deleteMessage(MASTER_CHAT_ID, ctx.callbackQuery.message.message_id); } catch(e){} }, 10000);
        
        try {
            const notifyMsg = userLang === "ru"
                ? `❌ **К сожалению, мастер отменил вашу запись.**\n\n💬 **Причина:** ${reason}\n\nПожалуйста, выберите другое время.`
                : `❌ **Afsuski, usta yozuvingizni bekor qildi.**\n\n💬 **Sabab:** ${reason}\n\nIltimos, boshqa vaqtni tanlang.`;
            
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

// МОИ ЗАПИСИ
bot.callbackQuery("view_my_bookings", async (ctx) => {
    await ctx.answerCallbackQuery();
    const lang = clientSessions[ctx.from.id]?.lang || "ru";

    try {
        // Достаем из БД активные записи конкретного пользователя
        const userBookings = await Booking.find({ 
            userId: ctx.from.id, 
            status: { $in: ["pending", "confirmed"] } 
        });

        if (userBookings.length === 0) {
            const kb = new InlineKeyboard().text(LANG[lang].back, "back_to_start");
            return await smartUpdate(ctx, imgWelcome, LANG[lang].no_bookings, kb);
        }
       
        let text = lang === "ru" ? "📅 **Ваши текущие записи:**\n\n" : "📅 **Sizning joriy yozuvlaringiz:**\n\n";
        const kb = new InlineKeyboard();
        
        userBookings.forEach((b, index) => {
            const statusTxt = lang === "ru" ? (b.status === "pending" ? "⏳ На рассмотрении" : "✅ Подтверждена") : (b.status === "pending" ? "⏳ Ko'rib chiqilmoqda" : "✅ Tasdiqlangan");
            text += `${index + 1}. **${SERVICES_DATA[b.serviceKey].name[lang]}** (${b.clientName}) | ${b.dateText} | ${b.time}\n(${statusTxt})\n\n`;
            kb.text(`${LANG[lang].cancel_btn} №${index + 1}`, `user_cancel_${b._id}`).row();
        });
        
        kb.text(LANG[lang].back, "back_to_start");
        await smartUpdate(ctx, imgWelcome, text, kb);
    } catch (err) { console.error(err); }
});

bot.callbackQuery(/^user_cancel_/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const bId = ctx.callbackQuery.data.replace("user_cancel_", "");
    
    try {
        const bookingExists = await Booking.exists({ _id: bId, status: { $in: ["pending", "confirmed"] } });
        if (!bookingExists) return ctx.answerCallbackQuery({ text: "Запись не найдена!", show_alert: true });
       
        const lang = clientSessions[ctx.from.id]?.lang || "ru";
        const kb = new InlineKeyboard();
        CANCEL_REASONS.forEach((reason, index) => { kb.text(reason, `user_reason_${bId}_${index}`).row(); });
        kb.text(lang === "ru" ? "⬅️ Назад" : "⬅️ Orqaga", "view_my_bookings");
        
        await smartUpdate(ctx, imgWelcome, lang === "ru" ? "Выберите причину отмены записи:" : "Yozuvni bekor qilish sababini tanlang:", kb);
    } catch (err) { console.error(err); }
});

bot.callbackQuery(/^user_reason_/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const parts = ctx.callbackQuery.data.split("_");
    const bId = parts[2], reasonIndex = parts[3];
    const lang = clientSessions[ctx.from.id]?.lang || "ru";
    
    try {
        const booking = await Booking.findById(bId);
        if (!booking || booking.status === "cancelled") {
            const kb = new InlineKeyboard().text(LANG[lang].back, "back_to_start");
            return await smartUpdate(ctx, imgWelcome, "Запись не найдена.", kb);
        }
        
        const reason = CANCEL_REASONS[reasonIndex];
        
        try {
            const masterMsg = await bot.api.sendMessage(MASTER_CHAT_ID, `⚠️ **ОТМЕНА ЗАПИСИ (Клиент)**\n\n👤 Имя: ${booking.clientName}\n💅 Услуга: ${SERVICES_DATA[booking.serviceKey].name.ru}\n📅 Дата: ${booking.dateText} в ${booking.time}\n❌ Причина: ${reason}`, { parse_mode: "Markdown" });
            
            setTimeout(async () => {
                try { await bot.api.deleteMessage(MASTER_CHAT_ID, masterMsg.message_id); } catch (e) {} 
            }, 30000);
        } catch (e) {}

        if (booking.adminMessageId) {
            try { await bot.api.deleteMessage(MASTER_CHAT_ID, booking.adminMessageId); } catch(e) {}
        }

        // ПРАВКА: Отменяем запись в БД
        booking.status = "cancelled";
        booking.reason = reason;
        booking.cancelledBy = "client";
        await booking.save();

        const kb = new InlineKeyboard().text(LANG[lang].back, "back_to_start");
        await smartUpdate(ctx, imgWelcome, lang === "ru" ? `✅ Ваша запись успешно отменена.\nБудем рады видеть вас в другой раз! ✨` : `✅ Sizning yozuvingiz bekor qilindi.\nSizni boshqa safar kutamiz! ✨`, kb);
    } catch (err) { console.error(err); }
});

bot.callbackQuery("back_to_start", async (ctx) => {
    await ctx.answerCallbackQuery();
    const lang = clientSessions[ctx.from.id]?.lang || "ru";
    if (clientSessions[ctx.from.id]) clientSessions[ctx.from.id].awaitingName = false;
    const welcomeText = LANG[lang].welcome.replace("{name}", ctx.from.first_name);
    await smartUpdate(ctx, imgWelcome, welcomeText, getMainMenuKeyboard(lang));
});

bot.callbackQuery("ignore", async (ctx) => { await ctx.answerCallbackQuery(); });

bot.catch((err) => {
    console.error("Глобальная ошибка бота ПУТЬ:");
    console.error(err); // Убрали .message, теперь покажет всё!
});

bot.start();
console.log("🚀 БОТ ОБНОВЛЕН! MongoDB полностью интегрирована.");