const { Bot } = require("grammy");

// Твой токен
const bot = new Bot("8913984681:AAGkZFjBP6bnisOkhyin3Ujtuov3xuPKxvM");

bot.command("start", (ctx) => {
    console.log("🔥 ЕСТЬ СВЯЗЬ! Сообщение от:", ctx.from.first_name);
    ctx.reply("Привет! Я работаю!");
});

console.log("🚀 ТЕСТОВЫЙ БОТ ЗАПУЩЕН. Нажимай /start в Telegram!");
bot.start();