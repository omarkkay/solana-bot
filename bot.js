const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

// Dummy route so Render thinks service is alive
app.get('/', (req, res) => res.send("🚀 MemeCoin Bot is running on Render"));
app.listen(PORT, () => {
  console.log(`Web server running on port ${PORT}`);
});

const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

// 🔹 Read token from environment variable (set in Render)
const token = process.env.TOKEN;
const bot = new TelegramBot(token, { polling: true });

let chatId = null;
let seenTokens = new Set(); // avoid duplicate alerts

// Start command
bot.onText(/\/start/, (msg) => {
  chatId = msg.chat.id;
  bot.sendMessage(chatId, "🚀 MemeCoin Bot is live! You'll get *new Solana token alerts* here (Safe ✅ or Risky ❌).");
});

// Test command
bot.onText(/\/ping/, (msg) => {
  bot.sendMessage(msg.chat.id, "Pong!");
});

// Helper: Check token safety via Solscan
async function checkTokenSafety(tokenAddress) {
  try {
    // 1️⃣ Get token info (ownership)
    const tokenRes = await axios.get(`https://public-api.solscan.io/token/${tokenAddress}`);
    const owner = tokenRes.data?.owner || "unknown";

    const renounced = owner === "11111111111111111111111111111111";

    // 2️⃣ Get LP info
    const marketRes = await axios.get(`https://public-api.solscan.io/market/token/${tokenAddress}`);
    const pools = marketRes.data?.data || [];

    let lpLocked = false;
    if (pools.length > 0) {
      lpLocked = pools.some(pool => pool.locked);
    }

    return { renounced, lpLocked };
  } catch (err) {
    console.error(`Safety check failed for ${tokenAddress}:`, err.message);
    return { renounced: false, lpLocked: false };
  }
}

// Main function: fetch new tokens + filter
async function checkNewTokens() {
  if (!chatId) return;

  try {
    // 1️⃣ Get new tokens from Birdeye
    const res = await axios.get(
      "https://public-api.birdeye.so/public/tokenlist?sort_by=createdAt&sort_type=desc&offset=0&limit=5",
      { headers: { 'x-chain': 'solana' } }
    );

    const tokens = res.data.data.tokens;

    for (const token of tokens) {
      if (seenTokens.has(token.address)) continue;

      try {
        // 2️⃣ Get Dexscreener data
        const dexRes = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${token.address}`);
        const pairs = dexRes.data.pairs;

        if (pairs && pairs.length > 0) {
          const pair = pairs[0];
          const liquidity = pair.liquidity?.usd || 0;
          const volume24h = pair.volume?.h24 || 0;

          // Apply liquidity + volume filters
          if (liquidity >= 20000 && volume24h >= 10000) {
            // 3️⃣ Check safety via Solscan
            const safety = await checkTokenSafety(token.address);
            seenTokens.add(token.address);

            // Status tags
            const safeStatus = (safety.lpLocked && safety.renounced) 
              ? "✅ SAFE" 
              : "❌ RISKY";

            bot.sendMessage(
              chatId,
              `${safeStatus} NEW SOLANA TOKEN\n\n` +
              `Name: ${token.name} (${token.symbol})\n` +
              `CA: ${token.address}\n` +
              `Created: ${new Date(token.createdAt * 1000).toLocaleString()}\n` +
              `Liquidity: $${liquidity.toLocaleString()}\n` +
              `Volume (24h): $${volume24h.toLocaleString()}\n` +
              `Ownership Renounced: ${safety.renounced ? "✅" : "❌"}\n` +
              `LP Locked: ${safety.lpLocked ? "✅" : "❌"}\n` +
              `Market Cap: $${token.mc ? token.mc.toLocaleString() : "?"}\n` +
              `Chart: ${pair.url}\n`
            );
          }
        }
      } catch (err) {
        console.error(`Dexscreener fetch failed for ${token.address}:`, err.message);
      }
    }
  } catch (err) {
    console.error("Error fetching new tokens:", err.message);
  }
}

// 🔹 Run check every 60s
setInterval(checkNewTokens, 60000);
