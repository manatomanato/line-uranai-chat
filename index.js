require('dotenv').config();
const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3000;
const LINE_ACCESS_TOKEN = process.env.LINE_ACCESS_TOKEN;
const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const paidUsers = new Set(["user_id_1", "user_id_2"]);
const sentUserId = new Set(); // 送信済みのユーザーIDを記録

app.use(bodyParser.json());

// Render の起動確認エンドポイント
app.get("/", (req, res) => {
    res.send("✅ Server is running on Render!");
});

// LINEの署名検証
function validateSignature(req) {
    const signature = req.headers['x-line-signature'];
    if (!signature) return false;

    const body = JSON.stringify(req.body);
    const hash = crypto.createHmac('sha256', LINE_CHANNEL_SECRET).update(body).digest('base64');

    return hash === signature;
}

// Webhookエンドポイント
app.post("/webhook", async (req, res) => {
    if (!validateSignature(req)) {
        console.log("Invalid signature. Request denied.");
        return res.status(403).send("Forbidden");
    }

    const events = req.body.events;

    for (const event of events) {
        const userId = event.source.userId;
        console.log("Received message from userId:", userId);

        // 最初の1回だけ `userId` を送信
        if (!sentUserId.has(userId)) {
            await replyMessage(userId, `あなたのUser IDは: ${userId} です。`);
            sentUserId.add(userId);
        }

        // ここからは通常の処理（占いチャット）
        const userMessage = event.message.text;

        if (!paidUsers.has(userId)) {
            await replyMessage(userId, "このサービスを利用するには月額500円の支払いが必要です。");
            return res.status(403).json({ status: "unauthorized" });
        }

        // ChatGPTで占いの返信を取得
        const gptResponse = await getGPTResponse(userMessage);

        // ユーザーに返信
        await replyMessage(userId, gptResponse);
    }

    res.json({ status: "ok" });
});

// ChatGPTのAPIを呼び出す
async function getGPTResponse(userMessage) {
    try {
        const response = await axios.post("https://api.openai.com/v1/chat/completions", {
            model: "gpt-4",
            messages: [
                { role: "system", content: "あなたは占い師です。優しく悩みを聞き、適切な占い結果を伝えてください。" },
                { role: "user", content: userMessage }
            ],
            temperature: 0.7,
            max_tokens: 100
        }, {
            headers: {
                "Authorization": `Bearer ${OPENAI_API_KEY}`,
                "Content-Type": "application/json"
            }
        });

        return response.data.choices[0].message.content;
    } catch (error) {
        console.error("🔴 OpenAI APIエラー:", error.response?.status, JSON.stringify(error.response?.data, null, 2) || error.message);
        return "申し訳ありませんが、占いができませんでした。";
    }
}

// LINEに返信を送信
async function replyMessage(userId, text) {
    const url = "https://api.line.me/v2/bot/message/push";
    const headers = {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${LINE_ACCESS_TOKEN}`
    };
    const data = {
        to: userId,
        messages: [{ type: "text", text }]
    };

    try {
        await axios.post(url, data, { headers });
    } catch (error) {
        console.error("Error sending message to LINE:", error);
    }
}

// 管理者が支払済みユーザーを登録するエンドポイント
app.post("/add-paid-user", async (req, res) => {
    const { userId } = req.body;

    if (!userId) {
        return res.status(400).json({ status: "error", message: "userIdが必要です" });
    }

    paidUsers.add(userId);
    await replyMessage(userId, "お支払いの確認が取れました。これで占いチャットを利用できます。");

    res.json({ status: "success", message: "ユーザーを支払済みリストに追加しました。" });
});

// 管理者が支払済みユーザーを削除するエンドポイント
app.post("/remove-paid-user", async (req, res) => {
    const { userId } = req.body;

    if (!userId) {
        return res.status(400).json({ status: "error", message: "userIdが必要です" });
    }

    // `paidUsers` から削除
    if (paidUsers.has(userId)) {
        paidUsers.delete(userId);
        await replyMessage(userId, "あなたの利用資格が取り消されました。再度利用するにはお支払いが必要です。");

        return res.json({ status: "success", message: "ユーザーを支払済みリストから削除しました。" });
    } else {
        return res.status(404).json({ status: "error", message: "このユーザーは支払済みリストに登録されていません。" });
    }
});

// サーバーを起動 (Render対応)
app.listen(PORT, "0.0.0.0", () => {
    console.log(`✅ Server running on port ${PORT}`);
});

