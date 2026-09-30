// netlify/functions/paypal-create-order.js
// Crea una orden de PayPal y devuelve el link de aprobación (approve_url).
// El cobro/entrega se completa en paypal-webhook.js cuando PayPal confirma.

import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

// Precios FIJOS en USD (el cliente NUNCA elige el monto).
const CANT_SAKURAS = {
  "250":  { usd: 1,   sakuras: 250  },
  "700":  { usd: 2,   sakuras: 700  },
  "1500": { usd: 2.5, sakuras: 1500 },
  "3000": { usd: 5,   sakuras: 3000 }
};
const MANGA_EXTRA_USD = 10;

// Conversión ARS -> USD para donaciones (ajustable por env var).
const ARS_POR_USD = Number(process.env.ARS_POR_USD || 1500);

const SITE_URL = process.env.PUBLIC_SITE_URL || "https://salamangas.netlify.app";

function out(statusCode, data) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data)
  };
}

function paypalBase() {
  return process.env.PAYPAL_MODE === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";
}

async function getPaypalToken() {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_SECRET;
  if (!clientId || !clientSecret) throw new Error("Faltan credenciales de PayPal");
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const r = await fetch(`${paypalBase()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: "grant_type=client_credentials"
  });
  const data = await r.json();
  if (!r.ok || !data.access_token) {
    throw new Error(`PayPal auth falló: ${data?.error_description || data?.error || r.status}`);
  }
  return data.access_token;
}

async function verifyUser(event) {
  const auth = event.headers.authorization || event.headers.Authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return null;
  try {
    const { data: { user } } = await supabaseAdmin.auth.getUser(token);
    return user || null;
  } catch (e) {
    return null;
  }
}

export const handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return out(405, { error: "Método no permitido" });
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const { tipo, item, creador, manga_id } = body;

    const user = await verifyUser(event);
    if (!user) return out(401, { error: "Sesión inválida" });

    let descripcion, montoUSD, customId;

    if (tipo === "sakuras") {
      const pack = CANT_SAKURAS[String(item)];
      if (!pack) return out(400, { error: "Pack de sakuras inválido" });
      montoUSD = pack.usd;
      descripcion = `SalaMangaS - ${pack.sakuras} Sakuras`;
      customId = JSON.stringify({ user_id: user.id, tipo: "sakuras", item: String(item) });

    } else if (tipo === "manga_extra") {
      montoUSD = MANGA_EXTRA_USD;
      descripcion = "SalaMangaS - Manga extra";
      customId = JSON.stringify({ user_id: user.id, tipo: "manga_extra" });

    } else if (tipo === "donacion") {
      const montoARS = Number(item);
      if (!montoARS || montoARS < 500) return out(400, { error: "Monto de donación inválido (mínimo $500 ARS)" });
      if (!creador) return out(400, { error: "Falta el creador de la donación" });
      montoUSD = Math.max(0.5, Number((montoARS / ARS_POR_USD).toFixed(2)));
      descripcion = "SalaMangaS - Donación a creador";
      customId = JSON.stringify({
        user_id: user.id,
        tipo: "donacion",
        creador,
        manga_id: manga_id || null,
        monto_ars: montoARS
      });

    } else {
      return out(400, { error: "Tipo de pago inválido" });
    }

    const accessToken = await getPaypalToken();

    const orderResponse = await fetch(`${paypalBase()}/v2/checkout/orders`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [{
          amount: {
            currency_code: process.env.PAYPAL_CURRENCY || "USD",
            value: montoUSD.toFixed(2)
          },
          description: descripcion,
          custom_id: customId
        }],
        application_context: {
          brand_name: "SalaMangaS",
          user_action: "PAY_NOW",
          return_url: `${SITE_URL}/?pago=ok`,
          cancel_url: `${SITE_URL}/?pago=cancel`
        }
      })
    });

    const orderData = await orderResponse.json();

    if (!orderResponse.ok) {
      console.error("PayPal create order falló:", orderData);
      return out(500, { error: "PayPal no pudo crear la orden" });
    }

    const approveUrl = (orderData.links || []).find(l => l.rel === "approve")?.href;
    if (!approveUrl) return out(500, { error: "PayPal no devolvió link de aprobación" });

    return out(200, {
      order_id: orderData.id,
      approve_url: approveUrl,
      monto_usd: montoUSD
    });

  } catch (error) {
    console.error("PayPal create order error:", error.message);
    return out(500, { error: "Error interno al crear la orden de PayPal" });
  }
};
