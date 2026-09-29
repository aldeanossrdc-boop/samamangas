// Netlify Function: puente seguro hacia Gemini (la API key NUNCA va en el index.html)
//
// Variables de entorno en Netlify → Site settings → Environment variables:
//   GEMINI_API_KEY   (obligatoria) — la key de Google AI Studio
//   GEMINI_MODEL     (opcional) — por defecto "gemini-3.1-flash-image"
//
// NOTA SOBRE EL MODELO (revisado 28/09/2026):
//   El modelo que usaba la Tanda B, "gemini-2.5-flash-image", sigue funcionando
//   pero Google avisó que lo apaga el 16/10/2026 (en unas semanas). Por eso
//   el valor por defecto ahora es "gemini-3.1-flash-image" (nombre comercial
//   "Nano Banana 2"), que es la versión estable vigente a esta fecha.
//   Si en el futuro Google vuelve a cambiar el nombre del modelo, no hace
//   falta tocar este archivo: alcanza con cambiar la variable GEMINI_MODEL
//   en Netlify, sin volver a publicar código.
exports.handler = async (event) => {
  const out = (c, o) => ({ statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(o) });
  if (event.httpMethod !== 'POST') return out(405, { error: 'Método no permitido' });
  const key = process.env.GEMINI_API_KEY;
  if (!key) return out(500, { error: 'Falta GEMINI_API_KEY en Netlify' });
  const SB = process.env.SUPABASE_URL || 'https://zalfaldrmccncjsahdmi.supabase.co';
  const SK = process.env.SUPABASE_KEY || 'sb_publishable_ghOA30jYrCYcWrwvA1pd2g_8VsjZoVV';
  try {
    // Solo usuarios logueados pueden gastar la cuota de IA
    const auth = event.headers.authorization || event.headers.Authorization || '';
    const u = await fetch(SB + '/auth/v1/user', { headers: { apikey: SK, Authorization: auth } });
    if (!u.ok) return out(401, { error: 'Sesión inválida. Volvé a iniciar sesión.' });
    const { prompt, images = [] } = JSON.parse(event.body || '{}');
    if (!prompt || prompt.length > 4000 || images.length > 3) return out(400, { error: 'Pedido inválido' });
    const model = process.env.GEMINI_MODEL || 'gemini-3.1-flash-image';
    const parts = [{ text: prompt }, ...images.map(i => ({ inline_data: { mime_type: i.mime, data: i.data } }))];
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ contents: [{ parts }], generationConfig: { responseModalities: ['TEXT', 'IMAGE'] } })
    });
    const j = await r.json();
    if (!r.ok) return out(502, { error: (j.error && j.error.message) || 'Error de Gemini. Si el mensaje menciona el nombre del modelo, puede que haya cambiado: revisá GEMINI_MODEL en Netlify.' });
    const ps = (j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || [];
    const im = ps.find(p => p.inlineData || p.inline_data);
    if (!im) return out(502, { error: 'Gemini no devolvió imagen. Probá con otra descripción.' });
    const d = im.inlineData || im.inline_data;
    return out(200, { image: d.data, mime: d.mimeType || d.mime_type || 'image/png' });
  } catch (e) { return out(500, { error: e.message }); }
};
