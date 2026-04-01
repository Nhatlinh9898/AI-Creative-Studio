import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import Stripe from "stripe";
import dotenv from "dotenv";
import admin from "firebase-admin";
import fs from "fs";

dotenv.config();

// Load Firebase config for Admin SDK
const configPath = path.join(process.cwd(), "firebase-applet-config.json");
let firebaseConfig: any = { projectId: "" };
if (fs.existsSync(configPath)) {
  try {
    firebaseConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch (e) {
    console.error("Error parsing firebase-applet-config.json", e);
  }
}

// Initialize Firebase Admin
let db: any = null;
try {
  if (!admin.apps.length) {
    const projectId = firebaseConfig.projectId || process.env.FIREBASE_PROJECT_ID;
    if (projectId) {
      admin.initializeApp({
        projectId: projectId,
      });
      db = admin.firestore();
      console.log("Firebase Admin initialized with project:", projectId);
    } else {
      console.warn("No Firebase Project ID found for Admin SDK");
    }
  } else {
    db = admin.firestore();
  }
} catch (err) {
  console.error("Lỗi khởi tạo Firebase Admin:", err);
}

let stripeInstance: Stripe | null = null;

function getStripe() {
  if (!stripeInstance) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      throw new Error("STRIPE_SECRET_KEY is not set in environment variables.");
    }
    stripeInstance = new Stripe(key);
  }
  return stripeInstance;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  console.log("Starting server on port", PORT);

  // Stripe Webhook (Must be before express.json middleware)
  app.post("/api/webhook", express.raw({ type: "application/json" }), async (req, res) => {
    console.log("Received webhook event");
    const sig = req.headers["stripe-signature"] as string;
    let event;

    try {
      const stripe = getStripe();
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET || ""
      );
    } catch (err: any) {
      console.error(`Webhook Error: ${err.message}`);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Handle the event
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.client_reference_id;
      
      console.log("Checkout session completed for user:", userId);

      try {
        const stripe = getStripe();
        const sessionWithLineItems = await stripe.checkout.sessions.retrieve(session.id, {
          expand: ['line_items'],
        });

        const priceId = sessionWithLineItems.line_items?.data[0]?.price?.id;
        let status: 'pro' | 'business' = 'pro';
        let creditsToAdd = 500;
        const amount = (session.amount_total || 0) / 100; // Stripe amount is in cents
        
        if (priceId === 'price_business_456') {
          status = 'business';
          creditsToAdd = 999999;
        }

        if (userId && db) {
          const userRef = db.collection('users').doc(userId);
          const userDoc = await userRef.get();
          
          if (userDoc.exists) {
            const userData = userDoc.data();
            
            // 1. Cập nhật hồ sơ người dùng
            await userRef.update({
              subscriptionStatus: status,
              credits: admin.firestore.FieldValue.increment(creditsToAdd),
              totalSpent: admin.firestore.FieldValue.increment(amount),
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });

            // 2. Ghi lại giao dịch
            await db.collection('transactions').add({
              uid: userId,
              amount: amount,
              type: 'subscription',
              status: 'completed',
              timestamp: new Date().toISOString()
            });

            // 3. Xử lý hoa hồng cho người giới thiệu
            if (userData.referredBy) {
              const referrerRef = db.collection('users').doc(userData.referredBy);
              const commission = amount * 0.2; // 20% hoa hồng
              
              await referrerRef.update({
                commissionBalance: admin.firestore.FieldValue.increment(commission)
              });

              // Ghi lại giao dịch hoa hồng
              await db.collection('transactions').add({
                uid: userData.referredBy,
                amount: commission,
                type: 'commission',
                status: 'completed',
                timestamp: new Date().toISOString(),
                fromUser: userId
              });
            }
          }
          console.log(`Successfully updated subscription and credits for user: ${userId} to ${status}`);
        } else if (!db) {
          console.error("Firestore Admin DB is not initialized. Cannot update subscription.");
        }
      } catch (error) {
        console.error(`Error processing webhook for user ${userId}:`, error);
      }
    }

    res.json({ received: true });
  });

  app.use(express.json());

  // API: Create Stripe Checkout Session
  app.post("/api/create-checkout-session", async (req, res) => {
    const { userId, priceId } = req.body;
    console.log("Creating checkout session for user:", userId, "price:", priceId);

    try {
      const stripe = getStripe();
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        line_items: [
          {
            price: priceId, // e.g., 'price_12345' from Stripe Dashboard
            quantity: 1,
          },
        ],
        mode: "subscription",
        success_url: `${process.env.APP_URL}/?payment=success`,
        cancel_url: `${process.env.APP_URL}/?payment=cancel`,
        client_reference_id: userId,
      });

      res.json({ url: session.url });
    } catch (error: any) {
      console.error("Stripe Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Health check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", firebaseAdmin: !!db });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    console.log("Starting Vite in middleware mode");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    console.log("Serving static files from dist");
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
