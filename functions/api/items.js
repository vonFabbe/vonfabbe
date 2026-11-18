// Your emails and names:
const USERS = {
  "dogslovegucci@proton.me": "Fabian",
  "williams_dianaw@icloud.com": "Ana",
};

// Fill these two in (see instructions). Neither is secret.
const TEAM_DOMAIN = "bold-band-a153.cloudflareaccess.com";
const AUD = "5d91925a4e08bf2818887d46d16825d54aaa82bf73c3c8ff00c11e8c9dcec7ff";

const b64 = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const txt = (s) => new TextDecoder().decode(b64(s));
let keyCache = null, keyTime = 0;
async function getKeys() {
  if (keyCache && Date.now() - keyTime < 3600e3) return keyCache;
  const r = await fetch(`https://${TEAM_DOMAIN}/cdn-cgi/access/certs`);
  keyCache = (await r.json()).keys; keyTime = Date.now();
  return keyCache;
}
// Checks Cloudflare's signed login token, so the email can't be faked.
async function whoIs(request) {
  const m = (request.headers.get("Cookie") || "").match(/CF_Authorization=([^;]+)/);
  const token = request.headers.get("Cf-Access-Jwt-Assertion") || (m && m[1]);
  if (!token) return { why: "no login token" };
  const [h, p, sig] = token.split(".");
  if (!sig) return { why: "bad token" };
  try {
    const jwk = (await getKeys()).find((k) => k.kid === JSON.parse(txt(h)).kid);
    if (!jwk) return { why: "unknown key" };
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    if (!(await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64(sig), new TextEncoder().encode(h + "." + p)))) return { why: "bad signature" };
    const c = JSON.parse(txt(p));
    if (![].concat(c.aud).includes(AUD)) return { why: "AUD tag doesn't match" };
    if (c.iss !== `https://${TEAM_DOMAIN}`) return { why: "team domain doesn't match" };
    if (c.exp * 1000 < Date.now()) return { why: "login expired" };
    return { email: String(c.email || "").toLowerCase() };
  } catch (e) { return { why: "error: " + e.message }; }
}

const json = (d, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export async function onRequest({ request, env }) {
  const auth = await whoIs(request);
  const email = auth.email || "";
  const me = USERS[email];
  if (!me) return json({ error: "forbidden", why: auth.why || "email not in list" }, 403);
  const other = Object.keys(USERS).find((e) => e !== email);
  const db = env.DB;
  const clean = (s, n) => String(s || "").trim().slice(0, n);
  const link = (s) => (/^https?:\/\//i.test(clean(s, 500)) ? clean(s, 500) : "");

  if (request.method === "GET") {
    const q = (cols, o) =>
      db.prepare(`SELECT ${cols} FROM items WHERE owner=? ORDER BY position, id`).bind(o).all();
    const mine = (await q("id,title,link,note,price", email)).results;
    const theirs = (await q("id,title,link,note,price,claimed", other)).results;
    return json({ me, partner: USERS[other], mine, theirs });
  }

  const b = request.method === "DELETE" ? {} : await request.json().catch(() => ({}));

  if (request.method === "POST") {
    const title = clean(b.title, 200);
    if (!title) return json({ error: "title required" }, 400);
    await db.prepare(
      "INSERT INTO items (owner,title,link,note,price,position) VALUES (?,?,?,?,?,(SELECT COALESCE(MAX(position),0)+1 FROM items WHERE owner=?))"
    ).bind(email, title, link(b.link), clean(b.note, 1000), clean(b.price, 50), email).run();
    return json({ ok: true });
  }

  if (request.method === "PUT") {
    if (Array.isArray(b.order)) {
      const stmt = db.prepare("UPDATE items SET position=? WHERE id=? AND owner=?");
      await db.batch(b.order.slice(0, 500).map((id, i) => stmt.bind(i + 1, id, email)));
    } else if (b.claimed !== undefined) {
      await db.prepare("UPDATE items SET claimed=? WHERE id=? AND owner=?")
        .bind(b.claimed ? 1 : 0, b.id, other).run();
    } else {
      const title = clean(b.title, 200);
      if (!title) return json({ error: "title required" }, 400);
      await db.prepare("UPDATE items SET title=?,link=?,note=?,price=? WHERE id=? AND owner=?")
        .bind(title, link(b.link), clean(b.note, 1000), clean(b.price, 50), b.id, email).run();
    }
    return json({ ok: true });
  }

  if (request.method === "DELETE") {
    await db.prepare("DELETE FROM items WHERE id=? AND owner=?")
      .bind(new URL(request.url).searchParams.get("id"), email).run();
    return json({ ok: true });
  }
  return json({ error: "method" }, 405);
}
